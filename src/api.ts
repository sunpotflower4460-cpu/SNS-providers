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
  return body as T;
}

export function fetchBudget(userId = 'local-user') {
  return apiFetch<BudgetResponse>(`/api/budget?userId=${encodeURIComponent(userId)}`);
}

export function discoverSocialCandidates(mission: Mission, userId = 'local-user') {
  return apiFetch<DiscoveryResponse>('/api/discover/social', {
    method: 'POST',
    body: JSON.stringify({ userId, mission: missionText(mission), maxPerPlatform: 12 }),
  });
}

export function rankCandidates(mission: Mission, candidates: Candidate[], monthlyLimitUsd: number, userId = 'local-user') {
  const selected = selectCandidatesForRanking(mission, candidates.slice(0, 50), 30);
  return apiFetch<RankResponse>('/api/ai/rank', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      mission: missionText(mission),
      communicationDNA: mission.communicationDNA,
      monthlyLimitUsd,
      candidates: selected.map((candidate) => ({
        id: candidate.id,
        username: candidate.username,
        bio: candidate.bio,
        tags: candidate.tags,
        kind: candidate.kind,
        platform: candidate.platform,
        publicMetrics: candidate.publicMetrics,
      })),
    }),
  });
}

export function analyzeSelfProfile(mission: Mission, profileText: string, recentPostsText: string, monthlyLimitUsd: number, userId = 'local-user') {
  const compactProfile = profileText.trim().slice(0, 10_000);
  const compactPosts = recentPostsText.trim().slice(0, 20_000);
  return apiFetch<RankResponse>('/api/ai/rank', {
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
}

export function enrichXProfiles(candidates: Candidate[], monthlyLimitUsd: number, userId = 'local-user') {
  const usernames = [...new Set(candidates.filter((candidate) => candidate.platform === 'x').map((candidate) => candidate.username))].slice(0, 100);
  if (!usernames.length) return Promise.resolve<XEnrichResponse>({ enabled: false, costUsd: 0, profiles: [], reason: 'No X candidates to enrich.' });
  return apiFetch<XEnrichResponse>('/api/x/enrich', {
    method: 'POST',
    body: JSON.stringify({ userId, usernames, monthlyLimitUsd }),
  });
}

function missionText(mission: Mission) {
  return `${mission.primaryGoal}\n${mission.text}\nSecondary: ${mission.secondaryGoals.join(', ')}`;
}
