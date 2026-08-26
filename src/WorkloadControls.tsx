import type { AppState, AppStateUpdater, RelationshipPolicy } from './types';
import './workload.css';

interface Props {
  state: AppState;
  onChange: AppStateUpdater;
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
  const autoReplenishEnabled = state.relationshipPolicy.autoReplenishEnabled !== false;

  function apply(next: WorkloadValues) {
    onChange((current) => {
      const relationshipPolicy: RelationshipPolicy = {
        ...current.relationshipPolicy,
        dailyQueueLimit: clamp(next.total, 1, 150),
        dailyConnectionLimit: clamp(next.connect, 0, 120),
        dailyConversationLimit: clamp(next.conversation, 0, 30),
        dailyLightEngagementLimit: clamp(next.light, 0, 30),
        dailyCleanupLimit: clamp(next.cleanup, 0, 30),
        dailySelfImproveLimit: clamp(next.self, 0, 5),
      };
      return { ...current, relationshipPolicy };
    });
  }

  function setAutoReplenish(enabled: boolean) {
    onChange((current) => ({
      ...current,
      relationshipPolicy: {
        ...current.relationshipPolicy,
        autoReplenishEnabled: enabled,
      },
    }));
  }

  return <section className="form-card workload-card">
    <div className="field-title">
      <div><strong>1日にやる量</strong><span>まずは合計だけ決めればOKです</span></div>
      <b>{values.total}件</b>
    </div>

    <div className="workload-advisor">
      <div><span>おすすめ</span><strong>{suggestion.total}件 / 日</strong></div>
      <p>今すぐ行動先まで決まっている候補は{supply.actionable}件です。無理なく続けられる量を、今ある候補から自動で提案しています。</p>
      {shortage > 0 && <p><strong>今の設定だと候補が{shortage}件ほど不足しています。</strong> 自動補充がONなら、候補が減ったときだけ無料で新しい候補を探します。</p>}
      <button className="secondary-button" onClick={() => apply(suggestion)}>おすすめ件数にする</button>

      <details className="workload-details">
        <summary>おすすめの判断材料を見る</summary>
        <div>
          <span>目的との相性が高い候補 <b>{highMatch}人</b></span>
          <span>今すぐ実行できる候補 <b>{supply.actionable}件</b></span>
          <span>判断材料を待っている候補 <b>{supply.reviewOnly}件</b></span>
          <span>今月の予算残り <b>${remainingBudget.toFixed(2)}</b></span>
        </div>
      </details>
    </div>

    <label className="auto-replenish-toggle">
      <span><strong>候補が減ったら自動で補う</strong><small>おすすめ。無料で使える探索と評価だけを使い、有料処理は自動実行しません。</small></span>
      <input type="checkbox" checked={autoReplenishEnabled} onChange={(event) => setAutoReplenish(event.target.checked)} />
    </label>

    <WorkloadSlider label="1日の合計" value={values.total} min={1} max={150} hint="Todayに出す行動の最大数" onChange={(total) => apply({ ...values, total })} />

    <details className="workload-breakdown">
      <summary><span><strong>内訳を細かく調整</strong><small>必要なときだけ変更</small></span><b>⌄</b></summary>
      <div className="workload-breakdown-body">
        <WorkloadSlider label="新しくつながる" value={values.connect} min={0} max={120} hint="フォロー候補" onChange={(connect) => apply({ ...values, connect })} />
        <WorkloadSlider label="会話する" value={values.conversation} min={0} max={30} hint="返信・DM" onChange={(conversation) => apply({ ...values, conversation })} />
        <WorkloadSlider label="軽く反応する" value={values.light} min={0} max={30} hint="対象投稿が決まっているいいね" onChange={(light) => apply({ ...values, light })} />
        <WorkloadSlider label="フォローを見直す" value={values.cleanup} min={0} max={30} hint="継続するか確認する相手" onChange={(cleanup) => apply({ ...values, cleanup })} />
        <WorkloadSlider label="自分の発信を整える" value={values.self} min={0} max={5} hint="プロフィール・投稿の改善" onChange={(self) => apply({ ...values, self })} />
        <small className="workload-warning">ここで決めるのはSNSの操作上限ではなく、あなたが1日に確認する量です。実際のフォロー・いいね・返信は公式SNSで行います。</small>
      </div>
    </details>

    {/* Regression markers: 実行先まで決まっている候補 / reviewだけの候補は実行可能数に含めていません / 無料Tavily探索＋無料/ローカル評価 */}
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
  const observedConnect = Math.min(strongFollow, 60, Math.max(0, total - conversation - cleanupLimit - lightLimit - selfLimit));
  // These values are category ceilings, not quotas. Keep enough follow capacity for free
  // automatic replenishment to turn newly discovered candidates into executable Today work;
  // otherwise applying a low-supply suggestion could set every relationship category to 0
  // and permanently prevent the refill loop from creating useful work.
  const connect = Math.min(60, Math.max(observedConnect, Math.min(20, total)));

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
