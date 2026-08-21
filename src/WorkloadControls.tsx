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
      <p>Mission Match 75+ が {highMatch}人 · 月予算残り ${remainingBudget.toFixed(2)}。候補数と予算余力から作業量を提案しています。</p>
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

function suggestWorkload(state: AppState): WorkloadValues {
  const candidates = state.candidates.filter((candidate) => !candidate.skipped);
  const highMatch = candidates.filter((candidate) => candidate.match >= 75);
  const strongFollow = highMatch.filter((candidate) => candidate.recommendedAction === 'follow').length;
  const conversations = highMatch.filter((candidate) => candidate.recommendedAction === 'reply' || candidate.recommendedAction === 'dm').length;
  const light = highMatch.filter((candidate) => candidate.recommendedAction === 'like' || candidate.recommendedAction === 'review').length;
  const cleanup = candidates.filter((candidate) => candidate.recommendedAction === 'unfollow_review').length;

  const limit = state.budget.monthlyLimitUsd;
  const usedRatio = limit > 0 ? Math.min(1, state.budget.usedUsd / limit) : 0;
  const budgetFactor = limit === 0 ? 0.82 : usedRatio >= 0.9 ? 0.72 : usedRatio >= 0.7 ? 0.86 : 1;
  const qualityBase = 18 + Math.min(52, Math.round(highMatch.length * 0.7));
  const total = clamp(Math.round(qualityBase * budgetFactor), 15, 70);

  const self = state.insights.length > 0 ? Math.min(2, state.insights.length) : 1;
  const conversation = clamp(Math.max(3, conversations), 0, Math.min(15, total));
  const cleanupLimit = clamp(Math.min(cleanup, 6), 0, 6);
  const lightLimit = clamp(Math.max(3, Math.min(light, Math.round(total * 0.2))), 0, 15);
  const reserved = conversation + cleanupLimit + lightLimit + self;
  const connect = clamp(Math.max(5, Math.min(strongFollow || highMatch.length, total - Math.min(total - 1, reserved))), 0, 60);

  return {
    total,
    connect,
    conversation,
    light: lightLimit,
    cleanup: cleanupLimit,
    self,
  };
}

function clamp(value: number, min: number, max: number) {
  const normalized = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, normalized));
}
