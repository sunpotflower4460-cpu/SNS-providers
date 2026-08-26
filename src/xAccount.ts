import { apiBaseUrl, apiConfigured } from './api';
import { getSyncToken } from './controlToken';
import { fetchWithTimeout } from './fetchWithTimeout';
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

export interface XFollowEvidenceTarget {
  key: string;
  username: string;
  platformUserId: string | null;
}

export interface XFollowEvidence {
  complete: boolean;
  cycle: number;
  targetCount: number;
  seenKeys: string[];
  unseenKeys: string[];
  targets: XFollowEvidenceTarget[];
}

export interface XOwnedSyncResponse {
  enabled: boolean;
  source: 'x' | 'cache' | 'disabled';
  costUsd: number;
  reason?: string;
  startedAt?: string;
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
  const token = requiredControlToken();
  const result = await request<unknown>(`/api/x/oauth/status?userId=${encodeURIComponent(userId)}`, undefined, token, 30_000);
  if (!validOAuthStatus(result)) throw new Error('X OAuth status returned an invalid success response');
  return result;
}

export async function startXOAuth() {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  const token = requiredControlToken();
  const result = await request<unknown>('/api/x/oauth/start', { method: 'POST' }, token, 30_000);
  if (!isRecord(result) || typeof result.authorizeUrl !== 'string' || !validAuthorizeUrl(result.authorizeUrl)) {
    throw new Error('X認可URLを取得できませんでした');
  }
  window.location.assign(result.authorizeUrl);
}

