import { useMemo } from 'react';
import { buildDailyQueue, queueSummary } from './daily';
import type { AppState, Candidate } from './types';
import { useLocalDayKey } from './useLocalDay';
import './daily.css';

interface Props {
  state: AppState;
  onOpenCandidate: (candidate: Candidate) => void;
  onOpenMe: () => void;
  onOpenDiscover: () => void;
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
  follow: 'フォロー候補',
  like: 'いいね',
  reply: '返信',
  dm: 'DM',
  review: '確認',
  unfollow_review: 'フォロー整理',
  self_improve: '自分を改善',
};

export default function DailyQueue({ state, onOpenCandidate, onOpenMe, onOpenDiscover }: Props) {
  const localDay = useLocalDayKey();
  const items = useMemo(() => buildDailyQueue(state), [state, localDay]);
  const summary = useMemo(() => queueSummary(items), [items]);
  const candidateById = useMemo(() => new Map(state.candidates.map((candidate) => [candidate.id, candidate])), [state.candidates]);
  const activeCandidateCount = state.candidates.filter((candidate) => !candidate.skipped).length;

  function openItem(item: (typeof items)[number]) {
    const candidate = item.candidateId ? candidateById.get(item.candidateId) : undefined;
    if (candidate) onOpenCandidate(candidate);
    else onOpenMe();
  }

  if (activeCandidateCount === 0) {
    return <section className="daily-queue empty onboarding-empty">
      <div className="queue-complete-icon">＋</div>
      <span className="section-kicker">最初の一歩</span>
      <h3>まず、つながる候補を見つけましょう</h3>
      <p>Missionを基準に候補を探すと、誰に何をするかがTodayへ自動で並びます。細かい設定は後からで大丈夫です。</p>
      <button className="primary-button empty-action" onClick={onOpenDiscover}>候補を探す</button>
    </section>;
  }

  if (!items.length) {
    return <section className="daily-queue empty">
      <div className="queue-complete-icon">✓</div>
      <span className="section-kicker">今日のおすすめ</span>
      <h3>今日すぐやることはありません</h3>
      <p>今日の分を終えたか、今ある候補にはまだ実行できる具体的な行動がありません。無理に行動を増やす必要はありません。</p>
      <button className="secondary-button empty-action" onClick={onOpenDiscover}>候補を確認する</button>
    </section>;
  }

  const first = items[0];
  const remaining = items.slice(1, 8);

  return <section className="daily-queue">
    <div className="daily-queue-head">
      <div>
        <span className="section-kicker">今日のおすすめ</span>
        <h2>上から順に進めればOK</h2>
      </div>
      <span className="queue-count">残り {items.length}件</span>
    </div>

    <div className="queue-summary" aria-label="今日の行動内訳">
      <span><b>{summary.connect}</b>新しくつながる</span>
      <span><b>{summary.engage}</b>交流する</span>
      <span><b>{summary.cleanup}</b>整理する</span>
      <span><b>{summary.self}</b>自分を改善</span>
    </div>

    <button
      className={first.action === 'unfollow_review' ? 'next-action-card cleanup' : 'next-action-card'}
      onClick={() => openItem(first)}
    >
      <span className="next-action-order">NEXT</span>
      <span className="next-action-icon">{actionIcon[first.action] || '◎'}</span>
      <span className="next-action-copy">
        <small>{actionLabel[first.action] || '確認'}</small>
        <strong>{first.title}</strong>
        <p>{first.reason}</p>
      </span>
      <span className="next-action-cta">開く <b>›</b></span>
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
            <small>{actionLabel[item.action] || '確認'}</small>
            <strong>{item.title}</strong>
          </span>
          <span className="queue-arrow">›</span>
        </button>)}
      </div>
    </div>}
    {items.length > 8 && <p className="queue-more">まず上位8件だけ表示しています。完了すると次の候補が自動で繰り上がります。</p>}
  </section>;
}
