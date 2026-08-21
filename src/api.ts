import type { Candidate, Mission } from './types';

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
