import { readActiveMonthUsage, reserveActiveMonthBudget, voidBudgetReservation } from '../budgetIntegrity';
import { resolveEffectiveBudgetLimit } from './budgetCeiling';
import { liveInstagramCapabilities, liveXCapabilities, operationWriteEnabled } from './capabilities';
import { buildExecutionFingerprint, persistExecutionFingerprintOrThrow } from './fingerprint';
import {
  assertExecutable,
  parseExecuteBody,
  resolveWriteTarget,
  writeOperationFor,
  needsDraft,
  type ExecuteGuardErr,
} from './executeGuard';
import { replyToInstagramComment } from './instagram/execute';
import { sendInstagramDm } from './instagram/dm';
import { probeInstagramPermissions } from './instagram/probe';
import { followXUser, unfollowXUser } from './x/follow';
import { likeXTweet } from './x/like';
import { sendXDm } from './x/dm';
import { replyToXTweet } from './x/execute';
import { lookupXAuthenticatedUser } from './x/lookup';
import { getValidXAccessToken, xOAuthStatus, type XOAuthEnv } from '../xOAuth';
import {
  claimActionForExecution,
  finalizeActionStatus,
  loadCanonicalAction,
  loadCanonicalEvent,
} from './repository';
import type {
  CanonicalExecuteContext,
  CanonicalSocialAction,
  ExecuteRequest,
  ProviderWriteResult,
} from './types';

export interface SocialExecuteEnv extends XOAuthEnv {
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  INSTAGRAM_COMMENT_REPLY_ENABLED?: string;
  X_REPLY_WRITE_ENABLED?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_API_VERSION?: string;
  X_REPLY_WRITE_USD?: string;
  X_FOLLOW_WRITE_USD?: string;
  X_DM_WRITE_USD?: string;
  INSTAGRAM_COMMENT_REPLY_USD?: string;
  INSTAGRAM_DM_WRITE_USD?: string;
  X_UNFOLLOW_WRITE_USD?: string;
  X_LIKE_WRITE_USD?: string;
  INSTAGRAM_DM_WRITE_ENABLED?: string;
  X_FOLLOW_WRITE_ENABLED?: string;
  X_UNFOLLOW_WRITE_ENABLED?: string;
  X_LIKE_WRITE_ENABLED?: string;
  X_DM_WRITE_ENABLED?: string;
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
  reservationId?: string | null;
  fingerprintJson?: string | null;
}

export interface SocialExecuteAdapters {
  replyToInstagramComment?: typeof replyToInstagramComment;
  replyToXTweet?: typeof replyToXTweet;
  followXUser?: typeof followXUser;
  unfollowXUser?: typeof unfollowXUser;
  likeXTweet?: typeof likeXTweet;
  sendXDm?: typeof sendXDm;
  sendInstagramDm?: typeof sendInstagramDm;
  xGrantedScopes?: readonly string[];
  getXAccessToken?: () => Promise<string>;
}

