export interface ExecutionFingerprint {
  normalizedTextSha256: string | null;
  canonicalTargetId: string;
  conversationId?: string;
  parentContentId?: string;
  actorId?: string;
  operation: string;
  preparedAt: string;
}

export function normalizeApprovedText(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 2400);
}

export async function hashNormalizedText(value: string) {
  const normalized = normalizeApprovedText(value);
  if (!normalized) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildExecutionFingerprint(input: {
  draft?: string;
  canonicalTargetId: string;
  conversationId?: string;
  parentContentId?: string;
  actorId?: string;
  operation: string;
  preparedAt?: string;
}): Promise<ExecutionFingerprint> {
  const textHash = input.draft != null && input.draft.trim()
    ? await hashNormalizedText(input.draft)
    : null;
  return {
    normalizedTextSha256: textHash,
    canonicalTargetId: input.canonicalTargetId,
    conversationId: input.conversationId,
    parentContentId: input.parentContentId,
    actorId: input.actorId,
    operation: input.operation,
    preparedAt: input.preparedAt || new Date().toISOString(),
  };
}

export function parseExecutionFingerprint(raw: string | null | undefined): ExecutionFingerprint | null {
  if (!raw?.trim() || raw.trim() === '{}') return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const canonicalTargetId = typeof parsed.canonicalTargetId === 'string' ? parsed.canonicalTargetId : '';
    const operation = typeof parsed.operation === 'string' ? parsed.operation : '';
    const preparedAt = typeof parsed.preparedAt === 'string' ? parsed.preparedAt : '';
    if (!canonicalTargetId || !operation || !preparedAt) return null;
    return {
      normalizedTextSha256: typeof parsed.normalizedTextSha256 === 'string' ? parsed.normalizedTextSha256 : null,
      canonicalTargetId,
      conversationId: typeof parsed.conversationId === 'string' ? parsed.conversationId : undefined,
      parentContentId: typeof parsed.parentContentId === 'string' ? parsed.parentContentId : undefined,
      actorId: typeof parsed.actorId === 'string' ? parsed.actorId : undefined,
      operation,
      preparedAt,
    };
  } catch {
    return null;
  }
}

export async function providerTextMatchesFingerprint(fingerprint: ExecutionFingerprint | null, text: string | undefined) {
  if (!fingerprint?.normalizedTextSha256) return false;
  if (typeof text !== 'string') return false;
  const hashed = await hashNormalizedText(text);
  return hashed === fingerprint.normalizedTextSha256;
}

export function exactReconcileDecision(matchCount: number): 'success' | 'unknown' {
  return matchCount === 1 ? 'success' : 'unknown';
}

export function fingerprintRequiresTextHash(operation: string) {
  return operation === 'instagram_comment_reply'
    || operation === 'instagram_dm_write'
    || operation === 'x_reply_write'
    || operation === 'x_dm_write';
}

export function fingerprintRequiresConversation(operation: string) {
  return operation === 'instagram_dm_write' || operation === 'x_dm_write';
}

export function assertDurableFingerprint(fingerprint: ExecutionFingerprint) {
  if (!fingerprint.canonicalTargetId) {
    throw new Error('Execution fingerprint is missing canonicalTargetId');
  }
  if (!fingerprint.actorId) {
    throw new Error('Execution fingerprint is missing actorId');
  }
  if (!fingerprint.operation) {
    throw new Error('Execution fingerprint is missing operation');
  }
  if (!fingerprint.preparedAt) {
    throw new Error('Execution fingerprint is missing preparedAt');
  }
  if (fingerprintRequiresTextHash(fingerprint.operation) && !fingerprint.normalizedTextSha256) {
    throw new Error('Execution fingerprint is missing normalizedTextSha256');
  }
  if (fingerprintRequiresConversation(fingerprint.operation) && !fingerprint.conversationId) {
    throw new Error('Execution fingerprint is missing conversationId');
  }
}

export async function persistExecutionFingerprintOrThrow(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
  fingerprint: ExecutionFingerprint,
) {
  assertDurableFingerprint(fingerprint);
  const payload = JSON.stringify(fingerprint);
  let result: { meta?: { changes?: number } };
  try {
    result = await db.prepare(
      `UPDATE social_executions
       SET fingerprint_json = ?
       WHERE user_id = ?
         AND idempotency_key = ?
         AND status = 'pending'`,
    ).bind(payload, userId, idempotencyKey).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'D1 fingerprint write failed';
    throw new Error(`Execution fingerprint could not be persisted: ${message}`);
  }
  if ((result.meta?.changes || 0) !== 1) {
    throw new Error('Execution fingerprint could not be persisted');
  }
  let stored: { fingerprint_json?: string | null } | null;
  try {
    stored = await db.prepare(
      `SELECT fingerprint_json
       FROM social_executions
       WHERE user_id = ? AND idempotency_key = ?`,
    ).bind(userId, idempotencyKey).first<{ fingerprint_json?: string | null }>();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'D1 fingerprint read failed';
    throw new Error(`Execution fingerprint verification failed: ${message}`);
  }
  if (!stored || stored.fingerprint_json !== payload) {
    throw new Error('Execution fingerprint verification failed');
  }
}
