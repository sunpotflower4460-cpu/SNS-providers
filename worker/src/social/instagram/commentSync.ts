import { fetchWithTimeout } from '../../fetchWithTimeout';
import { executionModeForAction, liveInstagramCapabilities } from '../capabilities';
import { persistInstagramCommentEvidence, type PersistableInstagramEngager } from './persist';
import { probeInstagramPermissions } from './probe';
import { commitSyncCheckpoint, loadSyncCheckpoint, saveSyncContinuation } from '../syncCheckpoints';
import { isNewerNumericProviderId, maxNumericProviderId, maxNumericProviderIdFrom } from '../providerIds';
import { queryRecord } from '../query';

export interface InstagramCommentSyncEnv {
  DB: D1Database;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_API_VERSION?: string;
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  INSTAGRAM_COMMENT_REPLY_ENABLED?: string;
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN?: string;
  INSTAGRAM_APP_SECRET?: string;
  INSTAGRAM_COMMENT_WEBHOOK_CONFIRMED?: string;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_MEDIA_PER_PAGE = 8;
const MAX_MEDIA_PAGES = 4;
const MAX_COMMENT_PAGES = 8;
export const MAX_PENDING_MEDIA = 48;

export interface PendingInstagramMedia {
  id: string;
  permalink: string | null;
  timestamp?: string;
  commentAfter?: string;
  knownCommentId?: string;
}

export function instagramRecentMediaUrl(version: string, igUserId: string, after?: string) {
  const params = new URLSearchParams({ fields: 'id,permalink,timestamp', limit: String(MAX_MEDIA_PER_PAGE) });
  if (after) params.set('after', after);
  return `https://graph.instagram.com/${version}/${encodeURIComponent(igUserId)}/media?${params.toString()}`;
}

export function instagramMediaCommentsUrl(version: string, mediaId: string, after?: string) {
  const params = new URLSearchParams({ fields: 'id,from,text,timestamp', limit: '50' });
  if (after) params.set('after', after);
  return {
    method: 'GET',
    path: `/${mediaId}/comments`,
    url: `https://graph.instagram.com/${version}/${encodeURIComponent(mediaId)}/comments?${params.toString()}`,
    query: queryRecord(params),
  };
}

export function instagramWebhookSecretsConfigured(env: { INSTAGRAM_WEBHOOK_VERIFY_TOKEN?: string; INSTAGRAM_APP_SECRET?: string }) {
  return Boolean(env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() && env.INSTAGRAM_APP_SECRET?.trim());
}

export function instagramCommentWebhookConfirmed(env: { INSTAGRAM_COMMENT_WEBHOOK_CONFIRMED?: string }) {
  const raw = env.INSTAGRAM_COMMENT_WEBHOOK_CONFIRMED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function instagramWebhookRegistrationStatus(secretsConfigured: boolean, confirmed: boolean) {
  return {
    receiverCode: 'READY' as const,
    secrets: secretsConfigured ? 'READY' as const : 'MISSING' as const,
    dashboardRegistration: confirmed ? 'CONFIRMED' as const : 'UNCONFIRMED' as const,
    sourceLabel: secretsConfigured && confirmed ? 'WEBHOOK REGISTERED' : secretsConfigured ? 'UNCONFIRMED' : 'DISABLED',
  };
}

export function parsePendingMedia(value: unknown): PendingInstagramMedia[] {
  const items: PendingInstagramMedia[] = [];
  const seen = new Set<string>();
  const push = (item: PendingInstagramMedia) => {
    if (!item.id || seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry) {
        push({ id: entry, permalink: null });
        continue;
      }
      if (!isRecord(entry)) continue;
      const id = typeof entry.id === 'string' ? entry.id : '';
      if (!id) continue;
      push({
        id,
        permalink: typeof entry.permalink === 'string' && entry.permalink ? entry.permalink : null,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
        commentAfter: typeof entry.commentAfter === 'string' ? entry.commentAfter : undefined,
        knownCommentId: typeof entry.knownCommentId === 'string' ? entry.knownCommentId : undefined,
      });
    }
    return items;
  }
  if (isRecord(value)) {
    for (const [id, entry] of Object.entries(value)) {
      if (!id) continue;
      if (typeof entry === 'string') {
        push({ id, permalink: entry || null });
        continue;
      }
      if (!isRecord(entry)) {
        push({ id, permalink: null });
        continue;
      }
      push({
        id,
        permalink: typeof entry.permalink === 'string' && entry.permalink ? entry.permalink : null,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
        commentAfter: typeof entry.commentAfter === 'string' ? entry.commentAfter : undefined,
        knownCommentId: typeof entry.knownCommentId === 'string' ? entry.knownCommentId : undefined,
      });
    }
  }
  return items;
}

export async function paginateInstagramComments(input: {
  version: string;
  mediaId: string;
  token: string;
  ownUserId?: string;
  after?: string;
  knownCommentId?: string;
  permalink: string | null;
  receivedAt: string;
  getJson?: (url: string) => Promise<{
    data?: Array<{ id?: string; text?: string; timestamp?: string; from?: { id?: string; username?: string } }>;
    paging?: { cursors?: { after?: string } };
  }>;
}) {
  const comments: PersistableInstagramEngager[] = [];
  let after = input.after || '';
  let pages = 0;
  let reachedKnown = false;
  let newestId = '';
  const getJson = input.getJson || ((url: string) => igGet(url, input.token));
  while (pages < MAX_COMMENT_PAGES) {
    const request = instagramMediaCommentsUrl(input.version, input.mediaId, after || undefined);
    const page = await getJson(request.url);
    pages += 1;
    for (const comment of page.data || []) {
      const commentId = typeof comment.id === 'string' ? comment.id : '';
      if (!commentId) continue;
      if (input.knownCommentId && commentId === input.knownCommentId) reachedKnown = true;
      if (!newestId || isNewerNumericProviderId(commentId, newestId)) newestId = commentId;
      const fromId = comment.from?.id?.trim() || '';
      const username = (comment.from?.username || '').trim();
      if (!fromId || (input.ownUserId && fromId === input.ownUserId)) continue;
      comments.push({
        id: fromId,
        username: username || fromId,
        lastCommentText: (comment.text || '').trim().slice(0, 500),
        lastCommentAt: comment.timestamp || input.receivedAt,
        latestCommentId: commentId,
        mediaId: input.mediaId,
        latestMediaPermalink: input.permalink,
      });
    }
    const next = page.paging?.cursors?.after || '';
    if (!next || (input.knownCommentId && reachedKnown)) {
      return { comments, newestId, reachedKnown: reachedKnown || !next, nextAfter: next && !(input.knownCommentId && reachedKnown) ? next : '', pages };
    }
    after = next;
  }
  return { comments, newestId, reachedKnown, nextAfter: after, pages };
}

export async function paginateInstagramMedia(input: {
  version: string;
  igUserId: string;
  token: string;
  mediaAfter?: string;
  webhookRegistrationConfirmed: boolean;
  cycleComplete?: boolean;
  maxPages?: number;
  getJson: (url: string) => Promise<{
    data?: Array<{ id?: string; permalink?: string; timestamp?: string }>;
    paging?: { cursors?: { after?: string } };
  }>;
}) {
  const maxPages = input.maxPages ?? MAX_MEDIA_PAGES;
  const seen = new Set<string>();
  const media: Array<{ id: string; permalink?: string; timestamp?: string }> = [];
  const newestPage = await input.getJson(instagramRecentMediaUrl(input.version, input.igUserId));
  let pages = 1;
  let newestNext = newestPage.paging?.cursors?.after || '';
  let newestTimestamp = '';
  for (const item of newestPage.data || []) {
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    media.push({ id, permalink: item.permalink, timestamp: item.timestamp });
    if (item.timestamp && (!newestTimestamp || item.timestamp > newestTimestamp)) newestTimestamp = item.timestamp;
  }

  let catchUpAfter = input.mediaAfter || '';
  if (!catchUpAfter && newestNext && !(input.webhookRegistrationConfirmed && input.cycleComplete)) {
    catchUpAfter = newestNext;
  }

  while (pages < maxPages && catchUpAfter) {
    const page = await input.getJson(instagramRecentMediaUrl(input.version, input.igUserId, catchUpAfter));
    pages += 1;
    for (const item of page.data || []) {
      const id = typeof item.id === 'string' ? item.id : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      media.push({ id, permalink: item.permalink, timestamp: item.timestamp });
    }
    catchUpAfter = page.paging?.cursors?.after || '';
  }

  return {
    media,
    pages,
    newestTimestamp,
    mediaAfter: catchUpAfter || '',
    catalogIncomplete: Boolean(catchUpAfter),
    newestPageNext: newestNext,
  };
}

export async function syncInstagramComments(
  env: InstagramCommentSyncEnv,
  body: { userId?: string },
  adapters: { getJson?: typeof igGet } = {},
) {
  const userId = sanitize(body.userId || 'local-user');
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim() || '';
  const igUserId = env.INSTAGRAM_USER_ID?.trim() || '';
  const version = env.INSTAGRAM_API_VERSION?.trim() || '';
  if (!token || !igUserId || !/^v\d+\.\d+$/.test(version)) {
    return disabled('Instagram comment sync requires INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID and INSTAGRAM_API_VERSION.');
  }
  const probe = await probeInstagramPermissions(env, userId);
  if (!probe.readComments && env.SOCIAL_WRITE_MODE !== 'test') {
    return disabled(probe.reason || 'Instagram comment permission is not verified.');
  }

  const receivedAt = new Date().toISOString();
  const executionMode = executionModeForAction('comment_reply', liveInstagramCapabilities(env, probe));
  const cached = await loadFreshCommentCache(env, userId, igUserId);
  if (cached?.length && env.SOCIAL_WRITE_MODE === 'test') {
    await persistInstagramCommentEvidence(env.DB, userId, cached, receivedAt, executionMode);
    return {
      enabled: true,
      source: 'cache',
      status: 'success' as const,
      costUsd: 0,
      syncedAt: receivedAt,
      checkpointComplete: true,
      events: cached.filter((item) => item.latestCommentId).map((item) => ({
        id: `ig-comment-${item.latestCommentId}`,
        actionId: `sa-ig-comment-${item.latestCommentId}`,
        type: 'comment' as const,
        externalEventId: item.latestCommentId,
        externalUserId: item.id,
        username: item.username,
        text: item.lastCommentText,
        parentContentId: item.mediaId,
        occurredAt: item.lastCommentAt || receivedAt,
      })),
    };
  }

  const loaded = await loadSyncCheckpoint(env.DB, userId, 'instagram_comments_poll');
  if (!loaded.available) {
    return {
      enabled: false,
      source: 'error',
      status: 'error' as const,
      costUsd: 0,
      events: [],
      reason: loaded.reason,
      checkpointComplete: false,
    };
  }

  const extra = loaded.checkpoint?.extra && typeof loaded.checkpoint.extra === 'object' ? loaded.checkpoint.extra : {};
  const mediaNewest = stringMap(extra.mediaNewestCommentId);
  const commentAfterMap = stringMap(extra.commentAfter);
  const pendingMedia = parsePendingMedia(extra.pendingMedia);
  const overflowPending = pendingMedia.slice(MAX_PENDING_MEDIA);
  const pendingToWalk = pendingMedia.slice(0, MAX_PENDING_MEDIA);
  for (const pending of pendingToWalk) {
    if (pending.commentAfter && !commentAfterMap[pending.id]) commentAfterMap[pending.id] = pending.commentAfter;
    if (pending.knownCommentId && !mediaNewest[pending.id]) mediaNewest[pending.id] = pending.knownCommentId;
  }
  const nextNewest: Record<string, string> = { ...mediaNewest };
  const nextAfter: Record<string, string> = { ...commentAfterMap };
  const comments: PersistableInstagramEngager[] = [];
  let commentsIncomplete = false;
  const getJson = adapters.getJson || igGet;
  const webhookSecrets = instagramWebhookSecretsConfigured(env);
  const webhookConfirmed = webhookSecrets && instagramCommentWebhookConfirmed(env);
  const mediaWalk = await paginateInstagramMedia({
    version,
    igUserId,
    token,
    mediaAfter: typeof extra.mediaAfter === 'string' ? extra.mediaAfter : '',
    webhookRegistrationConfirmed: webhookConfirmed,
    cycleComplete: extra.cycleComplete === true,
    getJson: (url) => getJson(url, token),
  });

  const mediaQueue: Array<{ id: string; permalink?: string; timestamp?: string }> = [...mediaWalk.media];
  for (const pending of pendingToWalk) {
    const existing = mediaQueue.find((item) => item.id === pending.id);
    if (existing) {
      if (!existing.permalink && pending.permalink) existing.permalink = pending.permalink;
      if (!existing.timestamp && pending.timestamp) existing.timestamp = pending.timestamp;
    } else {
      mediaQueue.push({
        id: pending.id,
        permalink: pending.permalink || undefined,
        timestamp: pending.timestamp,
      });
    }
  }

  const stillPending: PendingInstagramMedia[] = [...overflowPending];
  for (const item of mediaQueue) {
    const mediaId = item.id;
    const known = mediaNewest[mediaId] || pendingToWalk.find((row) => row.id === mediaId)?.knownCommentId || '';
    const permalink = item.permalink || pendingToWalk.find((row) => row.id === mediaId)?.permalink || null;
    const newestWalk = await paginateInstagramComments({
      version,
      mediaId,
      token,
      ownUserId: igUserId,
      after: '',
      knownCommentId: known,
      permalink,
      receivedAt,
      getJson: (url) => getJson(url, token),
    });
    comments.push(...newestWalk.comments);
    let olderWalkComplete = newestWalk.reachedKnown || !newestWalk.nextAfter;
    let newestId = newestWalk.newestId;
    const resumeAfter = commentAfterMap[mediaId] || pendingToWalk.find((row) => row.id === mediaId)?.commentAfter || nextAfter[mediaId] || '';
    if (!olderWalkComplete && resumeAfter) {
      const olderWalk = await paginateInstagramComments({
        version,
        mediaId,
        token,
        ownUserId: igUserId,
        after: resumeAfter,
        knownCommentId: known,
        permalink,
        receivedAt,
        getJson: (url) => getJson(url, token),
      });
      comments.push(...olderWalk.comments);
      newestId = maxNumericProviderId(newestId, olderWalk.newestId) || newestId;
      olderWalkComplete = olderWalk.reachedKnown || !olderWalk.nextAfter;
      if (!olderWalkComplete && olderWalk.nextAfter) nextAfter[mediaId] = olderWalk.nextAfter;
      else delete nextAfter[mediaId];
    } else if (!olderWalkComplete && newestWalk.nextAfter) {
      nextAfter[mediaId] = newestWalk.nextAfter;
    } else {
      delete nextAfter[mediaId];
    }
    if (olderWalkComplete && newestId) nextNewest[mediaId] = newestId;
    if (!olderWalkComplete) {
      commentsIncomplete = true;
      stillPending.push({
        id: mediaId,
        permalink,
        timestamp: item.timestamp,
        commentAfter: nextAfter[mediaId],
        knownCommentId: known || newestId || undefined,
      });
    }
  }

  await persistInstagramCommentEvidence(env.DB, userId, comments, receivedAt, executionMode);
  const catalogIncomplete = mediaWalk.catalogIncomplete;
  const extraPayload = {
    mediaAfter: catalogIncomplete ? mediaWalk.mediaAfter : '',
    mediaNewestTimestamp: mediaWalk.newestTimestamp || extra.mediaNewestTimestamp || null,
    mediaNewestCommentId: nextNewest,
    commentAfter: nextAfter,
    pendingMedia: stillPending,
    cycleComplete: !catalogIncomplete && !commentsIncomplete,
    webhookPrimary: webhookConfirmed,
  };
  const complete = extraPayload.cycleComplete === true;
  const persisted = complete
    ? await commitSyncCheckpoint(env.DB, userId, 'instagram_comments_poll', maxNumericProviderIdFrom(Object.values(nextNewest)), extraPayload)
    : await saveSyncContinuation(env.DB, userId, 'instagram_comments_poll', extraPayload.mediaAfter || null, extraPayload);
  if (!persisted.ok) {
    return {
      enabled: false,
      source: 'error',
      status: 'error' as const,
      costUsd: 0,
      syncedAt: receivedAt,
      checkpointComplete: false,
      events: comments.filter((item) => item.latestCommentId).map((item) => commentView(item, receivedAt)),
      reason: persisted.reason,
    };
  }

  return {
    enabled: true,
    source: 'instagram',
    status: 'success' as const,
    costUsd: 0,
    syncedAt: receivedAt,
    checkpointComplete: complete,
    events: comments.filter((item) => item.latestCommentId).map((item) => commentView(item, receivedAt)),
  };
}

function commentView(item: PersistableInstagramEngager, receivedAt: string) {
  return {
    id: `ig-comment-${item.latestCommentId}`,
    actionId: `sa-ig-comment-${item.latestCommentId}`,
    type: 'comment' as const,
    externalEventId: item.latestCommentId,
    externalUserId: item.id,
    username: item.username,
    text: item.lastCommentText,
    parentContentId: item.mediaId,
    occurredAt: item.lastCommentAt || receivedAt,
  };
}

async function loadFreshCommentCache(env: InstagramCommentSyncEnv, userId: string, expectedAccountId: string) {
  try {
    const row = await env.DB.prepare('SELECT snapshot_json, synced_at FROM instagram_engager_snapshots WHERE user_id = ?')
      .bind(userId)
      .first<{ snapshot_json: string; synced_at: string }>();
    if (!row) return null;
    const snapshot = JSON.parse(row.snapshot_json) as { accountId?: string; syncedAt?: string; engagers?: PersistableInstagramEngager[] };
    if (snapshot.accountId !== expectedAccountId || !Array.isArray(snapshot.engagers)) return null;
    const syncedAtMs = new Date(String(snapshot.syncedAt || row.synced_at)).getTime();
    if (!Number.isFinite(syncedAtMs) || Date.now() - syncedAtMs > CACHE_TTL_MS) return null;
    return snapshot.engagers;
  } catch {
    return null;
  }
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item) result[key] = item;
  }
  return result;
}

function disabled(reason: string) {
  return { enabled: false, source: 'disabled', status: 'disabled' as const, costUsd: 0, events: [], reason, checkpointComplete: false };
}

async function igGet<T>(url: string, token: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  }, 30_000, 'Instagram comment poll');
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body || typeof body !== 'object') throw new Error(`Instagram Graph API returned ${response.status}`);
  return body;
}

function sanitize(value: string) {
  const userId = value.trim();
  if (userId !== 'local-user') throw new Error('unsupported userId');
  return userId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