export async function executeSocialAction(
  env: SocialExecuteEnv,
  userId: string,
  actionId: string,
  body: unknown,
  adapters: SocialExecuteAdapters = {},
) {
  const parsed = parseExecuteBody(body);
  if (isExecuteGuardErr(parsed)) return { status: 400, body: parsed };

  const action = await loadCanonicalAction(env.DB, userId, actionId.trim());
  if (!action) {
    return {
      status: 404,
      body: { ok: false as const, code: 'NOT_FOUND', reason: 'Unknown social action.' },
    };
  }

  const event = await loadBoundEvent(env.DB, userId, action);

  const context: CanonicalExecuteContext = {
    executionId: parsed.executionId,
    draft: parsed.draft,
    action,
    candidate: {
      id: action.candidateId,
      platform: action.platform,
      platformUserId: action.platformUserId,
      username: action.username || '',
      identityConflict: action.identityConflict,
    },
    event,
  };

  const operation = writeOperationFor(action.type, action.platform);
  const existing = await loadExecution(env, userId, parsed.executionId);
  if (existing) return recoverExecution(existing, action, operation);

  const xScopes = action.platform === 'x'
    ? (adapters.xGrantedScopes || (await xOAuthStatus(env, userId)).scopes || [])
    : [];
  const capabilities = action.platform === 'instagram'
    ? liveInstagramCapabilities(env, env.SOCIAL_WRITE_MODE === 'test' ? undefined : await probeInstagramPermissions(env, userId).catch(() => null))
    : liveXCapabilities(env, xScopes, true);
  const writesEnabled = operationWriteEnabled(env, operation);
  const writeCostKnown = env.SOCIAL_WRITE_MODE === 'test' || knownWriteCost(env, operation) != null;
  const executable = assertExecutable(context, capabilities, { writesEnabled, writeCostKnown });
  if (!executable.ok) {
    const status = executable.code === 'WRITE_DISABLED' || executable.code === 'WRITE_COST_UNKNOWN' || executable.code === 'CAPABILITY_DENIED'
      ? 403
      : executable.code === 'RETRY_NOT_SAFE'
        ? 409
        : 400;
    return { status, body: executable };
  }

  const target = resolveWriteTarget(action, event);
  if ('ok' in target && target.ok === false) return { status: 400, body: target };

  const now = new Date().toISOString();
  const claimed = await claimActionForExecution(env.DB, userId, action.id, now);
  if (!claimed) {
    const latest = await loadCanonicalAction(env.DB, userId, action.id);
    if (latest?.status === 'executing') {
      const prior = await loadLatestExecutionForAction(env, userId, action.id);
      if (prior) return recoverExecution(prior, latest, operation);
      return {
        status: 202,
        body: {
          ok: false as const,
          code: 'UNKNOWN_RESULT',
          reason: 'This action is executing with no confirmed provider result. Reconcile instead of sending again.',
          executionId: parsed.executionId,
          status: 'unknown',
          certainty: 'unknown',
        },
      };
    }
    return {
      status: 409,
      body: { ok: false as const, code: 'INVALID_ACTION', reason: 'This social action is not in an executable state.' },
    };
  }

  const record: ExecutionRecord = {
    id: crypto.randomUUID(),
    userId,
    actionId: action.id,
    platform: action.platform,
    operation,
    idempotencyKey: parsed.executionId,
    externalResultId: null,
    status: 'pending',
    errorCode: null,
    createdAt: now,
    completedAt: null,
  };
  const stored = await persistExecution(env, record);
  if (stored === 'conflict') {
    const raced = await loadExecution(env, userId, parsed.executionId);
    if (raced) return recoverExecution(raced, action, operation);
  }
  if (!stored || stored === 'conflict') {
    await finalizeActionStatus(env.DB, userId, action.id, 'failed', { retryable: true, nowIso: new Date().toISOString() });
    return { status: 503, body: { ok: false as const, code: 'WRITE_COST_UNKNOWN', reason: 'Execution ledger is unavailable.' } };
  }

  const sending = await markExecutionSending(env, userId, parsed.executionId);
  if (!sending) {
    const raced = await loadExecution(env, userId, parsed.executionId);
    if (raced) return recoverExecution(raced, action, operation);
    return {
      status: 409,
      body: { ok: false as const, code: 'UNKNOWN_RESULT', reason: 'Execution state could not be reserved safely.' },
    };
  }

  const cost = env.SOCIAL_WRITE_MODE === 'test' ? 0 : knownWriteCost(env, operation);
  if (cost == null && env.SOCIAL_WRITE_MODE !== 'test') {
    await completeExecution(env, { ...record, status: 'failed', errorCode: 'WRITE_COST_UNKNOWN', completedAt: new Date().toISOString() });
    await finalizeActionStatus(env.DB, userId, action.id, 'failed', { retryable: true, nowIso: new Date().toISOString() });
    return { status: 403, body: { ok: false as const, code: 'WRITE_COST_UNKNOWN', reason: 'Billable social writes fail closed when accounting is unavailable.' } };
  }

  let reservationId: string | null = null;
  if ((cost || 0) > 0) {
    const usage = await readActiveMonthUsage(env.DB, userId);
    if (!usage.available) {
      await completeExecution(env, { ...record, status: 'failed', errorCode: 'WRITE_COST_UNKNOWN', completedAt: new Date().toISOString() });
      await finalizeActionStatus(env.DB, userId, action.id, 'failed', { retryable: true, nowIso: new Date().toISOString() });
      return { status: 403, body: { ok: false as const, code: 'WRITE_COST_UNKNOWN', reason: 'Budget ledger is unavailable.' } };
    }
    const budget = await resolveEffectiveBudgetLimit(env, userId);
    const effectiveLimit = budget.effectiveLimitUsd;
    reservationId = crypto.randomUUID();
    const reserved = await reserveActiveMonthBudget(env.DB, {
      id: reservationId,
      userId,
      provider: action.platform,
      operation,
      amountUsd: cost || 0,
      effectiveLimit,
      occurredAt: new Date().toISOString(),
    });
    if (!reserved) {
      await completeExecution(env, { ...record, status: 'failed', errorCode: 'WRITE_COST_UNKNOWN', completedAt: new Date().toISOString() });
      await finalizeActionStatus(env.DB, userId, action.id, 'failed', { retryable: true, nowIso: new Date().toISOString() });
      return { status: 403, body: { ok: false as const, code: 'WRITE_COST_UNKNOWN', reason: 'Write budget reservation failed closed.' } };
    }
    record.reservationId = reservationId;
    await attachReservation(env, userId, parsed.executionId, reservationId);
  }

  let providerCallStarted = false;
  let result: ProviderWriteResult;
  try {
    const boundTarget = resolveWriteTarget(action, event);
    let accessToken = '';
    if (action.platform === 'x' && env.SOCIAL_WRITE_MODE !== 'test') {
      accessToken = adapters.getXAccessToken
        ? await adapters.getXAccessToken()
        : await getValidXAccessToken(env, userId);
    }
    let actorId = action.platform === 'instagram' ? env.INSTAGRAM_USER_ID?.trim() : undefined;
    if (action.platform === 'x') {
      if (env.SOCIAL_WRITE_MODE === 'test' && !accessToken) {
        actorId = actorId || 'test-actor';
      } else {
        const me = await lookupXAuthenticatedUser(accessToken);
        actorId = me?.id;
      }
    }
    if (env.SOCIAL_WRITE_MODE === 'test' && !actorId) actorId = 'test-actor';
    if (!actorId) {
      throw new Error('Authenticated actor ID is required before a provider write.');
    }
    const targetId = isExecuteGuardErr(boundTarget)
      ? (action.externalEventId || action.platformUserId || action.id)
      : boundTarget.externalEventId;
    const fingerprint = await buildExecutionFingerprint({
      draft: needsDraft(action.type) ? parsed.draft : undefined,
      canonicalTargetId: targetId,
      conversationId: isExecuteGuardErr(boundTarget) ? action.conversationId : boundTarget.conversationId,
      parentContentId: isExecuteGuardErr(boundTarget) ? action.parentContentId : boundTarget.parentContentId,
      actorId,
      operation,
    });
    await persistExecutionFingerprintOrThrow(env.DB, userId, parsed.executionId, fingerprint);
    providerCallStarted = true;
    result = await performProviderWrite(env, context, operation, adapters);
  } catch (error) {
    if (!providerCallStarted && reservationId) {
      await voidBudgetReservation(env.DB, { id: reservationId, userId });
    }
    const message = error instanceof Error ? error.message : 'Provider write did not start.';
    if (!providerCallStarted) {
      await completeExecution(env, { ...record, status: 'failed', errorCode: 'CAPABILITY_DENIED', completedAt: new Date().toISOString() });
      await finalizeActionStatus(env.DB, userId, action.id, 'failed', { retryable: true, nowIso: new Date().toISOString() });
      return { status: 403, body: { ok: false as const, code: 'CAPABILITY_DENIED', reason: message } };
    }
    result = {
      certainty: 'unknown',
      retryable: false,
      errorCode: 'UNKNOWN_RESULT',
      reason: message,
    };
  }
  const completedAt = new Date().toISOString();

  if (result.certainty === 'success') {
    await completeExecution(env, {
      ...record,
      status: 'succeeded',
      externalResultId: result.externalResultId || null,
      errorCode: null,
      completedAt,
    });
    if ((cost || 0) === 0) await recordZeroCostWrite(env, userId, action.platform, operation);
    await finalizeActionStatus(env.DB, userId, action.id, 'completed', { completedAt, nowIso: completedAt });
    return {
      status: 200,
      body: {
        ok: true,
        idempotent: false,
        executionId: parsed.executionId,
        status: 'succeeded',
        certainty: 'success',
        externalResultId: result.externalResultId || null,
        providerStatus: result.providerStatus,
        metadata: result.metadata,
        pendingFollow: result.metadata?.pendingFollow === true,
      },
    };
  }

  if (result.certainty === 'unknown') {
    await completeExecution(env, {
      ...record,
      status: 'pending',
      errorCode: 'UNKNOWN_RESULT',
      completedAt: null,
    });
    return {
      status: 202,
      body: {
        ok: false as const,
        code: 'UNKNOWN_RESULT',
        reason: result.reason || 'Provider result is unknown and must be reconciled. Do not retry with a new executionId.',
        executionId: parsed.executionId,
        status: 'unknown',
        certainty: 'unknown',
        reservationRetained: Boolean(reservationId),
      },
    };
  }

  await completeExecution(env, {
    ...record,
    status: 'failed',
    errorCode: result.errorCode || 'INVALID_ACTION',
    completedAt,
  });
  if (reservationId) await voidBudgetReservation(env.DB, { id: reservationId, userId });
  await finalizeActionStatus(env.DB, userId, action.id, 'failed', {
    retryable: result.retryable === true,
    nowIso: completedAt,
  });
  return {
    status: 400,
    body: {
      ok: false as const,
      code: result.errorCode || 'INVALID_ACTION',
      reason: result.reason || 'Provider write failed.',
      executionId: parsed.executionId,
      status: 'failed',
      certainty: 'failure',
      retryable: result.retryable === true,
    },
  };
}

