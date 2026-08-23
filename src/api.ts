import { getSyncToken } from './controlToken';
import { fetchWithTimeout } from './fetchWithTimeout';
import { selectCandidatesForRanking } from './localFilter';
import { candidateRequestKey, missionRequestKey, selfRequestKey } from './requestContext';
import type { Candidate, Mission, PublicMetrics } from './types';

const rawBase = import.meta.env.VITE_API_BASE_URL?.trim() || '';
export const apiBaseUrl = rawBase.replace(/\/$/, '');
export const apiConfigured = Boolean(apiBaseUrl);

const rankKinds = new Set(['fan', 'artist', 'creator', 'media', 'venue', 'other', 'self_profile']);
const rankActions = new Set(['follow', 'like', 'reply', 'dm', 'review', 'unfollow_review']);

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

export interface XEnrichResponse {
  enabled: boolean;
  costUsd: number;
  profiles: XProfileResult[];
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

export async function discoverSocialCandidates(mission: Mission, userId = 'local-user') {
  const result = await apiFetch<unknown>('/api/discover/social', {
    method: 'POST',
    body: JSON.stringify({ userId, mission: missionText(mission), maxPerPlatform: 20 }),
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
    || !optionalString(result.reason, 2000)) {
    throw new Error('Discovery API returned an invalid success response');
  }
  const validated = result as unknown as DiscoveryResponse;
  if (!validated.enabled && (validated.costUsd !== 0 || validated.credits !== 0 || validated.profiles.length !== 0)) {
    throw new Error('Disabled discovery returned usage or profile data');
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

export async function rankCandidates(mission: Mission, candidates: Candidate[], monthlyLimitUsd: number, userId = 'local-user') {
  // Score the entire local pool before taking the API-sized subset. Slicing first can
  // hide a lower-prior-match candidate that has much stronger relationship/context value.
  const selected = selectCandidatesForRanking(mission, candidates, 30);
  const result = await apiFetch<unknown>('/api/ai/rank', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      mission: missionText(mission),
      communicationDNA: mission.communicationDNA.slice(0, 4000),
      monthlyLimitUsd,
      candidates: selected.map((candidate) => ({
        id: candidate.id,
        username: candidate.username,
        bio: candidate.bio.slice(0, 1200),
        tags: candidate.tags.slice(0, 20),
        kind: candidate.kind,
        platform: candidate.platform,
        publicMetrics: candidate.publicMetrics,
        relationshipStage: candidate.stage,
        relationshipScore: candidate.relationshipScore,
        reason: candidate.reason.slice(0, 800),
        strategy: candidate.strategy?.slice(0, 1000),
        engagementUrl: candidate.engagementUrl,
        followedAt: candidate.followedAt,
        lastInteractionAt: candidate.lastInteractionAt,
        profileSyncedAt: candidate.profileSyncedAt,
      })),
    }),
  }, undefined, 120_000);
  const validated = validateRankResponse(result);
  const selectedById = new Map(selected.map((candidate) => [candidate.id, candidate]));
  if (validated.results.some((item) => !selectedById.has(item.id))) {
    throw new Error('AI ranking returned a result for an unrequested candidate');
  }
  const requestMissionKey = missionRequestKey(mission);
  return {
    ...validated,
    results: validated.results.map((item) => {
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
  const usernames = [...new Set(candidates.filter((candidate) => candidate.platform === 'x').map((candidate) => candidate.username))].slice(0, 100);
  if (!usernames.length) return { enabled: false, costUsd: 0, profiles: [], reason: 'No X candidates to enrich.' } satisfies XEnrichResponse;
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
  const requested = new Set(usernames.map((username) => username.toLowerCase()));
  const returned = validated.profiles.map((profile) => profile.username.toLowerCase());
  if (returned.some((username) => !requested.has(username)) || new Set(returned).size !== returned.length) {
    throw new Error('X enrichment returned an unrequested or duplicate profile');
  }
  return validated;
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
  return platform === 'x'
    ? /^[A-Za-z0-9_]{1,15}$/.test(value)
    : /^[A-Za-z0-9._]{1,30}$/.test(value);
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
