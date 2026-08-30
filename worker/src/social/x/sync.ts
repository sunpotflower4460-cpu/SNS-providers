import { readActiveMonthUsage, reserveActiveMonthBudget, voidBudgetReservation } from '../../budgetIntegrity';
import { fetchWithTimeout } from '../../fetchWithTimeout';
import { getValidXAccessToken, xOAuthConfigured, xOAuthStatus, type XOAuthEnv } from '../../xOAuth';
import { resolveEffectiveBudgetLimit } from '../budgetCeiling';
import { persistXInboundEvidence } from './persist';
import { normalizeXInboundEvents } from './inbound';
import { executionModeForAction, liveXCapabilities } from '../capabilities';
import { queryRecord } from '../query';
import { commitSyncCheckpoint, loadSyncCheckpoint, saveSyncContinuation } from '../syncCheckpoints';
import { isNewerNumericProviderId } from '../providerIds';

export interface XInboundEnv extends XOAuthEnv {
  X_INBOUND_SYNC_ENABLED?: string;
  X_INBOUND_READ_USD?: string;
  X_OWNED_READ_USD?: string;
  X_OWNED_READ_ELIGIBLE?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  X_REPLY_WRITE_ENABLED?: string;
}

export interface XInboundSyncRequest {
  userId?: string;
  monthlyLimitUsd?: number;
  maxResults?: number;
}

interface MentionsResponse {
  data?: unknown[];
  includes?: { users?: unknown[] };
  meta?: { result_count?: number; next_token?: string; newest_id?: string; oldest_id?: string };
}

const MAX_PAGES = 8;

export function xMentionsUrl(accountId: string, input: { maxResults: number; sinceId?: string; paginationToken?: string }) {
  const params = new URLSearchParams({
    max_results: String(input.maxResults),
    'tweet.fields': 'author_id,conversation_id,created_at,in_reply_to_user_id,text',
    expansions: 'author_id',
    'user.fields': 'id,username,name',
  });
  if (input.sinceId) params.set('since_id', input.sinceId);
  if (input.paginationToken) params.set('pagination_token', input.paginationToken);
  return {
    method: 'GET',
    path: `/2/users/${accountId}/mentions`,
    url: `https://api.x.com/2/users/${encodeURIComponent(accountId)}/mentions?${params.toString()}`,
    query: queryRecord(params),
  };
}

export async function paginateXMentions(input: {
  accountId: string;
  sinceId?: string;
  paginationToken?: string;
  pendingNewestId?: string;
  maxResults: number;
  maxPages: number;
  receivedAt: string;
  getJson: (url: string) => Promise<MentionsResponse>;
}) {
  let paginationToken = input.paginationToken;
  const sinceId = input.sinceId;
  let newestId = input.pendingNewestId || sinceId || '';
  const allEvents: ReturnType<typeof normalizeXInboundEvents> = [];
  let pages = 0;
  let complete = false;
  const requests: Array<{ method: string; path: string; url: string; query: Record<string, string> }> = [];
  while (pages < input.maxPages) {
    const request = xMentionsUrl(input.accountId, {
      maxResults: input.maxResults,
      sinceId: paginationToken ? undefined : sinceId,
      paginationToken,
    });
    requests.push(request);
    const payload = await input.getJson(request.url);
    pages += 1;
    const pageEvents = normalizeXInboundEvents(payload.data || [], payload.includes?.users || [], input.receivedAt);
    allEvents.push(...pageEvents);
    for (const event of pageEvents) {
      if (!newestId || isNewerNumericProviderId(event.externalEventId, newestId)) newestId = event.externalEventId;
    }
    const next = typeof payload.meta?.next_token === 'string' ? payload.meta.next_token : '';
    if (!next) {
      complete = true;
      paginationToken = undefined;
      break;
    }
    paginationToken = next;
  }
  return {
    events: allEvents,
    newestId,
    complete,
    continuation: complete ? null : (paginationToken || null),
    pages,
    requests,
  };
}

