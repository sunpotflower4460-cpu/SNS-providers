import type { AppState, RelationshipPolicy } from './types';
import './workload.css';

interface Props {
  state: AppState;
  onChange: (state: AppState) => void;
}

interface WorkloadValues {
  total: number;
  connect: number;
  conversation: number;
  light: number;
  cleanup: number;
  self: number;
}

export default function WorkloadControls({ state, onChange }: Props) {
  const values = valuesFromPolicy(state.relationshipPolicy);
  const suggestion = suggestWorkload(state);
  const remainingBudget = Math.max(0, state.budget.monthlyLimitUsd - state.budget.usedUsd);
  const highMatch = state.candidates.filter((candidate) => !candidate.skipped && candidate.match >= 75).length;
  const supply = actionableSupply(state);
  const relationshipTarget = Math.max(0, values.total - values.self);
  const shortage = Math.max(0, relationshipTarget - supply.actionable);

  function apply(next: WorkloadValues) {
    const relationshipPolicy: RelationshipPolicy = {
      ...state.relationshipPolicy,
      dailyQueueLimit: clamp(next.total, 1, 150),
      dailyConnectionLimit: clamp(next.connect, 0, 120),
      dailyConversationLimit: clamp(next.conversation, 0, 30),
      dailyLightEngagementLimit: clamp(next.light, 0, 30),
      dailyCleanupLimit: clamp(next.cleanup, 0, 30),
      dailySelfImproveLimit: clamp(next.self, 0, 5),
    };
    onChange({ ...state, relationshipPolicy });
  }

  return <section className="form-card workload-card">
    <div className="field-title">
      <div><strong>1日の交流ワークロード</strong><span>候補の質を保ちながら、自分が処理する量を決める</span></div>
      <b>{values.total}</b>
    </div>

    <div className="workload-advisor">
      <div><span>AI目安</span><strong>{suggestion.total} actions</strong></div>
      <p>Mission Match 75+ が {highMatch}人 · 実行先まで決まっている候補 {supply.actionable}件 · 月予算残り ${remainingBudget.toFixed(2)}。reviewだけの候補は実行可能数に含めていません。</p>
      {shortage > 0 && <p><strong>候補供給が{shortage}件不足しています。</strong> DiscoverのMission探索とAI再評価で、具体的なfollow/like/reply/DM候補を補充する必要があります。</p>}
      {supply.reviewOnly > 0 && <p>{supply.reviewOnly}件はまだ「確認」止まりです。具体的な投稿接点や関係情報が取れるまで、実行候補として水増ししません。</p>}
      <button className="secondary-button" onClick={() => apply(suggestion)}>おすすめ値を適用</button>
    </div>

    <WorkloadSlider label="総キュー" value={values.total} min={1} max={150} hint="今日Todayに並べる最大件数" onChange={(total) => apply({ ...values, total })} />
    <WorkloadSlider label="新しくつながる" value={values.connect} min={0} max={120} hint="フォロー候補の作業量" onChange={(connect) => apply({ ...values, connect })} />
    <WorkloadSlider label="会話" value={values.conversation} min={0} max={30} hint="返信・DM候補" onChange={(conversation) => apply({ ...values, conversation })} />
    <WorkloadSlider label="軽い交流" value={values.light} min={0} max={30} hint="投稿確認・いいね候補" onChange={(light) => apply({ ...values, light })} />
    <WorkloadSlider label="フォロー整理" value={values.cleanup} min={0} max={30} hint="継続・解除を確認する候補" onChange={(cleanup) => apply({ ...values, cleanup })} />
    <WorkloadSlider label="自分改善" value={values.self} min={0} max={5} hint="プロフィール・投稿改善" onChange={(self) => apply({ ...values, self })} />

    <small className="workload-warning">この件数はX/Instagramの「安全上限」ではありません。SNS側の制限回避ではなく、本人が公式アプリで行う交流作業の量と質を管理するための設定です。変更はこの端末へすぐ保存されます。</small>
  </section>;
}

