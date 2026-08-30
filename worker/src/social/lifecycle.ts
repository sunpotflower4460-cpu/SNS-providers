import type { CanonicalSocialAction, SocialActionStatus } from './types';
import { loadCanonicalAction } from './repository';

const MAX_SNOOZE_MS = 7 * 86_400_000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const EXECUTABLE = new Set(['pending', 'ready', 'failed', 'snoozed']);
const TERMINAL = new Set(['completed', 'dismissed', 'expired']);

export interface LifecycleErr {
  ok: false;
  code: 'UNAUTHENTICATED' | 'NOT_FOUND' | 'INVALID_ACTION' | 'COMPLETED' | 'ALREADY_EXECUTED';
  reason: string;
}

export async function snoozeCanonicalAction(
  db: D1Database,
  userId: string,
  actionId: string,
  body: unknown,
) {
  const action = await loadCanonicalAction(db, userId, actionId);
  if (!action) return fail(404, 'NOT_FOUND', 'Unknown social action.');
  if (action.status === 'completed') return fail(409, 'COMPLETED', 'Completed actions cannot be snoozed.');
  if (action.status === 'executing') return fail(409, 'ALREADY_EXECUTED', 'An executing action cannot be snoozed.');
  if (TERMINAL.has(action.status) || !EXECUTABLE.has(action.status)) {
    return fail(400, 'INVALID_ACTION', 'This social action cannot be snoozed.');
  }
  const until = parseSnoozeUntil(body);
  if (!until.ok) return fail(400, 'INVALID_ACTION', until.reason);
  const nowIso = new Date().toISOString();
  try {
    const result = await db.prepare(
      `UPDATE social_actions
       SET status = 'snoozed', snoozed_until = ?, updated_at = ?
       WHERE id = ? AND user_id = ?
         AND status IN ('pending','ready','failed','snoozed')`,
    ).bind(until.iso, nowIso, actionId, userId).run();
    if ((result.meta.changes || 0) !== 1) {
      return fail(409, 'INVALID_ACTION', 'This social action is not in a snoozeable state.');
    }
  } catch {
    return fail(503, 'INVALID_ACTION', 'Canonical snooze could not be persisted.');
  }
  const latest = await loadCanonicalAction(db, userId, actionId);
  return { status: 200, body: { ok: true as const, action: latest } };
}

export async function dismissCanonicalAction(db: D1Database, userId: string, actionId: string) {
  const action = await loadCanonicalAction(db, userId, actionId);
  if (!action) return fail(404, 'NOT_FOUND', 'Unknown social action.');
  if (action.status === 'executing') return fail(409, 'ALREADY_EXECUTED', 'An executing action cannot be dismissed.');
  if (action.status === 'completed') return fail(409, 'COMPLETED', 'Completed actions cannot be dismissed.');
  if (action.status === 'dismissed') {
    return { status: 200, body: { ok: true as const, action, idempotent: true } };
  }
  if (TERMINAL.has(action.status)) {
    return fail(400, 'INVALID_ACTION', 'This social action cannot be dismissed.');
  }
  const nowIso = new Date().toISOString();
  try {
    const result = await db.prepare(
      `UPDATE social_actions
       SET status = 'dismissed', snoozed_until = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?
         AND status IN ('pending','ready','failed','snoozed')`,
    ).bind(nowIso, actionId, userId).run();
    if ((result.meta.changes || 0) !== 1) {
      return fail(409, 'INVALID_ACTION', 'This social action is not in a dismissable state.');
    }
  } catch {
    return fail(503, 'INVALID_ACTION', 'Canonical dismiss could not be persisted.');
  }
  const latest = await loadCanonicalAction(db, userId, actionId);
  return { status: 200, body: { ok: true as const, action: latest } };
}

