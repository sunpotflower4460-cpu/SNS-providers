export interface SyncLease {
  id: string;
  owner: string;
}

export type SyncLeaseResult =
  | { ok: true; lease: SyncLease }
  | { ok: false; reason: string };

const MAX_LEASE_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Reserve a short cross-device lease using the existing zero-cost ledger table.
 *
 * The lock ID is deterministic per user+operation, while the operation field carries
 * a unique owner token. A stale lease may be atomically taken over, but the old request
 * cannot later delete the new owner's lease because release checks both ID and owner.
 */
export async function reserveSyncLease(
  db: D1Database,
  userId: string,
  operation: 'x_owned_sync' | 'instagram_owned_sync',
  ttlMs: number,
): Promise<SyncLeaseResult> {
  const normalizedTtl = Math.max(60_000, Math.min(15 * 60_000, Math.round(ttlMs)));
  const id = `sync-lease:${userId}:${operation}`;
  const owner = `${operation}:${crypto.randomUUID()}`;
  const now = new Date();
  const cutoff = new Date(now.getTime() - normalizedTtl).toISOString();
  const futureLimit = new Date(now.getTime() + MAX_LEASE_CLOCK_SKEW_MS).toISOString();

  try {
    const result = await db.prepare(
      `INSERT INTO budget_ledger
        (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at)
       VALUES (?, ?, 'internal', ?, 0, 0, 0, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         provider = excluded.provider,
         operation = excluded.operation,
         cost_usd = 0,
         input_units = 0,
         output_units = 0,
         cache_hit = 0,
         occurred_at = excluded.occurred_at
       WHERE budget_ledger.occurred_at < ? OR budget_ledger.occurred_at > ?`
    ).bind(id, userId, owner, now.toISOString(), cutoff, futureLimit).run();

    if (result.meta.changes > 0) return { ok: true, lease: { id, owner } };
    return { ok: false, reason: '別の端末またはタブで同じSNS更新を実行中です。完了後にもう一度お試しください。' };
  } catch {
    return { ok: false, reason: '同期の重複防止ロックを確認できないため、安全のためSNS更新を停止しました。' };
  }
}

export async function releaseSyncLease(db: D1Database, lease: SyncLease) {
  try {
    await db.prepare('DELETE FROM budget_ledger WHERE id = ? AND operation = ?')
      .bind(lease.id, lease.owner)
      .run();
  } catch {
    // The lease expires naturally. Never delete by ID alone because a newer owner may
    // already have taken over an expired lease.
  }
}
