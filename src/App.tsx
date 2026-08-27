import { useEffect, useMemo, useState } from 'react';
import { analyzeSelfProfile, apiConfigured, discoverSocialCandidates, enrichXProfiles, fetchBudget, rankCandidates } from './api';
import BackupControls from './BackupControls';
import { getSyncToken } from './controlToken';
import DailyQueue from './DailyQueue';
import { buildDailyQueue, queueSummary } from './daily';
import { mergeDiscoveredProfiles } from './discoveryStore';
import Manual from './Manual';
import Onboarding from './Onboarding';
import { hasSeenOnboarding, markOnboardingSeen } from './onboarding';
import { addCandidateFromReference, applyRankResults, applySelfAnalysis, applyXProfiles, loadState, recordInteraction, saveState, setFollowBackStatus, syncBudget, updateCandidateDraft, updateMission, updateRelationshipPolicy, updateSelfProfileInputs } from './store';
import { copyDraft, openCandidate, platformLabel } from './social';
import type { AppState, Candidate, Mission, Platform } from './types';
import { useLocalDayKey } from './useLocalDay';
import { useModalA11y } from './useModalA11y';

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

const stageLabel: Record<Candidate['stage'], string> = {
  discovered: '発見', interested: '興味あり', following: 'フォロー中', engaged: '交流あり', recognized: '認知済み', conversation: '会話中', relationship: '関係構築',
};

