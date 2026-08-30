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

export type SyncCheckpointLoad =
  | { available: true; checkpoint: SyncCheckpoint | null }
  | { available: false; reason: string };

export type SyncCheckpointWrite =
  | { ok: true }
  | { ok: false; reason: string };

export async function loadSyncCheckpoint(
  db: D1Database,
  userId: string,
  source: SyncCheckpointSource,
): Promise<SyncCheckpointLoad> {
  try {
    const row = await db.prepare(
      `SELECT user_id, source, newest_seen_id, continuation_cursor, extra_json, committed_at, updated_at
       FROM social_sync_checkpoints WHERE user_id = ? AND source = ?`,
    ).bind(userId, source).first<Record<string, string | null>>();
    return { available: true, checkpoint: row ? mapCheckpoint(row) : null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync checkpoint query failed';
    return {
      available: false,
      reason: /no such table/i.test(message)
        ? 'social_sync_checkpoints is missing. Run production D1 migrations before provider reads.'
        : `Sync checkpoint query failed: ${message}`,
    };
  }
}

export async function saveSyncContinuation(
  db: D1Database,
  userId: string,
  source: SyncCheckpointSource,
  continuationCursor: string | null,
  extra: Record<string, unknown> = {},
): Promise<SyncCheckpointWrite> {
  const loaded = await loadSyncCheckpoint(db, userId, source);
  if (!loaded.available) return { ok: false, reason: loaded.reason };
  const updatedAt = new Date().toISOString();
  const existing = loaded.checkpoint;
  return upsertCheckpoint(db, {
    userId,
    source,
    newestSeenId: existing?.newestSeenId || null,
    continuationCursor,
    extra: { ...(existing?.extra || {}), ...extra, backlogComplete: false },
    committedAt: existing?.committedAt || null,
    updatedAt,
  }, { expectContinuation: continuationCursor });
}

export async function commitSyncCheckpoint(
  db: D1Database,
  userId: string,
  source: SyncCheckpointSource,
  newestSeenId: string | null,
  extra: Record<string, unknown> = {},
): Promise<SyncCheckpointWrite> {
  const loaded = await loadSyncCheckpoint(db, userId, source);
  if (!loaded.available) return { ok: false, reason: loaded.reason };
  const updatedAt = new Date().toISOString();
  const existing = loaded.checkpoint;
  return upsertCheckpoint(db, {
    userId,
    source,
    newestSeenId,
    continuationCursor: null,
    extra: { ...(existing?.extra || {}), ...extra, backlogComplete: true },
    committedAt: updatedAt,
    updatedAt,
  }, { expectContinuation: null, expectNewestSeenId: newestSeenId });
}

async function upsertCheckpoint(
  db: D1Database,
  row: SyncCheckpoint,
  verify: { expectContinuation: string | null; expectNewestSeenId?: string | null },
): Promise<SyncCheckpointWrite> {
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'checkpoint upsert failed';
    return { ok: false, reason: `Sync checkpoint could not be persisted: ${message}` };
  }
  const loaded = await loadSyncCheckpoint(db, row.userId, row.source);
  if (!loaded.available) return { ok: false, reason: loaded.reason };
  const stored = loaded.checkpoint;
  if (!stored) return { ok: false, reason: 'Sync checkpoint was not readable after persist.' };
  if ((stored.continuationCursor || null) !== (verify.expectContinuation || null)) {
    return { ok: false, reason: 'Sync checkpoint continuation verification failed.' };
  }
  if (verify.expectNewestSeenId !== undefined && (stored.newestSeenId || null) !== (verify.expectNewestSeenId || null)) {
    return { ok: false, reason: 'Sync checkpoint newest-seen verification failed.' };
  }
  return { ok: true };
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
