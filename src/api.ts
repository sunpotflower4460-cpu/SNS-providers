import type { Candidate, Mission, PublicMetrics } from './types';

const rawBase = import.meta.env.VITE_API_BASE_URL?.trim() || '';
export const apiBaseUrl = rawBase.replace(/\/$/, '');
export const apiConfigured = Boolean(apiBaseUrl);

export interface BudgetResponse {
  usedUsd: number;
  limitUsd: number;
  remainingUsd: number;
}

export interface RankResult {
  id: string;
  match: number;
  kind?: string;
  recommendedAction?: string;
  reason?: string;
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiConfigured) throw new Error('API endpoint is not configured');
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
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

export function rankCandidates(mission: Mission, candidates: Candidate[], monthlyLimitUsd: number, userId = 'local-user') {
  return apiFetch<RankResponse>('/api/ai/rank', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      mission: `${mission.primaryGoal}\n${mission.text}\nSecondary: ${mission.secondaryGoals.join(', ')}`,
      communicationDNA: mission.communicationDNA,
      monthlyLimitUsd,
      candidates: candidates.slice(0, 50).map((candidate) => ({
        id: candidate.id,
        username: candidate.username,
        bio: candidate.bio,
        tags: candidate.tags,
        kind: candidate.kind,
      })),
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
