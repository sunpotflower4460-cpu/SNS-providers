import { getSyncToken } from './controlToken';
import { fetchWithTimeout } from './fetchWithTimeout';
import { selectCandidatesForRanking } from './localFilter';
import { candidateRequestKey, missionRequestKey, selfRequestKey, xProfileRequestKey } from './requestContext';
import type { Candidate, Mission, PublicMetrics } from './types';

const rawBase = import.meta.env.VITE_API_BASE_URL?.trim() || '';
export const apiBaseUrl = rawBase.replace(/\/$/, '');
export const apiConfigured = Boolean(apiBaseUrl);

const rankKinds = new Set(['fan', 'artist', 'creator', 'media', 'venue', 'other', 'self_profile']);
const rankActions = new Set(['follow', 'like', 'reply', 'dm', 'review', 'unfollow_review']);
const xReservedPaths = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings', 'compose', 'intent']);
const instagramReservedPaths = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer']);

export interface BudgetResponse {
  usedUsd: number;
  limitUsd: number;
  remainingUsd: number;
  ledgerAvailable?: boolean;
}

export interface RankResult {
  id: string;
  match: number;
  kind?: string;
  recommendedAction?: string;
  reason?: string;
  draft?: string;
  strategy?: string;
  requestMissionKey?: string;
  requestCandidateKey?: string;
  requestSelfKey?: string;
}

export interface RankResponse {
  provider: string;
  paid: boolean;
  costUsd: number;
  reason?: string;
  results: RankResult[];
}

export interface XProfileResult {
  id: string;
  name: string;
  username: string;
  description: string;
  verified: boolean;
  createdAt?: string | null;
  publicMetrics: PublicMetrics;
}

export type XProfileResultList = XProfileResult[] & {
  requestCandidateKeys?: Readonly<Record<string, string>>;
};

export interface XEnrichResponse {
  enabled: boolean;
  costUsd: number;
  profiles: XProfileResultList;
  reason?: string;
}

export interface DiscoveredProfileResult {
  platform: 'x' | 'instagram';
  username: string;
  profileUrl: string;
  title: string;
  snippet: string;
  sourceUrl: string;
  score: number;
  requestMissionKey?: string;
}

export interface DiscoveryResponse {
  enabled: boolean;
  provider: string;
  costUsd: number;
  credits: number;
  profiles: DiscoveredProfileResult[];
  reason?: string;
  retryAfterSeconds?: number;
}

async function apiFetch<T>(path: string, init?: RequestInit, tokenOverride?: string, timeoutMs = 120_000): Promise<T> {
  if (!apiConfigured) throw new Error('API endpoint is not configured');
  const token = (tokenOverride ?? getSyncToken()).trim();
  if (!token) throw new Error('先にSettingsで個人管理キーを保存してください');
  const response = await fetchWithTimeout(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  }, timeoutMs, 'Worker API');
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error ? body.error : `API returned ${response.status}`;
    throw new Error(message);
  }
  if (body == null) throw new Error('API returned an empty or invalid JSON response');
  return body as T;
}

export async function fetchBudget(userId = 'local-user', tokenOverride?: string) {
  const result = await apiFetch<unknown>(`/api/budget?userId=${encodeURIComponent(userId)}`, undefined, tokenOverride, 30_000);
  if (!isRecord(result)
    || !nonNegativeFinite(result.usedUsd)
    || !nonNegativeFinite(result.limitUsd)
    || !nonNegativeFinite(result.remainingUsd)
    || (result.ledgerAvailable != null && typeof result.ledgerAvailable !== 'boolean')) {
    throw new Error('Budget API returned an invalid success response');
  }
  return result as unknown as BudgetResponse;
}