const insightCategoryLabel: Record<'profile' | 'content' | 'network', string> = {
  profile: 'プロフィール', content: '投稿内容', network: 'ネットワーク',
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
  const [apiNoteIsError, setApiNoteIsError] = useState(false);
  const [meNote, setMeNote] = useState('');
  const [meNoteIsError, setMeNoteIsError] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  const [showManual, setShowManual] = useState(false);
  const localDay = useLocalDayKey();

  // Updates the shared topbar status line. Self-analysis (Me tab) also calls
  // noteMe() below so its own status doesn't leak into unrelated tabs/sections
  // that read this same shared note (e.g. Discover's status chip).
  function note(text: string, isError = false) {
    setApiNote(text);
    setApiNoteIsError(isError);
  }

  // Self-analysis status, kept separate from note()/apiNote so a Discover or
  // budget-sync message never shows up under the Me tab's self-analysis form
  // (and vice versa) just because the user switched tabs.
  function noteMe(text: string, isError = false) {
    note(text, isError);
    setMeNote(text);
    setMeNoteIsError(isError);
  }

  useEffect(() => saveState(state), [state]);

  useEffect(() => {
    if (!apiConfigured) return;
    if (!getSyncToken().trim()) {
      note('管理キー未設定 · ローカル利用可');
      return;
    }
    fetchBudget()
      .then((budget) => setState((current) => syncBudget(current, budget.usedUsd, budget.limitUsd)))
      .catch((error) => note(error instanceof Error ? `予算同期: ${error.message}` : '予算同期に失敗しました', true));
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
      note('Worker URLを設定するとAI再評価が使えます', true);
      return;
    }
    const targets = active.filter((candidate) => candidate.recommendedAction !== 'unfollow_review');
    if (!targets.length) {
      note('再評価する候補がありません', true);
      return;
    }
    setRanking(true);
    note('Mission基準で候補を再評価中…');
    try {
      const result = await rankCandidates(state.mission, targets, state.budget.monthlyLimitUsd, state.relationshipPolicy.autoDraftReplies !== false);
      setState((current) => applyRankResults(current, result.results, result.costUsd));
      note(`${result.provider}で${result.results.length}件評価${result.paid ? ` · $${result.costUsd.toFixed(4)}` : ' · $0'}`);
    } catch (error) {
      note(error instanceof Error ? `AI評価失敗: ${error.message}` : 'AI評価に失敗しました', true);
    } finally {
      setRanking(false);
    }
  }

  async function discoverCandidates() {
    if (!apiConfigured) {
      note('Worker URLを設定すると無料候補探索が使えます', true);
      return;
    }
    setDiscovering(true);
    note('Missionから公開プロフィール候補を探索中…');
    try {
      const result = await discoverSocialCandidates(state.mission);
      if (!result.enabled) {
        note(result.reason || '無料探索は現在無効です', true);
        return;
      }
      let addedCount = 0;
      setState((current) => {
        const next = mergeDiscoveredProfiles(current, result.profiles);
        addedCount = Math.max(0, next.candidates.length - current.candidates.length);
        return next;
      });
      note(`${result.provider}で候補探索完了 · 新規${addedCount}件 · $${result.costUsd.toFixed(2)}`);
    } catch (error) {
      note(error instanceof Error ? `探索失敗: ${error.message}` : '候補探索に失敗しました', true);
    } finally {
      setDiscovering(false);
    }
  }

  async function enrichXCandidates() {
    if (!apiConfigured) {
      note('Worker URLを設定するとX公式プロフィール補完が使えます', true);
      return;
    }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const targets = state.candidates.filter((candidate) => {
      if (candidate.platform !== 'x' || candidate.skipped) return false;
      if (!candidate.profileSyncedAt) return true;
      return new Date(candidate.profileSyncedAt).getTime() < cutoff;
    }).slice(0, 100);
    if (!targets.length) {
      note('X候補は24時間以内に同期済みです');
      return;
    }

    setEnrichingX(true);
    note(`X公式情報を${targets.length}件まとめて確認中…`);
    try {
      const result = await enrichXProfiles(targets, state.budget.monthlyLimitUsd);
      if (!result.enabled) {
        note(result.reason || 'Xプロフィール補完は現在無効です', true);
        return;
      }
      setState((current) => applyXProfiles(current, result.profiles, result.costUsd));
      note(`X公式情報 ${result.profiles.length}件補完 · $${result.costUsd.toFixed(4)}`);
    } catch (error) {
      note(error instanceof Error ? `X補完失敗: ${error.message}` : 'Xプロフィール補完に失敗しました', true);
    } finally {
      setEnrichingX(false);
    }
  }

  async function analyzeMe(profileText: string, recentPostsText: string) {
    setState((current) => updateSelfProfileInputs(current, profileText, recentPostsText));
    if (!profileText.trim() && !recentPostsText.trim()) {
      noteMe('プロフィールまたは最近の投稿を入力してください', true);
      return;
    }
    if (!apiConfigured) {
      noteMe('Worker URLを設定すると自己分析が使えます', true);
      return;
    }
    setAnalyzingSelf(true);
    noteMe('自分のアカウントをMissionから逆算して分析中…');
    try {
      const result = await analyzeSelfProfile(state.mission, profileText, recentPostsText, state.budget.monthlyLimitUsd);
      setState((current) => applySelfAnalysis(updateSelfProfileInputs(current, profileText, recentPostsText), result.results[0], result.costUsd));
      noteMe(`${result.provider}で自己分析完了${result.paid ? ` · $${result.costUsd.toFixed(4)}` : ' · $0'}`);
    } catch (error) {
      noteMe(error instanceof Error ? `自己分析失敗: ${error.message}` : '自己分析に失敗しました', true);
    } finally {
      setAnalyzingSelf(false);
    }
  }

  function saveSelfProfileDraft(profileText: string, recentPostsText: string) {
    setState((current) => updateSelfProfileInputs(current, profileText, recentPostsText));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark">S</div>
        <div className="topbar-copy">
          <strong>Social Mission</strong>
          <span className={apiNoteIsError ? 'error' : undefined}>{apiNote}</span>
        </div>
        <div className="topbar-actions">
          <button className="help-button" onClick={() => setShowManual(true)} aria-label="使い方ガイドを開く">？</button>
          <BudgetPill state={state} />
        </div>
      </header>

      <main className="page">
        {tab === 'today' && <Today state={state} doneToday={doneToday} onOpen={onOpen} onTab={setTab} />}
        {tab === 'discover' && <Discover state={state} candidates={active} onOpen={onOpen} onChange={setState} onDiscover={discoverCandidates} onRerank={rerankCandidates} onEnrichX={enrichXCandidates} discovering={discovering} ranking={ranking} enrichingX={enrichingX} apiNote={apiNote} apiNoteIsError={apiNoteIsError} />}
        {tab === 'relations' && <Relations state={state} onOpen={onOpen} onChange={setState} />}
        {tab === 'me' && <Me state={state} onAnalyze={analyzeMe} analyzing={analyzingSelf} apiNote={meNote} apiNoteIsError={meNoteIsError} onSaveDraft={saveSelfProfileDraft} />}
        {tab === 'settings' && <Settings state={state} onChange={setState} onOpenManual={() => setShowManual(true)} />}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {tabs.map((item) => (
          <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setTab(item.id)}>
            <span>{item.icon}</span><small>{item.label}</small>
          </button>
        ))}
      </nav>

      {pending && <ResultSheet candidate={pending} onResolve={resolvePending} />}
      {showOnboarding && <Onboarding onFinish={() => { markOnboardingSeen(); setShowOnboarding(false); }} onOpenManual={() => setShowManual(true)} />}
      {!showOnboarding && showManual && <Manual onClose={() => setShowManual(false)} />}
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
    <NextStepBanner state={state} onTab={onTab} />

    <section className="mission-card">
      <div className="eyebrow">あなたのミッション</div>
      <h1>{state.mission.primaryGoal}</h1>
      <p>{state.mission.text}</p>
      <div className="mission-progress"><span style={{ width: `${progress}%` }} /></div>
      <div className="progress-copy"><strong>{doneToday}</strong><span>/ 今日{plannedTotal}件</span></div>
    </section>

    <section className="section-block">
      <div className="section-title"><div><span className="eyebrow">今日の内訳</span><h2>今日、目的に近づく</h2></div><button className="text-button" onClick={() => onTab('discover')}>すべて見る</button></div>
      <div className="metric-grid">
        <Metric icon="＋" value={summary.connect} label="新しくつながる" />
        <Metric icon="↗" value={summary.engage} label="会話・交流" />
        <Metric icon="◎" value={summary.self} label="自分を改善" />
        <Metric icon="−" value={summary.cleanup} label="フォロー整理" />
      </div>
    </section>

    <DailyQueue state={state} onOpenCandidate={onOpen} onOpenMe={() => onTab('me')} onOpenDiscover={() => onTab('discover')} />

    {state.insights[0] && <section className="coach-card">
      <div className="coach-icon">✦</div>
      <div><span className="eyebrow">AIコーチ</span><h3>{state.insights[0].title}</h3><p>{state.insights[0].body}</p></div>
      <button onClick={() => onTab('me')}>見る</button>
    </section>}
  </>;
}