function WorkloadSlider({ label, value, min, max, hint, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  hint: string;
  onChange: (value: number) => void;
}) {
  return <div className="workload-slider">
    <div><span><strong>{label}</strong><small>{hint}</small></span><b>{value}</b></div>
    <input className="range" type="range" min={min} max={max} step="1" value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </div>;
}

function valuesFromPolicy(policy: RelationshipPolicy): WorkloadValues {
  return {
    total: clamp(policy.dailyQueueLimit ?? 30, 1, 150),
    connect: clamp(policy.dailyConnectionLimit ?? 20, 0, 120),
    conversation: clamp(policy.dailyConversationLimit ?? 8, 0, 30),
    light: clamp(policy.dailyLightEngagementLimit ?? 8, 0, 30),
    cleanup: clamp(policy.dailyCleanupLimit ?? 5, 0, 30),
    self: clamp(policy.dailySelfImproveLimit ?? 2, 0, 5),
  };
}

function actionableSupply(state: AppState) {
  const highMatch = state.candidates.filter((candidate) => !candidate.skipped && candidate.match >= 75);
  let actionable = 0;
  let reviewOnly = 0;
  for (const candidate of highMatch) {
    if (candidate.recommendedAction === 'follow'
      || candidate.recommendedAction === 'dm'
      || candidate.recommendedAction === 'unfollow_review'
      || ((candidate.recommendedAction === 'like' || candidate.recommendedAction === 'reply') && Boolean(candidate.engagementUrl))) {
      actionable += 1;
    } else {
      reviewOnly += 1;
    }
  }
  return { actionable, reviewOnly };
}

function suggestWorkload(state: AppState): WorkloadValues {
  const candidates = state.candidates.filter((candidate) => !candidate.skipped);
  const highMatch = candidates.filter((candidate) => candidate.match >= 75);
  const strongFollow = highMatch.filter((candidate) => candidate.recommendedAction === 'follow').length;
  const conversations = highMatch.filter((candidate) => candidate.recommendedAction === 'dm'
    || (candidate.recommendedAction === 'reply' && Boolean(candidate.engagementUrl))).length;
  const light = highMatch.filter((candidate) => candidate.recommendedAction === 'like' && Boolean(candidate.engagementUrl)).length;
  const cleanup = candidates.filter((candidate) => candidate.recommendedAction === 'unfollow_review').length;

  const limit = state.budget.monthlyLimitUsd;
  const usedRatio = limit > 0 ? Math.min(1, state.budget.usedUsd / limit) : 0;
  const budgetFactor = limit === 0 ? 0.82 : usedRatio >= 0.9 ? 0.72 : usedRatio >= 0.7 ? 0.86 : 1;
  const self = state.insights.length > 0 ? Math.min(2, state.insights.length) : 0;
  const availableActions = strongFollow + conversations + light + cleanup + self;
  const qualityBase = 18 + Math.min(52, Math.round(highMatch.length * 0.7));
  const desiredTotal = Math.round(qualityBase * budgetFactor);
  const total = Math.max(1, Math.min(70, availableActions || 1, desiredTotal));

  const conversation = Math.min(conversations, 15, total);
  const cleanupLimit = Math.min(cleanup, 6, Math.max(0, total - conversation));
  const lightLimit = Math.min(light, 15, Math.max(0, total - conversation - cleanupLimit));
  const selfLimit = Math.min(self, Math.max(0, total - conversation - cleanupLimit - lightLimit));
  const connect = Math.min(strongFollow, 60, Math.max(0, total - conversation - cleanupLimit - lightLimit - selfLimit));

  return {
    total,
    connect,
    conversation,
    light: lightLimit,
    cleanup: cleanupLimit,
    self: selfLimit,
  };
}

function clamp(value: number, min: number, max: number) {
  const normalized = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, normalized));
}
