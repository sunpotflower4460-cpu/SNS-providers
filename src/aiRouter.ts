import type { BudgetState } from './types';

export type AiTask = 'filter' | 'rank' | 'message' | 'self_analysis' | 'strategy';
export type AiProvider = 'local' | 'groq-free' | 'gemini-free' | 'deepseek-flash';

export interface ProviderAvailability {
  local: boolean;
  groqFree: boolean;
  geminiFree: boolean;
  deepseek: boolean;
}

export interface RouteDecision {
  provider: AiProvider;
  reason: string;
  paid: boolean;
}

export function remainingBudget(budget: BudgetState) {
  return Math.max(0, budget.monthlyLimitUsd - budget.usedUsd);
}

export function chooseAiProvider(task: AiTask, budget: BudgetState, available: ProviderAvailability): RouteDecision {
  if ((task === 'filter' || task === 'rank') && available.local) {
    return { provider: 'local', reason: '軽量な除外・類似度判定は端末内処理を優先します。', paid: false };
  }

  if (available.groqFree) {
    return { provider: 'groq-free', reason: '無料枠を最優先し、高性能モデルを有料化せず利用します。', paid: false };
  }

  if (available.geminiFree && task !== 'message') {
    return { provider: 'gemini-free', reason: '公開情報ベースの処理を無料Tierへフォールバックします。', paid: false };
  }

  if (available.deepseek && remainingBudget(budget) > 0) {
    return { provider: 'deepseek-flash', reason: '無料枠枯渇時のみ低価格モデルを利用します。', paid: true };
  }

  return { provider: 'local', reason: 'HARD LIMITを守るため有料リクエストを停止します。', paid: false };
}

export function canSpend(budget: BudgetState, estimatedUsd: number) {
  if (!budget.hardLimit) return true;
  return budget.usedUsd + estimatedUsd <= budget.monthlyLimitUsd;
}