function NextStepBanner({ state, onTab }: { state: AppState; onTab: (tab: Tab) => void }) {
  const hasCandidates = state.candidates.some((candidate) => !candidate.skipped);
  const needsReview = state.candidates.some((candidate) => !candidate.skipped && candidate.recommendedAction === 'review' && candidate.stage === 'discovered');

  if (!hasCandidates) {
    return <section className="next-step-banner">
      <span className="eyebrow">はじめの一歩</span>
      <strong>まだ交流したい人が登録されていません</strong>
      <p>Discoverタブを開いて、Missionに合いそうな人を探すか、プロフィールURL / @usernameを追加してください。</p>
      <button className="primary-button" onClick={() => onTab('discover')}>Discoverを開く<span>↗</span></button>
    </section>;
  }
  if (needsReview) {
    return <section className="next-step-banner">
      <span className="eyebrow">次のステップ</span>
      <strong>候補をAIで評価しましょう</strong>
      <p>追加した候補はまだMissionとの一致度が未評価です。Discoverで「AIで候補を再評価」を押すと、おすすめ順と会話のヒントが更新されます。</p>
      <button className="primary-button" onClick={() => onTab('discover')}>Discoverで評価する<span>↗</span></button>
    </section>;
  }
  return null;
}

function Metric({ icon, value, label }: { icon: string; value: number; label: string }) {
  return <div className="metric-card"><span className="metric-icon">{icon}</span><strong>{value}</strong><small>{label}</small></div>;
}