export async function discoverSocialCandidates(mission: Mission, userId = 'local-user', automatic = false) {
  const result = await apiFetch<unknown>('/api/discover/social', {
    method: 'POST',
    body: JSON.stringify({ userId, mission: missionText(mission), maxPerPlatform: 20, automatic }),
  }, undefined, 60_000);
  if (!isRecord(result)
    || typeof result.enabled !== 'boolean'
    || !boundedString(result.provider, 1, 80)
    || !nonNegativeFinite(result.costUsd)
    || !nonNegativeFinite(result.credits)
    || !Array.isArray(result.profiles)
    || result.profiles.length > 40
    || !result.profiles.every(validDiscoveredProfile)
    || !uniqueDiscoveredProfiles(result.profiles)
    || !optionalString(result.reason, 2000)
    || !optionalBoundedInteger(result.retryAfterSeconds, 1, 86_400)) {
    throw new Error('Discovery API returned an invalid success response');
  }
  const validated = result as unknown as DiscoveryResponse;
  if (!validated.enabled && (validated.costUsd !== 0 || validated.credits !== 0 || validated.profiles.length !== 0)) {
    throw new Error('Disabled discovery returned usage or profile data');
  }
  if (validated.enabled && validated.retryAfterSeconds != null) {
    throw new Error('Enabled discovery returned an unexpected retry delay');
  }
  if (validated.enabled && validated.costUsd !== 0) {
    throw new Error('Initial free discovery returned a billable response');
  }
  const requestMissionKey = missionRequestKey(mission);
  return {
    ...validated,
    profiles: validated.profiles.map((profile) => ({ ...profile, requestMissionKey })),
  };
}

export async function rankCandidates(
  mission: Mission,
  candidates: Candidate[],
  monthlyLimitUsd: number,
  userId = 'local-user',
  paidAllowed = true,
  draftsEnabled = true,
) {
  // Automatic/free-only ranking must not revisit a candidate that a prior AI pass has
  // already left at review. Both profile-only and concrete-post discoveries start with
  // this reason prefix; any completed ranking pass replaces the reason.
  const rankingPool = paidAllowed
    ? candidates
    : candidates.filter((candidate) => candidate.reason.startsWith('無料Web検索から候補'));
  if (!rankingPool.length) {
    return {
      provider: 'local',
      paid: false,
      costUsd: 0,
      reason: 'Free-only ranking found no untouched web-discovery candidates to evaluate.',
      results: [],
    } satisfies RankResponse;
  }

  // Manual ranking still scores the entire candidate pool before taking 30. The
  // free-only automatic path scores its entire untouched-discovery pool before taking 30.
  const selected = paidAllowed
    ? selectCandidatesForRanking(mission, candidates, 30)
    : selectCandidatesForRanking(mission, rankingPool, 30);
  const result = await apiFetch<unknown>('/api/ai/rank', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      mission: missionText(mission),
      communicationDNA: mission.communicationDNA.slice(0, 4000),
      monthlyLimitUsd,
      paidAllowed,
      draftsEnabled,
      candidates: selected.map((candidate) => ({
        id: candidate.id,
        username: candidate.username,
        bio: candidate.bio.slice(0, 1200),
        tags: candidate.tags.slice(0, 20),
        kind: candidate.kind,
        platform: candidate.platform,
        currentMatch: candidate.match,
        publicMetrics: candidate.publicMetrics,
        relationshipStage: candidate.stage,
        relationshipScore: candidate.relationshipScore,
        reason: candidate.reason.slice(0, 800),
        strategy: candidate.strategy?.slice(0, 1000),
        engagementUrl: candidate.engagementUrl,
        followedAt: candidate.followedAt,
        followBack: candidate.followBack,
        lastInteractionAt: candidate.lastInteractionAt,
        profileSyncedAt: candidate.profileSyncedAt,
      })),
    }),
  }, undefined, 120_000);
  const validated = validateRankResponse(result);
  if (!paidAllowed && (validated.paid || validated.costUsd !== 0)) {
    throw new Error('Free-only ranking returned a paid response');
  }
  const selectedById = new Map(selected.map((candidate) => [candidate.id, candidate]));
  if (validated.results.some((item) => !selectedById.has(item.id))) {
    throw new Error('AI ranking returned a result for an unrequested candidate');
  }
  const completedResults = paidAllowed
    ? validated.results
    : completeFreeOnlyRankingBatch(validated.results, selected);
  const requestMissionKey = missionRequestKey(mission);
  return {
    ...validated,
    results: completedResults.map((item) => {
      const candidate = selectedById.get(item.id)!;
      const exactTargetRequired = item.recommendedAction === 'like' || item.recommendedAction === 'reply';
      const missingExactTarget = exactTargetRequired && !candidate.engagementUrl;
      return {
        ...item,
        recommendedAction: missingExactTarget ? 'review' : item.recommendedAction,
        strategy: missingExactTarget
          ? '具体的な投稿・会話URLがまだないため、いいね/返信先を推測せずプロフィール確認を優先します。次回、実投稿の接点が取れたら自動で実行候補へ上げます。'
          : item.strategy,
        draft: missingExactTarget ? undefined : item.draft,
        requestMissionKey,
        requestCandidateKey: candidateRequestKey(candidate),
      };
    }),
  };
}

