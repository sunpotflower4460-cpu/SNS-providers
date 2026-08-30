import { fetchWithTimeout } from './fetchWithTimeout';

export interface InstagramOwnedEnv {
  DB: D1Database;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_API_VERSION?: string;
}

export interface InstagramOwnedSyncRequest {
  userId?: string;
  maxMedia?: number;
  maxCommentsPerMedia?: number;
  force?: boolean;
}

interface GraphPage<T> {
  data?: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
  };
}

interface InstagramMedia {
  id: string;
  caption?: string;
  permalink?: string;
  timestamp?: string;
}

interface InstagramComment {
  id: string;
  text?: string;
  timestamp?: string;
  from?: {
    id?: string;
    username?: string;
  };
}

interface EngagerAccumulator {
  id: string;
  username: string;
  commentCount: number;
  mediaIds: Set<string>;
  latestCommentId: string | null;
  lastCommentText: string;
  lastCommentAt: string | null;
  mediaId: string | null;
  latestMediaPermalink: string | null;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const INSTAGRAM_RESERVED_PATHS = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer']);

export async function syncInstagramEngagers(env: InstagramOwnedEnv, body: InstagramOwnedSyncRequest) {
  const userId = sanitizeUserId(body.userId || 'local-user');
  const accessToken = env.INSTAGRAM_ACCESS_TOKEN?.trim();
  const instagramUserId = env.INSTAGRAM_USER_ID?.trim();
  const apiVersion = env.INSTAGRAM_API_VERSION?.trim();
  if (!accessToken || !instagramUserId || !apiVersion) {
    return disabled('Instagram Professional sync requires INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID and INSTAGRAM_API_VERSION.');
  }
  if (!/^v\d+\.\d+$/.test(apiVersion)) return disabled('INSTAGRAM_API_VERSION must look like v24.0.');
  if (!/^\d{4,30}$/.test(instagramUserId)) return disabled('INSTAGRAM_USER_ID is invalid.');

  const cached = await loadFreshCache(env, userId, Boolean(body.force), instagramUserId);
  if (cached) return { ...cached, source: 'cache', externalCostUsd: 0 };

  const maxMedia = clampInt(body.maxMedia, 8, 1, 12);
  const maxCommentsPerMedia = clampInt(body.maxCommentsPerMedia, 25, 1, 50);
  const media = await fetchMedia(accessToken, apiVersion, instagramUserId, maxMedia);
  const commentPages = await Promise.all(media.map((item) => fetchComments(accessToken, apiVersion, item.id, maxCommentsPerMedia)));

  // Username is the stable merge key within one response. Some Graph responses can omit
  // from.id on individual comments; keying by id-or-username would split one person into
  // two accumulators and make the final unique-username validation reject the whole sync.
  const engagers = new Map<string, EngagerAccumulator>();
  let commentEvents = 0;
  for (let index = 0; index < media.length; index += 1) {
    const item = media[index];
    const comments = commentPages[index];
    for (const comment of comments) {
      commentEvents += 1;
      const fromId = comment.from?.id?.trim() || '';
      const username = sanitizeUsername(comment.from?.username || '');
      if (!username || fromId === instagramUserId) continue;
      const key = username.toLowerCase();
      const existing = engagers.get(key) || {
        id: fromId || `username:${key}`,
        username,
        commentCount: 0,
        mediaIds: new Set<string>(),
        latestCommentId: null,
        lastCommentText: '',
        lastCommentAt: null,
        mediaId: null,
        latestMediaPermalink: null,
      };
      if (fromId) {
        if (existing.id.startsWith('username:')) existing.id = fromId;
        else if (existing.id !== fromId) {
          throw new Error('Instagram Graph API returned inconsistent commenter identity for one username');
        }
      }
      existing.commentCount += 1;
      existing.mediaIds.add(item.id);
      if (isLater(comment.timestamp, existing.lastCommentAt)) {
        existing.lastCommentAt = comment.timestamp || existing.lastCommentAt;
        existing.lastCommentText = (comment.text || '').trim().slice(0, 500);
        existing.latestCommentId = comment.id;
        existing.mediaId = item.id;
        // Keep the concrete action target bound to the exact same comment event as
        // lastCommentAt/lastCommentText/latestCommentId/mediaId. If this newest media
        // lacks a permalink, do not inherit an older post URL.
        existing.latestMediaPermalink = item.permalink || null;
      }
      engagers.set(key, existing);
    }
  }

  const syncedAt = new Date().toISOString();
  const result = {
    enabled: true,
    source: 'instagram',
    externalCostUsd: 0,
    syncedAt,
    accountId: instagramUserId,
    mediaScanned: media.length,
    commentEvents,
    engagers: [...engagers.values()]
      .sort((a, b) => b.commentCount - a.commentCount || (b.lastCommentAt || '').localeCompare(a.lastCommentAt || ''))
      .slice(0, 80)
      .map((entry) => ({
        id: entry.id,
        username: entry.username,
        profileUrl: `https://www.instagram.com/${entry.username}/`,
        commentCount: entry.commentCount,
        mediaCount: entry.mediaIds.size,
        lastCommentText: entry.lastCommentText,
        lastCommentAt: entry.lastCommentAt,
        latestCommentId: entry.latestCommentId,
        mediaId: entry.mediaId,
        latestMediaPermalink: entry.latestMediaPermalink,
      })),
  };

  if (!validInstagramSnapshot(result, instagramUserId)) {
    throw new Error('Instagram Graph API produced an invalid engager snapshot');
  }
  await saveCache(env, userId, result);
  await recordUsage(env, userId, media.length, commentEvents);
  return result;
}

function disabled(reason: string) {
  return { enabled: false, source: 'disabled', externalCostUsd: 0, reason, engagers: [] };
}

async function fetchMedia(token: string, version: string, instagramUserId: string, limit: number) {
  const params = new URLSearchParams({
    fields: 'id,caption,permalink,timestamp',
    limit: String(limit),
  });
  const result = await graphFetch<GraphPage<unknown>>(`https://graph.instagram.com/${version}/${encodeURIComponent(instagramUserId)}/media?${params.toString()}`, token);
  if (result.data == null) return [];
  if (!Array.isArray(result.data)
    || result.data.length > limit
    || !result.data.every(validRawMedia)
    || !uniqueRawIds(result.data)) {
    throw new Error('Instagram media endpoint returned malformed or duplicate media data');
  }
  return result.data as InstagramMedia[];
}

async function fetchComments(token: string, version: string, mediaId: string, limit: number) {
  const params = new URLSearchParams({
    fields: 'id,from,text,timestamp',
    limit: String(limit),
  });
  const result = await graphFetch<GraphPage<unknown>>(`https://graph.instagram.com/${version}/${encodeURIComponent(mediaId)}/comments?${params.toString()}`, token);
  if (result.data == null) return [];
  if (!Array.isArray(result.data)
    || result.data.length > limit
    || !result.data.every(validRawComment)
    || !uniqueRawIds(result.data)) {
    throw new Error('Instagram comments endpoint returned malformed or duplicate comment data');
  }
  return result.data as InstagramComment[];
}

async function graphFetch<T>(url: string, token: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  }, 30_000, 'Instagram Graph API');
  const body = await response.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) {
    const detail = body && typeof body === 'object' && body.error?.message ? `: ${body.error.message.slice(0, 180)}` : '';
    throw new Error(`Instagram Graph API returned ${response.status}${detail}`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Instagram Graph API returned an empty or invalid JSON response');
  return body as T;
}

async function loadFreshCache(env: InstagramOwnedEnv, userId: string, force: boolean, expectedAccountId: string) {
  if (force) return null;
  try {
    const row = await env.DB.prepare('SELECT snapshot_json, synced_at FROM instagram_engager_snapshots WHERE user_id = ?')
      .bind(userId)
      .first<{ snapshot_json: string; synced_at: string }>();
    if (!row) return null;
    const snapshot = JSON.parse(row.snapshot_json) as unknown;
    if (!isRecord(snapshot)
      || snapshot.accountId !== expectedAccountId
      || !validInstagramSnapshot(snapshot, expectedAccountId)
      || snapshot.syncedAt !== row.synced_at) {
      await deleteCache(env, userId);
      return null;
    }
    // Freshness belongs to the observation stored inside the snapshot, not a separately
    // mutable row timestamp. Binding the two exactly prevents an old snapshot from being
    // made fresh again by touching only instagram_engager_snapshots.synced_at.
    const syncedAtMs = new Date(snapshot.syncedAt as string).getTime();
    if (!Number.isFinite(syncedAtMs) || syncedAtMs > Date.now() + 60_000 || Date.now() - syncedAtMs > CACHE_TTL_MS) return null;
    return snapshot;
  } catch {
    return null;
  }
}

async function deleteCache(env: InstagramOwnedEnv, userId: string) {
  try {
    await env.DB.prepare('DELETE FROM instagram_engager_snapshots WHERE user_id = ?').bind(userId).run();
  } catch {
    // Invalid cache is ignored even if cleanup cannot be persisted.
  }
}

async function saveCache(env: InstagramOwnedEnv, userId: string, snapshot: unknown) {
  try {
    if (!isRecord(snapshot) || typeof snapshot.syncedAt !== 'string' || !validPastishIso(snapshot.syncedAt)) return;
    await env.DB.prepare(
      `INSERT INTO instagram_engager_snapshots (user_id, snapshot_json, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, synced_at = excluded.synced_at`
    ).bind(userId, JSON.stringify(snapshot), snapshot.syncedAt).run();
  } catch {
    // A cache failure must not discard successfully fetched engagement data.
  }
}

async function recordUsage(env: InstagramOwnedEnv, userId: string, mediaCount: number, commentCount: number) {
  try {
    await env.DB.prepare(
      'INSERT INTO budget_ledger (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?)'
    ).bind(crypto.randomUUID(), userId, 'instagram', 'owned_comments_sync', mediaCount, commentCount, new Date().toISOString()).run();
  } catch {
    // Meta calls are not part of the paid-provider HARD LIMIT in this adapter.
  }
}

function validRawMedia(value: unknown): value is InstagramMedia {
  return isRecord(value)
    && typeof value.id === 'string'
    && /^\d{1,30}$/.test(value.id)
    && (value.caption == null || (typeof value.caption === 'string' && value.caption.length <= 30_000))
    && (value.permalink == null || (typeof value.permalink === 'string' && validInstagramMediaUrl(value.permalink)))
    && (value.timestamp == null || (typeof value.timestamp === 'string' && validPastishIso(value.timestamp)));
}

function validRawComment(value: unknown): value is InstagramComment {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !/^\d{1,30}$/.test(value.id)
    || (value.text != null && (typeof value.text !== 'string' || value.text.length > 10_000))
    || (value.timestamp != null && (typeof value.timestamp !== 'string' || !validPastishIso(value.timestamp)))) return false;
  if (value.from == null) return true;
  if (!isRecord(value.from)) return false;
  return (value.from.id == null || (typeof value.from.id === 'string' && /^\d{1,30}$/.test(value.from.id)))
    && (value.from.username == null || (typeof value.from.username === 'string' && Boolean(sanitizeUsername(value.from.username))));
}

