import { useEffect, useMemo, useState } from 'react';
import { analyzeSelfProfile, apiConfigured, discoverSocialCandidates, enrichXProfiles, fetchBudget, rankCandidates } from './api';
import BackupControls from './BackupControls';
import DailyQueue from './DailyQueue';
import { mergeDiscoveredProfiles } from './discoveryStore';
import { addCandidateFromReference, applyRankResults, applySelfAnalysis, applyXProfiles, loadState, recordInteraction, saveState, setFollowBackStatus, syncBudget, updateMission, updateRelationshipPolicy, updateSelfProfileInputs } from './store';
import { copyDraft, openCandidate, platformLabel } from './social';
import type { AppState, Candidate, Mission, Platform } from './types';

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
  const [ranking, setRanking] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [enrichingX, setEnrichingX] = useState(false);
  const [analyzingSelf, setAnalyzingSelf] = useState(false);
  const [apiNote, setApiNote] = useState(apiConfigured ? 'API接続待機' : 'ローカルモード');

  useEffect(() => saveState(state), [state]);

  useEffect(() => {
    if (!apiConfigured) return;
    let cancelled = false;
    fetchBudget()
      .then((budget) => {
        if (cancelled) return;
        setState((current) => syncBudget(current, budget.usedUsd, budget.limitUsd));
        setApiNote(budget.ledgerAvailable === false ? '無料モード · 有料APIは台帳復旧まで停止' : '予算同期済み');
      })
      .catch(() => {
        if (!cancelled) setApiNote('API未接続・ローカル継続');
      });
    return () => { cancelled = true; };
  }, []);

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

  async function discoverCandidates() {
    if (!apiConfigured) {
      setApiNote('Worker URLを設定すると無料Web探索が使えます');
      return;
    }
    setDiscovering(true);
    setApiNote('Missionに合う公開プロフィール候補を無料探索中…');
    try {
      const result = await discoverSocialCandidates(state.mission);
      if (!result.enabled) {
        setApiNote(result.reason || '無料候補探索は現在無効です');
        return;
      }
      let added = 0;
      setState((current) => {
        const next = mergeDiscoveredProfiles(current, result.profiles);
        added = next.candidates.length - current.candidates.length;
        return next;
      });
      setApiNote(`無料探索で${added}件追加 · ${result.credits || 0} credits · $0`);
    } catch (error) {
      setApiNote(error instanceof Error ? `候補探索失敗: ${error.message}` : '候補探索に失敗しました');
    } finally {
      setDiscovering(false);
    }
  }

  async function rerankCandidates() {
    if (!apiConfigured) {
      setApiNote('Worker URLを設定するとAI再評価が使えます');
      return;
    }
    const targets = state.candidates.filter((candidate) => !candidate.skipped).slice(0, 50);
    if (!targets.length) return;
    setRanking(true);
    setApiNote('Missionに照らしてAI評価中…');
    try {
      const result = await rankCandidates(state.mission, targets, state.budget.monthlyLimitUsd);
      setState((current) => applyRankResults(current, result.results, result.costUsd));
      setApiNote(`${result.provider}で${result.results.length}件を評価${result.paid ? ` · $${result.costUsd.toFixed(4)}` : ' · $0'}`);
    } catch (error) {
      setApiNote(error instanceof Error ? `AI評価失敗: ${error.message}` : 'AI評価に失敗しました');
    } finally {
      setRanking(false);
    }
  }

  async function enrichXCandidates() {
    if (!apiConfigured) {
      setApiNote('Worker URLを設定するとX公式情報の補完が使えます');
      return;
    }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const targets = state.candidates.filter((candidate) => {
      if (candidate.platform !== 'x' || candidate.skipped) return false;
      if (!candidate.profileSyncedAt) return true;
      return new Date(candidate.profileSyncedAt).getTime() < cutoff;
    }).slice(0, 100);
    if (!targets.length) {
      setApiNote('X候補は24時間以内に同期済みです');
      return;
    }

    setEnrichingX(true);
    setApiNote(`X公式情報を${targets.length}件まとめて確認中…`);
    try {
      const result = await enrichXProfiles(targets, state.budget.monthlyLimitUsd);
      if (!result.enabled) {
        setApiNote(result.reason || 'Xプロフィール補完は現在無効です');
        return;
      }
      setState((current) => applyXProfiles(current, result.profiles, result.costUsd));
      setApiNote(`X公式情報 ${result.profiles.length}件補完 · $${result.costUsd.toFixed(4)}`);
    } catch (error) {
      setApiNote(error instanceof Error ? `X補完失敗: ${error.message}` : 'Xプロフィール補完に失敗しました');
    } finally {
      setEnrichingX(false);
    }
  }

  async function analyzeMe(profileText: string, recentPostsText: string) {
    setState((current) => updateSelfProfileInputs(current, profileText, recentPostsText));
    if (!profileText.trim() && !recentPostsText.trim()) {
      setApiNote('プロフィールまたは最近の投稿を入力してください');
      return;
    }
    if (!apiConfigured) {
      setApiNote('Worker URLを設定すると自己分析が使えます');
      return;
    }
    setAnalyzingSelf(true);
    setApiNote('自分のアカウントをMissionから逆算して分析中…');
    try {
      const result = await analyzeSelfProfile(state.mission, profileText, recentPostsText, state.budget.monthlyLimitUsd);
      setState((current) => applySelfAnalysis(updateSelfProfileInputs(current, profileText, recentPostsText), result.results[0], result.costUsd));
      setApiNote(`${result.provider}で自己分析完了${result.paid ? ` · $${result.costUsd.toFixed(4)}` : ' · $0'}`);
    } catch (error) {
      setApiNote(error instanceof Error ? `自己分析失敗: ${error.message}` : '自己分析に失敗しました');
    } finally {
      setAnalyzingSelf(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">S</div>
        <div className="topbar-copy">
          <strong>Social Mission</strong>
          <span>{apiNote}</span>
        </div>
        <BudgetPill state={state} />
      </header>

      <main className="page">
        {tab === 'today' && <Today state={state} active={active} doneToday={doneToday} onOpen={onOpen} onTab={setTab} />}
        {tab === 'discover' && <Discover state={state} candidates={active} onOpen={onOpen} onChange={setState} onDiscover={discoverCandidates} onRerank={rerankCandidates} onEnrichX={enrichXCandidates} discovering={discovering} ranking={ranking} enrichingX={enrichingX} apiNote={apiNote} />}
        {tab === 'relations' && <Relations state={state} onOpen={onOpen} onChange={setState} />}
        {tab === 'me' && <Me state={state} onAnalyze={analyzeMe} analyzing={analyzingSelf} />}
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
  const pct = state.budget.monthlyLimitUsd > 0 ? Math.min(100, Math.round((state.budget.usedUsd / state.budget.monthlyLimitUsd) * 100)) : 0;
  return <div className="budget-pill"><span>{state.budget.monthlyLimitUsd === 0 ? 'FREE' : `${pct}%`}</span><strong>${state.budget.usedUsd.toFixed(2)}</strong></div>;
}

function Today({ state, active, doneToday, onOpen, onTab }: {
  state: AppState; active: Candidate[]; doneToday: number; onOpen: (c: Candidate) => void; onTab: (tab: Tab) => void;
}) {
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

    <DailyQueue state={state} onOpenCandidate={onOpen} onOpenMe={() => onTab('me')} />

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

function Discover({ state, candidates, onOpen, onChange, onDiscover, onRerank, onEnrichX, discovering, ranking, enrichingX, apiNote }: {
  state: AppState;
  candidates: Candidate[];
  onOpen: (c: Candidate) => void;
  onChange: (state: AppState) => void;
  onDiscover: () => void;
  onRerank: () => void;
  onEnrichX: () => void;
  discovering: boolean;
  ranking: boolean;
  enrichingX: boolean;
  apiNote: string;
}) {
  const [filter, setFilter] = useState<'all' | 'x' | 'instagram'>('all');
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [reference, setReference] = useState('');
  const visible = candidates.filter((candidate) => filter === 'all' || candidate.platform === filter);

  function addReference(value = reference) {
    if (!value.trim()) return;
    onChange(addCandidateFromReference(state, platform, value));
    setReference('');
  }

  async function addFromClipboard() {
    try {
      const value = await navigator.clipboard.readText();
      if (value) addReference(value);
    } catch {
      setReference((current) => current || '');
    }
  }

  return <>
    <PageHeading eyebrow="DISCOVER" title="今日会うべき人" text="数ではなく、Missionへの近さで並べています。" />

    <section className="import-card">
      <div className="import-head"><div><span className="eyebrow">ADD CANDIDATE</span><strong>AIに探させるか、見つけた人を1タップで追加</strong></div><span className="status-chip">{apiNote}</span></div>
      <button className="discovery-button" disabled={discovering} onClick={onDiscover}><span>✦</span><strong>{discovering ? '無料探索中…' : 'Missionから無料で候補を探す'}</strong><small>Tavily無料モード · X/Instagram公開プロフィール候補</small></button>
      <div className="mini-segmented">
        <button className={platform === 'instagram' ? 'active' : ''} onClick={() => setPlatform('instagram')}>Instagram</button>
        <button className={platform === 'x' ? 'active' : ''} onClick={() => setPlatform('x')}>X</button>
      </div>
      <div className="import-row"><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="プロフィールURL または @username" /><button onClick={() => addReference()}>追加</button></div>
      <div className="import-actions">
        <button className="secondary-button" onClick={addFromClipboard}>クリップボードから追加</button>
        <button className="secondary-button" disabled={enrichingX} onClick={onEnrichX}>{enrichingX ? 'X同期中…' : 'X公式情報を補完'}</button>
        <button className="primary-button" disabled={ranking} onClick={onRerank}>{ranking ? 'AI評価中…' : 'AIで候補を再評価'}</button>
      </div>
    </section>

    <div className="segmented">
      {(['all', 'x', 'instagram'] as const).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All' : item === 'x' ? 'X' : 'Instagram'}</button>)}
    </div>
    <div className="card-stack">{visible.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} onOpen={onOpen} />)}</div>
  </>;
}

function CandidateCard({ candidate, onOpen, featured = false }: { candidate: Candidate; onOpen: (c: Candidate) => void; featured?: boolean }) {
  const buttonLabel = candidate.recommendedAction === 'reply' ? `${platformLabel(candidate.platform)}で返信` : candidate.recommendedAction === 'unfollow_review' ? `${platformLabel(candidate.platform)}で整理確認` : `${platformLabel(candidate.platform)}で見る`;
  return <article className={featured ? 'candidate-card featured' : 'candidate-card'}>
    <div className="candidate-head">
      <div className={`platform-avatar ${candidate.platform}`}>{candidate.platform === 'x' ? 'X' : '◎'}</div>
      <div className="candidate-identity"><strong>{candidate.displayName}{candidate.verified ? ' ✓' : ''}</strong><span>@{candidate.username} · {kindLabel[candidate.kind]}</span></div>
      <div className="match-score"><strong>{candidate.match}</strong><small>MATCH</small></div>
    </div>
    {candidate.bio && <p className="candidate-bio">{candidate.bio}</p>}
    {candidate.publicMetrics && <div className="profile-metrics"><span><b>{compactNumber(candidate.publicMetrics.followers)}</b> followers</span><span><b>{compactNumber(candidate.publicMetrics.posts)}</b> posts</span></div>}
    <p className="reason">{candidate.reason}</p>
    {candidate.strategy && <div className="strategy-note"><span>AI STRATEGY</span><p>{candidate.strategy}</p></div>}
    <div className="tags">{candidate.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
    {candidate.draft && <div className="draft-box"><span>AI返信案</span><p>{candidate.draft}</p><button onClick={() => copyDraft(candidate.draft!)}>コピー</button></div>}
    <div className="candidate-actions">
      <button className="secondary-button">後で</button>
      <button className="primary-button" onClick={() => onOpen(candidate)}>{buttonLabel}<span>↗</span></button>
    </div>
  </article>;
}

function Relations({ state, onOpen, onChange }: { state: AppState; onOpen: (c: Candidate) => void; onChange: (state: AppState) => void }) {
  const following = state.candidates.filter((candidate) => candidate.stage !== 'discovered');
  const cleanup = following.filter((candidate) => candidate.recommendedAction === 'unfollow_review');
  return <>
    <PageHeading eyebrow="RELATIONS" title="関係を育てる" text="フォロー数ではなく、関係の深まりと整理タイミングを覚えておきます。" />
    <div className="relation-summary">
      <div><strong>{following.length}</strong><span>tracked</span></div>
      <div><strong>{following.filter((c) => c.followBack === true).length}</strong><span>mutual</span></div>
      <div><strong>{cleanup.length}</strong><span>review</span></div>
    </div>
    {cleanup.length > 0 && <section className="cleanup-banner"><span className="eyebrow">FOLLOW REVIEW</span><strong>{cleanup.length}人を整理候補として確認</strong><p>自動解除はしません。Mission一致度と交流履歴を見て、公式アプリで最終判断します。</p></section>}
    <div className="relation-list">{following.map((candidate) => <article className={candidate.recommendedAction === 'unfollow_review' ? 'relation-card review' : 'relation-card'} key={candidate.id}>
      <button className="relation-main" onClick={() => onOpen(candidate)}>
        <div className={`mini-avatar ${candidate.platform}`}>{candidate.platform === 'x' ? 'X' : '◎'}</div>
        <div><strong>{candidate.displayName}</strong><span>@{candidate.username} · {candidate.stage}</span></div>
        <div className="relation-score">{candidate.relationshipScore}<small>REL</small></div>
      </button>
      {candidate.strategy && <p className="relation-advice">{candidate.strategy}</p>}
      <div className="followback-controls" role="group" aria-label={`${candidate.username} follow back status`}>
        <button className={candidate.followBack === true ? 'active' : ''} onClick={() => onChange(setFollowBackStatus(state, candidate.id, true))}>相互</button>
        <button className={candidate.followBack === false ? 'active warn' : ''} onClick={() => onChange(setFollowBackStatus(state, candidate.id, false))}>フォロバなし</button>
        <button className={candidate.followBack == null ? 'active' : ''} onClick={() => onChange(setFollowBackStatus(state, candidate.id, null))}>未確認</button>
      </div>
    </article>)}</div>
  </>;
}

function Me({ state, onAnalyze, analyzing }: { state: AppState; onAnalyze: (profile: string, posts: string) => void; analyzing: boolean }) {
  const [profile, setProfile] = useState(state.selfProfile.profileText);
  const [posts, setPosts] = useState(state.selfProfile.recentPostsText);
  const score = state.selfProfile.score ?? Math.min(100, 48 + state.insights.length * 8);
  return <>
    <PageHeading eyebrow="ME" title="自分自身も成長対象に" text="プロフィールと最近の投稿をMissionとの差分から見て、次に直す場所を決めます。" />
    <section className="score-card"><div><span>MISSION SCORE</span><strong>{score}</strong><small>/100</small></div><p>{state.mission.primaryGoal}</p></section>

    <section className="self-input-card">
      <span className="eyebrow">ACCOUNT INPUT</span>
      <label>現在のプロフィール / Bio<textarea rows={5} value={profile} onChange={(event) => setProfile(event.target.value)} placeholder="SNSのプロフィール文を貼り付け" /></label>
      <label>最近の投稿<textarea rows={8} value={posts} onChange={(event) => setPosts(event.target.value)} placeholder="最近の投稿を数件まとめて貼り付け。無理に全部入れなくてOK" /></label>
      <button className="primary-button full" disabled={analyzing} onClick={() => onAnalyze(profile, posts)}>{analyzing ? 'Missionから分析中…' : 'AIで自分を分析'}</button>
      <small>初期PWAは手動貼り付けで$0寄りに運用。将来、本人アカウント連携へ差し替え可能です。</small>
    </section>

    {state.selfProfile.summary && <section className="self-result-card">
      <div className="result-heading"><span className="eyebrow">AI DIAGNOSIS</span>{state.selfProfile.analyzedAt && <small>{new Date(state.selfProfile.analyzedAt).toLocaleDateString('ja-JP')} 更新</small>}</div>
      <h3>現在地</h3><p>{state.selfProfile.summary}</p>
      {state.selfProfile.strategy && <><h3>目的地へ近づく作戦</h3><p>{state.selfProfile.strategy}</p></>}
      {state.selfProfile.profileRewrite && <div className="rewrite-box"><span>プロフィール改善案</span><p>{state.selfProfile.profileRewrite}</p><button onClick={() => copyDraft(state.selfProfile.profileRewrite!)}>コピー</button></div>}
    </section>}

    <div className="insight-list">{state.insights.map((insight) => <article className="insight-card" key={insight.id}><div className="insight-top"><span>{insight.category.toUpperCase()}</span><b className={`priority ${insight.priority}`}>{insight.priority}</b></div><h3>{insight.title}</h3><p>{insight.body}</p></article>)}</div>
  </>;
}

function Settings({ state, onChange }: { state: AppState; onChange: (state: AppState) => void }) {
  const [mission, setMission] = useState<Mission>(state.mission);
  const [limit, setLimit] = useState(state.budget.monthlyLimitUsd);
  const [reviewDays, setReviewDays] = useState(state.relationshipPolicy.followBackReviewAfterDays);
  const [preserveHighMatch, setPreserveHighMatch] = useState(state.relationshipPolicy.preserveHighMatch);
  function save() {
    const next = updateMission(state, mission);
    const withPolicy = updateRelationshipPolicy(next, { followBackReviewAfterDays: reviewDays, preserveHighMatch });
    onChange({ ...withPolicy, budget: { ...withPolicy.budget, hardLimit: true, monthlyLimitUsd: limit, mode: limit === 0 ? 'free' : limit <= 1 ? 'eco' : limit <= 3 ? 'balanced' : 'growth' } });
  }
  return <>
    <PageHeading eyebrow="SETTINGS" title="AIに目的地を教える" text="ここが推薦・文章・自己分析すべての判断軸になります。" />
    <section className="form-card"><label>Mission<textarea value={mission.text} rows={5} onChange={(e) => setMission({ ...mission, text: e.target.value })} /></label><label>一番大事なゴール<input value={mission.primaryGoal} onChange={(e) => setMission({ ...mission, primaryGoal: e.target.value })} /></label><label>Communication DNA<textarea value={mission.communicationDNA} rows={4} onChange={(e) => setMission({ ...mission, communicationDNA: e.target.value })} /></label></section>
    <section className="form-card relationship-settings">
      <div className="field-title"><div><strong>フォロー整理ポリシー</strong><span>フォロバだけで機械的に解除しない</span></div><b>{reviewDays}日</b></div>
      <input className="range" type="range" min="7" max="90" step="1" value={reviewDays} onChange={(e) => setReviewDays(Number(e.target.value))} />
      <div className="range-labels"><span>7日</span><span>30日</span><span>90日</span></div>
      <button className="policy-toggle" onClick={() => setPreserveHighMatch((value) => !value)}><span><strong>高Mission Matchは残す</strong><small>フォロバなしでも相性80以上や交流中の人は継続候補</small></span><i className={preserveHighMatch ? 'toggle on' : 'toggle'} /></button>
    </section>
    <section className="form-card budget-settings"><div className="field-title"><div><strong>月間AI/API予算</strong><span>機能を削らず、外部取得量を自動調整</span></div><b>${limit}</b></div><input className="range" type="range" min="0" max="10" step="1" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /><div className="range-labels"><span>$0</span><span>$3 recommended</span><span>$10</span></div><div className="hard-limit"><span><strong>HARD LIMIT</strong><small>常時ON。設定額を超える有料リクエストを拒否</small></span><i className="toggle on" /></div><div className="budget-breakdown"><span>X <b>${state.budget.xUsd.toFixed(2)}</b></span><span>LLM <b>${state.budget.llmUsd.toFixed(2)}</b></span><span>Search <b>${state.budget.searchUsd.toFixed(2)}</b></span></div></section>
    <BackupControls state={state} onRestore={onChange} />
    <button className="save-button" onClick={save}>設定を保存</button>
  </>;
}

function PageHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>;
}

function ResultSheet({ candidate, onResolve }: { candidate: Candidate; onResolve: (action: 'followed' | 'skipped' | 'kept') => void }) {
  return <div className="sheet-backdrop"><section className="result-sheet"><div className="sheet-handle" /><span className="eyebrow">WELCOME BACK</span><h2>@{candidate.username} はどうしました？</h2><p>結果だけ教えてください。次の推薦と関係性スコアに反映します。</p><button className="primary-button full" onClick={() => onResolve('followed')}>フォロー / 交流した</button><button className="secondary-button full" onClick={() => onResolve('kept')}>今回は見るだけ</button><button className="ghost-button full" onClick={() => onResolve('skipped')}>この候補は違う</button></section></div>;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export default App;