function Discover({ state, candidates, onOpen, onChange, onDiscover, onRerank, onEnrichX, discovering, ranking, enrichingX, apiNote, apiNoteIsError }: {
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
  apiNoteIsError: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'x' | 'instagram'>('all');
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [reference, setReference] = useState('');
  const [referenceNote, setReferenceNote] = useState('');
  const [expanded, setExpanded] = useState(false);
  const busy = discovering || ranking || enrichingX;
  const CAP = 6;
  const visible = candidates.filter((candidate) => filter === 'all' || candidate.platform === filter);
  const shown = expanded ? visible : visible.slice(0, CAP);
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
    const next = addCandidateFromReference(state, platform, value);
    if (next === state) {
      setReferenceNote('追加できませんでした(重複か、無効なURL/@usernameの可能性があります)');
      return;
    }
    onChange(next);
    setReference('');
    setReferenceNote('');
  }

  function snoozeCandidate(candidate: Candidate) {
    const until = new Date();
    until.setHours(24, 0, 0, 0);
    onChange({
      ...state,
      candidates: state.candidates.map((item) => item.id === candidate.id ? { ...item, snoozedUntil: until.toISOString() } : item),
    });
  }

  function editDraft(candidateId: string, draft: string) {
    onChange(updateCandidateDraft(state, candidateId, draft));
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
      <div className="import-head"><div><span className="eyebrow">候補を追加</span><strong>AIに探させるか、見つけた人を1タップで追加</strong></div><span className={apiNoteIsError ? 'status-chip error' : 'status-chip'}>{apiNote}</span></div>
      <p className="import-hint">① 下から候補を追加 → ② 「AIで候補を再評価」でMission順に並び替え → ③ Todayのリストから実行</p>
      <button className="discovery-button" disabled={busy} onClick={onDiscover}><span>{discovering ? <i className="spinner" aria-hidden="true" /> : '✦'}</span><strong>{discovering ? '無料探索中…' : 'Missionから無料で候補を探す'}</strong><small>Tavily無料モード · X/Instagram公開プロフィール候補</small></button>
      <div className="mini-segmented">
        <button className={platform === 'instagram' ? 'active' : ''} onClick={() => setPlatform('instagram')}>Instagram</button>
        <button className={platform === 'x' ? 'active' : ''} onClick={() => setPlatform('x')}>X</button>
      </div>
      <div className="import-row"><input value={reference} onChange={(event) => { setReference(event.target.value); if (referenceNote) setReferenceNote(''); }} placeholder="プロフィールURL または @username" /><button onClick={() => addReference()}>追加</button></div>
      {referenceNote && <p className="form-note error">{referenceNote}</p>}
      <div className="import-actions">
        <button className="secondary-button" disabled={busy} onClick={addFromClipboard}>クリップボードから追加</button>
        <button className="secondary-button" disabled={busy} onClick={onEnrichX}>{enrichingX && <i className="spinner" aria-hidden="true" />}{enrichingX ? 'X同期中…' : 'X公式情報を補完'}</button>
        <button className="primary-button" disabled={busy} onClick={onRerank}>{ranking && <i className="spinner" aria-hidden="true" />}{ranking ? 'AI評価中…' : 'AIで候補を再評価'}</button>
      </div>
    </section>

    <div className="segmented">
      {(['all', 'x', 'instagram'] as const).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'すべて' : item === 'x' ? 'X' : 'Instagram'}</button>)}
    </div>
    {visible.length > 0 ? <>
      <div className="card-stack">{shown.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} onOpen={onOpen} onLater={snoozeCandidate} onEditDraft={editDraft} />)}</div>
      {!expanded && visible.length > CAP && <button className="list-more-button" onClick={() => setExpanded(true)}>もっと見る (+{visible.length - CAP}件)</button>}
    </> : <DiscoverEmptyState filter={filter} storedCount={storedCount} snoozedCount={snoozedCount} />}
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