function uniqueRawIds(items: unknown[]) {
  const ids = items.map((item) => isRecord(item) && typeof item.id === 'string' ? item.id : '');
  return ids.every(Boolean) && new Set(ids).size === ids.length;
}

function validInstagramSnapshot(value: unknown, expectedAccountId: string) {
  if (!isRecord(value)
    || value.enabled !== true
    || value.source !== 'instagram'
    || value.externalCostUsd !== 0
    || typeof value.syncedAt !== 'string'
    || !validPastishIso(value.syncedAt)
    || value.accountId !== expectedAccountId
    || !boundedNonNegativeInteger(value.mediaScanned, 12)
    || !boundedNonNegativeInteger(value.commentEvents, 600)
    || !Array.isArray(value.engagers)
    || value.engagers.length > 80
    || !value.engagers.every(validEngager)
    || !uniqueEngagers(value.engagers)) return false;

  const mediaScanned = value.mediaScanned as number;
  const commentEvents = value.commentEvents as number;
  const engagers = value.engagers as Array<Record<string, unknown>>;
  if (engagers.some((engager) => (engager.mediaCount as number) > mediaScanned)) return false;
  return engagers.reduce((sum, engager) => sum + (engager.commentCount as number), 0) <= commentEvents;
}

function validEngager(value: unknown) {
  return isRecord(value)
    && typeof value.id === 'string'
    && /^(?:\d{1,30}|username:[A-Za-z0-9._]{1,30})$/.test(value.id)
    && typeof value.username === 'string'
    && Boolean(sanitizeUsername(value.username))
    && typeof value.profileUrl === 'string'
    && validInstagramProfileUrl(value.profileUrl, value.username)
    && boundedPositiveInteger(value.commentCount, 600)
    && boundedPositiveInteger(value.mediaCount, 12)
    && typeof value.lastCommentText === 'string'
    && value.lastCommentText.length <= 500
    && (value.lastCommentAt == null || (typeof value.lastCommentAt === 'string' && validPastishIso(value.lastCommentAt)))
    && (value.latestCommentId == null || (typeof value.latestCommentId === 'string' && /^\d{1,30}$/.test(value.latestCommentId)))
    && (value.mediaId == null || (typeof value.mediaId === 'string' && /^\d{1,30}$/.test(value.mediaId)))
    && (value.latestMediaPermalink == null || (typeof value.latestMediaPermalink === 'string' && validInstagramMediaUrl(value.latestMediaPermalink)))
    && sameLatestCommentEvent(value);
}

