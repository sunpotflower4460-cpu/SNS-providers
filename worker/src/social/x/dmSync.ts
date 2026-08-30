import { readActiveMonthUsage, reserveActiveMonthBudget, voidBudgetReservation } from '../../budgetIntegrity';
import { fetchWithTimeout } from '../../fetchWithTimeout';
import { getValidXAccessToken, xOAuthConfigured, xOAuthStatus, type XOAuthEnv } from '../../xOAuth';
import { resolveEffectiveBudgetLimit } from '../budgetCeiling';
import { executionModeForAction, liveXCapabilities } from '../capabilities';
import { commitSyncCheckpoint, loadSyncCheckpoint, saveSyncContinuation } from '../syncCheckpoints';
import { lookupXAuthenticatedUser } from './lookup';
import { paginateXDmEvents } from './dm';
import { persistXDmEvidence } from './persistDm';

export interface XDmSyncEnv extends XOAuthEnv {
  X_DM_READ_ENABLED?: string;
  X_DM_READ_USD?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  X_DM_WRITE_ENABLED?: string;
}

const MAX_PAGES = 8;

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
  const reservationId = crypto.randomUUID();
  if ((price || 0) > 0) {
    const usage = await readActiveMonthUsage(env.DB, userId);
    if (!usage.available) return disabled('X DM reads fail closed when the budget ledger is unavailable.');
    const budget = await resolveEffectiveBudgetLimit(env, userId, body.monthlyLimitUsd);
    const reserved = await reserveActiveMonthBudget(env.DB, {
      id: reservationId,
      userId,
      provider: 'x',
      operation: 'x_dm_read',
      amountUsd: price || 0,
      effectiveLimit: budget.effectiveLimitUsd,
      occurredAt: new Date().toISOString(),
    });
    if (!reserved) return disabled('X DM read was blocked by the monthly HARD LIMIT.');
  }

  let providerCallStarted = false;
  try {
    const accessToken = await getValidXAccessToken(env, userId);
    const me = await lookupXAuthenticatedUser(accessToken);
    if (!me) throw new Error('X /2/users/me did not return a valid user id.');
    const checkpoint = await loadSyncCheckpoint(env.DB, userId, 'x_dm');
    const knownNewest = checkpoint?.newestSeenId || '';
    const pendingNewestId = typeof checkpoint?.extra?.pendingNewestId === 'string' ? checkpoint.extra.pendingNewestId : undefined;
    const receivedAt = new Date().toISOString();
    providerCallStarted = true;
    const paged = await paginateXDmEvents({
      ownUserId: me.id,
      paginationToken: checkpoint?.continuationCursor || undefined,
      knownNewest,
      pendingNewestId,
      maxPages: MAX_PAGES,
      receivedAt,
      getJson: (url) => xGet(url, accessToken),
    });
    const inbound = paged.events.filter((event) => !event.ownMessage);
    const executionMode = executionModeForAction('dm_reply', liveXCapabilities(env, oauth.scopes || [], oauth.connected));
    await persistXDmEvidence(env.DB, userId, inbound, executionMode);
    if (paged.complete) {
      await commitSyncCheckpoint(env.DB, userId, 'x_dm', paged.newestId || knownNewest || null, { pages: paged.pages });
    } else {
      await saveSyncContinuation(env.DB, userId, 'x_dm', paged.continuation, {
        pages: paged.pages,
        budgetStop: true,
        pendingNewestId: paged.newestId || pendingNewestId || null,
      });
    }
    return {
      enabled: true,
      source: 'x',
      status: 'success' as const,
      costUsd: price || 0,
      syncedAt: receivedAt,
      checkpointComplete: paged.complete,
      events: inbound.map((event) => ({
        id: event.id,
        actionId: `sa-x-dm-${event.externalEventId}`,
        type: 'dm' as const,
        externalEventId: event.externalEventId,
        externalUserId: event.externalUserId,
        username: event.username,
        displayName: event.displayName,
        conversationId: event.conversationId,
        text: event.text,
        occurredAt: event.occurredAt,
      })),
    };
  } catch (error) {
    if (!providerCallStarted && (price || 0) > 0) await voidBudgetReservation(env.DB, { id: reservationId, userId });
    const message = error instanceof Error ? error.message : 'X DM sync failed';
    return {
      enabled: false,
      source: 'error',
      status: 'error' as const,
      costUsd: providerCallStarted ? (price || 0) : 0,
      events: [],
      reason: message,
      reservationRetained: providerCallStarted,
    };
  }
}

function readPrice(raw?: string) {
  if (raw == null || String(raw).trim() === '') return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function disabled(reason: string) {
  return { enabled: false, source: 'disabled', status: 'disabled' as const, costUsd: 0, events: [], reason };
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
