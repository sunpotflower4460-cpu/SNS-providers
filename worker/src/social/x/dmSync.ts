import { readActiveMonthUsage, reserveActiveMonthBudget } from '../../budgetIntegrity';
import { fetchWithTimeout } from '../../fetchWithTimeout';
import { getValidXAccessToken, xOAuthConfigured, xOAuthStatus, type XOAuthEnv } from '../../xOAuth';
import { executionModeForAction, liveXCapabilities } from '../capabilities';
import { lookupXAuthenticatedUser } from './lookup';
import { normalizeXDmEvents } from './dm';
import { persistXDmEvidence } from './persistDm';

export interface XDmSyncEnv extends XOAuthEnv {
  X_DM_READ_ENABLED?: string;
  X_DM_READ_USD?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  X_DM_WRITE_ENABLED?: string;
}

export async function syncXDirectMessages(env: XDmSyncEnv, body: { userId?: string; monthlyLimitUsd?: number }) {
  const userId = sanitize(body.userId || 'local-user');
  if (env.X_DM_READ_ENABLED !== 'true' && env.SOCIAL_WRITE_MODE !== 'test') {
    return disabled('X DM inbound sync is disabled until X_DM_READ_ENABLED=true.');
  }
  if (!xOAuthConfigured(env) && env.SOCIAL_WRITE_MODE !== 'test') {
    return disabled('X DM sync requires a connected X account with dm.read.');
  }
  const oauth = await xOAuthStatus(env, userId);
  if (env.SOCIAL_WRITE_MODE !== 'test' && !(oauth.scopes || []).includes('dm.read')) {
    return disabled('X DM read requires an explicit dm.read OAuth upgrade.');
  }
  const price = readPrice(env.X_DM_READ_USD);
  if (price == null && env.SOCIAL_WRITE_MODE !== 'test') {
    return disabled('X DM reads fail closed until X_DM_READ_USD is explicitly configured.');
  }
  if ((price || 0) > 0) {
    const usage = await readActiveMonthUsage(env.DB, userId);
    if (!usage.available) return disabled('X DM reads fail closed when the budget ledger is unavailable.');
    const serverCeiling = Number(env.DEFAULT_MONTHLY_BUDGET_USD);
    const requested = Number(body.monthlyLimitUsd);
    const effectiveLimit = Math.min(
      Number.isFinite(requested) && requested >= 0 ? requested : serverCeiling,
      Number.isFinite(serverCeiling) && serverCeiling >= 0 ? serverCeiling : 0,
    );
    const reserved = await reserveActiveMonthBudget(env.DB, {
      id: crypto.randomUUID(),
      userId,
      provider: 'x',
      operation: 'x_dm_read',
      amountUsd: price || 0,
      effectiveLimit,
      occurredAt: new Date().toISOString(),
    });
    if (!reserved) return disabled('X DM read was blocked by the monthly HARD LIMIT.');
  }

  const accessToken = await getValidXAccessToken(env, userId);
  const me = await lookupXAuthenticatedUser(accessToken);
  if (!me) throw new Error('X /2/users/me did not return a valid user id.');
  const payload = await xGet<{ data?: unknown[] }>(
    'https://api.x.com/2/dm_events?max_results=50&dm_event.fields=id,text,event_type,dm_conversation_id,sender_id,created_at&event_types=MessageCreate',
    accessToken,
  );
  const receivedAt = new Date().toISOString();
  const events = normalizeXDmEvents(payload.data || [], me.id, receivedAt);
  const inbound = events.filter((event) => !event.ownMessage);
  const executionMode = executionModeForAction('dm_reply', liveXCapabilities(env, oauth.scopes || [], oauth.connected));
  await persistXDmEvidence(env.DB, userId, inbound, executionMode);
  return {
    enabled: true,
    source: 'x',
    costUsd: price || 0,
    syncedAt: receivedAt,
    events: inbound.map((event) => ({
      id: event.id,
      actionId: `sa-x-dm-${event.externalEventId}`,
      type: 'dm' as const,
      externalEventId: event.externalEventId,
      externalUserId: event.externalUserId,
      conversationId: event.conversationId,
      text: event.text,
      occurredAt: event.occurredAt,
    })),
  };
}

function readPrice(raw?: string) {
  if (raw == null || String(raw).trim() === '') return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function disabled(reason: string) {
  return { enabled: false, source: 'disabled', costUsd: 0, events: [], reason };
}

async function xGet<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  }, 30_000, 'X DM API');
  const body = await response.json().catch(() => null) as T | { detail?: string } | null;
  if (!response.ok) throw new Error(`X API returned ${response.status}`);
  if (!body || typeof body !== 'object') throw new Error('X DM API returned invalid JSON');
  return body as T;
}

function sanitize(value: string) {
  const userId = value.trim();
  if (userId !== 'local-user') throw new Error('unsupported userId');
  return userId;
}
