import { readActiveMonthUsage, reserveActiveMonthBudget } from '../../budgetIntegrity';
import { fetchWithTimeout } from '../../fetchWithTimeout';
import { getValidXAccessToken, xOAuthConfigured, type XOAuthEnv } from '../../xOAuth';
import { persistXInboundEvidence } from './persist';
import { normalizeXInboundEvents } from './inbound';

export interface XInboundEnv extends XOAuthEnv {
  X_INBOUND_SYNC_ENABLED?: string;
  X_INBOUND_READ_USD?: string;
  X_OWNED_READ_USD?: string;
  X_OWNED_READ_ELIGIBLE?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
}

export interface XInboundSyncRequest {
  userId?: string;
  monthlyLimitUsd?: number;
  maxResults?: number;
}

interface MentionsResponse {
  data?: unknown[];
  includes?: { users?: unknown[] };
  meta?: { result_count?: number; next_token?: string };
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
  const requestedCeiling = Number(body.monthlyLimitUsd);
  const serverCeiling = Number(env.DEFAULT_MONTHLY_BUDGET_USD);
  const effectiveLimit = Math.min(
    Number.isFinite(requestedCeiling) && requestedCeiling >= 0 ? requestedCeiling : serverCeiling,
    Number.isFinite(serverCeiling) && serverCeiling >= 0 ? serverCeiling : 0,
  );
  const reservationId = crypto.randomUUID();
  const reserved = await reserveActiveMonthBudget(env.DB, {
    id: reservationId,
    userId,
    provider: 'x',
    operation: 'inbound_mentions_read',
    amountUsd: price,
    effectiveLimit,
    occurredAt: new Date().toISOString(),
  });
  if (!reserved) return disabled('X inbound read was blocked by the monthly HARD LIMIT.');

  try {
    const accessToken = await getValidXAccessToken(env, userId);
    const me = await xFetch<{ data?: { id?: string } }>('https://api.x.com/2/users/me?user.fields=id', accessToken);
    const accountId = typeof me.data?.id === 'string' && /^\d{1,30}$/.test(me.data.id) ? me.data.id : '';
    if (!accountId) throw new Error('X /2/users/me did not return a valid user id.');

    const maxResults = clampInt(body.maxResults, 20, 5, 50);
    const params = new URLSearchParams({
      max_results: String(maxResults),
      'tweet.fields': 'author_id,conversation_id,created_at,in_reply_to_user_id,text',
      expansions: 'author_id',
      'user.fields': 'id,username,name',
    });
    const payload = await xFetch<MentionsResponse>(
      `https://api.x.com/2/users/${encodeURIComponent(accountId)}/mentions?${params.toString()}`,
      accessToken,
    );
    const receivedAt = new Date().toISOString();
    const events = normalizeXInboundEvents(payload.data || [], payload.includes?.users || [], receivedAt);
    await persistXInboundEvidence(env.DB, userId, events, 'handoff');
    return {
      enabled: true,
      source: 'x',
      costUsd: price,
      syncedAt: receivedAt,
      events: events.map((event) => ({
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
    const message = error instanceof Error ? error.message : 'X inbound sync failed';
    return { enabled: false, source: 'disabled', costUsd: price, events: [], reason: message, reservationRetained: true };
  }
}

function inboundReadPrice(env: XInboundEnv) {
  const explicit = Number(env.X_INBOUND_READ_USD);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (env.X_OWNED_READ_ELIGIBLE === 'true') {
    const owned = Number(env.X_OWNED_READ_USD);
    if (Number.isFinite(owned) && owned > 0) return owned;
  }
  return null;
}

function disabled(reason: string) {
  return { enabled: false, source: 'disabled', costUsd: 0, events: [], reason };
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