function completeFreeOnlyRankingBatch(results: RankResult[], selected: Candidate[]): RankResult[] {
  const returned = new Set(results.map((result) => result.id));
  const omitted = selected
    .filter((candidate) => !returned.has(candidate.id))
    .map((candidate): RankResult => ({
      id: candidate.id,
      match: candidate.match,
      kind: candidate.kind,
      recommendedAction: 'review',
      reason: '無料評価でこの候補の確実な判定が返らなかったため、本人確認を優先します。',
      strategy: 'プロフィールと現在の発信を確認し、判断材料が増えたときに再評価します。',
    }));
  return omitted.length ? [...results, ...omitted] : results;
}

export async function analyzeSelfProfile(mission: Mission, profileText: string, recentPostsText: string, monthlyLimitUsd: number, userId = 'local-user') {
  const compactProfile = profileText.trim().slice(0, 10_000);
  const compactPosts = recentPostsText.trim().slice(0, 20_000);
  const result = await apiFetch<unknown>('/api/ai/rank', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      mission: missionText(mission),
      communicationDNA: mission.communicationDNA.slice(0, 4000),
      monthlyLimitUsd,
      candidates: [{
        id: '__self__',
        username: 'self',
        kind: 'self_profile',
        platform: 'self',
        bio: `PROFILE\n${compactProfile}\n\nRECENT POSTS\n${compactPosts}`,
        tags: ['self-analysis'],
      }],
    }),
  }, undefined, 120_000);
  const validated = validateRankResponse(result);
  if (validated.results.length !== 1 || validated.results[0].id !== '__self__') {
    throw new Error('AI self-analysis returned an invalid result identity');
  }
  return {
    ...validated,
    results: validated.results.map((item) => ({
      ...item,
      requestMissionKey: missionRequestKey(mission),
      requestSelfKey: selfRequestKey(profileText, recentPostsText),
    })),
  };
}

