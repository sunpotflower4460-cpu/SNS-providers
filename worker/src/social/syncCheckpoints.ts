export type SyncCheckpointSource =
  | 'x_mentions'
  | 'x_dm'
  | 'instagram_comments_poll'
  | 'instagram_dm';

export interface SyncCheckpoint {
  userId: string;
  source: SyncCheckpointSource;
  newestSeenId: string | null;
  continuationCursor: string | null;
  extra: Record<string, unknown>;
  committedAt: string | null;
  updatedAt: string;
}

export async function loadSyncCheckpoint(
  db: D1Database,
  userId: string,
  source: SyncCheckpointSource,
): Promise<SyncCheckpoint | null> {
  try {
    const row = await db.prepare(
      `SELECT user_id, source, newest_seen_id, continuation_cursor, extra_json, committed_at, updated_at
       FROM social_sync_checkpoints WHERE user_id = ? AND source = ?`,
    ).bind(userId, source).first<Record<string, string | null>>();
    return row ? mapCheckpoint(row) : null;
  } catch {
    return null;
  }
}

export async function saveSyncContinuation(
  db: D1Database,
  userId: string,
  source: SyncCheckpointSource,
  continuationCursor: string | null,
  extra: Record<string, unknown> = {},
) {
  const updatedAt = new Date().toISOString();
  const existing = await loadSyncCheckpoint(db, userId, source);
  await upsertCheckpoint(db, {
    userId,
    source,
    newestSeenId: existing?.newestSeenId || null,
    continuationCursor,
    extra: { ...(existing?.extra || {}), ...extra },
    committedAt: existing?.committedAt || null,
    updatedAt,
  });
}

export async function commitSyncCheckpoint(
  db: D1Database,
  userId: string,
  source: SyncCheckpointSource,
  newestSeenId: string | null,
  extra: Record<string, unknown> = {},
) {
  const updatedAt = new Date().toISOString();
  const existing = await loadSyncCheckpoint(db, userId, source);
  await upsertCheckpoint(db, {
    userId,
    source,
    newestSeenId,
    continuationCursor: null,
    extra: { ...(existing?.extra || {}), ...extra, backlogComplete: true },
    committedAt: updatedAt,
    updatedAt,
  });
}

async function upsertCheckpoint(db: D1Database, row: SyncCheckpoint) {
  await db.prepare(
    `INSERT INTO social_sync_checkpoints
      (user_id, source, newest_seen_id, continuation_cursor, extra_json, committed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, source) DO UPDATE SET
       newest_seen_id = excluded.newest_seen_id,
       continuation_cursor = excluded.continuation_cursor,
       extra_json = excluded.extra_json,
       committed_at = excluded.committed_at,
       updated_at = excluded.updated_at`,
  ).bind(
    row.userId,
    row.source,
    row.newestSeenId,
    row.continuationCursor,
    JSON.stringify(row.extra || {}),
    row.committedAt,
    row.updatedAt,
  ).run();
}

function mapCheckpoint(row: Record<string, string | null>): SyncCheckpoint {
  let extra: Record<string, unknown> = {};
  try {
    extra = row.extra_json ? JSON.parse(row.extra_json) as Record<string, unknown> : {};
  } catch {
    extra = {};
  }
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) extra = {};
  return {
    userId: String(row.user_id),
    source: row.source as SyncCheckpointSource,
    newestSeenId: row.newest_seen_id,
    continuationCursor: row.continuation_cursor,
    extra,
    committedAt: row.committed_at,
    updatedAt: String(row.updated_at),
  };
}
