import { useMemo } from 'react';
import { apiConfigured } from './api';
import { getSyncToken } from './controlToken';
import { firstQueueSteps } from './firstQueue';
import { buildDailyQueue } from './daily';
import { platformLabel, staleConversationCue } from './social';
import type { AppState, Candidate } from './types';
import { localDayKey, useLocalDayKey } from './useLocalDay';
import './daily.css';

interface Props {
  state: AppState;
  onOpenCandidate: (candidate: Candidate) => void;
  onOpenMe: () => void;
  onOpenDiscover: () => void;
  onOpenSettings: () => void;
}

const actionIcon: Record<string, string> = {
  follow: '＋',
  like: '♡',
  reply: '↗',
  dm: '✉',
  review: '◎',
  unfollow_review: '−',
  self_improve: '✦',
};

const actionLabel: Record<string, string> = {
  follow: 'フォロー',
  like: 'いいね',
  reply: '返信',
  dm: 'DM',
  review: '確認',
  unfollow_review: 'フォロー整理',
  self_improve: '自分を改善',
};

export default function DailyQueue({ state, onOpenCandidate, onOpenMe, onOpenDiscover, onOpenSettings }: Props) {
  const localDay = useLocalDayKey();
  const items = useMemo(() => buildDailyQueue(state), [state, localDay]);
  const candidateById = useMemo(() => new Map(state.candidates.map((candidate) => [candidate.id, candidate])), [state.candidates]);
  const activeCandidateCount = state.candidates.filter((candidate) => !candidate.skipped).length;
  const completedToday = useMemo(() => {
    const selfCompleted = state.selfProfile.analyzedAt
      ? localDayKey(new Date(state.selfProfile.analyzedAt)) === localDay
      : false;
    return selfCompleted || state.interactions.some((interaction) => {
      const at = new Date(interaction.at);
      return interaction.action !== 'review'
        && Number.isFinite(at.getTime())
        && localDayKey(at) === localDay;
    });
  }, [state.interactions, state.selfProfile.analyzedAt, localDay]);

  function openItem(item: (typeof items)[number]) {
    if (item.kind === 'self') {
      onOpenMe();
      return;
    }
    const candidate = item.candidateId ? candidateById.get(item.candidateId) : undefined;
    if (candidate) onOpenCandidate(candidate);
    else onOpenDiscover();
  }

  if (activeCandidateCount === 0) {
    const steps = firstQueueSteps(state, {
      apiConfigured,
      hasControlToken: Boolean(getSyncToken().trim()),
    });
    return <section className="daily-queue empty onboarding-empty">
      <div className="queue-complete-icon">＋</div>
      <span className="section-kicker">最初の一歩</span>
      <h3>まず、つながる候補を見つけましょう</h3>
      <p>Missionを基準に候補を探すと、誰に何をするかがTodayへ自動で並びます。WorkerやAIがなくても、URL追加と保存済みの関係状態だけで使えます。実在しない人は出しません。</p>
      <ol className="first-queue-steps">
        {steps.map((step) => (
          <li key={step.id} className={step.done ? 'done' : undefined}>
            <span>{step.done ? '済' : step.index}</span>
            <strong>{step.label}</strong>
          </li>
        ))}
      </ol>
      <div className="empty-actions">
        <button className="primary-button empty-action" onClick={onOpenDiscover}>候補を探す / 同期する</button>
        <button className="secondary-button empty-action" onClick={onOpenSettings}>設定と接続を確認</button>
      </div>
    </section>;
  }

  if (!items.length && completedToday) {
    return <section className="daily-queue empty completed-empty">
      <div className="queue-complete-icon">✓</div>
      <span className="section-kicker">今日のおすすめ</span>
      <h3>今日のおすすめは完了です</h3>
      <p>追加で無理に行動する必要はありません。新しい相手を見たいときだけ、候補一覧を確認できます。</p>
      <button className="secondary-button empty-action" onClick={onOpenDiscover}>候補を見る</button>
    </section>;
  }

  if (!items.length) {
    return <section className="daily-queue empty waiting-empty">
      <div className="queue-wait-icon">○</div>
      <span className="section-kicker">今日のおすすめ</span>
      <h3>今は実行できる候補がありません</h3>
      <p>候補はありますが、まだフォロー・いいね・返信に落とせない人が残っています。URL追加や無料探索、キャッシュ済みのフォロワー・IGコメントで足せます。AI再評価は任意です。</p>
      <div className="empty-actions">
        <button className="primary-button empty-action" onClick={onOpenDiscover}>新しい候補を探す</button>
        <button className="secondary-button empty-action" onClick={onOpenSettings}>設定と同期を確認</button>
      </div>
    </section>;
  }

  const first = items[0];
  const firstCandidate = first.candidateId ? candidateById.get(first.candidateId) : undefined;
  const firstCta = nextActionCta(first.action, firstCandidate);
  const remaining = items.slice(1, 8);
  const staleCue = staleConversationCue(first.staleDays ?? null);

  return <section className="daily-queue">
    <div className="daily-queue-head">
      <div>
        <span className="section-kicker">今日のおすすめ</span>
        <h2>まず、この1件から</h2>
      </div>
      <span className="queue-count">残り {items.length}件</span>
    </div>

    <button
      className={first.action === 'unfollow_review' ? 'next-action-card cleanup' : 'next-action-card'}
      onClick={() => openItem(first)}
      aria-label={`${first.title}：${firstCta}`}
    >
      <span className="next-action-order">次にやること</span>
      <span className="next-action-icon">{actionIcon[first.action] || '◎'}</span>
      <span className="next-action-copy">
        <small>{actionLabel[first.action] || '確認'}</small>
        <strong>{first.title}</strong>
        {first.engagementLabel && <em className="queue-surface">{first.engagementLabel}</em>}
        {staleCue && <em className="queue-stale">{staleCue}</em>}
        <p>{first.reason}</p>
      </span>
      <span className="next-action-cta">{firstCta} <b>›</b></span>
    </button>

    {remaining.length > 0 && <div className="queue-list-block">
      <div className="queue-list-label"><span>その次</span><small>1件終えると自動で繰り上がります</small></div>
      <div className="queue-list">
        {remaining.map((item, index) => <button
          key={item.id}
          className={item.action === 'unfollow_review' ? 'queue-row cleanup' : 'queue-row'}
          onClick={() => openItem(item)}
        >
          <span className="queue-rank">{index + 2}</span>
          <span className="queue-action-icon">{actionIcon[item.action] || '◎'}</span>
          <span className="queue-copy">
            <small>{actionLabel[item.action] || '確認'}{item.staleDays != null && item.staleDays > 0 ? ` · この人とは${item.staleDays}日空き` : ''}</small>
            <strong>{item.title}</strong>
          </span>
          <span className="queue-arrow">›</span>
        </button>)}
      </div>
    </div>}
    {items.length > 8 && <p className="queue-more">まず上位8件だけ表示しています。完了すると次の候補が自動で繰り上がります。</p>}
  </section>;
}

function nextActionCta(action: string, candidate?: Candidate) {
  if (action === 'self_improve') return '自分を整える';
  const platform = candidate ? platformLabel(candidate.platform) : 'SNS';
  const hasDraft = Boolean(candidate?.draft?.trim());
  switch (action) {
    case 'follow': return hasDraft ? `コピーして${platform}でフォロー` : `${platform}でフォロー`;
    case 'like': return `${platform}で対象投稿を開く`;
    case 'reply': return hasDraft ? `コピーして${platform}で開く` : `${platform}で返信先を開く`;
    case 'dm': return hasDraft ? `コピーして${platform}で開く` : `${platform}でDM先を開く`;
    case 'unfollow_review': return `${platform}で確認する`;
    default: return `${platform}で確認する`;
  }
}