export async function enrichXProfiles(candidates: Candidate[], monthlyLimitUsd: number, userId = 'local-user') {
  const xCandidates = candidates.filter((candidate) => candidate.platform === 'x');
  const usernames = [...new Set(xCandidates.map((candidate) => candidate.username))].slice(0, 100);
  if (!usernames.length) return { enabled: false, costUsd: 0, profiles: [], reason: 'No X candidates to enrich.' } satisfies XEnrichResponse;
  const requested = new Set(usernames.map((username) => username.toLowerCase()));
  const requestCandidateKeys = Object.fromEntries(
    xCandidates
      .filter((candidate) => requested.has(candidate.username.toLowerCase()))
      .map((candidate) => [candidate.id, xProfileRequestKey(candidate)]),
  );
  const result = await apiFetch<unknown>('/api/x/enrich', {
    method: 'POST',
    body: JSON.stringify({ userId, usernames, monthlyLimitUsd }),
  }, undefined, 60_000);
  if (!isRecord(result)
    || typeof result.enabled !== 'boolean'
    || !nonNegativeFinite(result.costUsd)
    || !Array.isArray(result.profiles)
    || !result.profiles.every(validXProfile)
    || !optionalString(result.reason, 2000)) {
    throw new Error('X enrich API returned an invalid success response');
  }
  const validated = result as unknown as XEnrichResponse;
  if (!validated.enabled && (validated.costUsd !== 0 || validated.profiles.length !== 0)) {
    throw new Error('Disabled X enrichment returned billable or profile data');
  }
  const returned = validated.profiles.map((profile) => profile.username.toLowerCase());
  if (returned.some((username) => !requested.has(username)) || new Set(returned).size !== returned.length) {
    throw new Error('X enrichment returned an unrequested or duplicate profile');
  }
  const contextualProfiles = validated.profiles as XProfileResultList;
  // Keep request context client-only. It must not be trusted from or sent to the provider;
  // it simply binds the already validated response to the local records that initiated it.
  Object.defineProperty(contextualProfiles, 'requestCandidateKeys', {
    value: Object.freeze(requestCandidateKeys),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return { ...validated, profiles: contextualProfiles };
}

export interface SocialCapabilitySnapshot {
  instagram: {
    readMentions: boolean;
    readComments: boolean;
    readDm: boolean;
    sendReply: boolean;
    sendCommentReply: boolean;
    sendDm: boolean;
    follow: boolean;
    unfollow: boolean;
    like: boolean;
    configured?: boolean;
    tokenValid?: boolean;
    tokenAvailable?: boolean;
    professionalAccount?: boolean;
    permissionsVerified?: boolean;
    accountTypeSupported?: boolean;
    writeAdapterEnabled?: boolean;
    productionWriteEnabled?: boolean;
    reason?: string;
  };
  x: {
    readMentions: boolean;
    readComments: boolean;
    readDm: boolean;
    sendReply: boolean;
    sendCommentReply: boolean;
    sendDm: boolean;
    follow: boolean;
    unfollow: boolean;
    like: boolean;
    connected?: boolean;
    scopes?: string[];
    reason?: string;
  };
}

export async function fetchSocialCapabilities(userId = 'local-user') {
  const result = await apiFetch<unknown>(`/api/social/capabilities?userId=${encodeURIComponent(userId)}`, undefined, undefined, 30_000);
  if (!isRecord(result) || !validCapabilityBlock(result.instagram) || !validCapabilityBlock(result.x)) {
    throw new Error('Social capability API returned an invalid success response');
  }
  return result as unknown as SocialCapabilitySnapshot;
}

export interface SocialExecuteSuccess {
  ok: true;
  idempotent?: boolean;
  executionId: string;
  status: string;
  certainty?: 'success' | 'failure' | 'unknown';
  externalResultId?: string | null;
  providerStatus?: string;
  metadata?: Record<string, unknown>;
  pendingFollow?: boolean;
}

export interface SocialExecuteFailure {
  ok: false;
  code: string;
  reason: string;
  executionId?: string;
  status?: string;
  certainty?: 'success' | 'failure' | 'unknown';
  retryable?: boolean;
}

export async function snoozeSocialActionRequest(actionId: string, userId = 'local-user') {
  return lifecycleMutation(`/api/social/actions/${encodeURIComponent(actionId)}/snooze`, { userId });
}

export async function dismissSocialActionRequest(actionId: string, userId = 'local-user') {
  return lifecycleMutation(`/api/social/actions/${encodeURIComponent(actionId)}/dismiss`, { userId });
}

async function lifecycleMutation(path: string, body: { userId: string }) {
  if (!apiConfigured) throw new Error('API endpoint is not configured');
  const token = getSyncToken().trim();
  if (!token) throw new Error('先にSettingsで個人管理キーを保存してください');
  const response = await fetchWithTimeout(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }, 20_000, 'Social action lifecycle');
  const payload = await response.json().catch(() => null) as { ok?: boolean; action?: unknown; code?: string; reason?: string; error?: string } | null;
  if (!payload) throw new Error('Lifecycle API returned an empty response');
  if (payload.code === 'NOT_FOUND') return { ok: false as const, code: 'NOT_FOUND' as const, reason: payload.reason };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.reason || payload.error || `API returned ${response.status}`);
  }
  return payload;
}

