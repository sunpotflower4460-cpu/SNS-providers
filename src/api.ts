import { getSyncToken } from './controlToken';
import { selectCandidatesForRanking } from './localFilter';
import type { Candidate, Mission, PublicMetrics } from './types';

const rawBase = import.meta.env.VITE_API_BASE_URL?.trim() || '';
export const apiBaseUrl = rawBase.replace(/\/$/, '');
export const apiConfigured = Boolean(apiBaseUrl);

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
}

export interface DiscoveryResponse {
  enabled: boolean;
  provider: string;
  costUsd: number;
  credits: number;
  profiles: DiscoveredProfileResult[];
  reason?: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiConfigured) throw new Error('API endpoint is not configured');
  const token = getSyncToken().trim();
  if (!token) throw new Error('先にSettingsで個人管理キーを保存してください');
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error ? body.error : `API returned ${response.status}`;
    throw new Error(message);
  }
  if (body == null) throw new Error('API returned an empty or invalid JSON response');
  return body as T;
}

export async function fetchBudget(userId = 'local-user') {
  const result = await apiFetch<unknown>(`/api/budget?userId=${encodeURIComponent(userId)}`);
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
    body: JSON.stringify({ userId, mission: missionText(mission), maxPerPlatform: 12 }),
  });
  if (!isRecord(result)
    || typeof result.enabled !== 'boolean'
    || typeof result.provider !== 'string'
    || !nonNegativeFinite(result.costUsd)
    || !nonNegativeFinite(result.credits)
    || !Array.isArray(result.profiles)
    || !result.profiles.every(validDiscoveredProfile)) {
    throw new Error('Discovery API returned an invalid success response');
  }
  return result as unknown as DiscoveryResponse;
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
      communicationDNA: mission.communicationDNA,
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
      })),
    }),
  });
  return validateRankResponse(result);
}

export async function analyzeSelfProfile(mission: Mission, profileText: string, recentPostsText: string, monthlyLimitUsd: number, userId = 'local-user') {
  const compactProfile = profileText.trim().slice(0, 10_000);
  const compactPosts = recentPostsText.trim().slice(0, 20_000);
  const result = await apiFetch<unknown>('/api/ai/rank', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      mission: missionText(mission),
      communicationDNA: mission.communicationDNA,
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
  });
  return validateRankResponse(result);
}

export async function enrichXProfiles(candidates: Candidate[], monthlyLimitUsd: number, userId = 'local-user') {
  const usernames = [...new Set(candidates.filter((candidate) => candidate.platform === 'x').map((candidate) => candidate.username))].slice(0, 100);
  if (!usernames.length) return { enabled: false, costUsd: 0, profiles: [], reason: 'No X candidates to enrich.' } satisfies XEnrichResponse;
  const result = await apiFetch<unknown>('/api/x/enrich', {
    method: 'POST',
    body: JSON.stringify({ userId, usernames, monthlyLimitUsd }),
  });
  if (!isRecord(result)
    || typeof result.enabled !== 'boolean'
    || !nonNegativeFinite(result.costUsd)
    || !Array.isArray(result.profiles)
    || !result.profiles.every(validXProfile)) {
    throw new Error('X enrich API returned an invalid success response');
  }
  return result as unknown as XEnrichResponse;
}

function validateRankResponse(value: unknown): RankResponse {
  if (!isRecord(value)
    || typeof value.provider !== 'string'
    || typeof value.paid !== 'boolean'
    || !nonNegativeFinite(value.costUsd)
    || !Array.isArray(value.results)
    || !value.results.every(validRankResult)) {
    throw new Error('AI ranking API returned an invalid success response');
  }
  return value as unknown as RankResponse;
}

function validRankResult(value: unknown) {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && finiteNumber(value.match);
}

function validDiscoveredProfile(value: unknown) {
  return isRecord(value)
    && (value.platform === 'x' || value.platform === 'instagram')
    && typeof value.username === 'string'
    && value.username.length > 0
    && typeof value.profileUrl === 'string'
    && typeof value.title === 'string'
    && typeof value.snippet === 'string'
    && typeof value.sourceUrl === 'string'
    && finiteNumber(value.score);
}

function validXProfile(value: unknown) {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.username === 'string'
    && typeof value.name === 'string'
    && typeof value.description === 'string'
    && typeof value.verified === 'boolean'
    && validMetrics(value.publicMetrics);
}

function validMetrics(value: unknown) {
  return isRecord(value)
    && nonNegativeFinite(value.followers)
    && nonNegativeFinite(value.following)
    && nonNegativeFinite(value.posts)
    && (value.listed == null || nonNegativeFinite(value.listed));
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
  return `${mission.primaryGoal}\n${mission.text}\nSecondary: ${mission.secondaryGoals.join(', ')}`;
}
