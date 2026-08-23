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
    || !value.engagers.every(validEngager)) return false;

  if (!value.enabled) {
    return value.source === 'disabled'
      && value.externalCostUsd === 0
      && value.engagers.length === 0;
  }
  if (value.source === 'disabled' || value.externalCostUsd !== 0) return false;
  if (typeof value.syncedAt !== 'string' || !validIso(value.syncedAt)) return false;
  if (typeof value.accountId !== 'string' || !/^\d{4,30}$/.test(value.accountId)) return false;
  if (!boundedNonNegativeInteger(value.mediaScanned, 12)) return false;
  if (!boundedNonNegativeInteger(value.commentEvents, 600)) return false;
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
    && nullableIso(value.lastCommentAt)
    && (value.latestMediaPermalink == null || (typeof value.latestMediaPermalink === 'string' && validInstagramMediaUrl(value.latestMediaPermalink)));
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
    const first = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '';
    return url.protocol === 'https:' && host === 'instagram.com' && ['p', 'reel', 'reels', 'tv'].includes(first);
  } catch {
    return false;
  }
}

function nullableIso(value: unknown) {
  return value == null || (typeof value === 'string' && validIso(value));
}

function validIso(value: string) {
  return Number.isFinite(new Date(value).getTime());
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