export function executionBindingsConflict(
  existing: Pick<ExecutionRecord, 'actionId' | 'platform' | 'operation'>,
  action: Pick<CanonicalSocialAction, 'id' | 'platform' | 'type'>,
  operation: string,
) {
  return existing.actionId !== action.id
    || existing.platform !== action.platform
    || existing.operation !== operation;
}

function recoverExecution(existing: ExecutionRecord, action: CanonicalSocialAction, operation: string) {
  if (executionBindingsConflict(existing, action, operation)) {
    return {
      status: 409,
      body: {
        ok: false as const,
        code: 'BINDING_MISMATCH',
        reason: 'This executionId is already bound to a different social action.',
      },
    };
  }
  if (existing.status === 'pending' && existing.errorCode === 'UNKNOWN_RESULT') {
    return {
      status: 202,
      body: {
        ok: false as const,
        code: 'UNKNOWN_RESULT',
        idempotent: true,
        executionId: existing.idempotencyKey,
        status: 'unknown',
        certainty: 'unknown',
        reason: 'A previous attempt already reached the provider. Reconcile this executionId instead of sending again.',
      },
    };
  }
  if (existing.status === 'pending') {
    return {
      status: 200,
      body: {
        ok: true,
        idempotent: true,
        executionId: existing.idempotencyKey,
        status: 'executing',
        certainty: 'unknown',
        externalResultId: existing.externalResultId,
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      idempotent: true,
      executionId: existing.idempotencyKey,
      status: existing.status,
      certainty: existing.status === 'succeeded' ? 'success' : 'failure',
      externalResultId: existing.externalResultId,
    },
  };
}

async function performProviderWrite(
  env: SocialExecuteEnv,
  context: CanonicalExecuteContext,
  operation: string,
  adapters: SocialExecuteAdapters,
): Promise<ProviderWriteResult> {
  if (env.SOCIAL_WRITE_MODE === 'test') {
    return {
      certainty: 'success',
      externalResultId: `test-${context.executionId}`,
      providerStatus: 'test',
    };
  }
  const target = resolveWriteTarget(context.action, context.event);
  if (isExecuteGuardErr(target)) {
    return { certainty: 'failure', retryable: false, errorCode: target.code, reason: target.reason };
  }
  if (operation === 'instagram_comment_reply') {
    const reply = adapters.replyToInstagramComment || replyToInstagramComment;
    return reply({
      commentId: target.externalEventId,
      message: context.draft,
      accessToken: env.INSTAGRAM_ACCESS_TOKEN?.trim() || '',
      apiVersion: env.INSTAGRAM_API_VERSION?.trim() || '',
    });
  }
  if (operation === 'x_reply_write') {
    const reply = adapters.replyToXTweet || replyToXTweet;
    const accessToken = adapters.getXAccessToken
      ? await adapters.getXAccessToken()
      : await getValidXAccessToken(env, context.action.userId);
    return reply({
      tweetId: target.externalEventId,
      message: context.draft,
      accessToken,
    });
  }
  const xToken = async () => adapters.getXAccessToken
    ? adapters.getXAccessToken()
    : getValidXAccessToken(env, context.action.userId);
  if (operation === 'x_follow_write' || operation === 'x_unfollow_write' || operation === 'x_like_write') {
    const accessToken = await xToken();
    const me = await lookupXAuthenticatedUser(accessToken);
    if (!me) {
      return { certainty: 'failure', retryable: false, errorCode: 'CAPABILITY_DENIED', reason: 'Authenticated X user ID could not be resolved from the server token.' };
    }
    if (operation === 'x_like_write') {
      const like = adapters.likeXTweet || likeXTweet;
      return like({ sourceUserId: me.id, tweetId: target.externalEventId, accessToken });
    }
    const follow = operation === 'x_follow_write'
      ? (adapters.followXUser || followXUser)
      : (adapters.unfollowXUser || unfollowXUser);
    return follow({ sourceUserId: me.id, targetUserId: target.externalEventId, accessToken });
  }
  if (operation === 'x_dm_write') {
    if (!target.conversationId) {
      return { certainty: 'failure', retryable: false, errorCode: 'BINDING_MISMATCH', reason: 'X DM requires a canonical conversation ID from server evidence.' };
    }
    const send = adapters.sendXDm || sendXDm;
    return send({ conversationId: target.conversationId, message: context.draft, accessToken: await xToken() });
  }
  if (operation === 'instagram_dm_write') {
    const recipientId = context.action.platformUserId || context.event?.externalUserId || '';
    const send = adapters.sendInstagramDm || sendInstagramDm;
    return send({
      igUserId: env.INSTAGRAM_USER_ID?.trim() || '',
      recipientId,
      message: context.draft,
      accessToken: env.INSTAGRAM_ACCESS_TOKEN?.trim() || '',
      apiVersion: env.INSTAGRAM_API_VERSION?.trim() || '',
      lastInboundAt: context.event?.occurredAt || context.action.observedAt,
    });
  }
  return {
    certainty: 'failure',
    retryable: false,
    errorCode: 'HANDOFF_NOT_EXECUTABLE',
    reason: 'Live provider writes are not enabled for this action type; it stays HANDOFF.',
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

function isExecuteGuardErr(value: unknown): value is ExecuteGuardErr {
  if (!value || typeof value !== 'object' || !('ok' in value)) return false;
  return (value as { ok?: unknown }).ok === false;
}

export function knownWriteCost(env: SocialExecuteEnv, operation: string) {
  const raw = operation === 'x_reply_write' ? env.X_REPLY_WRITE_USD
    : operation === 'x_follow_write' ? env.X_FOLLOW_WRITE_USD
      : operation === 'x_unfollow_write' ? env.X_UNFOLLOW_WRITE_USD
        : operation === 'x_like_write' ? env.X_LIKE_WRITE_USD
          : operation === 'x_dm_write' ? env.X_DM_WRITE_USD
            : operation === 'instagram_comment_reply' ? env.INSTAGRAM_COMMENT_REPLY_USD
              : operation === 'instagram_dm_write' ? env.INSTAGRAM_DM_WRITE_USD
                : undefined;
  if (raw == null || String(raw).trim() === '') return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (operation === 'instagram_comment_reply' || operation === 'instagram_dm_write') return amount;
  return amount > 0 ? amount : null;
}

async function attachReservation(env: SocialExecuteEnv, userId: string, executionId: string, reservationId: string) {
  try {
    await env.DB.prepare(
      'UPDATE social_executions SET reservation_id = ? WHERE user_id = ? AND idempotency_key = ?',
    ).bind(reservationId, userId, executionId).run();
  } catch {
    // Reservation row still exists in budget_ledger; unknown results retain it until reconcile.
  }
}

async function loadLatestExecutionForAction(env: SocialExecuteEnv, userId: string, actionId: string) {
  try {
    const row = await env.DB.prepare(
      `SELECT id, user_id, action_id, platform, operation, idempotency_key, external_result_id, status, error_code, created_at, completed_at
       FROM social_executions WHERE user_id = ? AND action_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(userId, actionId).first<Record<string, string | null>>();
    if (!row) return null;
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
    } satisfies ExecutionRecord;
  } catch {
    return null;
  }
}

async function loadExecution(env: SocialExecuteEnv, userId: string, executionId: string) {
  try {
    const row = await env.DB.prepare(
      'SELECT id, user_id, action_id, platform, operation, idempotency_key, external_result_id, status, error_code, created_at, completed_at FROM social_executions WHERE user_id = ? AND idempotency_key = ?'
    ).bind(userId, executionId).first<Record<string, string | null>>();
    if (!row) return null;
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
    } satisfies ExecutionRecord;
  } catch {
    return null;
  }
}

async function persistExecution(env: SocialExecuteEnv, record: ExecutionRecord) {
  try {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO social_executions
        (id, user_id, action_id, platform, operation, idempotency_key, external_result_id, status, error_code, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      record.id,
      record.userId,
      record.actionId,
      record.platform,
      record.operation,
      record.idempotencyKey,
      record.externalResultId,
      record.status,
      record.errorCode,
      record.createdAt,
      record.completedAt,
    ).run();
    if ((result.meta.changes || 0) === 0) return 'conflict' as const;
    return 'ok' as const;
  } catch {
    return null;
  }
}

async function markExecutionSending(env: SocialExecuteEnv, userId: string, executionId: string) {
  try {
    const result = await env.DB.prepare(
      `UPDATE social_executions SET error_code = 'SENDING'
       WHERE user_id = ? AND idempotency_key = ? AND status = 'pending' AND error_code IS NULL`
    ).bind(userId, executionId).run();
    return (result.meta.changes || 0) === 1;
  } catch {
    return false;
  }
}

async function completeExecution(env: SocialExecuteEnv, record: ExecutionRecord) {
  try {
    await env.DB.prepare(
      'UPDATE social_executions SET status = ?, external_result_id = ?, error_code = ?, completed_at = ? WHERE user_id = ? AND idempotency_key = ?'
    ).bind(record.status, record.externalResultId, record.errorCode, record.completedAt, record.userId, record.idempotencyKey).run();
  } catch {
    // Idempotent recovery still returns the in-memory result below.
  }
}

async function recordZeroCostWrite(env: SocialExecuteEnv, userId: string, provider: string, operation: string) {
  try {
    await env.DB.prepare(
      'INSERT INTO budget_ledger (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)'
    ).bind(crypto.randomUUID(), userId, provider, operation, new Date().toISOString()).run();
  } catch {
    // Zero-cost Instagram replies are documented as non-billable; audit rows must not block a confirmed provider success.
  }
}