export async function prepareSocialActionRequest(intent: {
  candidateId: string;
  type: 'follow' | 'like' | 'unfollow_review';
  username?: string;
  platformUserId?: string;
  engagementUrl?: string;
}, userId = 'local-user') {
  return apiFetch<{ ok: boolean; executionMode?: string; action?: { id: string; status?: string; platformUserId?: string; externalEventId?: string }; reason?: string; code?: string }>(
    '/api/social/actions/prepare',
    { method: 'POST', body: JSON.stringify({ userId, ...intent }) },
    undefined,
    30_000,
  );
}

export async function fetchCanonicalSocialActions(userId = 'local-user') {
  const result = await apiFetch<{ ok?: boolean; actions?: Array<{
    id: string;
    status: string;
    snoozedUntil?: string;
    completedAt?: string;
    executionMode?: string;
    type?: string;
    platform?: string;
    source?: string;
    candidateId?: string;
    externalEventId?: string;
    conversationId?: string;
  }> }>(
    `/api/social/actions?userId=${encodeURIComponent(userId)}`,
    undefined,
    undefined,
    20_000,
  );
  return Array.isArray(result.actions) ? result.actions : [];
}

export async function reconcileSocialExecutionRequest(executionId: string, userId = 'local-user') {
  if (!apiConfigured) throw new Error('API endpoint is not configured');
  const token = getSyncToken().trim();
  if (!token) throw new Error('先にSettingsで個人管理キーを保存してください');
  const response = await fetchWithTimeout(`${apiBaseUrl}/api/social/executions/${encodeURIComponent(executionId)}/reconcile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId }),
  }, 45_000, 'Social reconcile');
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) throw new Error('Reconcile API returned an empty response');
  return body;
}

export async function fetchProductionPreflight(userId = 'local-user') {
  return apiFetch<Record<string, unknown>>(`/api/preflight?userId=${encodeURIComponent(userId)}`, undefined, undefined, 30_000);
}

export async function putRuntimeSettings(monthlyBudgetCeilingUsd: number, userId = 'local-user') {
  return apiFetch<{ monthlyBudgetCeilingUsd: number; effectiveLimitUsd: number }>('/api/settings/runtime', {
    method: 'PUT',
    body: JSON.stringify({ userId, monthlyBudgetCeilingUsd }),
  });
}

export async function syncSocialInbox(userId = 'local-user', monthlyLimitUsd: number) {
  return apiFetch<Record<string, unknown>>('/api/social/inbox/sync', {
    method: 'POST',
    body: JSON.stringify({ userId, monthlyLimitUsd }),
  }, undefined, 90_000);
}

export async function syncXDirectMessages(userId = 'local-user', monthlyLimitUsd?: number) {
  return apiFetch<{ enabled: boolean; events?: unknown[]; reason?: string; costUsd?: number }>('/api/x/dm/sync', {
    method: 'POST',
    body: JSON.stringify({ userId, monthlyLimitUsd }),
  }, undefined, 60_000);
}

export async function syncInstagramDirectMessages(userId = 'local-user', monthlyLimitUsd?: number) {
  return apiFetch<{ enabled: boolean; events?: unknown[]; reason?: string; costUsd?: number }>('/api/instagram/dm/sync', {
    method: 'POST',
    body: JSON.stringify({ userId, monthlyLimitUsd }),
  }, undefined, 60_000);
}

export async function executeSocialActionRequest(
  actionId: string,
  payload: { executionId: string; draft: string },
  userId = 'local-user',
): Promise<SocialExecuteSuccess | SocialExecuteFailure> {
  if (!apiConfigured) throw new Error('API endpoint is not configured');
  const token = getSyncToken().trim();
  if (!token) throw new Error('先にSettingsで個人管理キーを保存してください');
  const response = await fetchWithTimeout(`${apiBaseUrl}/api/social/actions/${encodeURIComponent(actionId)}/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, executionId: payload.executionId, draft: payload.draft }),
  }, 45_000, 'Social execute');
  const body = await response.json().catch(() => null) as unknown;
  if (!isRecord(body)) throw new Error('Execute API returned an empty or invalid JSON response');
  if (body.ok === true && typeof body.executionId === 'string') {
    return body as unknown as SocialExecuteSuccess;
  }
  const reason = typeof body.reason === 'string' && body.reason
    ? body.reason
    : typeof body.error === 'string' && body.error
      ? body.error
      : `Execute returned ${response.status}`;
  return {
    ok: false,
    code: typeof body.code === 'string' ? body.code : 'INVALID_ACTION',
    reason,
    executionId: typeof body.executionId === 'string' ? body.executionId : payload.executionId,
    status: typeof body.status === 'string' ? body.status : undefined,
    certainty: body.certainty === 'success' || body.certainty === 'failure' || body.certainty === 'unknown' ? body.certainty : undefined,
    retryable: body.retryable === true,
  };
}

