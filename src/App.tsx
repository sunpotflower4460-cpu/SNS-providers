import { useEffect, useMemo, useState } from 'react';
import { loadState, recordInteraction, saveState, updateMission } from './store';
import { copyDraft, openCandidate, platformLabel } from './social';
import type { AppState, Candidate, Mission } from './types';

type Tab = 'today' | 'discover' | 'relations' | 'me' | 'settings';

const tabs: { id: Tab; icon: string; label: string }[] = [
  { id: 'today', icon: '⌂', label: 'Today' },
  { id: 'discover', icon: '✦', label: 'Discover' },
  { id: 'relations', icon: '◎', label: 'Relations' },
  { id: 'me', icon: '◐', label: 'Me' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

const kindLabel: Record<Candidate['kind'], string> = {
  fan: 'ファン候補', artist: 'アーティスト仲間', creator: 'クリエイター', media: 'メディア', venue: '活動機会', other: '候補',
};

function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [tab, setTab] = useState<Tab>('today');
  const [pending, setPending] = useState<Candidate | null>(null);

  useEffect(() => saveState(state), [state]);

  const active = useMemo(
    () => state.candidates.filter((candidate) => !candidate.skipped).sort((a, b) => b.match - a.match),
    [state.candidates],
  );

  const doneToday = useMemo(() => {
    const today = new Date().toDateString();
    return state.interactions.filter((item) => new Date(item.at).toDateString() === today).length;
  }, [state.interactions]);

  function onOpen(candidate: Candidate) {
    setPending(candidate);
    openCandidate(candidate);
  }

  function resolvePending(action: 'followed' | 'skipped' | 'kept') {
    if (!pending) return;
    setState((current) => recordInteraction(current, pending.id, action));
    setPending(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">S</div>
        <div className="topbar-copy">
          <strong>Social Mission</strong>
          <span>AI relationship navigator</span>
        </div>
        <BudgetPill state={state} />
      </header>

      <main className="page">
        {tab === 'today' && <Today state={state} active={active} doneToday={doneToday} onOpen={onOpen} onTab={setTab} />}
        {tab === 'discover' && <Discover candidates={active} onOpen={onOpen} />}
        {tab === 'relations' && <Relations state={state} onOpen={onOpen} />}
        {tab === 'me' && <Me state={state} />}
        {tab === 'settings' && <Settings state={state} onChange={setState} />}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {tabs.map((item) => (
          <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setTab(item.id)}>
            <span>{item.icon}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>

      {pending && <ResultSheet candidate={pending} onResolve={resolvePending} />}
    </div>
  );
}

function BudgetPill({ state }: { state: AppState }) {
  const pct = Math.min(100, Math.round((state.budget.usedUsd / state.budget.monthlyLimitUsd) * 100));
  return <div className="budget-pill"><span>{pct}%</span><strong>${state.budget.usedUsd.toFixed(2)}</strong></div>;
}

function Today({ state, active, doneToday, onOpen, onTab }: {
  state: AppState; active: Candidate[]; doneToday: number; onOpen: (c: Candidate) => void; onTab: (tab: Tab) => void;
}) {
  const first = active[0];
  const follow = active.filter((c) => c.recommendedAction === 'follow').length;
  const reply = active.filter((c) => c.recommendedAction === 'reply').length;
  const review = state.candidates.filter((c) => c.recommendedAction === 'unfollow_review').length;
  const goal = Math.max(20, active.length + state.insights.length);
  const progress = Math.min(100, Math.round((doneToday / goal) * 100));

  return <>
    <section className="mission-card">
      <div className="eyebrow">YOUR MISSION</div>
      <h1>{state.mission.primaryGoal}</h1>
      <p>{state.mission.text}</p>
      <div className="mission-progress"><span style={{ width: `${progress}%` }} /></div>
      <div className="progress-copy"><strong>{doneToday}</strong><span>/ {goal} actions today</span></div>
    </section>

    <section className="section-block">
      <div className="section-title"><div><span className="eyebrow">TODAY</span><h2>今日、目的に近づく</h2></div><button className="text-button" onClick={() => onTab('discover')}>すべて見る</button></div>
      <div className="metric-grid">
        <Metric icon="＋" value={follow} label="新しくつながる" />
        <Metric icon="↗" value={reply} label="会話を始める" />
        <Metric icon="◎" value={state.insights.length} label="自分を改善" />
        <Metric icon="−" value={review} label="フォロー整理" />
      </div>
    </section>

    {first && <section className="section-block">
      <div className="section-title"><div><span className="eyebrow">NEXT BEST ACTION</span><h2>まず、この人から</h2></div></div>
      <CandidateCard candidate={first} onOpen={onOpen} featured />
    </section>}

    <section className="coach-card">
      <div className="coach-icon">✦</div>
      <div><span className="eyebrow">AI COACH</span><h3>{state.insights[0]?.title}</h3><p>{state.insights[0]?.body}</p></div>
      <button onClick={() => onTab('me')}>見る</button>
    </section>
  </>;
}

function Metric({ icon, value, label }: { icon: string; value: number; label: string }) {
  return <div className="metric-card"><span className="metric-icon">{icon}</span><strong>{value}</strong><small>{label}</small></div>;
}

function Discover({ candidates, onOpen }: { candidates: Candidate[]; onOpen: (c: Candidate) => void }) {
  const [filter, setFilter] = useState<'all' | 'x' | 'instagram'>('all');
  const visible = candidates.filter((candidate) => filter === 'all' || candidate.platform === filter);
  return <>
    <PageHeading eyebrow="DISCOVER" title="今日会うべき人" text="数ではなく、Missionへの近さで並べています。" />
    <div className="segmented">
      {(['all', 'x', 'instagram'] as const).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All' : item === 'x' ? 'X' : 'Instagram'}</button>)}
    </div>
    <div className="card-stack">{visible.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} onOpen={onOpen} />)}</div>
  </>;
}

function CandidateCard({ candidate, onOpen, featured = false }: { candidate: Candidate; onOpen: (c: Candidate) => void; featured?: boolean }) {
  const buttonLabel = candidate.recommendedAction === 'reply' ? `${platformLabel(candidate.platform)}で返信` : `${platformLabel(candidate.platform)}で見る`;
  return <article className={featured ? 'candidate-card featured' : 'candidate-card'}>
    <div className="candidate-head">
      <div className={`platform-avatar ${candidate.platform}`}>{candidate.platform === 'x' ? 'X' : '◎'}</div>
      <div className="candidate-identity"><strong>{candidate.displayName}</strong><span>@{candidate.username} · {kindLabel[candidate.kind]}</span></div>
      <div className="match-score"><strong>{candidate.match}</strong><small>MATCH</small></div>
    </div>
    <p className="reason">{candidate.reason}</p>
    <div className="tags">{candidate.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
    {candidate.draft && <div className="draft-box"><span>AI返信案</span><p>{candidate.draft}</p><button onClick={() => copyDraft(candidate.draft!)}>コピー</button></div>}
    <div className="candidate-actions">
      <button className="secondary-button">後で</button>
      <button className="primary-button" onClick={() => onOpen(candidate)}>{buttonLabel}<span>↗</span></button>
    </div>
  </article>;
}

function Relations({ state, onOpen }: { state: AppState; onOpen: (c: Candidate) => void }) {
  const following = state.candidates.filter((candidate) => candidate.stage !== 'discovered');
  return <>
    <PageHeading eyebrow="RELATIONS" title="関係を育てる" text="フォロー数ではなく、関係の深まりを覚えておきます。" />
    <div className="relation-summary">
      <div><strong>{following.length}</strong><span>tracked</span></div>
      <div><strong>{following.filter((c) => c.followBack).length}</strong><span>mutual</span></div>
      <div><strong>{following.filter((c) => c.stage === 'engaged' || c.stage === 'conversation').length}</strong><span>engaged</span></div>
    </div>
    <div className="relation-list">{following.map((candidate) => <button className="relation-row" key={candidate.id} onClick={() => onOpen(candidate)}>
      <div className={`mini-avatar ${candidate.platform}`}>{candidate.platform === 'x' ? 'X' : '◎'}</div>
      <div><strong>{candidate.displayName}</strong><span>@{candidate.username} · {candidate.stage}</span></div>
      <div className="relation-score">{candidate.relationshipScore}<small>REL</small></div>
    </button>)}</div>
  </>;
}

function Me({ state }: { state: AppState }) {
  const score = Math.round(state.insights.reduce((sum, item) => sum + (item.priority === 'high' ? 20 : item.priority === 'medium' ? 25 : 30), 0) / Math.max(1, state.insights.length) + 48);
  return <>
    <PageHeading eyebrow="ME" title="自分自身も成長対象に" text="Missionとの差分をAIが見つけ、外への交流と内側の改善を同じ方向へ揃えます。" />
    <section className="score-card"><div><span>MISSION SCORE</span><strong>{Math.min(100, score)}</strong><small>/100</small></div><p>{state.mission.primaryGoal}</p></section>
    <div className="insight-list">{state.insights.map((insight) => <article className="insight-card" key={insight.id}><div className="insight-top"><span>{insight.category.toUpperCase()}</span><b className={`priority ${insight.priority}`}>{insight.priority}</b></div><h3>{insight.title}</h3><p>{insight.body}</p><button>改善案を見る <span>→</span></button></article>)}</div>
  </>;
}

function Settings({ state, onChange }: { state: AppState; onChange: (state: AppState) => void }) {
  const [mission, setMission] = useState<Mission>(state.mission);
  const [limit, setLimit] = useState(state.budget.monthlyLimitUsd);
  function save() {
    const next = updateMission(state, mission);
    onChange({ ...next, budget: { ...next.budget, monthlyLimitUsd: limit, mode: limit === 0 ? 'free' : limit <= 1 ? 'eco' : limit <= 3 ? 'balanced' : 'growth' } });
  }
  return <>
    <PageHeading eyebrow="SETTINGS" title="AIに目的地を教える" text="ここが推薦・文章・自己分析すべての判断軸になります。" />
    <section className="form-card"><label>Mission<textarea value={mission.text} rows={5} onChange={(e) => setMission({ ...mission, text: e.target.value })} /></label><label>一番大事なゴール<input value={mission.primaryGoal} onChange={(e) => setMission({ ...mission, primaryGoal: e.target.value })} /></label><label>Communication DNA<textarea value={mission.communicationDNA} rows={4} onChange={(e) => setMission({ ...mission, communicationDNA: e.target.value })} /></label></section>
    <section className="form-card budget-settings"><div className="field-title"><div><strong>月間AI/API予算</strong><span>機能を削らず、外部取得量を自動調整</span></div><b>${limit}</b></div><input className="range" type="range" min="0" max="10" step="1" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /><div className="range-labels"><span>$0</span><span>$3 recommended</span><span>$10</span></div><div className="hard-limit"><span><strong>HARD LIMIT</strong><small>設定額を超える有料リクエストを拒否</small></span><i className={state.budget.hardLimit ? 'toggle on' : 'toggle'} /></div></section>
    <button className="save-button" onClick={save}>設定を保存</button>
  </>;
}

function PageHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>;
}

function ResultSheet({ candidate, onResolve }: { candidate: Candidate; onResolve: (action: 'followed' | 'skipped' | 'kept') => void }) {
  return <div className="sheet-backdrop"><section className="result-sheet"><div className="sheet-handle" /><span className="eyebrow">WELCOME BACK</span><h2>@{candidate.username} はどうしました？</h2><p>結果だけ教えてください。次の推薦と関係性スコアに反映します。</p><button className="primary-button full" onClick={() => onResolve('followed')}>フォロー / 交流した</button><button className="secondary-button full" onClick={() => onResolve('kept')}>今回は見るだけ</button><button className="ghost-button full" onClick={() => onResolve('skipped')}>この候補は違う</button></section></div>;
}

export default App;
