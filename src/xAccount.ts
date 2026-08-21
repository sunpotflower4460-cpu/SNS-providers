import { apiBaseUrl, apiConfigured } from './api';
import { getSyncToken } from './sync';
import type { Candidate, PublicMetrics } from './types';

export interface XOAuthStatus {
  configured: boolean;
  connected: boolean;
  scopes: string[];
  expiresAt: string | null;
  updatedAt: string | null;
  refreshable?: boolean;
}

export interface XOwnedUser {
  id: string;
  username: string;
  name: string;
  description: string;
  verified: boolean;
  profileImageUrl: string | null;
  publicMetrics: PublicMetrics;
}

export interface XOwnedPost {
  id: string;
  text: string;
  createdAt: string | null;
  publicMetrics: {
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
  };
}

interface XCoverageSlice {
  fetched: number;
  complete: boolean;
  cycle?: number;
  rotated?: boolean;
}

export interface XFollowEvidence {
  complete: boolean;
  cycle: number;
  targetCount: number;
  seenKeys: string[];
  unseenKeys: string[];
}

export interface XOwnedSyncResponse {
  enabled: boolean;
  source: 'x' | 'cache' | 'disabled';
  costUsd: number;
  reason?: string;
  syncedAt?: string;
  profile?: XOwnedUser;
  followers?: XOwnedUser[];
  following?: XOwnedUser[];
  posts?: XOwnedPost[];
  coverage?: {
    followers: XCoverageSlice;
    following: XCoverageSlice;
    posts: { fetched: number; complete: boolean };
  };
  followEvidence?: XFollowEvidence | null;
  requested?: { followers: number; following: number; posts: number };
  pacing?: {
    daysRemaining: number;
    pacedCapUsd: number;
    globalRemainingUsd: number;
  };
}

export async function fetchXOAuthStatus(userId = 'local-user') {
  if (!apiConfigured) return { configured: false, connected: false, scopes: [], expiresAt: null, updatedAt: null, refreshable: false } satisfies XOAuthStatus;
  return request<XOAuthStatus>(`/api/x/oauth/status?userId=${encodeURIComponent(userId)}`);
}

export async function startXOAuth() {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  const token = requiredControlToken();
  const result = await request<{ authorizeUrl: string }>('/api/x/oauth/start', { method: 'POST' }, token);
  if (!result.authorizeUrl) throw new Error('X認可URLを取得できませんでした');
  window.location.assign(result.authorizeUrl);
}

export async function disconnectXOAuth(userId = 'local-user') {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  const token = requiredControlToken();
  return request<{ ok: boolean }>(`/api/x/oauth/disconnect?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }, token);
}

export async function syncOwnedXData(monthlyLimitUsd: number, candidates: Candidate[] = [], userId = 'local-user') {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  const token = requiredControlToken();
  const trackedAccounts = candidates
    .filter((candidate) => candidate.platform === 'x' && Boolean(candidate.followedAt) && !candidate.skipped)
    .slice(0, 500)
    .map((candidate) => ({
      key: candidate.id,
      username: candidate.username,
      platformUserId: candidate.platformUserId || null,
    }));
  return request<XOwnedSyncResponse>('/api/x/owned/sync', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      monthlyLimitUsd,
      maxFollowers: 100,
      maxFollowing: 100,
      maxPosts: 20,
      trackedAccounts,
    }),
  }, token);
}

function requiredControlToken() {
  const token = getSyncToken().trim();
  if (!token) throw new Error('先にSettingsの個人管理キーを保存してください');
  return token;
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error ? body.error : `X account API returned ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}