export interface XInboundEventResult {
  id: string;
  actionId: string;
  type: 'mention' | 'reply';
  externalEventId: string;
  externalUserId?: string;
  username?: string;
  text?: string;
  conversationId?: string;
  permalink?: string;
  occurredAt: string;
}

export interface XInboundSyncResponse {
  enabled: boolean;
  source: string;
  costUsd: number;
  reason?: string;
  syncedAt?: string;
  events: XInboundEventResult[];
}

export async function syncXInbound(userId = 'local-user', monthlyLimitUsd?: number) {
  const result = await apiFetch<unknown>('/api/x/inbound/sync', {
    method: 'POST',
    body: JSON.stringify({ userId, monthlyLimitUsd, maxResults: 20 }),
  }, undefined, 60_000);
  if (!isRecord(result)
    || typeof result.enabled !== 'boolean'
    || !boundedString(result.source, 1, 80)
    || !nonNegativeFinite(result.costUsd)
    || !Array.isArray(result.events)
    || result.events.length > 80
    || !result.events.every(validXInboundEvent)
    || !optionalString(result.reason, 2000)
    || (result.syncedAt != null && !validIso(result.syncedAt))) {
    throw new Error('X inbound API returned an invalid success response');
  }
  const validated = result as unknown as XInboundSyncResponse;
  if (!validated.enabled && (validated.events.length !== 0 || (validated.costUsd !== 0 && !validated.reason))) {
    throw new Error('Disabled X inbound sync returned unexpected event data');
  }
  return validated;
}

function validCapabilityBlock(value: unknown) {
  return isRecord(value)
    && typeof value.readMentions === 'boolean'
    && typeof value.readComments === 'boolean'
    && typeof value.readDm === 'boolean'
    && typeof value.sendReply === 'boolean'
    && typeof value.sendCommentReply === 'boolean'
    && typeof value.sendDm === 'boolean'
    && typeof value.follow === 'boolean'
    && typeof value.unfollow === 'boolean'
    && typeof value.like === 'boolean';
}

function validXInboundEvent(value: unknown) {
  return isRecord(value)
    && boundedString(value.id, 1, 180)
    && boundedString(value.actionId, 1, 180)
    && (value.type === 'mention' || value.type === 'reply')
    && typeof value.externalEventId === 'string'
    && /^\d{1,30}$/.test(value.externalEventId)
    && (value.externalUserId == null || (typeof value.externalUserId === 'string' && /^\d{1,30}$/.test(value.externalUserId)))
    && optionalString(value.username, 15)
    && optionalString(value.text, 4000)
    && optionalString(value.conversationId, 30)
    && optionalString(value.permalink, 2000)
    && validIso(value.occurredAt);
}

function validateRankResponse(value: unknown): RankResponse {
  if (!isRecord(value)
    || !boundedString(value.provider, 1, 80)
    || typeof value.paid !== 'boolean'
    || !nonNegativeFinite(value.costUsd)
    || !Array.isArray(value.results)
    || value.results.length === 0
    || value.results.length > 50
    || !value.results.every(validRankResult)
    || !uniqueResultIds(value.results)
    || !optionalString(value.reason, 2000)) {
    throw new Error('AI ranking API returned an invalid success response');
  }
  if (value.paid === false && value.costUsd !== 0) throw new Error('Free AI ranking returned a billable response');
  return value as unknown as RankResponse;
}

