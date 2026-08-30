import type { CanonicalSocialAction, CanonicalSocialEvent, SocialActionStatus } from './types';

export async function loadCanonicalAction(db: D1Database, userId: string, actionId: string) {
  try {
    const row = await db.prepare(
      `SELECT id, user_id, platform, candidate_id, action_type, status, execution_mode, source,
              external_event_id, conversation_id, parent_content_id, target_url, observed_at,
              created_at, updated_at, completed_at, platform_user_id, username, identity_conflict, retryable
       FROM social_actions WHERE user_id = ? AND id = ?`
    ).bind(userId, actionId).first<Record<string, string | number | null>>();
    return row ? mapAction(row) : null;
  } catch {
    return null;
  }
}

export async function loadCanonicalEvent(
  db: D1Database,
  userId: string,
  platform: string,
  eventType: string,
  externalEventId: string,
) {
  try {
    const row = await db.prepare(
      `SELECT id, user_id, platform, event_type, external_event_id, external_user_id, payload_json, occurred_at, received_at
       FROM social_events WHERE user_id = ? AND platform = ? AND event_type = ? AND external_event_id = ?`
    ).bind(userId, platform, eventType, externalEventId).first<Record<string, string | null>>();
    return row ? mapEvent(row) : null;
  } catch {
    return null;
  }
}

export async function upsertSocialEvent(db: D1Database, event: CanonicalSocialEvent) {
  await db.prepare(
    `INSERT INTO social_events
      (id, user_id, platform, event_type, external_event_id, external_user_id, payload_json, occurred_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, platform, event_type, external_event_id) DO UPDATE SET
       external_user_id = excluded.external_user_id,
       payload_json = excluded.payload_json,
       occurred_at = excluded.occurred_at,
       received_at = excluded.received_at`
  ).bind(
    event.id,
    event.userId,
    event.platform,
    event.type,
    event.externalEventId,
    event.externalUserId || null,
    JSON.stringify(event.payload || {}),
    event.occurredAt,
    event.receivedAt,
  ).run();
}

export async function upsertProviderSocialAction(db: D1Database, action: CanonicalSocialAction) {
  await db.prepare(
    `INSERT INTO social_actions
      (id, user_id, platform, candidate_id, action_type, status, execution_mode, source,
       external_event_id, conversation_id, parent_content_id, target_url, observed_at,
       created_at, updated_at, completed_at, platform_user_id, username, identity_conflict, retryable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       candidate_id = excluded.candidate_id,
       parent_content_id = excluded.parent_content_id,
       target_url = excluded.target_url,
       conversation_id = excluded.conversation_id,
       observed_at = excluded.observed_at,
       platform_user_id = excluded.platform_user_id,
       username = excluded.username,
       identity_conflict = excluded.identity_conflict,
       updated_at = excluded.updated_at
     WHERE social_actions.status NOT IN ('completed', 'executing', 'dismissed', 'expired')`
  ).bind(
    action.id,
    action.userId,
    action.platform,
    action.candidateId,
    action.type,
    action.status,
    action.executionMode,
    action.source,
    action.externalEventId || null,
    action.conversationId || null,
    action.parentContentId || null,
    action.targetUrl || null,
    action.observedAt || null,
    action.createdAt,
    action.updatedAt,
    action.completedAt || null,
    action.platformUserId || null,
    action.username || null,
    action.identityConflict ? 1 : 0,
    action.retryable ? 1 : 0,
  ).run();
}

export async function claimActionForExecution(db: D1Database, userId: string, actionId: string, nowIso: string) {
  try {
    const result = await db.prepare(
      `UPDATE social_actions
       SET status = 'executing', updated_at = ?
       WHERE id = ? AND user_id = ?
         AND status IN ('pending', 'ready', 'failed')
         AND (status <> 'failed' OR retryable = 1)`
    ).bind(nowIso, actionId, userId).run();
    return (result.meta.changes || 0) === 1;
  } catch {
    return false;
  }
}

export async function finalizeActionStatus(
  db: D1Database,
  userId: string,
  actionId: string,
  status: Extract<SocialActionStatus, 'completed' | 'failed' | 'executing'>,
  options: { retryable?: boolean; completedAt?: string; nowIso: string },
) {
  try {
    if (status === 'completed') {
      await db.prepare(
        'UPDATE social_actions SET status = ?, completed_at = ?, updated_at = ?, retryable = 0 WHERE user_id = ? AND id = ?'
      ).bind(status, options.completedAt || options.nowIso, options.nowIso, userId, actionId).run();
      return;
    }
    if (status === 'failed') {
      await db.prepare(
        'UPDATE social_actions SET status = ?, retryable = ?, updated_at = ? WHERE user_id = ? AND id = ?'
      ).bind(status, options.retryable === false ? 0 : 1, options.nowIso, userId, actionId).run();
      return;
    }
    await db.prepare(
      'UPDATE social_actions SET status = ?, updated_at = ? WHERE user_id = ? AND id = ?'
    ).bind(status, options.nowIso, userId, actionId).run();
  } catch {
    // Recovery still returns the execution record.
  }
}

function mapAction(row: Record<string, string | number | null>): CanonicalSocialAction {
  const platform = row.platform === 'x' || row.platform === 'instagram' ? row.platform : 'instagram';
  return {
    id: String(row.id),
    userId: String(row.user_id),
    platform,
    candidateId: String(row.candidate_id),
    type: row.action_type as CanonicalSocialAction['type'],
    status: row.status as CanonicalSocialAction['status'],
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
    platformUserId: row.platform_user_id ? String(row.platform_user_id) : undefined,
    username: row.username ? String(row.username) : undefined,
    identityConflict: Number(row.identity_conflict) === 1,
    retryable: Number(row.retryable) !== 0,
  };
}

function mapEvent(row: Record<string, string | null>): CanonicalSocialEvent {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payload_json || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const platform = row.platform === 'x' || row.platform === 'instagram' ? row.platform : 'instagram';
  return {
    id: String(row.id),
    userId: String(row.user_id),
    platform,
    type: String(row.event_type),
    externalEventId: String(row.external_event_id),
    externalUserId: row.external_user_id || undefined,
    payload,
    occurredAt: String(row.occurred_at),
    receivedAt: String(row.received_at),
  };
}
