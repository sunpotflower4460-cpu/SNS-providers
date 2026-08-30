import { apiBaseUrl, apiConfigured } from './api';
import { fetchWithTimeout } from './fetchWithTimeout';
import { getSyncToken } from './sync';

export interface InstagramEngager {
  id: string;
  username: string;
  profileUrl: string;
  commentCount: number;
  mediaCount: number;
  lastCommentText: string;
  lastCommentAt: string | null;
  latestCommentId: string | null;
  mediaId: string | null;
  latestMediaPermalink: string | null;
}

export interface InstagramEngagerSyncResponse {
  enabled: boolean;
  source: 'instagram' | 'cache' | 'disabled';
  externalCostUsd: number;
  reason?: string;
  syncedAt?: string;
  accountId?: string;
  mediaScanned?: number;
  commentEvents?: number;
  engagers: InstagramEngager[];
}

export async function syncInstagramEngagers(userId = 'local-user') {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  const token = getSyncToken().trim();
  if (!token) throw new Error('先にSettingsの個人管理キーを保存してください');
  const response = await fetchWithTimeout(`${apiBaseUrl}/api/instagram/engagers/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, maxMedia: 8, maxCommentsPerMedia: 25 }),
  }, 90_000, 'Instagram同期');
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === 'string' && body.error ? body.error : `Instagram sync returned ${response.status}`;
    throw new Error(message);
  }
  if (!validInstagramResponse(body)) throw new Error('Instagram sync returned an invalid success response');
  return body;
}

function validInstagramResponse(value: unknown): value is InstagramEngagerSyncResponse {
  if (!isRecord(value)
    || typeof value.enabled !== 'boolean'
    || !['instagram', 'cache', 'disabled'].includes(String(value.source || ''))
    || !nonNegativeFinite(value.externalCostUsd)
    || !Array.isArray(value.engagers)
    || value.engagers.length > 80
    || !value.engagers.every(validEngager)
    || !uniqueEngagers(value.engagers as InstagramEngager[])) return false;

  if (!value.enabled) {
    return value.source === 'disabled'
      && value.externalCostUsd === 0
      && value.engagers.length === 0;
  }
  if (value.source === 'disabled' || value.externalCostUsd !== 0) return false;
  if (typeof value.syncedAt !== 'string' || !validPastishIso(value.syncedAt)) return false;
  if (typeof value.accountId !== 'string' || !/^\d{4,30}$/.test(value.accountId)) return false;
  if (!boundedNonNegativeInteger(value.mediaScanned, 12)) return false;
  if (!boundedNonNegativeInteger(value.commentEvents, 600)) return false;

  const mediaScanned = value.mediaScanned as number;
  const commentEvents = value.commentEvents as number;
  const engagers = value.engagers as InstagramEngager[];
  if (engagers.some((engager) => engager.mediaCount > mediaScanned)) return false;
  const countedExternalComments = engagers.reduce((sum, engager) => sum + engager.commentCount, 0);
  if (countedExternalComments > commentEvents) return false;
  return true;
}

function validEngager(value: unknown): value is InstagramEngager {
  return isRecord(value)
    && typeof value.id === 'string'
    && /^(?:\d{1,30}|username:[A-Za-z0-9._]{1,30})$/.test(value.id)
    && typeof value.username === 'string'
    && /^[A-Za-z0-9._]{1,30}$/.test(value.username)
    && typeof value.profileUrl === 'string'
    && validInstagramProfileUrl(value.profileUrl, value.username)
    && boundedPositiveInteger(value.commentCount, 600)
    && boundedPositiveInteger(value.mediaCount, 12)
    && typeof value.lastCommentText === 'string'
    && value.lastCommentText.length <= 500
    && nullablePastishIso(value.lastCommentAt)
    && (value.latestCommentId == null || (typeof value.latestCommentId === 'string' && /^\d{1,30}$/.test(value.latestCommentId)))
    && (value.mediaId == null || (typeof value.mediaId === 'string' && /^\d{1,30}$/.test(value.mediaId)))
    && (value.latestMediaPermalink == null || (typeof value.latestMediaPermalink === 'string' && validInstagramMediaUrl(value.latestMediaPermalink)))
    && sameLatestCommentEvent(value as InstagramEngager);
}

function sameLatestCommentEvent(engager: InstagramEngager) {
  if (engager.latestCommentId == null && engager.mediaId == null) return true;
  return Boolean(engager.latestCommentId && engager.mediaId);
}

function uniqueEngagers(engagers: InstagramEngager[]) {
  const ids = new Set<string>();
  const usernames = new Set<string>();
  for (const engager of engagers) {
    const username = engager.username.toLowerCase();
    if (ids.has(engager.id) || usernames.has(username)) return false;
    ids.add(engager.id);
    usernames.add(username);
  }
  return true;
}

function validInstagramProfileUrl(value: string, username: string) {
  if (value.length > 2000) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:'
      && host === 'instagram.com'
      && parts.length === 1
      && parts[0].toLowerCase() === username.toLowerCase();
  } catch {
    return false;
  }
}

function validInstagramMediaUrl(value: string) {
  if (value.length > 2000) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const [kind, shortcode] = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:'
      && host === 'instagram.com'
      && ['p', 'reel', 'reels', 'tv'].includes((kind || '').toLowerCase())
      && /^[A-Za-z0-9_-]{1,100}$/.test(shortcode || '');
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
