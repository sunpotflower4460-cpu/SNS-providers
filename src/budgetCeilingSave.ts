export const BUDGET_SAVE_FAILED_MESSAGE = '予算上限をサーバーへ保存できませんでした';

export interface RuntimeBudgetSaveSuccess {
  ok: true;
  monthlyBudgetCeilingUsd: number;
  serverHardLimitUsd: number;
  effectiveLimitUsd: number;
}

export interface RuntimeBudgetSaveFailure {
  ok: false;
  reason: string;
}

export type RuntimeBudgetSaveResult = RuntimeBudgetSaveSuccess | RuntimeBudgetSaveFailure;

export function parseRuntimeBudgetResponse(body: unknown): RuntimeBudgetSaveResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: BUDGET_SAVE_FAILED_MESSAGE };
  }
  const record = body as Record<string, unknown>;
  const monthly = Number(record.monthlyBudgetCeilingUsd);
  const hard = Number(record.serverHardLimitUsd);
  const effective = Number(record.effectiveLimitUsd);
  if (!Number.isFinite(monthly) || monthly < 0) return { ok: false, reason: BUDGET_SAVE_FAILED_MESSAGE };
  if (!Number.isFinite(hard) || hard < 0) return { ok: false, reason: BUDGET_SAVE_FAILED_MESSAGE };
  if (!Number.isFinite(effective) || effective < 0) return { ok: false, reason: BUDGET_SAVE_FAILED_MESSAGE };
  if (effective > hard + 1e-9) return { ok: false, reason: BUDGET_SAVE_FAILED_MESSAGE };
  if (effective > monthly + 1e-9) return { ok: false, reason: BUDGET_SAVE_FAILED_MESSAGE };
  return {
    ok: true,
    monthlyBudgetCeilingUsd: monthly,
    serverHardLimitUsd: hard,
    effectiveLimitUsd: effective,
  };
}

export async function persistServerBudgetCeiling(input: {
  requestedUsd: number;
  putRuntimeSettings: (monthlyBudgetCeilingUsd: number) => Promise<unknown>;
}): Promise<RuntimeBudgetSaveResult> {
  const requested = Number(input.requestedUsd);
  if (!Number.isFinite(requested) || requested < 0) {
    return { ok: false, reason: BUDGET_SAVE_FAILED_MESSAGE };
  }
  try {
    const body = await input.putRuntimeSettings(requested);
    return parseRuntimeBudgetResponse(body);
  } catch {
    return { ok: false, reason: BUDGET_SAVE_FAILED_MESSAGE };
  }
}