export async function listCanonicalActions(db: D1Database, userId: string, limit = 200) {
  const capped = Math.max(1, Math.min(200, Math.floor(limit)));
  try {
    const rows = await db.prepare(
      `SELECT id, user_id, platform, candidate_id, action_type, status, execution_mode, source,
              external_event_id, conversation_id, parent_content_id, target_url, observed_at,
              created_at, updated_at, completed_at, platform_user_id, username, identity_conflict,
              retryable, snoozed_until, result_metadata_json
       FROM social_actions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`,
    ).bind(userId, capped).all();
    return { ok: true as const, actions: (rows.results || []).map(mapListRow) };
  } catch {
    return { ok: false as const, actions: [] as CanonicalSocialAction[], reason: 'Canonical actions could not be read.' };
  }
}

function parseSnoozeUntil(body: unknown): { ok: true; iso: string } | { ok: false; reason: string } {
  const now = Date.now();
  const fallback = new Date(now + 86_400_000).toISOString();
  if (body == null || (typeof body === 'object' && body && !('until' in body) && !('durationHours' in body))) {
    return { ok: true, iso: fallback };
  }
  if (!isRecord(body)) return { ok: false, reason: 'Snooze body must be a JSON object.' };
  if (Object.prototype.hasOwnProperty.call(body, 'platform') || Object.prototype.hasOwnProperty.call(body, 'target')) {
    return { ok: false, reason: 'Snooze must not include platform or target fields.' };
  }
  if (typeof body.until === 'string') {
    const time = new Date(body.until).getTime();
    if (!Number.isFinite(time)) return { ok: false, reason: 'snoozedUntil must be a valid ISO timestamp.' };
    if (time > now + MAX_SNOOZE_MS) return { ok: false, reason: 'Snooze duration is above the 7-day bound.' };
    if (time > now + CLOCK_SKEW_MS && time - now < 60_000) {
      // tiny future values are OK; far-future already rejected above
    }
    if (time > now + MAX_SNOOZE_MS || time < now - CLOCK_SKEW_MS) {
      if (time < now - CLOCK_SKEW_MS) return { ok: false, reason: 'Snooze timestamp is in the past.' };
    }
    if (time > now + MAX_SNOOZE_MS) return { ok: false, reason: 'Future-poisoned snooze timestamp was rejected.' };
    if (time - now > MAX_SNOOZE_MS) return { ok: false, reason: 'Snooze duration is above the 7-day bound.' };
    return { ok: true, iso: new Date(time).toISOString() };
  }
  if (body.durationHours != null) {
    const hours = Number(body.durationHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 7) {
      return { ok: false, reason: 'Snooze durationHours must be between 1 and 168.' };
    }
    return { ok: true, iso: new Date(now + hours * 3_600_000).toISOString() };
  }
  return { ok: true, iso: fallback };
}

function mapListRow(row: Record<string, unknown>): CanonicalSocialAction {
  const platform = row.platform === 'x' || row.platform === 'instagram' ? row.platform : 'instagram';
  let resultMetadata: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(String(row.result_metadata_json || '{}')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) resultMetadata = parsed as Record<string, unknown>;
  } catch {
    resultMetadata = undefined;
  }
  return {
    id: String(row.id),
    userId: String(row.user_id),
    platform,
    candidateId: String(row.candidate_id),
    type: row.action_type as CanonicalSocialAction['type'],
    status: row.status as SocialActionStatus,
    executionMode: row.execution_mode === 'in_app' ? 'in_app' : 'handoff',
    source: String(row.source || ''),
    externalEventId: row.external_event_id ? String(row.external_event_id) : undefined,
    conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
    parentContentId: row.parent_content_id ? String(row.parent_content_id) : undefined,
    targetUrl: row.target_url ? String(row.target_url) : undefined,
    observedAt: row.observed_at ? String(row.observed_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : undefined,
    platformUserId: row.platform_user_id ? String(row.platform_user_id) : undefined,
    username: row.username ? String(row.username) : undefined,
    identityConflict: Number(row.identity_conflict) === 1,
    retryable: Number(row.retryable) !== 0,
    resultMetadata,
  };
}

function fail(status: number, code: LifecycleErr['code'], reason: string) {
  return { status, body: { ok: false as const, code, reason } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