export async function disconnectXOAuth(userId = 'local-user') {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  const token = requiredControlToken();
  const result = await request<unknown>(`/api/x/oauth/disconnect?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }, token, 30_000);
  if (!isRecord(result) || result.ok !== true) throw new Error('X接続解除の成功応答が不正です');
  return { ok: true };
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
  const result = await request<unknown>('/api/x/owned/sync', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      monthlyLimitUsd,
      maxFollowers: 100,
      maxFollowing: 100,
      maxPosts: 20,
      trackedAccounts,
    }),
  }, token, 90_000);
  if (!validOwnedSyncResponse(result)) throw new Error('X owned sync returned an invalid success response');
  return result;
}

function requiredControlToken() {
  const token = getSyncToken().trim();
  if (!token) throw new Error('先にSettingsの個人管理キーを保存してください');
  return token;
}

async function request<T>(path: string, init?: RequestInit, token?: string, timeoutMs = 30_000): Promise<T> {
  const response = await fetchWithTimeout(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  }, timeoutMs, 'X連携');
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error ? body.error : `X account API returned ${response.status}`;
    throw new Error(message);
  }
  if (body == null) throw new Error('X account API returned an empty or invalid JSON response');
  return body as T;
}

function validOAuthStatus(value: unknown): value is XOAuthStatus {
  return isRecord(value)
    && typeof value.configured === 'boolean'
    && typeof value.connected === 'boolean'
    && Array.isArray(value.scopes)
    && value.scopes.length <= 16
    && value.scopes.every((scope) => typeof scope === 'string' && scope.length <= 80)
    && nullableIso(value.expiresAt)
    && nullableIso(value.updatedAt)
    && (value.refreshable == null || typeof value.refreshable === 'boolean');
}

function validOwnedSyncResponse(value: unknown): value is XOwnedSyncResponse {
  if (!isRecord(value)
    || typeof value.enabled !== 'boolean'
    || !['x', 'cache', 'disabled'].includes(String(value.source || ''))
    || !nonNegativeFinite(value.costUsd)) return false;

  if (!value.enabled) {
    return value.source === 'disabled'
      && value.costUsd === 0
      && value.profile == null
      && value.followers == null
      && value.following == null
      && value.posts == null;
  }
  if (value.source === 'disabled' || !validOwnedUser(value.profile)) return false;
  if (value.source === 'cache' && value.costUsd !== 0) return false;
  if (typeof value.startedAt !== 'string' || !validPastishIso(value.startedAt)) return false;
  if (typeof value.syncedAt !== 'string' || !validPastishIso(value.syncedAt)) return false;
  if (new Date(value.startedAt).getTime() > new Date(value.syncedAt).getTime()) return false;
  if (!Array.isArray(value.followers) || value.followers.length > 500 || !value.followers.every(validOwnedUser) || !uniqueUsers(value.followers)) return false;
  if (!Array.isArray(value.following) || value.following.length > 500 || !value.following.every(validOwnedUser) || !uniqueUsers(value.following)) return false;
  if (!Array.isArray(value.posts) || value.posts.length > 50 || !value.posts.every(validOwnedPost) || !uniqueIds(value.posts)) return false;
  if (!validCoverage(value.coverage) || !validRequested(value.requested) || !validPacing(value.pacing)) return false;
  if (value.followEvidence != null && !validFollowEvidence(value.followEvidence)) return false;

  const coverage = value.coverage as Record<string, unknown>;
  const followersCoverage = coverage.followers as Record<string, unknown>;
  const followingCoverage = coverage.following as Record<string, unknown>;
  const postsCoverage = coverage.posts as Record<string, unknown>;
  const requested = value.requested as Record<string, unknown>;
  if (followersCoverage.fetched !== value.followers.length
    || followingCoverage.fetched !== value.following.length
    || postsCoverage.fetched !== value.posts.length
    || (requested.followers as number) < value.followers.length
    || (requested.following as number) < value.following.length
    || (requested.posts as number) < value.posts.length) return false;

  return true;
}

function validOwnedUser(value: unknown): value is XOwnedUser {
  return isRecord(value)
    && typeof value.id === 'string'
    && /^\d{1,30}$/.test(value.id)
    && typeof value.username === 'string'
    && /^[A-Za-z0-9_]{1,15}$/.test(value.username)
    && typeof value.name === 'string'
    && value.name.length <= 300
    && typeof value.description === 'string'
    && value.description.length <= 5000
    && typeof value.verified === 'boolean'
    && (value.profileImageUrl == null || (typeof value.profileImageUrl === 'string' && validHttpsUrl(value.profileImageUrl)))
    && validMetrics(value.publicMetrics);
}

function validOwnedPost(value: unknown): value is XOwnedPost {
  return isRecord(value)
    && typeof value.id === 'string'
    && /^\d{1,30}$/.test(value.id)
    && typeof value.text === 'string'
    && value.text.length <= 30_000
    && nullablePastishIso(value.createdAt)
    && isRecord(value.publicMetrics)
    && nonNegativeFinite(value.publicMetrics.likes)
    && nonNegativeFinite(value.publicMetrics.replies)
    && nonNegativeFinite(value.publicMetrics.reposts)
    && nonNegativeFinite(value.publicMetrics.quotes);
}

function validCoverage(value: unknown) {
  return isRecord(value)
    && validCoverageSlice(value.followers, 500)
    && validCoverageSlice(value.following, 500)
    && isRecord(value.posts)
    && boundedNonNegativeInteger(value.posts.fetched, 50)
    && typeof value.posts.complete === 'boolean';
}

function validCoverageSlice(value: unknown, maxFetched: number) {
  return isRecord(value)
    && boundedNonNegativeInteger(value.fetched, maxFetched)
    && typeof value.complete === 'boolean'
    && (value.cycle == null || boundedNonNegativeInteger(value.cycle, 1_000_000))
    && (value.rotated == null || typeof value.rotated === 'boolean');
}

function validFollowEvidence(value: unknown): value is XFollowEvidence {
  if (!isRecord(value)
    || typeof value.complete !== 'boolean'
    || !boundedNonNegativeInteger(value.cycle, 1_000_000)
    || !boundedNonNegativeInteger(value.targetCount, 500)
    || !Array.isArray(value.seenKeys)
    || !Array.isArray(value.unseenKeys)
    || !Array.isArray(value.targets)
    || value.seenKeys.length > 500
    || value.unseenKeys.length > 500
    || value.targets.length > 500
    || !value.seenKeys.every(validEvidenceKey)
    || !value.unseenKeys.every(validEvidenceKey)
    || !value.targets.every(validEvidenceTarget)) return false;
  if (!value.complete) return value.seenKeys.length === 0 && value.unseenKeys.length === 0 && value.targets.length === 0;
  const allKeys = [...value.seenKeys, ...value.unseenKeys];
  const targetKeys = value.targets.map((target) => target.key);
  return allKeys.length === value.targetCount
    && value.targets.length === value.targetCount
    && new Set(allKeys).size === allKeys.length
    && new Set(targetKeys).size === targetKeys.length
    && targetKeys.every((key) => allKeys.includes(key));
}

function validEvidenceTarget(value: unknown): value is XFollowEvidenceTarget {
  return isRecord(value)
    && validEvidenceKey(value.key)
    && typeof value.username === 'string'
    && /^[A-Za-z0-9_]{1,15}$/.test(value.username)
    && (value.platformUserId === null || (typeof value.platformUserId === 'string' && /^\d{1,30}$/.test(value.platformUserId)));
}

function validEvidenceKey(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
}

function validRequested(value: unknown) {
  return isRecord(value)
    && boundedNonNegativeInteger(value.followers, 500)
    && boundedNonNegativeInteger(value.following, 500)
    && boundedNonNegativeInteger(value.posts, 50);
}

function validPacing(value: unknown) {
  return isRecord(value)
    && boundedPositiveInteger(value.daysRemaining, 31)
    && nonNegativeFinite(value.pacedCapUsd)
    && nonNegativeFinite(value.globalRemainingUsd);
}

function validMetrics(value: unknown): value is PublicMetrics {
  return isRecord(value)
    && nonNegativeFinite(value.followers)
    && nonNegativeFinite(value.following)
    && nonNegativeFinite(value.posts)
    && (value.listed == null || nonNegativeFinite(value.listed));
}

function uniqueUsers(users: XOwnedUser[]) {
  const ids = new Set<string>();
  const usernames = new Set<string>();
  for (const user of users) {
    const username = user.username.toLowerCase();
    if (ids.has(user.id) || usernames.has(username)) return false;
    ids.add(user.id);
    usernames.add(username);
  }
  return true;
}

function uniqueIds(items: Array<{ id: string }>) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function validAuthorizeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'x.com' && url.pathname === '/i/oauth2/authorize';
  } catch {
    return false;
  }
}

function validHttpsUrl(value: string) {
  if (value.length > 2000) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function nullableIso(value: unknown) {
  return value == null || (typeof value === 'string' && validIso(value));
}

function nullablePastishIso(value: unknown) {
  return value == null || (typeof value === 'string' && validPastishIso(value));
}

function validIso(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

function validPastishIso(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() + 5 * 60 * 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function boundedNonNegativeInteger(value: unknown, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function boundedPositiveInteger(value: unknown, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;
}
