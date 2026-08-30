import { readActiveMonthUsage, reserveActiveMonthBudget, voidBudgetReservation } from '../budgetIntegrity';
import { fetchWithTimeout } from '../fetchWithTimeout';
import { resolveEffectiveBudgetLimit } from './budgetCeiling';
import { parseExecutionFingerprint, providerTextMatchesFingerprint, exactReconcileDecision, type ExecutionFingerprint } from './fingerprint';
import { finalizeActionStatus, loadCanonicalAction, loadCanonicalEvent } from './repository';
import { instagramMessagingWindowOpen } from './instagram/dm';
import { extractXTweetId } from './x/like';
import { lookupXFollowRelationship, interpretFollowRelationship } from './x/followReconcile';
import { interpretLikeState, likeReconciliationReady, lookupXLikedState } from './x/likeReconcile';
import { lookupXAuthenticatedUser } from './x/lookup';
import { getValidXAccessToken, xOAuthStatus, type XOAuthEnv } from '../xOAuth';
import type { CanonicalSocialAction, CanonicalSocialEvent } from './types';

export interface ReconcileEnv extends XOAuthEnv {
  SOCIAL_WRITE_MODE?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_API_VERSION?: string;
  SOCIAL_RECONCILE_READ_USD?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
}

export interface ExecutionRecord {
  id: string;
  userId: string;
  actionId: string;
  platform: string;
  operation: string;
  idempotencyKey: string;
  externalResultId: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  reservationId: string | null;
  resultMetadataJson?: string | null;
  fingerprintJson?: string | null;
}

const RECONCILE_WINDOW_MS = 30 * 60 * 1000;

export async function reconcileExecution(env: ReconcileEnv, userId: string, executionId: string) {
  const existing = await loadExecution(env, userId, executionId);
  if (!existing) {
    return { status: 404, body: { ok: false as const, code: 'NOT_FOUND', reason: 'Unknown execution.' } };
  }
  if (existing.status === 'succeeded' || existing.status === 'failed') {
    return {
      status: 200,
      body: {
        ok: true as const,
        idempotent: true,
        executionId,
        status: existing.status,
        certainty: existing.status === 'succeeded' ? 'success' : 'failure',
        externalResultId: existing.externalResultId,
        reservationRetained: existing.status === 'succeeded',
      },
    };
  }
  if (existing.errorCode !== 'UNKNOWN_RESULT') {
    await markUnknown(env, existing);
    existing.errorCode = 'UNKNOWN_RESULT';
  }

  const action = await loadCanonicalAction(env.DB, userId, existing.actionId);
  if (!action) {
    return { status: 404, body: { ok: false as const, code: 'NOT_FOUND', reason: 'Unknown social action for this execution.' } };
  }

  if (env.SOCIAL_WRITE_MODE === 'test') {
    return stillUnknown(existing, 'Test mode does not contact live providers during reconciliation.');
  }

  const price = reconcilePrice(env);
  if (price == null) {
    return stillUnknown(existing, 'Reconciliation reads fail closed until SOCIAL_RECONCILE_READ_USD is set.');
  }
  let reservationId: string | null = null;
  let providerCallStarted = false;
  if (price > 0) {
    const usage = await readActiveMonthUsage(env.DB, userId);
    if (!usage.available) return stillUnknown(existing, 'Budget ledger is unavailable for reconciliation reads.');
    const budget = await resolveEffectiveBudgetLimit(env, userId);
    reservationId = crypto.randomUUID();
    const reserved = await reserveActiveMonthBudget(env.DB, {
      id: reservationId,
      userId,
      provider: action.platform,
      operation: 'social_reconcile_read',
      amountUsd: price,
      effectiveLimit: budget.effectiveLimitUsd,
      occurredAt: new Date().toISOString(),
    });
    if (!reserved) return stillUnknown(existing, 'Reconciliation read was blocked by the monthly HARD LIMIT.');
  }

  try {
    const event = action.externalEventId
      ? await loadBoundEvent(env.DB, userId, action)
      : null;
    const fingerprint = parseExecutionFingerprint(existing.fingerprintJson);
    if (!fingerprint) {
      return stillUnknown(existing, 'UNKNOWN reconciliation cannot run without a durable execution fingerprint.');
    }
    providerCallStarted = true;
    const match = await readProviderMatch(env, action, existing, event, fingerprint);
    if (match === 'success') {
      const completedAt = new Date().toISOString();
      await completeExecution(env, {
        ...existing,
        status: 'succeeded',
        errorCode: null,
        completedAt,
      });
      await finalizeActionStatus(env.DB, userId, action.id, 'completed', { completedAt, nowIso: completedAt });
      return {
        status: 200,
        body: {
          ok: true as const,
          idempotent: false,
          executionId,
          status: 'succeeded',
          certainty: 'success',
          reservationRetained: Boolean(existing.reservationId),
        },
      };
    }
    if (match === 'failure') {
      const completedAt = new Date().toISOString();
      await completeExecution(env, { ...existing, status: 'failed', errorCode: 'INVALID_ACTION', completedAt });
      await finalizeActionStatus(env.DB, userId, action.id, 'failed', { retryable: true, nowIso: completedAt });
      if (existing.reservationId) await voidBudgetReservation(env.DB, { id: existing.reservationId, userId });
      return {
        status: 200,
        body: {
          ok: true as const,
          executionId,
          status: 'failed',
          certainty: 'failure',
          reservationRetained: false,
          reservationReleased: Boolean(existing.reservationId),
        },
      };
    }
    return stillUnknown(existing, 'Provider evidence is missing or ambiguous. This execution stays UNKNOWN and must not be resent with a new executionId.');
  } catch (error) {
    if (!providerCallStarted && reservationId) {
      await voidBudgetReservation(env.DB, { id: reservationId, userId });
    }
    const message = error instanceof Error ? error.message : 'Reconciliation failed';
    return stillUnknown(existing, message);
  }
}