function CandidateCard({ candidate, onOpen, onLater, onEditDraft, featured = false }: { candidate: Candidate; onOpen: (c: Candidate) => void; onLater: (c: Candidate) => void; onEditDraft: (id: string, draft: string) => void; featured?: boolean }) {
  const buttonLabel = candidate.recommendedAction === 'reply' ? `${platformLabel(candidate.platform)}で返信` : candidate.recommendedAction === 'unfollow_review' ? `${platformLabel(candidate.platform)}で整理確認` : `${platformLabel(candidate.platform)}で見る`;
  // Buffer edits locally and only commit (onEditDraft -> full setState -> localStorage
  // write) on blur, same pattern as the Mission/Me text fields, so typing a draft
  // doesn't serialize the entire app state to localStorage on every keystroke.
  const [draftText, setDraftText] = useState(candidate.draft ?? '');
  useEffect(() => { setDraftText(candidate.draft ?? ''); }, [candidate.aiDraft]);
  return <article className={featured ? 'candidate-card featured' : 'candidate-card'}>
    <div className="candidate-head">
      <div className={`platform-avatar ${candidate.platform}`}>{candidate.platform === 'x' ? 'X' : '◎'}</div>
      <div className="candidate-identity"><strong>{candidate.displayName}{candidate.verified ? ' ✓' : ''}</strong><span>@{candidate.username} · {kindLabel[candidate.kind]}</span></div>
      <div className="match-score"><strong>{candidate.match}</strong><small>一致度</small></div>
    </div>
    {candidate.bio && <p className="candidate-bio">{candidate.bio}</p>}
    {candidate.publicMetrics && <div className="profile-metrics"><span><b>{compactNumber(candidate.publicMetrics.followers)}</b> フォロワー</span><span><b>{compactNumber(candidate.publicMetrics.posts)}</b> 投稿</span></div>}
    <p className="reason">{candidate.reason}</p>
    {candidate.strategy && <div className="strategy-note"><span>AIの提案</span><p>{candidate.strategy}</p></div>}
    <div className="tags">{candidate.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
    {candidate.aiDraft !== undefined && <div className="draft-box">
      <span>AI返信案 · 編集できます</span>
      <textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} onBlur={() => onEditDraft(candidate.id, draftText)} rows={3} />
      <div className="draft-box-actions">
        {draftText !== candidate.aiDraft && <button className="ghost-button" onClick={() => { setDraftText(candidate.aiDraft!); onEditDraft(candidate.id, candidate.aiDraft!); }}>元のAI案に戻す</button>}
        <button disabled={!draftText} onClick={() => copyDraft(draftText)}>コピー</button>
      </div>
    </div>}
    <div className="candidate-actions">
      <button className="secondary-button" onClick={() => onLater(candidate)}>明日へ</button>
      <button className="primary-button" onClick={() => onOpen(candidate)}>{buttonLabel}<span>↗</span></button>
    </div>
  </article>;
}