export async function syncXInboundMentions(env: XInboundEnv, body: XInboundSyncRequest) {
  const userId = sanitizeUserId(body.userId || 'local-user');
  if (env.X_INBOUND_SYNC_ENABLED !== 'true') {
    return disabled('X inbound mention/reply sync is disabled until X_INBOUND_SYNC_ENABLED=true.');
  }
  if (!xOAuthConfigured(env)) {
    return disabled('X inbound sync requires the existing read-only X connection.');
  }

  const price = inboundReadPrice(env);
  if (price == null) {
    return disabled('X inbound reads fail closed until X_INBOUND_READ_USD (or eligible owned-read pricing) is explicitly configured.');
  }

  const usage = await readActiveMonthUsage(env.DB, userId);
  if (!usage.available) return disabled('X inbound reads fail closed when the budget ledger is unavailable.');
  const budget = await resolveEffectiveBudgetLimit(env, userId, body.monthlyLimitUsd);
  const reservationId = crypto.randomUUID();
  const reserved = price === 0 ? true : await reserveActiveMonthBudget(env.DB, {
    id: reservationId,
    userId,
    provider: 'x',
    operation: 'inbound_mentions_read',
    amountUsd: price,
    effectiveLimit: budget.effectiveLimitUsd,
    occurredAt: new Date().toISOString(),
  });
  if (!reserved) return disabled('X inbound read was blocked by the monthly HARD LIMIT.');

  let providerCallStarted = false;
  try {
    const accessToken = await getValidXAccessToken(env, userId);
    const me = await xFetch<{ data?: { id?: string } }>('https://api.x.com/2/users/me?user.fields=id', accessToken);
    const accountId = typeof me.data?.id === 'string' && /^\d{1,30}$/.test(me.data.id) ? me.data.id : '';
    if (!accountId) throw new Error('X /2/users/me did not return a valid user id.');

    const loaded = await loadSyncCheckpoint(env.DB, userId, 'x_mentions');
    if (!loaded.available) {
      await voidBudgetReservation(env.DB, { id: reservationId, userId });
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
    const checkpoint = loaded.checkpoint;
    const maxResults = clampInt(body.maxResults, 20, 5, 100);
    const sinceId = checkpoint?.newestSeenId && /^\d{1,30}$/.test(checkpoint.newestSeenId)
      ? checkpoint.newestSeenId
      : undefined;
    const pendingNewestId = typeof checkpoint?.extra?.pendingNewestId === 'string' ? checkpoint.extra.pendingNewestId : undefined;
    const receivedAt = new Date().toISOString();
    providerCallStarted = true;
    const paged = await paginateXMentions({
      accountId,
      sinceId,
      paginationToken: checkpoint?.continuationCursor || undefined,
      pendingNewestId,
      maxResults,
      maxPages: MAX_PAGES,
      receivedAt,
      getJson: (url) => xFetch<MentionsResponse>(url, accessToken),
    });

    const oauthStatus = await xOAuthStatus(env, userId);
    const executionMode = executionModeForAction('reply_inbound', liveXCapabilities(env, oauthStatus.scopes || []));
    await persistXInboundEvidence(env.DB, userId, paged.events, executionMode);
    if (paged.complete) {
      const persisted = await commitSyncCheckpoint(env.DB, userId, 'x_mentions', paged.newestId || sinceId || null, { pages: paged.pages });
      if (!persisted.ok) {
        return {
          enabled: false,
          source: 'error',
          status: 'error' as const,
          costUsd: price,
          syncedAt: receivedAt,
          checkpointComplete: false,
          events: paged.events.map((event) => ({
            id: event.id,
            actionId: `sa-x-${event.type}-${event.externalEventId}`,
            type: event.type,
            externalEventId: event.externalEventId,
            externalUserId: event.externalUserId,
            username: event.username,
            text: event.text,
            conversationId: event.conversationId,
            permalink: event.permalink,
            occurredAt: event.occurredAt,
          })),
          reason: persisted.reason,
          reservationRetained: true,
        };
      }
    } else {
      const persisted = await saveSyncContinuation(env.DB, userId, 'x_mentions', paged.continuation, {
        pages: paged.pages,
        budgetStop: paged.pages >= MAX_PAGES,
        pendingNewestId: paged.newestId || pendingNewestId || null,
      });
      if (!persisted.ok) {
        return {
          enabled: false,
          source: 'error',
          status: 'error' as const,
          costUsd: price,
          syncedAt: receivedAt,
          checkpointComplete: false,
          events: paged.events.map((event) => ({
            id: event.id,
            actionId: `sa-x-${event.type}-${event.externalEventId}`,
            type: event.type,
            externalEventId: event.externalEventId,
            externalUserId: event.externalUserId,
            username: event.username,
            text: event.text,
            conversationId: event.conversationId,
            permalink: event.permalink,
            occurredAt: event.occurredAt,
          })),
          reason: persisted.reason,
          reservationRetained: true,
        };
      }
    }
    const allEvents = paged.events;
    const complete = paged.complete;
    return {
      enabled: true,
      source: 'x',
      status: 'success' as const,
      costUsd: price,
      syncedAt: receivedAt,
      checkpointComplete: complete,
      events: allEvents.map((event) => ({
        id: event.id,
        actionId: `sa-x-${event.type}-${event.externalEventId}`,
        type: event.type,
        externalEventId: event.externalEventId,
        externalUserId: event.externalUserId,
        username: event.username,
        text: event.text,
        conversationId: event.conversationId,
        permalink: event.permalink,
        occurredAt: event.occurredAt,
      })),
    };
  } catch (error) {
    if (!providerCallStarted) await voidBudgetReservation(env.DB, { id: reservationId, userId });
    const message = error instanceof Error ? error.message : 'X inbound sync failed';
    return {
      enabled: false,
      source: 'error',
      status: 'error' as const,
      costUsd: providerCallStarted ? price : 0,
      events: [],
      reason: message,
      reservationRetained: providerCallStarted,
    };
  }
}

function inboundReadPrice(env: XInboundEnv) {
  const explicit = Number(env.X_INBOUND_READ_USD);
  if (Number.isFinite(explicit) && explicit >= 0 && String(env.X_INBOUND_READ_USD || '').trim() !== '') return explicit;
  if (env.X_OWNED_READ_ELIGIBLE === 'true') {
    const owned = Number(env.X_OWNED_READ_USD);
    if (Number.isFinite(owned) && owned > 0) return owned;
  }
  return null;
}

function disabled(reason: string) {
  return { enabled: false, source: 'disabled', status: 'disabled' as const, costUsd: 0, events: [], reason };
}

async function xFetch<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  }, 30_000, 'X inbound API');
  const body = await response.json().catch(() => null) as T | { detail?: string; title?: string } | null;
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body && body.detail ? `: ${String(body.detail).slice(0, 180)}` : '';
    throw new Error(`X API returned ${response.status}${detail}`);
  }
  if (!body || typeof body !== 'object') throw new Error('X API returned an empty or invalid JSON response');
  return body as T;
}

function sanitizeUserId(value: string) {
  const userId = value.trim();
  if (userId !== 'local-user') throw new Error('unsupported userId');
  return userId;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? Math.floor(value!) : fallback;
  return Math.max(min, Math.min(max, parsed));
}
