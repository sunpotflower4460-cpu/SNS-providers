import { useEffect, useMemo, useState } from 'react';
import { analyzeSelfProfile, apiConfigured, discoverSocialCandidates, enrichXProfiles, fetchBudget, rankCandidates } from './api';
import BackupControls from './BackupControls';
import { getSyncToken } from './controlToken';
import DailyQueue from './DailyQueue';
import { buildDailyQueue, queueSummary } from './daily';
import { mergeDiscoveredProfiles } from './discoveryStore';
import { addCandidateFromReference, applyRankResults, applySelfAnalysis, applyXProfiles, loadState, recordInteraction, saveState, setFollowBackStatus, syncBudget, updateMission, updateRelationshipPolicy, updateSelfProfileInputs } from './store';
import { copyDraft, openCandidate, platformLabel } from './social';
import type { AppState, AppStateUpdater, Candidate, Mission, Platform } from './types';
import { useLocalDayKey } from './useLocalDay';

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
  const [persistenceError, setPersistenceError] = useState('');
  const localDay = useLocalDayKey();
  const statusNote = persistenceError || apiNote;

  useEffect(() => {
    const saved = saveState(state);
    setPersistenceError(saved.ok ? '' : saved.reason);
  }, [state]);

  useEffect(() => {
    if (!apiConfigured) return;
    if (!getSyncToken().trim()) {
      setApiNote('管理キー未設定 · ローカル利用可');
      return;
    }
    fetchBudget()
      .then((budget) => setState((current) => syncBudget(current, budget.usedUsd, budget.limitUsd)))
      .catch((error) => setApiNote(error instanceof Error ? `予算同期: ${error.message}` : '予算同期に失敗しました'));
  }, []);

  const active = useMemo(() => {
    const now = Date.now();
    return state.candidates
      .filter((candidate) => {
        if (candidate.skipped) return false;
        if (!candidate.snoozedUntil) return true;
        const until = new Date(candidate.snoozedUntil).getTime();
        return !Number.isFinite(until) || until <= now;
      })
      .sort((a, b) => b.match - a.match);
  }, [state.candidates, localDay]);

  const doneToday = useMemo(() => {
    const now = new Date();
    return state.interactions.filter((interaction) => {
      const at = new Date(interaction.at);
      return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
    }).length;
  }, [state.interactions, localDay]);

  function onOpen(candidate: Candidate) {
    setPending(candidate);
    openCandidate(candidate);
  }

  function resolvePending(action: 'followed' | 'skipped' | 'later' | 'kept') {
    if (!pending) return;
    if (action !== 'later') setState((current) => recordInteraction(current, pending.id, action));
    setPending(null);
  }

  async function rerankCandidates() {
    if (!apiConfigured) {
      setApiNote('Worker URLを設定するとAI再評価が使えます');
      return;
    }
    const targets = active.filter((candidate) => candidate.recommendedAction !== 'unfollow_review');
    if (!targets.length) {
      setApiNote('再評価する候補がありません');
      return;
    }
    setRanking(true);
    setApiNote('Mission基準で候補を再評価中…');
    try {
      const result = await rankCandidates(state.mission, targets, state.budget.monthlyLimitUsd);
      setState((current) => applyRankResults(current, result.results, result.costUsd));
      setApiNote(`${result.provider}で${result.results.length}件評価${result.paid ? ` · $${result.costUsd.toFixed(4)}` : ' · $0'}`);
    } catch (error) {
      setApiNote(error instanceof Error ? `AI評価失敗: ${error.message}` : 'AI評価に失敗しました');
    } finally {
      setRanking(false);
    }
  }

  async function discoverCandidates() {
    if (!apiConfigured) {
      setApiNote('Worker URLを設定すると無料候補探索が使えます');
      return;
    }
    setDiscovering(true);
    setApiNote('Missionから公開プロフィール候補を探索中…');
    try {
      const result = await discoverSocialCandidates(state.mission);
      if (!result.enabled) {
        setApiNote(result.reason || '無料探索は現在無効です');
        return;
      }
      let addedCount = 0;
      setState((current) => {
        const next = mergeDiscoveredProfiles(current, result.profiles);
        addedCount = Math.max(0, next.candidates.length - current.candidates.length);
        return next;
      });
      setApiNote(`${result.provider}で候補探索完了 · 新規${addedCount}件 · $${result.costUsd.toFixed(2)}`);
    } catch (error) {
      setApiNote(error instanceof Error ? `探索失敗: ${error.message}` : '候補探索に失敗しました');
    } finally {
      setDiscovering(false);
    }
  }

  async function enrichXCandidates() {
    if (!apiConfigured) {
      setApiNote('Worker URLを設定するとX公式プロフィール補完が使えます');
      return;
    }
    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000;
    const futureSkewLimit = now + 5 * 60 * 1000;
    const targets = state.candidates.filter((candidate) => {
      if (candidate.platform !== 'x' || candidate.skipped) return false;
      const lastAttempt = candidate.profileSyncAttemptedAt || candidate.profileSyncedAt;
      if (!lastAttempt) return true;
      const lastAttemptMs = new Date(lastAttempt).getTime();
      if (!Number.isFinite(lastAttemptMs) || lastAttemptMs > futureSkewLimit) return true;
      return lastAttemptMs < cutoff;
    }).slice(0, 100);
    if (!targets.length) {
      setApiNote('X候補は24時間以内に確認済みです');
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
      const attemptedUsernames = targets.map((candidate) => candidate.username);
      setState((current) => applyXProfiles(current, result.profiles, attemptedUsernames, result.costUsd));
      setApiNote(`X公式情報 ${result.profiles.length}/${targets.length}件取得 · $${result.costUsd.toFixed(4)}`);
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
      // Inputs were already persisted before the request. Re-applying the request-time
      // text here would overwrite a newer X sync/restore that completed while AI was busy.
      setState((current) => applySelfAnalysis(current, result.results[0], result.costUsd));
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
          <span>{statusNote}</span>
        </div>
        <BudgetPill state={state} />
      </header>

      <main className="page">
        {tab === 'today' && <Today state={state} doneToday={doneToday} onOpen={onOpen} onTab={setTab} />}
        {tab === 'discover' && <Discover state={state} candidates={active} onOpen={onOpen} onChange={setState} onDiscover={discoverCandidates} onRerank={rerankCandidates} onEnrichX={enrichXCandidates} discovering={discovering} ranking={ranking} enrichingX={enrichingX} apiNote={statusNote} />}
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

function Today({ state, doneToday, onOpen, onTab }: {
  state: AppState; doneToday: number; onOpen: (c: Candidate) => void; onTab: (tab: Tab) => void;
}) {
  const queue = buildDailyQueue(state);
  const summary = queueSummary(queue);
  const configuredLimit = Math.max(1, state.relationshipPolicy.dailyQueueLimit ?? 30);
  const plannedTotal = Math.min(configuredLimit, doneToday + queue.length);
  const progress = plannedTotal > 0 ? Math.min(100, Math.round((doneToday / plannedTotal) * 100)) : 100;

  return <>
    <section className="mission-card">
      <div className="eyebrow">YOUR MISSION</div>
      <h1>{state.mission.primaryGoal}</h1>
      <p>{state.mission.text}</p>
      <div className="mission-progress"><span style={{ width: `${progress}%` }} /></div>
      <div className="progress-copy"><strong>{doneToday}</strong><span>/ {plannedTotal} actions today</span></div>
    </section>

    <section className="section-block">
      <div className="section-title"><div><span className="eyebrow">TODAY</span><h2>今日、目的に近づく</h2></div><button className="text-button" onClick={() => onTab('discover')}>すべて見る</button></div>
      <div className="metric-grid">
        <Metric icon="＋" value={summary.connect} label="新しくつながる" />
        <Metric icon="↗" value={summary.engage} label="会話・交流" />
        <Metric icon="◎" value={summary.self} label="自分を改善" />
        <Metric icon="−" value={summary.cleanup} label="フォロー整理" />
      </div>
    </section>

    <DailyQueue state={state} onOpenCandidate={onOpen} onOpenMe={() => onTab('me')} />

    {state.insights[0] && <section className="coach-card">
      <div className="coach-icon">✦</div>
      <div><span className="eyebrow">AI COACH</span><h3>{state.insights[0].title}</h3><p>{state.insights[0].body}</p></div>
      <button onClick={() => onTab('me')}>見る</button>
    </section>}
  </>;
}

function Metric({ icon, value, label }: { icon: string; value: number; label: string }) {
  return <div className="metric-card"><span className="metric-icon">{icon}</span><strong>{value}</strong><small>{label}</small></div>;
}

function Discover({ state, candidates, onOpen, onChange, onDiscover, onRerank, onEnrichX, discovering, ranking, enrichingX, apiNote }: {
  state: AppState;
  candidates: Candidate[];
  onOpen: (c: Candidate) => void;
  onChange: AppStateUpdater;
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
  const now = Date.now();
  const matchesFilter = (candidate: Candidate) => filter === 'all' || candidate.platform === filter;
  const snoozedCount = state.candidates.filter((candidate) => {
    if (candidate.skipped || !matchesFilter(candidate) || !candidate.snoozedUntil) return false;
    const until = new Date(candidate.snoozedUntil).getTime();
    return Number.isFinite(until) && until > now;
  }).length;
  const storedCount = state.candidates.filter((candidate) => !candidate.skipped && matchesFilter(candidate)).length;

  function addReference(value = reference) {
    if (!value.trim()) return;
    onChange((current) => addCandidateFromReference(current, platform, value));
    setReference('');
  }

  function snoozeCandidate(candidate: Candidate) {
    const until = new Date();
    until.setHours(24, 0, 0, 0);
    onChange((current) => ({
      ...current,
      candidates: current.candidates.map((item) => item.id === candidate.id ? { ...item, snoozedUntil: until.toISOString() } : item),
    }));
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
    {visible.length > 0 ? <div className="card-stack">{visible.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} onOpen={onOpen} onLater={snoozeCandidate} />)}</div> : <DiscoverEmptyState filter={filter} storedCount={storedCount} snoozedCount={snoozedCount} />}
  </>;
}

function DiscoverEmptyState({ filter, storedCount, snoozedCount }: { filter: 'all' | 'x' | 'instagram'; storedCount: number; snoozedCount: number }) {
  const platform = filter === 'all' ? '候補' : filter === 'x' ? 'X候補' : 'Instagram候補';
  if (snoozedCount > 0 && storedCount === snoozedCount) {
    return <section className="form-card"><div className="field-title"><div><strong>今日はここまで</strong><span>{snoozedCount}件の{platform}を「明日へ」移動済みです。明日になると自動で候補へ戻ります。</span></div><b>✓</b></div></section>;
  }
  if (storedCount === 0) {
    return <section className="form-card"><div className="field-title"><div><strong>{platform}はまだありません</strong><span>上のMission探索、プロフィールURL、@usernameのどれかから追加できます。</span></div><b>＋</b></div></section>;
  }
  return <section className="form-card"><div className="field-title"><div><strong>今日表示する{platform}はありません</strong><span>見送った候補や明日送りの候補は今日の一覧から外れています。</span></div><b>○</b></div></section>;
}

function CandidateCard({ candidate, onOpen, onLater, featured = false }: { candidate: Candidate; onOpen: (c: Candidate) => void; onLater: (c: Candidate) => void; featured?: boolean }) {
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
      <button className="secondary-button" onClick={() => onLater(candidate)}>明日へ</button>
      <button className="primary-button" onClick={() => onOpen(candidate)}>{buttonLabel}<span>↗</span></button>
    </div>
  </article>;
}

function Relations({ state, onOpen, onChange }: { state: AppState; onOpen: (c: Candidate) => void; onChange: AppStateUpdater }) {
  const following = state.candidates.filter((candidate) => !candidate.skipped && candidate.stage !== 'discovered');
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
        <button className={candidate.followBack === true ? 'active' : ''} onClick={() => onChange((current) => setFollowBackStatus(current, candidate.id, true))}>相互</button>
        <button className={candidate.followBack === false ? 'active warn' : ''} onClick={() => onChange((current) => setFollowBackStatus(current, candidate.id, false))}>フォロバなし</button>
        <button className={candidate.followBack == null ? 'active' : ''} onClick={() => onChange((current) => setFollowBackStatus(current, candidate.id, null))}>未確認</button>
      </div>
    </article>)}</div>
  </>;
}

