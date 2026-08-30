export interface RuntimeBudgetEnv {
  DB: D1Database;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
}

export const SERVER_HARD_LIMIT_FALLBACK_USD = 3;

export function serverHardLimitUsd(env: { DEFAULT_MONTHLY_BUDGET_USD?: string }) {
  const parsed = Number(env.DEFAULT_MONTHLY_BUDGET_USD);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return SERVER_HARD_LIMIT_FALLBACK_USD;
}

export async function loadUserBudgetCeilingUsd(db: D1Database, userId: string): Promise<number | null> {
  try {
    const row = await db.prepare(
      'SELECT monthly_budget_ceiling_usd FROM user_runtime_settings WHERE user_id = ?',
    ).bind(userId).first<{ monthly_budget_ceiling_usd: number }>();
    const amount = Number(row?.monthly_budget_ceiling_usd);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return amount;
  } catch {
    return null;
  }
}

export async function saveUserBudgetCeilingUsd(db: D1Database, userId: string, ceilingUsd: number) {
  if (!Number.isFinite(ceilingUsd) || ceilingUsd < 0) {
    throw new Error('monthly_budget_ceiling_usd must be a non-negative number.');
  }
  const updatedAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO user_runtime_settings (user_id, monthly_budget_ceiling_usd, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       monthly_budget_ceiling_usd = excluded.monthly_budget_ceiling_usd,
       updated_at = excluded.updated_at`,
  ).bind(userId, ceilingUsd, updatedAt).run();
  return { userId, monthlyBudgetCeilingUsd: ceilingUsd, updatedAt };
}

export async function resolveEffectiveBudgetLimit(
  env: RuntimeBudgetEnv,
  userId: string,
  requestedLimitUsd?: number,
) {
  const hardLimit = serverHardLimitUsd(env);
  const storedCeiling = await loadUserBudgetCeilingUsd(env.DB, userId);
  const requested = Number(requestedLimitUsd);
  const requestedOrNull = Number.isFinite(requested) && requested >= 0 ? requested : null;
  const userCeiling = storedCeiling == null ? requestedOrNull : storedCeiling;
  const effectiveLimit = Math.min(
    hardLimit,
    userCeiling == null ? hardLimit : userCeiling,
  );
  return {
    hardLimitUsd: hardLimit,
    userCeilingUsd: storedCeiling,
    requestedLimitUsd: requestedOrNull,
    effectiveLimitUsd: effectiveLimit,
  };
}

export async function loadRuntimeSettings(env: RuntimeBudgetEnv, userId: string) {
  const budget = await resolveEffectiveBudgetLimit(env, userId);
  return {
    userId,
    monthlyBudgetCeilingUsd: budget.userCeilingUsd,
    serverHardLimitUsd: budget.hardLimitUsd,
    effectiveLimitUsd: budget.effectiveLimitUsd,
  };
}
