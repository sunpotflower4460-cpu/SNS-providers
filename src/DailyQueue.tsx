import { useMemo } from 'react';
import { buildDailyQueue, queueSummary } from './daily';
import type { AppState, Candidate } from './types';
import './daily.css';

interface Props {
  state: AppState;
  onOpenCandidate: (candidate: Candidate) => void;
  onOpenMe: () => void;
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

export default function DailyQueue({ state, onOpenCandidate, onOpenMe }: Props) {
  const items = useMemo(() => buildDailyQueue(state, 20), [state]);
  const summary = useMemo(() => queueSummary(items), [items]);
  const candidateById = useMemo(() => new Map(state.candidates.map((candidate) => [candidate.id, candidate])), [state.candidates]);

  if (!items.length) {
    return <section className="daily-queue empty"><span className="eyebrow">DAILY QUEUE</span><h3>今日のキューは完了です</h3><p>新しい候補を追加するか、明日またMissionに沿って組み直します。</p></section>;
  }

  return <section className="daily-queue">
    <div className="daily-queue-head">
      <div><span className="eyebrow">DAILY QUEUE</span><h2>今日のおすすめ順</h2></div>
      <span className="queue-count">{items.length} actions</span>
    </div>

    <div className="queue-summary">
      <span><b>{summary.connect}</b>つながる</span>
      <span><b>{summary.engage}</b>交流</span>
      <span><b>{summary.cleanup}</b>整理</span>
      <span><b>{summary.self}</b>自分改善</span>
    </div>

    <div className="queue-list">
      {items.slice(0, 8).map((item, index) => {
        const candidate = item.candidateId ? candidateById.get(item.candidateId) : undefined;
        return <button
          key={item.id}
          className={item.action === 'unfollow_review' ? 'queue-row cleanup' : 'queue-row'}
          onClick={() => candidate ? onOpenCandidate(candidate) : onOpenMe()}
        >
          <span className="queue-rank">{index + 1}</span>
          <span className="queue-action-icon">{actionIcon[item.action] || '◎'}</span>
          <span className="queue-copy"><strong>{item.title}</strong><small>{item.reason}</small></span>
          <span className="queue-arrow">›</span>
        </button>;
      })}
    </div>
    {items.length > 8 && <p className="queue-more">上位8件を表示中 · 完了すると次の候補が繰り上がります</p>}
  </section>;
}