function Me({ state, onAnalyze, analyzing }: { state: AppState; onAnalyze: (profile: string, posts: string) => void; analyzing: boolean }) {
  const [profile, setProfile] = useState(state.selfProfile.profileText);
  const [posts, setPosts] = useState(state.selfProfile.recentPostsText);
  const score = state.selfProfile.score;

  useEffect(() => {
    setProfile(state.selfProfile.profileText);
    setPosts(state.selfProfile.recentPostsText);
  }, [state.selfProfile.profileText, state.selfProfile.recentPostsText]);

  return <>
    <PageHeading eyebrow="ME" title="自分もMissionに近づける" text="相手探しだけでなく、自分のプロフィールと投稿の状態もAIが見ます。" />
    <section className="score-card"><div><span>MISSION SCORE</span><strong>{score == null ? '—' : score}</strong>{score != null && <small>/100</small>}</div><p>{state.selfProfile.summary || 'まだ未測定です。プロフィールや最近の投稿を入れると、Missionから現在地と次の改善点を評価します。'}</p></section>
    <section className="form-card self-analysis-card">
      <label>現在のプロフィール<textarea value={profile} onChange={(event) => setProfile(event.target.value)} placeholder="X / Instagramのプロフィール文を貼り付け" /></label>
      <label>最近の投稿<textarea value={posts} onChange={(event) => setPosts(event.target.value)} placeholder="最近の投稿を数件まとめて貼り付け" /></label>
      <button className="primary-button" disabled={analyzing} onClick={() => onAnalyze(profile, posts)}>{analyzing ? '分析中…' : 'Missionから自己分析'}</button>
    </section>
    {state.selfProfile.strategy && <section className="coach-card self-result"><div className="coach-icon">↗</div><div><span className="eyebrow">NEXT STRATEGY</span><h3>目的地へ近づく作戦</h3><p>{state.selfProfile.strategy}</p></div></section>}
    {state.selfProfile.profileRewrite && <section className="form-card rewrite-card"><div className="field-title"><div><strong>プロフィール改善案</strong><span>事実を足さず、Missionへの入口を分かりやすくする</span></div><b>AI</b></div><p>{state.selfProfile.profileRewrite}</p><button className="secondary-button" onClick={() => copyDraft(state.selfProfile.profileRewrite!)}>コピー</button></section>}
    <div className="insight-list">{state.insights.map((insight) => <article className="insight-card" key={insight.id}><div className={`priority ${insight.priority}`} /><div><span>{insight.category.toUpperCase()}</span><strong>{insight.title}</strong><p>{insight.body}</p></div></article>)}</div>
  </>;
}

