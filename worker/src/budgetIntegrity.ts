export interface ActiveMonthUsage {
  usedUsd: number;
  available: boolean;
}

interface UsageRow {
  used: number | string | null;
  invalid_count: number | string | null;
}

export async function readActiveMonthUsage(db: D1Database, userId: string): Promise<ActiveMonthUsage> {
  try {
    const { start, end } = utcMonthWindow();
    const row = await db.prepare(
      `SELECT
         COALESCE(SUM(cost_usd), 0) AS used,
         COALESCE(SUM(CASE
           WHEN typeof(cost_usd) NOT IN ('integer','real') OR cost_usd < 0 THEN 1
           ELSE 0
         END), 0) AS invalid_count
       FROM budget_ledger
       WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ?`
    ).bind(userId, start, end).first<UsageRow>();

    const usedUsd = Number(row?.used ?? 0);
    const invalidCount = Number(row?.invalid_count ?? 0);
    if (!Number.isFinite(usedUsd)
      || usedUsd < 0
      || !Number.isSafeInteger(invalidCount)
      || invalidCount !== 0) {
      return { usedUsd: 0, available: false };
    }
    return { usedUsd, available: true };
  } catch {
    return { usedUsd: 0, available: false };
  }
}

export async function reserveActiveMonthBudget(
  db: D1Database,
  args: {
    id: string;
    userId: string;
    provider: string;
    operation: string;
    amountUsd: number;
    effectiveLimit: number;
    occurredAt: string;
  },
) {
  const { id, userId, provider, operation, amountUsd, effectiveLimit, occurredAt } = args;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(effectiveLimit) || effectiveLimit < 0) return false;
  const { start, end } = utcMonthWindow();
  try {
    // This is intentionally one statement. A separate preflight SUM would race another
    // reservation. The CTE also rejects legacy D1 rows that predate schema CHECKs and
    // contain negative/text/null cost values; one corrupt active-month row disables paid
    // work instead of making the HARD LIMIT appear to have more room.
    const result = await db.prepare(
      `WITH current_usage AS (
         SELECT
           COALESCE(SUM(cost_usd), 0) AS used,
           COALESCE(SUM(CASE
             WHEN typeof(cost_usd) NOT IN ('integer','real') OR cost_usd < 0 THEN 1
             ELSE 0
           END), 0) AS invalid_count
         FROM budget_ledger
         WHERE user_id = ? AND occurred_at >= ? AND occurred_at < ?
       )
       INSERT INTO budget_ledger
         (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at)
       SELECT ?, ?, ?, ?, ?, 0, 0, 0, ?
       FROM current_usage
       WHERE invalid_count = 0
         AND typeof(used) IN ('integer','real')
         AND used >= 0
         AND used + ? <= ?`
    ).bind(
      userId,
      start,
      end,
      id,
      userId,
      provider,
      operation,
      amountUsd,
      occurredAt,
      amountUsd,
      effectiveLimit,
    ).run();
    return result.meta.changes === 1;
  } catch {
    return false;
  }
}

export function utcMonthWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}
