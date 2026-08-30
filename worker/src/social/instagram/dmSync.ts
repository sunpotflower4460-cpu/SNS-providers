import { readActiveMonthUsage, reserveActiveMonthBudget } from '../../budgetIntegrity';
import { fetchWithTimeout } from '../../fetchWithTimeout';
import { executionModeForAction, liveInstagramCapabilities } from '../capabilities';
import { probeInstagramPermissions } from './probe';
import { normalizeInstagramDmMessages } from './dm';
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

export async function syncInstagramDirectMessages(env: InstagramDmSyncEnv, body: { userId?: string; monthlyLimitUsd?: number }) {
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
  if ((price || 0) > 0) {
    const usage = await readActiveMonthUsage(env.DB, userId);
    if (!usage.available) return disabled('Instagram DM reads fail closed when the budget ledger is unavailable.');
    const limit = Number(env.DEFAULT_MONTHLY_BUDGET_USD);
    const reserved = await reserveActiveMonthBudget(env.DB, {
      id: crypto.randomUUID(),
      userId,
      provider: 'instagram',
      operation: 'instagram_dm_read',
      amountUsd: price || 0,
      effectiveLimit: Number.isFinite(limit) && limit >= 0 ? limit : 0,
      occurredAt: new Date().toISOString(),
    });
    if (!reserved) return disabled('Instagram DM read was blocked by the monthly HARD LIMIT.');
  }

  const token = env.INSTAGRAM_ACCESS_TOKEN!.trim();
  const igUserId = env.INSTAGRAM_USER_ID!.trim();
  const version = env.INSTAGRAM_API_VERSION!.trim();
  const conversations = await igGet<{ data?: Array<{ id?: string }> }>(
    `https://graph.instagram.com/${version}/${encodeURIComponent(igUserId)}/conversations?platform=instagram&fields=id,updated_time`,
    token,
  );
  const receivedAt = new Date().toISOString();
  const events = [];
  for (const conversation of (conversations.data || []).slice(0, 20)) {
    const conversationId = typeof conversation.id === 'string' ? conversation.id : '';
    if (!conversationId) continue;
    const detail = await igGet<{ messages?: { data?: unknown[] } }>(
      `https://graph.instagram.com/${version}/${encodeURIComponent(conversationId)}?fields=messages{id,created_time,from,message}`,
      token,
    );
    events.push(...normalizeInstagramDmMessages(conversationId, detail.messages?.data || [], igUserId, receivedAt));
  }
  const inbound = events.filter((event) => !event.ownMessage);
  const executionMode = executionModeForAction('dm_reply', liveInstagramCapabilities(env, probe));
  await persistInstagramDmEvidence(env.DB, userId, inbound, executionMode);
  return {
    enabled: true,
    source: 'instagram',
    costUsd: price || 0,
    syncedAt: receivedAt,
    events: inbound.map((event) => ({
      id: event.id,
      actionId: `sa-ig-dm-${event.externalEventId}`,
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
