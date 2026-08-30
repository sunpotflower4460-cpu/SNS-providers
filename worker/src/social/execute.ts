import { INSTAGRAM_PROFESSIONAL_CAPABILITIES, xCapabilitiesFromScopes } from './capabilities';
import { assertExecutable, assertSingleActionExecute, type ExecuteGuardErr } from './executeGuard';
import type { ExecuteRequest } from './types';

export interface SocialExecuteEnv {
  DB: D1Database;
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  X_REPLY_WRITE_USD?: string;
  X_FOLLOW_WRITE_USD?: string;
  X_DM_WRITE_USD?: string;
  INSTAGRAM_COMMENT_REPLY_USD?: string;
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
}

export async function executeSocialAction(env: SocialExecuteEnv, userId: string, body: unknown, grantedXScopes: string[] = []) {
  const parsed = assertSingleActionExecute(body);
  if (isExecuteGuardErr(parsed)) return { status: 400, body: parsed };

  const capabilities = parsed.action.platform === 'instagram'
    ? INSTAGRAM_PROFESSIONAL_CAPABILITIES
    : xCapabilitiesFromScopes(grantedXScopes);
  const writesEnabled = env.SOCIAL_WRITE_ENABLED === 'true' || env.SOCIAL_WRITE_MODE === 'test';
  const writeCostKnown = env.SOCIAL_WRITE_MODE === 'test' || knownWriteCost(env, parsed) != null;
  const executable = assertExecutable(parsed, capabilities, { writesEnabled, writeCostKnown });
  if (!executable.ok) {
    const status = executable.code === 'WRITE_DISABLED' || executable.code === 'WRITE_COST_UNKNOWN' || executable.code === 'CAPABILITY_DENIED'
      ? 403
      : 400;
    return { status, body: executable };
  }

  if (env.SOCIAL_WRITE_MODE !== 'test') {
    return {
      status: 501,
      body: {
        ok: false as const,
        code: 'WRITE_DISABLED',
        reason: 'Live provider writes are not enabled for this operation yet.',
      },
    };
  }

  const existing = await loadExecution(env, userId, parsed.executionId);
  if (existing) {
    return {
      status: 200,
      body: {
        ok: true,
        idempotent: true,
        executionId: existing.idempotencyKey,
        status: existing.status,
        externalResultId: existing.externalResultId,
      },
    };
  }

  const now = new Date().toISOString();
  const record: ExecutionRecord = {
    id: crypto.randomUUID(),
    userId,
    actionId: parsed.action.id,
    platform: parsed.action.platform,
    operation: writeOperation(parsed),
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
    if (raced) {
      return {
        status: 200,
        body: {
          ok: true,
          idempotent: true,
          executionId: raced.idempotencyKey,
          status: raced.status,
          externalResultId: raced.externalResultId,
        },
      };
    }
  }
  if (!stored || stored === 'conflict') return { status: 503, body: { ok: false as const, code: 'WRITE_COST_UNKNOWN', reason: 'Execution ledger is unavailable.' } };

  const completed = {
    ...record,
    status: 'succeeded' as const,
    externalResultId: `test-${parsed.executionId}`,
    completedAt: new Date().toISOString(),
  };
  await completeExecution(env, completed);
  return {
    status: 200,
    body: {
      ok: true,
      idempotent: false,
      executionId: parsed.executionId,
      status: 'succeeded',
      externalResultId: completed.externalResultId,
    },
  };
}

function isExecuteGuardErr(value: ExecuteRequest | ExecuteGuardErr): value is ExecuteGuardErr {
  return 'ok' in value && value.ok === false;
}

function writeOperation(request: ExecuteRequest) {
  switch (request.action.type) {
    case 'comment_reply': return 'instagram_comment_reply';
    case 'dm_reply':
    case 'dm_outbound':
      return request.action.platform === 'instagram' ? 'instagram_dm_write' : 'x_dm_write';
    case 'follow': return 'x_follow_write';
    case 'reply_inbound':
    case 'reply_outbound':
      return 'x_reply_write';
    default: return `${request.action.platform}_write`;
  }
}

function knownWriteCost(env: SocialExecuteEnv, request: ExecuteRequest) {
  const operation = writeOperation(request);
  const raw = operation === 'x_reply_write' ? env.X_REPLY_WRITE_USD
    : operation === 'x_follow_write' ? env.X_FOLLOW_WRITE_USD
      : operation === 'x_dm_write' ? env.X_DM_WRITE_USD
        : operation === 'instagram_comment_reply' ? env.INSTAGRAM_COMMENT_REPLY_USD
          : undefined;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
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

async function completeExecution(env: SocialExecuteEnv, record: ExecutionRecord) {
  try {
    await env.DB.prepare(
      'UPDATE social_executions SET status = ?, external_result_id = ?, completed_at = ? WHERE user_id = ? AND idempotency_key = ?'
    ).bind(record.status, record.externalResultId, record.completedAt, record.userId, record.idempotencyKey).run();
  } catch {
    // Idempotent recovery still returns the in-memory result below.
  }
}