function sameLatestCommentEvent(value: Record<string, unknown>) {
  const hasAny = Boolean(value.lastCommentAt || value.latestCommentId || value.mediaId || value.lastCommentText || value.latestMediaPermalink);
  if (!hasAny) return true;
  return typeof value.latestCommentId === 'string' && typeof value.mediaId === 'string';
}

function uniqueEngagers(engagers: unknown[]) {
  const ids = new Set<string>();
  const usernames = new Set<string>();
  for (const engager of engagers) {
    if (!isRecord(engager) || typeof engager.id !== 'string' || typeof engager.username !== 'string') return false;
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

function isLater(candidate?: string, current?: string | null) {
  if (!current) return true;
  if (!candidate) return false;
  const candidateMs = new Date(candidate).getTime();
  const currentMs = new Date(current).getTime();
  if (!Number.isFinite(candidateMs)) return false;
  if (!Number.isFinite(currentMs)) return true;
  return candidateMs >= currentMs;
}

function validPastishIso(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() + 5 * 60 * 1000;
}

function boundedNonNegativeInteger(value: unknown, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function boundedPositiveInteger(value: unknown, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeUsername(value: string) {
  const username = value.trim().replace(/^@/, '');
  const lowered = username.toLowerCase();
  if (INSTAGRAM_RESERVED_PATHS.has(lowered)) return '';
  return /^[A-Za-z0-9._]{1,30}$/.test(username) ? username : '';
}

function sanitizeUserId(value: string) {
  const userId = value.trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(userId)) throw new Error('invalid userId');
  return userId;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? Math.floor(value!) : fallback;
  return Math.max(min, Math.min(max, parsed));
}
