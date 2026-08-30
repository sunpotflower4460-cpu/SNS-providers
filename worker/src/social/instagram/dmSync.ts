import { readActiveMonthUsage, reserveActiveMonthBudget, voidBudgetReservation } from '../../budgetIntegrity';
import { fetchWithTimeout } from '../../fetchWithTimeout';
import { resolveEffectiveBudgetLimit } from '../budgetCeiling';
import { executionModeForAction, liveInstagramCapabilities } from '../capabilities';
import { isNewerNumericProviderId, maxNumericProviderIdFrom } from '../providerIds';
import { commitSyncCheckpoint, loadSyncCheckpoint, saveSyncContinuation } from '../syncCheckpoints';
import { probeInstagramPermissions } from './probe';
import { normalizeInstagramDmMessages, type NormalizedInstagramDmEvent } from './dm';
import { persistInstagramDmEvidence } from './persistDm';

export interface InstagramDmSyncEnv {
  DB: D1Database;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_API_VERSION?: string;
  INSTAGRAM_DM_READ_ENABLED?: string;
  INSTAGRAM_DM_READ_USD?: string;
  INSTAGRAM_DM_WRITE_ENABLED?: string;
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  INSTAGRAM_COMMENT_REPLY_ENABLED?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
}

export interface InstagramDmThreadMaps {
  conversationUpdatedTime: Record<string, string>;
  conversationNewestMessageId: Record<string, string>;
  conversationMessageCursor: Record<string, string>;
  conversationPendingNewestId: Record<string, string>;
}

const MAX_CONVERSATION_PAGES = 8;
const MAX_MESSAGE_PAGES = 4;

export function instagramConversationListUrl(version: string, igUserId: string, after?: string) {
  const params = new URLSearchParams({
    platform: 'instagram',
    fields: 'id,updated_time,participants{id,username,name}',
    limit: '25',
  });
  if (after) params.set('after', after);
  return {
    method: 'GET',
    path: `/${igUserId}/conversations`,
    url: `https://graph.instagram.com/${version}/${encodeURIComponent(igUserId)}/conversations?${params.toString()}`,
  };
}