function Settings({ state, onChange }: { state: AppState; onChange: AppStateUpdater }) {
  const [missionText, setMissionText] = useState(state.mission.text);
  const [primaryGoal, setPrimaryGoal] = useState(state.mission.primaryGoal);
  const [communicationDNA, setCommunicationDNA] = useState(state.mission.communicationDNA);
  const [budget, setBudget] = useState(state.budget.monthlyLimitUsd);
  const [followBackDays, setFollowBackDays] = useState(state.relationshipPolicy.followBackReviewAfterDays);

  useEffect(() => setMissionText(state.mission.text), [state.mission.text]);
  useEffect(() => setPrimaryGoal(state.mission.primaryGoal), [state.mission.primaryGoal]);
  useEffect(() => setCommunicationDNA(state.mission.communicationDNA), [state.mission.communicationDNA]);
  useEffect(() => setBudget(state.budget.monthlyLimitUsd), [state.budget.monthlyLimitUsd]);
  useEffect(() => setFollowBackDays(state.relationshipPolicy.followBackReviewAfterDays), [state.relationshipPolicy.followBackReviewAfterDays]);

  function persist() {
    onChange((current) => {
      let next = updateMission(current, { ...current.mission, text: missionText, primaryGoal, communicationDNA });
      next = { ...next, budget: { ...next.budget, monthlyLimitUsd: Math.max(0, budget), hardLimit: true } };
      next = updateRelationshipPolicy(next, { ...next.relationshipPolicy, followBackReviewAfterDays: Math.max(7, Math.min(90, Math.round(followBackDays || 30))) });
      return next;
    });
  }

  return <>
    <PageHeading eyebrow="SETTINGS" title="AIに目的地を教える" text="この設定が候補選び・交流文・自己改善の判断軸になります。" />
    <section className="form-card">
      <label>Mission<textarea value={missionText} onChange={(event) => setMissionText(event.target.value)} /></label>
      <label>最優先ゴール<input value={primaryGoal} onChange={(event) => setPrimaryGoal(event.target.value)} /></label>
      <label>Communication DNA<textarea value={communicationDNA} onChange={(event) => setCommunicationDNA(event.target.value)} /></label>
      <label>月間AI / API予算 <span className="inline-value">${budget.toFixed(2)}</span><input className="range" type="range" min="0" max="10" step="0.5" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></label>
      <label>フォローバック整理レビュー <span className="inline-value">{followBackDays}日後</span><input className="range" type="range" min="7" max="90" step="1" value={followBackDays} onChange={(event) => setFollowBackDays(Number(event.target.value))} /></label>
      <div className="hard-limit"><span>HARD LIMIT</span><strong>ON</strong><p>この上限を超える有料API処理は実行しません。</p></div>
      <button className="primary-button" onClick={persist}>設定を保存</button>
    </section>
    <BackupControls state={state} onRestore={onChange} />
  </>;
}

function PageHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <header className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></header>;
}

function ResultSheet({ candidate, onResolve }: { candidate: Candidate; onResolve: (action: 'followed' | 'skipped' | 'later' | 'kept') => void }) {
  const cleanup = candidate.recommendedAction === 'unfollow_review';
  return <div className="sheet-backdrop"><section className="result-sheet"><div className="sheet-handle" /><span className="eyebrow">WELCOME BACK</span><h2>@{candidate.username} はどうしました？</h2><p>{cleanup ? 'フォロー整理の最終操作は公式SNS側で行います。ここでは継続・解除の判断だけ記録します。' : '最終操作は公式SNS側で行います。ここでは関係性履歴だけ記録します。'}</p><div className="sheet-actions">{cleanup ? <><button onClick={() => onResolve('kept')}>フォローを継続する</button><button onClick={() => onResolve('skipped')}>フォロー解除した</button><button className="muted" onClick={() => onResolve('later')}>後で</button></> : <><button onClick={() => onResolve('followed')}>フォローした</button><button onClick={() => onResolve('kept')}>交流した / 継続</button><button onClick={() => onResolve('skipped')}>今回は見送る</button><button className="muted" onClick={() => onResolve('later')}>後で</button></>}</div></section></div>;
}

function compactNumber(value?: number) {
  const number = value || 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

export default App;