function Relations({ state, onOpen, onChange }: { state: AppState; onOpen: (c: Candidate) => void; onChange: (state: AppState) => void }) {
  const [expanded, setExpanded] = useState(false);
  const following = state.candidates.filter((candidate) => candidate.stage !== 'discovered');
  const cleanup = following.filter((candidate) => candidate.recommendedAction === 'unfollow_review');
  const CAP = 10;
  const shown = expanded ? following : following.slice(0, CAP);
  return <>
    <PageHeading eyebrow="RELATIONS" title="関係を育てる" text="フォロー数ではなく、関係の深まりと整理タイミングを覚えておきます。" />
    {following.length === 0 ? <RelationsEmptyState /> : <>
      <div className="relation-summary">
        <div><strong>{following.length}</strong><span>つながり中</span></div>
        <div><strong>{following.filter((c) => c.followBack === true).length}</strong><span>相互フォロー</span></div>
        <div><strong>{cleanup.length}</strong><span>整理候補</span></div>
      </div>
      {cleanup.length > 0 && <section className="cleanup-banner"><span className="eyebrow">フォロー整理レビュー</span><strong>{cleanup.length}人を整理候補として確認</strong><p>自動解除はしません。Mission一致度と交流履歴を見て、公式アプリで最終判断します。</p></section>}
      <div className="relation-list">{shown.map((candidate) => <article className={candidate.recommendedAction === 'unfollow_review' ? 'relation-card review' : 'relation-card'} key={candidate.id}>
        <button className="relation-main" onClick={() => onOpen(candidate)}>
          <div className={`mini-avatar ${candidate.platform}`}>{candidate.platform === 'x' ? 'X' : '◎'}</div>
          <div><strong>{candidate.displayName}</strong><span>@{candidate.username} · {stageLabel[candidate.stage]}</span></div>
          <div className="relation-score">{candidate.relationshipScore}<small>関係度</small></div>
        </button>
        {candidate.strategy && <p className="relation-advice">{candidate.strategy}</p>}
        <span className="followback-label">フォロー状況を記録</span>
        <div className="followback-controls" role="group" aria-label={`${candidate.username} follow back status`}>
          <button className={candidate.followBack === true ? 'active' : ''} onClick={() => onChange(setFollowBackStatus(state, candidate.id, true))}>相互</button>
          <button className={candidate.followBack === false ? 'active warn' : ''} onClick={() => onChange(setFollowBackStatus(state, candidate.id, false))}>フォロバなし</button>
          <button className={candidate.followBack == null ? 'active' : ''} onClick={() => onChange(setFollowBackStatus(state, candidate.id, null))}>未確認</button>
        </div>
      </article>)}</div>
      {!expanded && following.length > CAP && <button className="list-more-button" onClick={() => setExpanded(true)}>もっと見る (+{following.length - CAP}件)</button>}
    </>}
  </>;
}

function RelationsEmptyState() {
  return <section className="form-card"><div className="field-title"><div><strong>まだつながりがありません</strong><span>Discoverで見つけた人にフォロー・交流などのアクションを行うと、ここに関係の記録が表示されます。</span></div><b>◎</b></div></section>;
}