export async function recoverUnknownIfNeeded(env: ReconcileEnv, userId: string, execution: ExecutionRecord) {
  if (execution.status === 'pending' && execution.errorCode !== 'UNKNOWN_RESULT' && execution.errorCode !== 'SENDING') {
    return;
  }
  if (execution.status === 'pending' && (execution.errorCode === 'SENDING' || execution.errorCode == null)) {
    await markUnknown(env, execution);
  }
}

async function readProviderMatch(
  env: ReconcileEnv,
  action: CanonicalSocialAction,
  execution: ExecutionRecord,
  event: CanonicalSocialEvent | null,
  fingerprint: ExecutionFingerprint | null,
): Promise<'success' | 'failure' | 'unknown'> {
  try {
    if (action.platform === 'instagram' && action.type === 'comment_reply') {
      return reconcileInstagramComment(env, action, execution, event, fingerprint);
    }
    if (action.platform === 'instagram' && (action.type === 'dm_reply' || action.type === 'dm_outbound')) {
      return reconcileInstagramDm(env, action, execution, event, fingerprint);
    }
    if (action.platform === 'x' && (action.type === 'reply_inbound' || action.type === 'reply_outbound')) {
      return reconcileXReply(env, action, execution, event, fingerprint);
    }
    if (action.platform === 'x' && (action.type === 'dm_reply' || action.type === 'dm_outbound')) {
      return reconcileXDm(env, action, execution, event, fingerprint);
    }
    if (action.platform === 'x' && action.type === 'like') {
      return reconcileXLike(env, action, execution, fingerprint);
    }
    if (action.platform === 'x' && (action.type === 'follow' || action.type === 'unfollow_review')) {
      return reconcileXFollow(env, action, execution, fingerprint);
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function inReconcileWindow(createdIso: string, occurredMs: number) {
  return Number.isFinite(occurredMs) && Math.abs(occurredMs - new Date(createdIso).getTime()) <= RECONCILE_WINDOW_MS;
}

async function reconcileInstagramComment(
  env: ReconcileEnv,
  action: CanonicalSocialAction,
  execution: ExecutionRecord,
  event: CanonicalSocialEvent | null,
  fingerprint: ExecutionFingerprint | null,
): Promise<'success' | 'failure' | 'unknown'> {
  const commentId = event?.externalEventId || action.externalEventId || '';
  const version = env.INSTAGRAM_API_VERSION?.trim() || '';
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim() || '';
  const ownId = env.INSTAGRAM_USER_ID?.trim() || '';
  if (!/^\d{1,30}$/.test(commentId) || !token || !/^v\d+\.\d+$/.test(version) || !ownId) return 'unknown';
  if (!fingerprint?.normalizedTextSha256) return 'unknown';
  if (!fingerprint.canonicalTargetId || fingerprint.canonicalTargetId !== commentId) return 'unknown';
  if (!fingerprint.actorId || fingerprint.actorId !== ownId) return 'unknown';
  const url = `https://graph.instagram.com/${version}/${encodeURIComponent(commentId)}/replies?fields=id,text,timestamp,from,parent`;
  const payload = await igGet<{ data?: Array<Record<string, unknown>> }>(url, token, 'Instagram reply reconcile');
  const matches = [];
  for (const row of payload.data || []) {
    const fromId = isRecord(row.from) && typeof row.from.id === 'string' ? row.from.id : '';
    const parentId = isRecord(row.parent) && typeof row.parent.id === 'string' ? row.parent.id : commentId;
    const created = typeof row.timestamp === 'string' ? new Date(row.timestamp).getTime() : Number.NaN;
    const textOk = await providerTextMatchesFingerprint(fingerprint, typeof row.text === 'string' ? row.text : undefined);
    if (fromId === ownId && fromId === fingerprint.actorId && parentId === commentId && inReconcileWindow(execution.createdAt, created) && textOk) {
      matches.push(row);
    }
  }
  return exactReconcileDecision(matches.length);
}

async function reconcileInstagramDm(
  env: ReconcileEnv,
  action: CanonicalSocialAction,
  execution: ExecutionRecord,
  event: CanonicalSocialEvent | null,
  fingerprint: ExecutionFingerprint | null,
): Promise<'success' | 'failure' | 'unknown'> {
  const conversationId = action.conversationId || (typeof event?.payload.conversationId === 'string' ? event.payload.conversationId : '');
  const version = env.INSTAGRAM_API_VERSION?.trim() || '';
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim() || '';
  const ownId = env.INSTAGRAM_USER_ID?.trim() || '';
  if (!conversationId || !token || !ownId || !instagramMessagingWindowOpen(event?.occurredAt || action.observedAt)) return 'unknown';
  if (!fingerprint?.normalizedTextSha256) return 'unknown';
  if (!fingerprint.conversationId || fingerprint.conversationId !== conversationId) return 'unknown';
  if (!fingerprint.actorId || fingerprint.actorId !== ownId) return 'unknown';
  const url = `https://graph.instagram.com/${version}/${encodeURIComponent(conversationId)}?fields=messages{id,created_time,from,message}`;
  const payload = await igGet<{ messages?: { data?: Array<Record<string, unknown>> } }>(url, token, 'Instagram DM reconcile');
  const matches = [];
  for (const row of payload.messages?.data || []) {
    const fromId = isRecord(row.from) && typeof row.from.id === 'string' ? row.from.id : '';
    const created = typeof row.created_time === 'string' ? new Date(row.created_time).getTime() : Number.NaN;
    const text = typeof row.message === 'string' ? row.message : typeof row.text === 'string' ? row.text : undefined;
    const textOk = await providerTextMatchesFingerprint(fingerprint, text);
    if (fromId === ownId && fromId === fingerprint.actorId && inReconcileWindow(execution.createdAt, created) && textOk) matches.push(row);
  }
  return exactReconcileDecision(matches.length);
}

async function reconcileXReply(
  env: ReconcileEnv,
  action: CanonicalSocialAction,
  execution: ExecutionRecord,
  event: CanonicalSocialEvent | null,
  fingerprint: ExecutionFingerprint | null,
): Promise<'success' | 'failure' | 'unknown'> {
  const tweetId = event?.externalEventId || action.externalEventId || '';
  if (!/^\d{1,30}$/.test(tweetId)) return 'unknown';
  if (!fingerprint?.normalizedTextSha256) return 'unknown';
  if (!fingerprint.canonicalTargetId || fingerprint.canonicalTargetId !== tweetId) return 'unknown';
  if (fingerprint.parentContentId && fingerprint.parentContentId !== tweetId) return 'unknown';
  const accessToken = await getValidXAccessToken(env, action.userId);
  const me = await lookupXAuthenticatedUser(accessToken);
  if (!me) return 'unknown';
  if (!fingerprint.actorId || fingerprint.actorId !== me.id) return 'unknown';
  const url = `https://api.x.com/2/users/${encodeURIComponent(me.id)}/tweets?max_results=20&tweet.fields=created_at,text,conversation_id&expansions=referenced_tweets.id`;
  const payload = await xGet<{
    data?: Array<Record<string, unknown>>;
  }>(url, accessToken, 'X reply reconcile');
  const matches = [];
  for (const row of payload.data || []) {
    const referenced = Array.isArray(row.referenced_tweets) ? row.referenced_tweets : [];
    const repliesTo = referenced.some((item) => isRecord(item) && item.type === 'replied_to' && item.id === tweetId);
    const created = typeof row.created_at === 'string' ? new Date(row.created_at).getTime() : Number.NaN;
    const textOk = await providerTextMatchesFingerprint(fingerprint, typeof row.text === 'string' ? row.text : undefined);
    if (repliesTo && inReconcileWindow(execution.createdAt, created) && textOk) matches.push(row);
  }
  return exactReconcileDecision(matches.length);
}

async function reconcileXDm(
  env: ReconcileEnv,
  action: CanonicalSocialAction,
  execution: ExecutionRecord,
  event: CanonicalSocialEvent | null,
  fingerprint: ExecutionFingerprint | null,
): Promise<'success' | 'failure' | 'unknown'> {
  const conversationId = action.conversationId || (typeof event?.payload.conversationId === 'string' ? event.payload.conversationId : '');
  if (!conversationId) return 'unknown';
  if (!fingerprint?.normalizedTextSha256) return 'unknown';
  if (!fingerprint.conversationId || fingerprint.conversationId !== conversationId) return 'unknown';
  const accessToken = await getValidXAccessToken(env, action.userId);
  const me = await lookupXAuthenticatedUser(accessToken);
  if (!me) return 'unknown';
  if (!fingerprint.actorId || fingerprint.actorId !== me.id) return 'unknown';
  const url = 'https://api.x.com/2/dm_events?max_results=50&dm_event.fields=id,text,event_type,dm_conversation_id,sender_id,created_at&event_types=MessageCreate';
  const payload = await xGet<{ data?: Array<Record<string, unknown>> }>(url, accessToken, 'X DM reconcile');
  const matches = [];
  for (const row of payload.data || []) {
    const sender = typeof row.sender_id === 'string' ? row.sender_id : '';
    const conversation = typeof row.dm_conversation_id === 'string' ? row.dm_conversation_id : '';
    const created = typeof row.created_at === 'string' ? new Date(row.created_at).getTime() : Number.NaN;
    const textOk = await providerTextMatchesFingerprint(fingerprint, typeof row.text === 'string' ? row.text : undefined);
    if (sender === me.id && conversation === conversationId && inReconcileWindow(execution.createdAt, created) && textOk) {
      matches.push(row);
    }
  }
  return exactReconcileDecision(matches.length);
}

async function reconcileXLike(
  env: ReconcileEnv,
  action: CanonicalSocialAction,
  _execution: ExecutionRecord,
  fingerprint: ExecutionFingerprint | null,
): Promise<'success' | 'failure' | 'unknown'> {
  const tweetId = action.externalEventId || extractXTweetId(action.targetUrl || '');
  if (!/^\d{1,30}$/.test(tweetId)) return 'unknown';
  if (!fingerprint?.canonicalTargetId || fingerprint.canonicalTargetId !== tweetId) return 'unknown';
  if (!fingerprint.actorId || !fingerprint.operation || !fingerprint.preparedAt) return 'unknown';
  if (fingerprint.operation !== 'x_like_write') return 'unknown';
  const oauth = await xOAuthStatus(env, action.userId);
  if (!likeReconciliationReady(oauth.scopes || [])) return 'unknown';
  const accessToken = await getValidXAccessToken(env, action.userId);
  const me = await lookupXAuthenticatedUser(accessToken);
  if (!me) return 'unknown';
  if (fingerprint.actorId !== me.id) return 'unknown';
  const state = await lookupXLikedState({ sourceUserId: me.id, tweetId, accessToken });
  return interpretLikeState(state);
}

async function reconcileXFollow(
  env: ReconcileEnv,
  action: CanonicalSocialAction,
  _execution: ExecutionRecord,
  fingerprint: ExecutionFingerprint | null,
): Promise<'success' | 'failure' | 'unknown'> {
  const target = action.platformUserId || '';
  if (!/^\d{1,30}$/.test(target)) return 'unknown';
  if (!fingerprint?.canonicalTargetId || fingerprint.canonicalTargetId !== target) return 'unknown';
  if (!fingerprint.actorId || !fingerprint.operation || !fingerprint.preparedAt) return 'unknown';
  const expectedOp = action.type === 'unfollow_review' ? 'x_unfollow_write' : 'x_follow_write';
  if (fingerprint.operation !== expectedOp) return 'unknown';
  const accessToken = await getValidXAccessToken(env, action.userId);
  const me = await lookupXAuthenticatedUser(accessToken);
  if (!me) return 'unknown';
  if (fingerprint.actorId !== me.id) return 'unknown';
  const relationship = await lookupXFollowRelationship({
    sourceUserId: me.id,
    targetUserId: target,
    accessToken,
  });
  return interpretFollowRelationship(action.type === 'unfollow_review' ? 'unfollow_review' : 'follow', relationship);
}

function stillUnknown(existing: ExecutionRecord, reason: string) {
  return {
    status: 202,
    body: {
      ok: false as const,
      code: 'UNKNOWN_RESULT',
      idempotent: true,
      executionId: existing.idempotencyKey,
      status: 'unknown',
      certainty: 'unknown',
      reason,
      reservationRetained: Boolean(existing.reservationId),
    },
  };
}

async function loadBoundEvent(db: D1Database, userId: string, action: CanonicalSocialAction) {
  if (!action.externalEventId) return null;
  if (action.platform === 'instagram' && action.type === 'comment_reply') {
    return loadCanonicalEvent(db, userId, 'instagram', 'comment', action.externalEventId);
  }
  if (action.platform === 'instagram' && (action.type === 'dm_reply' || action.type === 'dm_outbound')) {
    return loadCanonicalEvent(db, userId, 'instagram', 'dm', action.externalEventId);
  }
  if (action.platform === 'x' && (action.type === 'dm_reply' || action.type === 'dm_outbound')) {
    return loadCanonicalEvent(db, userId, 'x', 'dm', action.externalEventId);
  }
  if (action.platform === 'x') {
    return await loadCanonicalEvent(db, userId, 'x', 'reply', action.externalEventId)
      || await loadCanonicalEvent(db, userId, 'x', 'mention', action.externalEventId);
  }
  return null;
}

export async function loadExecution(env: { DB: D1Database }, userId: string, executionId: string): Promise<ExecutionRecord | null> {
  try {
    const row = await env.DB.prepare(
      'SELECT id, user_id, action_id, platform, operation, idempotency_key, external_result_id, status, error_code, created_at, completed_at, reservation_id, result_metadata_json, fingerprint_json FROM social_executions WHERE user_id = ? AND idempotency_key = ?',
    ).bind(userId, executionId).first<Record<string, string | null>>();
    if (row) return mapExecution(row);
  } catch {
    // fingerprint_json may not exist yet.
  }
  try {
    const row = await env.DB.prepare(
      'SELECT id, user_id, action_id, platform, operation, idempotency_key, external_result_id, status, error_code, created_at, completed_at, reservation_id, result_metadata_json FROM social_executions WHERE user_id = ? AND idempotency_key = ?',
    ).bind(userId, executionId).first<Record<string, string | null>>();
    if (!row) return mapLegacyExecution(env, userId, executionId);
    return mapExecution(row);
  } catch {
    return mapLegacyExecution(env, userId, executionId);
  }
}

async function mapLegacyExecution(env: { DB: D1Database }, userId: string, executionId: string) {
  try {
    const row = await env.DB.prepare(
      'SELECT id, user_id, action_id, platform, operation, idempotency_key, external_result_id, status, error_code, created_at, completed_at FROM social_executions WHERE user_id = ? AND idempotency_key = ?',
    ).bind(userId, executionId).first<Record<string, string | null>>();
    return row ? mapExecution(row) : null;
  } catch {
    return null;
  }
}

function mapExecution(row: Record<string, string | null>): ExecutionRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    actionId: String(row.action_id),
    platform: String(row.platform),
    operation: String(row.operation),
    idempotencyKey: String(row.idempotency_key),
    externalResultId: row.external_result_id,
    status: row.status === 'succeeded' || row.status === 'failed' ? row.status : 'pending',
    errorCode: row.error_code,
    createdAt: String(row.created_at),
    completedAt: row.completed_at,
    reservationId: row.reservation_id || null,
    resultMetadataJson: row.result_metadata_json || null,
    fingerprintJson: row.fingerprint_json || null,
  };
}

async function markUnknown(env: { DB: D1Database }, execution: ExecutionRecord) {
  try {
    await env.DB.prepare(
      `UPDATE social_executions SET error_code = 'UNKNOWN_RESULT' WHERE user_id = ? AND idempotency_key = ? AND status = 'pending'`,
    ).bind(execution.userId, execution.idempotencyKey).run();
  } catch {
    // Keep in-memory unknown handling.
  }
}

async function completeExecution(env: { DB: D1Database }, record: ExecutionRecord) {
  try {
    await env.DB.prepare(
      'UPDATE social_executions SET status = ?, external_result_id = ?, error_code = ?, completed_at = ? WHERE user_id = ? AND idempotency_key = ?',
    ).bind(record.status, record.externalResultId, record.errorCode, record.completedAt, record.userId, record.idempotencyKey).run();
  } catch {
    // Recovery still returns the in-memory result.
  }
}

function reconcilePrice(env: ReconcileEnv) {
  if (env.SOCIAL_RECONCILE_READ_USD == null || String(env.SOCIAL_RECONCILE_READ_USD).trim() === '') return null;
  const amount = Number(env.SOCIAL_RECONCILE_READ_USD);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

async function igGet<T>(url: string, token: string, label: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  }, 20_000, label);
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body || typeof body !== 'object') throw new Error(`${label} returned ${response.status}`);
  return body;
}

async function xGet<T>(url: string, accessToken: string, label: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  }, 20_000, label);
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body || typeof body !== 'object') throw new Error(`${label} returned ${response.status}`);
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
