import type { RuntimeBudgetSaveResult, RuntimeBudgetSaveSuccess } from './budgetCeilingSave';

export interface ClientBudgetAfterSave {
  monthlyLimitUsd: number;
  effectiveLimitUsd: number;
  inputUsd: number;
}

export function shouldApplySettingsSave(editVersion: number, saveVersion: number) {
  return editVersion === saveVersion;
}

export function clientBudgetAfterServerSave(result: RuntimeBudgetSaveSuccess): ClientBudgetAfterSave {
  return {
    monthlyLimitUsd: result.monthlyBudgetCeilingUsd,
    effectiveLimitUsd: result.effectiveLimitUsd,
    inputUsd: result.monthlyBudgetCeilingUsd,
  };
}

export function completeSettingsBudgetSave(input: {
  editVersion: number;
  saveVersion: number;
  result: RuntimeBudgetSaveResult;
}): {
  apply: boolean;
  saved: boolean;
  error: string | null;
  monthlyLimitUsd?: number;
  effectiveLimitUsd?: number;
  inputUsd?: number;
  authority?: RuntimeBudgetSaveSuccess;
} {
  if (!shouldApplySettingsSave(input.editVersion, input.saveVersion)) {
    return { apply: false, saved: false, error: null };
  }
  if (!input.result.ok) {
    return { apply: false, saved: false, error: input.result.reason };
  }
  const client = clientBudgetAfterServerSave(input.result);
  return {
    apply: true,
    saved: true,
    error: null,
    ...client,
    authority: input.result,
  };
}
