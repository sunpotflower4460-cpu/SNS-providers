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
  lastCommentText: string;
  lastCommentAt: string | null;
  latestMediaPermalink: string | null;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

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
      const key = fromId || username.toLowerCase();
      const existing = engagers.get(key) || {
        id: fromId || `username:${username.toLowerCase()}`,
        username,
        commentCount: 0,
        mediaIds: new Set<string>(),
        lastCommentText: '',
        lastCommentAt: null,
        latestMediaPermalink: null,
      };
      existing.commentCount += 1;
      existing.mediaIds.add(item.id);
      if (isLater(comment.timestamp, existing.lastCommentAt)) {
        existing.lastCommentAt = comment.timestamp || existing.lastCommentAt;
        existing.lastCommentText = (comment.text || '').trim().slice(0, 500);
        existing.latestMediaPermalink = item.permalink || existing.latestMediaPermalink;
      } else if (!existing.latestMediaPermalink && item.permalink) {
        existing.latestMediaPermalink = item.permalink;
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
        latestMediaPermalink: entry.latestMediaPermalink,
      })),
  };

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
  const result = await graphFetch<GraphPage<InstagramMedia>>(`https://graph.instagram.com/${version}/${encodeURIComponent(instagramUserId)}/media?${params.toString()}`, token);
  return (result.data || []).slice(0, limit);
}

async function fetchComments(token: string, version: string, mediaId: string, limit: number) {
  const params = new URLSearchParams({
    fields: 'from,text,timestamp',
    limit: String(limit),
  });
  const result = await graphFetch<GraphPage<InstagramComment>>(`https://graph.instagram.com/${version}/${encodeURIComponent(mediaId)}/comments?${params.toString()}`, token);
  return (result.data || []).slice(0, limit);
}

async function graphFetch<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });
  const body = await response.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) {
    const detail = body && typeof body === 'object' && body.error?.message ? `: ${body.error.message.slice(0, 180)}` : '';
    throw new Error(`Instagram Graph API returned ${response.status}${detail}`);
  }
  return body as T;
}

async function loadFreshCache(env: InstagramOwnedEnv, userId: string, force: boolean, expectedAccountId: string) {
  if (force) return null;
  try {
    const row = await env.DB.prepare('SELECT snapshot_json, synced_at FROM instagram_engager_snapshots WHERE user_id = ?')
      .bind(userId)
      .first<{ snapshot_json: string; synced_at: string }>();
    if (!row) return null;
    if (Date.now() - new Date(row.synced_at).getTime() > CACHE_TTL_MS) return null;
    const snapshot = JSON.parse(row.snapshot_json) as Record<string, unknown>;
    if (snapshot.accountId !== expectedAccountId) return null;
    return snapshot;
  } catch {
    return null;
  }
}

async function saveCache(env: InstagramOwnedEnv, userId: string, snapshot: unknown) {
  try {
    await env.DB.prepare(
      `INSERT INTO instagram_engager_snapshots (user_id, snapshot_json, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, synced_at = excluded.synced_at`
    ).bind(userId, JSON.stringify(snapshot), new Date().toISOString()).run();
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

function isLater(candidate?: string, current?: string | null) {
  if (!current) return true;
  if (!candidate) return false;
  const candidateMs = new Date(candidate).getTime();
  const currentMs = new Date(current).getTime();
  if (!Number.isFinite(candidateMs)) return false;
  if (!Number.isFinite(currentMs)) return true;
  return candidateMs >= currentMs;
}

function sanitizeUsername(value: string) {
  return value.trim().replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '').slice(0, 30);
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