function Me({ state, onAnalyze, analyzing, apiNote, apiNoteIsError, onSaveDraft }: { state: AppState; onAnalyze: (profile: string, posts: string) => void; analyzing: boolean; apiNote: string; apiNoteIsError: boolean; onSaveDraft: (profile: string, posts: string) => void }) {
  const [profile, setProfile] = useState(state.selfProfile.profileText);
  const [posts, setPosts] = useState(state.selfProfile.recentPostsText);
  const score = state.selfProfile.score;

  useEffect(() => {
    setProfile(state.selfProfile.profileText);
    setPosts(state.selfProfile.recentPostsText);
  }, [state.selfProfile.profileText, state.selfProfile.recentPostsText]);

  return <>
    <PageHeading eyebrow="ME" title="自分もMissionに近づける" text="相手探しだけでなく、自分のプロフィールと投稿の状態もAIが見ます。" />
    <section className="score-card"><div><span>Missionスコア</span><strong>{score == null ? '—' : score}</strong>{score != null && <small>/100</small>}</div><p>{state.selfProfile.summary || 'まだ未測定です。プロフィールや最近の投稿を入れると、Missionから現在地と次の改善点を評価します。'}</p></section>
    <section className="form-card self-analysis-card">
      <label>現在のプロフィール<textarea value={profile} onChange={(event) => setProfile(event.target.value)} onBlur={() => onSaveDraft(profile, posts)} placeholder="X / Instagramのプロフィール文を貼り付け" /></label>
      <label>最近の投稿<textarea value={posts} onChange={(event) => setPosts(event.target.value)} onBlur={() => onSaveDraft(profile, posts)} placeholder="最近の投稿を数件まとめて貼り付け" /></label>
      <button className="primary-button" disabled={analyzing} onClick={() => onAnalyze(profile, posts)}>{analyzing && <i className="spinner" aria-hidden="true" />}{analyzing ? '分析中…' : 'Missionから自己分析'}</button>
      {apiNote && <p className={apiNoteIsError ? 'form-note error' : 'form-note'}>{apiNote}</p>}
    </section>
    {state.selfProfile.strategy && <section className="coach-card self-result"><div className="coach-icon">↗</div><div><span className="eyebrow">次の作戦</span><h3>目的地へ近づく作戦</h3><p>{state.selfProfile.strategy}</p></div></section>}
    {state.selfProfile.profileRewrite && <section className="form-card rewrite-card"><div className="field-title"><div><strong>プロフィール改善案</strong><span>事実を足さず、Missionへの入口を分かりやすくする</span></div><b>AI</b></div><p>{state.selfProfile.profileRewrite}</p><button className="secondary-button" onClick={() => copyDraft(state.selfProfile.profileRewrite!)}>コピー</button></section>}
    <div className="insight-list">{state.insights.map((insight) => <article className="insight-card" key={insight.id}><div className={`priority ${insight.priority}`} /><div><span>{insightCategoryLabel[insight.category]}</span><strong>{insight.title}</strong><p>{insight.body}</p></div></article>)}</div>
  </>;
}