export function instagramConversationMessagesUrl(version: string, conversationId: string, after?: string) {
  const params = new URLSearchParams({
    fields: 'id,created_time,from,message',
    limit: '50',
  });
  if (after) params.set('after', after);
  return {
    method: 'GET',
    path: `/${conversationId}/messages`,
    url: `https://graph.instagram.com/${version}/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
  };
}

export async function lookupInstagramConversationByUser(input: {
  igUserId: string;
  senderIgsid: string;
  accessToken: string;
  apiVersion: string;
}) {
  const url = `https://graph.instagram.com/${input.apiVersion}/${encodeURIComponent(input.igUserId)}/conversations?platform=instagram&user_id=${encodeURIComponent(input.senderIgsid)}&fields=id,updated_time,participants`;
  const payload = await igGet<{ data?: Array<{ id?: string }> }>(url, input.accessToken);
  const id = payload.data?.find((row) => typeof row.id === 'string' && row.id)?.id;
  return typeof id === 'string' ? id : '';
}

export function emptyInstagramDmThreadMaps(): InstagramDmThreadMaps {
  return {
    conversationUpdatedTime: {},
    conversationNewestMessageId: {},
    conversationMessageCursor: {},
    conversationPendingNewestId: {},
  };
}

export function instagramDmMapsFromExtra(extra: Record<string, unknown> | undefined): InstagramDmThreadMaps {
  const source = extra && typeof extra === 'object' ? extra : {};
  return {
    conversationUpdatedTime: stringMap(source.conversationUpdatedTime),
    conversationNewestMessageId: stringMap(source.conversationNewestMessageId),
    conversationMessageCursor: stringMap(source.conversationMessageCursor),
    conversationPendingNewestId: stringMap(source.conversationPendingNewestId),
  };
}

export function instagramDmThreadIsFullyProcessed(
  maps: InstagramDmThreadMaps,
  conversationId: string,
  updatedTime: string,
) {
  const cursor = maps.conversationMessageCursor[conversationId];
  if (cursor) return false;
  const committedNewest = maps.conversationNewestMessageId[conversationId];
  const committedUpdated = maps.conversationUpdatedTime[conversationId];
  return Boolean(committedNewest && committedUpdated && updatedTime && committedUpdated === updatedTime);
}

export async function walkInstagramConversationMessages(input: {
  conversationId: string;
  updatedTime: string;
  maps: InstagramDmThreadMaps;
  igUserId: string;
  participant?: { id?: string; username?: string; name?: string };
  receivedAt: string;
  maxMessagePages?: number;
  getJson: (url: string) => Promise<{
    data?: unknown[];
    paging?: { cursors?: { after?: string } };
  }>;
  version: string;
}) {
  const maxPages = input.maxMessagePages ?? MAX_MESSAGE_PAGES;
  const committedNewest = input.maps.conversationNewestMessageId[input.conversationId] || '';
  const savedCursor = input.maps.conversationMessageCursor[input.conversationId] || '';
  const startedFromCursor = Boolean(savedCursor);
  let messageAfter = savedCursor;
  let pendingNewest = input.maps.conversationPendingNewestId[input.conversationId] || '';
  let reachedKnown = false;
  let pages = 0;
  let lastCursor = savedCursor;
  const events: NormalizedInstagramDmEvent[] = [];

  while (pages < maxPages) {
    const messagesReq = instagramConversationMessagesUrl(input.version, input.conversationId, messageAfter || undefined);
    const detail = await input.getJson(messagesReq.url);
    pages += 1;
    const pageEvents = normalizeInstagramDmMessages(
      input.conversationId,
      detail.data || [],
      input.igUserId,
      input.receivedAt,
      input.participant,
    );
    if (!startedFromCursor && !messageAfter && pageEvents[0] && !pendingNewest) {
      pendingNewest = pageEvents[0].externalEventId;
    }
    for (const event of pageEvents) {
      if (committedNewest && event.externalEventId === committedNewest) reachedKnown = true;
      if (isNewerNumericProviderId(event.externalEventId, pendingNewest)) pendingNewest = event.externalEventId;
    }
    events.push(...pageEvents);
    const nextMessage = detail.paging?.cursors?.after || '';
    if (!nextMessage || reachedKnown) {
      lastCursor = '';
      break;
    }
    messageAfter = nextMessage;
    lastCursor = nextMessage;
  }

  const threadComplete = reachedKnown || !lastCursor;
  const nextMaps: InstagramDmThreadMaps = {
    conversationUpdatedTime: { ...input.maps.conversationUpdatedTime },
    conversationNewestMessageId: { ...input.maps.conversationNewestMessageId },
    conversationMessageCursor: { ...input.maps.conversationMessageCursor },
    conversationPendingNewestId: { ...input.maps.conversationPendingNewestId },
  };

  if (threadComplete) {
    if (pendingNewest) nextMaps.conversationNewestMessageId[input.conversationId] = pendingNewest;
    delete nextMaps.conversationMessageCursor[input.conversationId];
    delete nextMaps.conversationPendingNewestId[input.conversationId];
    if (!startedFromCursor && input.updatedTime) {
      nextMaps.conversationUpdatedTime[input.conversationId] = input.updatedTime;
    }
  } else {
    if (lastCursor) nextMaps.conversationMessageCursor[input.conversationId] = lastCursor;
    if (pendingNewest) nextMaps.conversationPendingNewestId[input.conversationId] = pendingNewest;
  }

  return {
    events,
    threadComplete,
    pages,
    maps: nextMaps,
    pendingNewest,
    continuationCursor: threadComplete ? '' : lastCursor,
  };
}

export async function syncInstagramDirectMessages(
  env: InstagramDmSyncEnv,
  body: { userId?: string; monthlyLimitUsd?: number },
  adapters: { getJson?: typeof igGet } = {},
) {
  const userId = sanitize(body.userId || 'local-user');
  if (env.INSTAGRAM_DM_READ_ENABLED !== 'true' && env.SOCIAL_WRITE_MODE !== 'test') {
    return disabled('Instagram DM inbound sync is disabled until INSTAGRAM_DM_READ_ENABLED=true.');
  }
  const probe = await probeInstagramPermissions(env, userId);
  if (!probe.readDm && env.SOCIAL_WRITE_MODE !== 'test') {
    return disabled(probe.reason || 'Instagram message permission is not verified.');
  }
  const price = readPrice(env.INSTAGRAM_DM_READ_USD);
  if (price == null && env.SOCIAL_WRITE_MODE !== 'test') {
    return disabled('Instagram DM reads fail closed until INSTAGRAM_DM_READ_USD is explicitly set (use 0 after confirming Meta does not bill this call).');
  }
  const reservationId = crypto.randomUUID();
  if ((price || 0) > 0) {
    const usage = await readActiveMonthUsage(env.DB, userId);
    if (!usage.available) return disabled('Instagram DM reads fail closed when the budget ledger is unavailable.');
    const budget = await resolveEffectiveBudgetLimit(env, userId, body.monthlyLimitUsd);
    const reserved = await reserveActiveMonthBudget(env.DB, {
      id: reservationId,
      userId,
      provider: 'instagram',
      operation: 'instagram_dm_read',
      amountUsd: price || 0,
      effectiveLimit: budget.effectiveLimitUsd,
      occurredAt: new Date().toISOString(),
    });
    if (!reserved) return disabled('Instagram DM read was blocked by the monthly HARD LIMIT.');
  }

  const loaded = await loadSyncCheckpoint(env.DB, userId, 'instagram_dm');
  if (!loaded.available) {
    if ((price || 0) > 0) await voidBudgetReservation(env.DB, { id: reservationId, userId });
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

  let providerCallStarted = false;
  const getJson = adapters.getJson || igGet;
  try {
    const token = env.INSTAGRAM_ACCESS_TOKEN!.trim();
    const igUserId = env.INSTAGRAM_USER_ID!.trim();
    const version = env.INSTAGRAM_API_VERSION!.trim();
    const checkpoint = loaded.checkpoint;
    let maps = instagramDmMapsFromExtra(checkpoint?.extra);
    let after = checkpoint?.continuationCursor || (typeof checkpoint?.extra?.conversationsAfter === 'string' ? checkpoint.extra.conversationsAfter : '') || '';
    const receivedAt = new Date().toISOString();
    const events: NormalizedInstagramDmEvent[] = [];
    let pages = 0;
    let listComplete = false;
    let threadsIncomplete = false;

    while (pages < MAX_CONVERSATION_PAGES) {
      const list = instagramConversationListUrl(version, igUserId, after || undefined);
      providerCallStarted = true;
      const conversations = await getJson<{
        data?: Array<{
          id?: string;
          updated_time?: string;
          participants?: { data?: Array<{ id?: string; username?: string; name?: string }> };
        }>;
        paging?: { cursors?: { after?: string }; next?: string };
      }>(list.url, token);
      pages += 1;
      for (const conversation of conversations.data || []) {
        const conversationId = typeof conversation.id === 'string' ? conversation.id : '';
        if (!conversationId) continue;
        const updatedTime = typeof conversation.updated_time === 'string' ? conversation.updated_time : '';
        if (instagramDmThreadIsFullyProcessed(maps, conversationId, updatedTime)) continue;
        const participant = (conversation.participants?.data || []).find((row) => row.id && row.id !== igUserId);
        const walked = await walkInstagramConversationMessages({
          conversationId,
          updatedTime,
          maps,
          igUserId,
          participant,
          receivedAt,
          version,
          getJson: (url) => getJson(url, token),
        });
        maps = walked.maps;
        events.push(...walked.events);
        if (!walked.threadComplete) threadsIncomplete = true;
      }
      const nextAfter = conversations.paging?.cursors?.after || '';
      if (!nextAfter && !conversations.paging?.next) {
        listComplete = true;
        after = '';
        break;
      }
      after = nextAfter || after;
      if (!nextAfter) {
        listComplete = true;
        break;
      }
    }

    const inbound = events.filter((event) => !event.ownMessage);
    const executionMode = executionModeForAction('dm_reply', liveInstagramCapabilities(env, probe));
    await persistInstagramDmEvidence(env.DB, userId, inbound, executionMode);
    const extraPayload = {
      ...maps,
      conversationsAfter: after || null,
    };
    const complete = listComplete && !threadsIncomplete && !after;
    const persisted = complete
      ? await commitSyncCheckpoint(env.DB, userId, 'instagram_dm', maxNumericProviderIdFrom(Object.values(maps.conversationNewestMessageId)), extraPayload)
      : await saveSyncContinuation(env.DB, userId, 'instagram_dm', after || null, extraPayload);
    if (!persisted.ok) {
      return {
        enabled: false,
        source: 'error',
        status: 'error' as const,
        costUsd: providerCallStarted ? (price || 0) : 0,
        syncedAt: receivedAt,
        checkpointComplete: false,
        events: inbound.map(toEventView),
        reason: persisted.reason,
        reservationRetained: providerCallStarted,
      };
    }
    return {
      enabled: true,
      source: 'instagram',
      status: 'success' as const,
      costUsd: price || 0,
      syncedAt: receivedAt,
      checkpointComplete: complete,
      events: inbound.map(toEventView),
    };
  } catch (error) {
    if (!providerCallStarted && (price || 0) > 0) await voidBudgetReservation(env.DB, { id: reservationId, userId });
    const message = error instanceof Error ? error.message : 'Instagram DM sync failed';
    return {
      enabled: false,
      source: 'error',
      status: 'error' as const,
      costUsd: providerCallStarted ? (price || 0) : 0,
      events: [],
      reason: message,
      reservationRetained: providerCallStarted,
      checkpointComplete: false,
    };
  }
}

function toEventView(event: NormalizedInstagramDmEvent) {
  return {
    id: event.id,
    actionId: `sa-ig-dm-${event.externalEventId}`,
    type: 'dm' as const,
    externalEventId: event.externalEventId,
    externalUserId: event.externalUserId,
    username: event.username,
    displayName: event.displayName,
    conversationId: event.conversationId,
    text: event.text,
    occurredAt: event.occurredAt,
  };
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item) result[key] = item;
  }
  return result;
}

function readPrice(raw?: string) {
  if (raw == null || String(raw).trim() === '') return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function disabled(reason: string) {
  return { enabled: false, source: 'disabled', status: 'disabled' as const, costUsd: 0, events: [], reason, checkpointComplete: false };
}

async function igGet<T>(url: string, token: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  }, 30_000, 'Instagram DM API');
  const body = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(`Instagram Graph API returned ${response.status}`);
  if (!body || typeof body !== 'object') throw new Error('Instagram DM API returned invalid JSON');
  return body as T;
}

function sanitize(value: string) {
  const userId = value.trim();
  if (userId !== 'local-user') throw new Error('unsupported userId');
  return userId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