function validRankResult(value: unknown) {
  return isRecord(value)
    && boundedString(value.id, 1, 180)
    && finiteNumber(value.match)
    && value.match >= 0
    && value.match <= 100
    && (value.kind == null || (typeof value.kind === 'string' && rankKinds.has(value.kind)))
    && (value.recommendedAction == null || (typeof value.recommendedAction === 'string' && rankActions.has(value.recommendedAction)))
    && optionalString(value.reason, 2400)
    && optionalString(value.strategy, 3200)
    && optionalString(value.draft, 2400);
}

function validDiscoveredProfile(value: unknown) {
  if (!isRecord(value) || (value.platform !== 'x' && value.platform !== 'instagram')) return false;
  return validSocialUsername(value.platform, value.username)
    && validOfficialSocialUrl(value.platform, value.profileUrl, true)
    && validOfficialSocialUrl(value.platform, value.sourceUrl, false)
    && boundedString(value.title, 0, 300)
    && boundedString(value.snippet, 0, 2000)
    && finiteNumber(value.score)
    && value.score >= 0
    && value.score <= 1;
}

function validXProfile(value: unknown) {
  return isRecord(value)
    && boundedString(value.id, 1, 30)
    && /^\d{1,30}$/.test(value.id)
    && validSocialUsername('x', value.username)
    && boundedString(value.name, 0, 300)
    && boundedString(value.description, 0, 5000)
    && typeof value.verified === 'boolean'
    && (value.createdAt == null || validIso(value.createdAt))
    && validMetrics(value.publicMetrics);
}

function validMetrics(value: unknown) {
  return isRecord(value)
    && nonNegativeFinite(value.followers)
    && nonNegativeFinite(value.following)
    && nonNegativeFinite(value.posts)
    && (value.listed == null || nonNegativeFinite(value.listed));
}

function uniqueResultIds(results: unknown[]) {
  const ids = results.map((item) => isRecord(item) && typeof item.id === 'string' ? item.id : '');
  return new Set(ids).size === ids.length;
}

function uniqueDiscoveredProfiles(profiles: unknown[]) {
  const keys = profiles.map((profile) => {
    if (!isRecord(profile) || typeof profile.platform !== 'string' || typeof profile.username !== 'string') return '';
    return `${profile.platform}:${profile.username.toLowerCase()}`;
  });
  return keys.every(Boolean) && new Set(keys).size === keys.length;
}

function validSocialUsername(platform: 'x' | 'instagram', value: unknown) {
  if (typeof value !== 'string') return false;
  const lowered = value.toLowerCase();
  if (platform === 'x') {
    return !xReservedPaths.has(lowered) && /^[A-Za-z0-9_]{1,15}$/.test(value);
  }
  return !instagramReservedPaths.has(lowered) && /^[A-Za-z0-9._]{1,30}$/.test(value);
}

function validOfficialSocialUrl(platform: 'x' | 'instagram', value: unknown, profileOnly: boolean) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const allowedHosts = platform === 'x' ? new Set(['x.com', 'twitter.com']) : new Set(['instagram.com']);
    if (!allowedHosts.has(host)) return false;
    if (!profileOnly) return true;
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length === 1 && validSocialUsername(platform, parts[0].replace(/^@/, ''));
  } catch {
    return false;
  }
}

function validIso(value: unknown) {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function optionalString(value: unknown, maxLength: number) {
  return value == null || (typeof value === 'string' && value.length <= maxLength);
}

function optionalBoundedInteger(value: unknown, min: number, max: number) {
  return value == null || (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max);
}

function boundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeFinite(value: unknown): value is number {
  return finiteNumber(value) && value >= 0;
}

function missionText(mission: Mission) {
  return `${mission.primaryGoal.trim()}\n${mission.text.trim()}\nSecondary: ${mission.secondaryGoals.join(', ')}`.slice(0, 4000);
}