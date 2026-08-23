import { apiBaseUrl, apiConfigured } from './api';
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
  const response = await fetch(`${apiBaseUrl}/api/instagram/engagers/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, maxMedia: 8, maxCommentsPerMedia: 25 }),
  });
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
    || !value.engagers.every(validEngager)) return false;

  if (!value.enabled) return value.source === 'disabled';
  if (value.source === 'disabled') return false;
  if (value.syncedAt != null && (typeof value.syncedAt !== 'string' || !validIso(value.syncedAt))) return false;
  if (value.accountId != null && (typeof value.accountId !== 'string' || !/^\d{4,30}$/.test(value.accountId))) return false;
  if (value.mediaScanned != null && !nonNegativeFinite(value.mediaScanned)) return false;
  if (value.commentEvents != null && !nonNegativeFinite(value.commentEvents)) return false;
  return true;
}

function validEngager(value: unknown): value is InstagramEngager {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.username === 'string'
    && /^[A-Za-z0-9._]{1,30}$/.test(value.username)
    && typeof value.profileUrl === 'string'
    && validInstagramProfileUrl(value.profileUrl, value.username)
    && nonNegativeFinite(value.commentCount)
    && nonNegativeFinite(value.mediaCount)
    && typeof value.lastCommentText === 'string'
    && nullableIso(value.lastCommentAt)
    && (value.latestMediaPermalink == null || (typeof value.latestMediaPermalink === 'string' && validInstagramUrl(value.latestMediaPermalink)));
}

function validInstagramProfileUrl(value: string, username: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const first = url.pathname.split('/').filter(Boolean)[0] || '';
    return url.protocol === 'https:' && host === 'instagram.com' && first.toLowerCase() === username.toLowerCase();
  } catch {
    return false;
  }
}

function validInstagramUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.replace(/^www\./, '').toLowerCase() === 'instagram.com';
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