function Settings({ state, onChange, onOpenManual }: { state: AppState; onChange: (state: AppState) => void; onOpenManual: () => void }) {
  const [missionText, setMissionText] = useState(state.mission.text);
  const [primaryGoal, setPrimaryGoal] = useState(state.mission.primaryGoal);
  const [communicationDNA, setCommunicationDNA] = useState(state.mission.communicationDNA);
  const [budget, setBudget] = useState(state.budget.monthlyLimitUsd);
  const [followBackDays, setFollowBackDays] = useState(state.relationshipPolicy.followBackReviewAfterDays);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 2200);
    return () => clearTimeout(timer);
  }, [justSaved]);

  function persist() {
    let next = updateMission(state, { ...state.mission, text: missionText, primaryGoal, communicationDNA });
    next = { ...next, budget: { ...next.budget, monthlyLimitUsd: Math.max(0, budget), hardLimit: true } };
    next = updateRelationshipPolicy(next, { ...next.relationshipPolicy, followBackReviewAfterDays: Math.max(7, Math.min(90, Math.round(followBackDays || 30))) });
    onChange(next);
    setJustSaved(true);
  }

  function saveMissionField() {
    onChange(updateMission(state, { ...state.mission, text: missionText, primaryGoal, communicationDNA }));
  }

  function saveBudget() {
    onChange({ ...state, budget: { ...state.budget, monthlyLimitUsd: Math.max(0, budget), hardLimit: true } });
  }

  function saveFollowBackDays() {
    onChange(updateRelationshipPolicy(state, { ...state.relationshipPolicy, followBackReviewAfterDays: Math.max(7, Math.min(90, Math.round(followBackDays || 30))) }));
  }

  return <>
    <PageHeading eyebrow="SETTINGS" title="AIに目的地を教える" text="この設定が候補選び・交流文・自己改善の判断軸になります。" />
    <section className="form-card">
      <div className="field-title"><div><strong>アプリの使い方が分からないときは</strong><span>5つのタブの役割と、基本の流れをいつでも見返せます</span></div><b>？</b></div>
      <button className="secondary-button" onClick={onOpenManual}>使い方ガイドを見る</button>
    </section>
    <section className="form-card">
      <button type="button" className="policy-toggle" onClick={() => onChange(updateRelationshipPolicy(state, { ...state.relationshipPolicy, autoDraftReplies: !(state.relationshipPolicy.autoDraftReplies !== false) }))}>
        <span><strong>返信文案を自動で提案する</strong><small>AI再評価のとき、返信・DMが適切な候補に下書き文を自動生成します(1回の評価につき最大5件)。オフでも評価自体は行われますが下書きは作られません。送信は引き続きご自身で公式アプリから行います。</small></span>
        <span className={state.relationshipPolicy.autoDraftReplies !== false ? 'toggle on' : 'toggle'} />
      </button>
    </section>
    <section className="form-card">
      <label>Mission<textarea value={missionText} onChange={(event) => setMissionText(event.target.value)} onBlur={saveMissionField} /></label>
      <label>最優先ゴール<input value={primaryGoal} onChange={(event) => setPrimaryGoal(event.target.value)} onBlur={saveMissionField} /></label>
      <label>Communication DNA<textarea value={communicationDNA} onChange={(event) => setCommunicationDNA(event.target.value)} onBlur={saveMissionField} /></label>
      <label>月間AI / API予算 <span className="inline-value">${budget.toFixed(2)}</span><input className="range" type="range" min="0" max="10" step="0.5" value={budget} onChange={(event) => setBudget(Number(event.target.value))} onBlur={saveBudget} /></label>
      <label>フォローバック整理レビュー <span className="inline-value">{followBackDays}日後</span><input className="range" type="range" min="7" max="90" step="1" value={followBackDays} onChange={(event) => setFollowBackDays(Number(event.target.value))} onBlur={saveFollowBackDays} /></label>
      <div className="hard-limit"><span>HARD LIMIT</span><strong>ON</strong><p>この上限を超える有料API処理は実行しません。</p></div>
      <button className="primary-button" onClick={persist}>設定を保存</button>
      {justSaved && <p className="form-note success">保存しました</p>}
    </section>
    <BackupControls state={state} onRestore={onChange} />
  </>;
}

function PageHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <header className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></header>;
}

function ResultSheet({ candidate, onResolve }: { candidate: Candidate; onResolve: (action: 'followed' | 'skipped' | 'later' | 'kept') => void }) {
  const cleanup = candidate.recommendedAction === 'unfollow_review';
  const dismiss = () => onResolve('later');
  const containerRef = useModalA11y<HTMLElement>(dismiss);
  return <div className="sheet-backdrop" onClick={dismiss}><section ref={containerRef} className="result-sheet" role="dialog" aria-modal="true" aria-label={`${candidate.username}の結果を記録`} tabIndex={-1} onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><span className="eyebrow">おかえりなさい</span><h2>@{candidate.username} はどうしました？</h2><p>{cleanup ? 'フォロー整理の最終操作は公式SNS側で行います。ここでは継続・解除の判断だけ記録します。' : '最終操作は公式SNS側で行います。ここでは関係性履歴だけ記録します。'}</p><div className="sheet-actions">{cleanup ? <><button onClick={() => onResolve('kept')}>フォローを継続する</button><button onClick={() => onResolve('skipped')}>フォロー解除した</button><button className="muted" onClick={() => onResolve('later')}>後で</button></> : <><button onClick={() => onResolve('followed')}>フォローした</button><button onClick={() => onResolve('kept')}>交流した / 継続</button><button onClick={() => onResolve('skipped')}>今回は見送る</button><button className="muted" onClick={() => onResolve('later')}>後で</button></>}</div></section></div>;
}

function compactNumber(value?: number) {
  const number = value || 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

export default App;
