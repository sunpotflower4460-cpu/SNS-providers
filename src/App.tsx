import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeSelfProfile, apiConfigured, discoverSocialCandidates, enrichXProfiles, fetchBudget, rankCandidates } from './api';
import BackupControls from './BackupControls';
import { getSyncToken } from './controlToken';
import DailyQueue from './DailyQueue';
import { buildDailyQueue, queueSummary } from './daily';
import { mergeDiscoveredProfiles } from './discoveryStore';
import Manual from './Manual';
import Onboarding from './Onboarding';
import { hasSeenOnboarding, markOnboardingSeen } from './onboarding';
import { resolveVisibleResult } from './resultResolution';
import { addCandidateFromReference, applyRankResults, applySelfAnalysis, applyXProfiles, loadState, saveState, setFollowBackStatus, syncBudget, updateCandidateDraft, updateMission, updateRelationshipPolicy, updateSelfProfileInputs } from './store';
import { copyDraft, daysSinceTimestamp, engagementSurfaceLabel, openCandidate, platformLabel, staleConversationCue } from './social';
import type { AppState, AppStateUpdater, Candidate, Platform } from './types';
import { useLocalDayKey } from './useLocalDay';
import { useModalA11y } from './useModalA11y';

type Tab = 'today' | 'discover' | 'relations' | 'me' | 'settings';

const tabs: { id: Tab; icon: string; label: string }[] = [
  { id: 'today', icon: '⌂', label: '今日' },
  { id: 'discover', icon: '＋', label: '探す' },
  { id: 'relations', icon: '◎', label: '関係' },
  { id: 'me', icon: '◐', label: '自分' },
  { id: 'settings', icon: '⚙', label: '設定' },
];

const kindLabel: Record<Candidate['kind'], string> = {
  fan: 'ファン候補', artist: 'アーティスト仲間', creator: 'クリエイター', media: 'メディア', venue: '活動機会', other: '候補',
};

const stageLabel: Record<Candidate['stage'], string> = {
  discovered: '未接触',
  interested: '気になる',
  following: 'フォロー中',
  engaged: '接点あり',
  recognized: '認識済み',
  conversation: '会話中',
  relationship: '関係あり',
};

const actionLabel: Record<Candidate['recommendedAction'], string> = {
  follow: 'フォロー',
  like: 'いいね',
  reply: '返信',
  dm: 'DM',
  review: '確認',
  unfollow_review: 'フォロー整理',
};

const insightCategoryLabel = {
  profile: 'プロフィール',
  content: '投稿',
  network: 'つながり',
} as const;

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
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  const [showManual, setShowManual] = useState(false);
  const [autoRetryTick, setAutoRetryTick] = useState(0);
  const autoReplenishingRef = useRef(false);
  const autoReplenishAttemptKeyRef = useRef('');
  const autoReplenishRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localDay = useLocalDayKey();
  const statusNote = persistenceError || apiNote;

  useEffect(() => {
    const saved = saveState(state);
    setPersistenceError(saved.ok ? '' : saved.reason);
  }, [state]);

  useEffect(() => () => {
    if (autoReplenishRetryTimerRef.current) clearTimeout(autoReplenishRetryTimerRef.current);
  }, []);

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

  useEffect(() => {
    if (state.relationshipPolicy.autoReplenishEnabled === false
      || !apiConfigured
      || !getSyncToken().trim()
      || discovering
      || ranking
      || enrichingX
      || autoReplenishingRef.current) return;

    const demand = autoReplenishDemand(state);
    if (demand.remainingTarget <= 0 || demand.current >= demand.lowWater) return;

    const missionKey = JSON.stringify([
      state.mission.primaryGoal,
      state.mission.text,
      state.mission.secondaryGoals,
      state.mission.communicationDNA,
    ]);
    const attemptKey = `${localDay}:${missionKey}`;
    if (autoReplenishAttemptKeyRef.current === attemptKey) return;

    const snapshot = state;
    const now = Date.now();
    const existingRankTargets = snapshot.candidates.filter((candidate) => {
      if (candidate.skipped
        || candidate.recommendedAction !== 'review'
        || !candidate.reason.startsWith('無料Web検索から候補')) return false;
      if (!candidate.snoozedUntil) return true;
      const until = new Date(candidate.snoozedUntil).getTime();
      return !Number.isFinite(until) || until <= now;
    });

    autoReplenishAttemptKeyRef.current = attemptKey;
    autoReplenishingRef.current = true;

    const clearRetryTimer = () => {
      if (!autoReplenishRetryTimerRef.current) return;
      clearTimeout(autoReplenishRetryTimerRef.current);
      autoReplenishRetryTimerRef.current = null;
    };
    const scheduleRetry = (delayMs = 10 * 60 * 1000) => {
      clearRetryTimer();
      autoReplenishRetryTimerRef.current = setTimeout(() => {
        if (autoReplenishAttemptKeyRef.current === attemptKey) autoReplenishAttemptKeyRef.current = '';
        autoReplenishRetryTimerRef.current = null;
        setAutoRetryTick((current) => current + 1);
      }, Math.max(1_000, delayMs));
    };

    if (existingRankTargets.length) {
      setRanking(true);
      setApiNote(`未評価候補 ${existingRankTargets.length}件を無料で自動評価中…`);
      void (async () => {
        try {
          const ranked = await rankCandidates(snapshot.mission, existingRankTargets, snapshot.budget.monthlyLimitUsd, 'local-user', false);
          // autoDraftReplies must not change rankCandidates' argument list here: it is
          // pinned verbatim by scripts/verify-action-supply-invariants.mjs. Honor the
          // toggle by stripping drafts from the response instead.
          const rankedResults = snapshot.relationshipPolicy.autoDraftReplies === false
            ? ranked.results.map((result) => ({ ...result, draft: undefined }))
            : ranked.results;
          setState((current) => applyRankResults(current, rankedResults, ranked.costUsd));
          clearRetryTimer();
          // Free ranking is capped at 30 per request. Clearing the attempt key allows the
          // next untouched batch to continue without issuing another Tavily search.
          autoReplenishAttemptKeyRef.current = '';
          setApiNote(`自動評価完了 · ${ranked.provider}で${ranked.results.length}件評価 · $0`);
        } catch (error) {
          scheduleRetry();
          setApiNote(error instanceof Error ? `自動評価: ${error.message}` : '自動候補評価に失敗しました');
        } finally {
          autoReplenishingRef.current = false;
          setRanking(false);
        }
      })();
      return;
    }

    setDiscovering(true);
    setRanking(true);
    setApiNote(`実行可能候補 ${demand.current}/${demand.remainingTarget}件 · 無料で自動補充中…`);

    void (async () => {
      let discoverySucceeded = false;
      try {
        const discovered = await discoverSocialCandidates(snapshot.mission, 'local-user', true);
        if (!discovered.enabled) {
          if (discovered.retryAfterSeconds) scheduleRetry(discovered.retryAfterSeconds * 1000);
          setApiNote(discovered.reason || '自動候補補充は現在利用できません');
          return;
        }
        discoverySucceeded = true;

        const merged = mergeDiscoveredProfiles(snapshot, discovered.profiles);
        const addedCount = Math.max(0, merged.candidates.length - snapshot.candidates.length);
        // Persist free-search yield immediately. If the later free ranking request fails,
        // the discovered profiles remain available and the retry path can rank them
        // without spending another Tavily search credit.
        setState((current) => mergeDiscoveredProfiles(current, discovered.profiles));

        const rankTargets = merged.candidates.filter((candidate) => {
          if (candidate.skipped
            || candidate.recommendedAction !== 'review'
            || !candidate.reason.startsWith('無料Web検索から候補')) return false;
          if (!candidate.snoozedUntil) return true;
          const until = new Date(candidate.snoozedUntil).getTime();
          return !Number.isFinite(until) || until <= now;
        });

        if (!rankTargets.length) {
          clearRetryTimer();
          setApiNote(`自動補充完了 · 新規${addedCount}件 · 追加評価対象なし · $0`);
          return;
        }

        // Automatic replenishment is explicitly free-only. Free Groq may be used when
        // configured; otherwise the Worker falls back to deterministic local ranking.
        const ranked = await rankCandidates(merged.mission, rankTargets, merged.budget.monthlyLimitUsd, 'local-user', false);
        // autoDraftReplies must not change rankCandidates' argument list here: it is
        // pinned verbatim by scripts/verify-action-supply-invariants.mjs. Honor the
        // toggle by stripping drafts from the response instead.
        const rankedResults = merged.relationshipPolicy.autoDraftReplies === false
          ? ranked.results.map((result) => ({ ...result, draft: undefined }))
          : ranked.results;
        setState((current) => {
          const withDiscovery = mergeDiscoveredProfiles(current, discovered.profiles);
          return applyRankResults(withDiscovery, rankedResults, ranked.costUsd);
        });
        clearRetryTimer();
        // Discovery can yield up to 40 profiles while one free ranking call handles 30.
        // Continue with the remaining saved profiles, but do not reopen another search.
        if (rankTargets.length > ranked.results.length) autoReplenishAttemptKeyRef.current = '';
        setApiNote(`自動補充完了 · 新規${addedCount}件 · ${ranked.provider}で${ranked.results.length}件評価 · $0`);
      } catch (error) {
        // A successful discovery is already persisted above. Retrying later will first
        // evaluate those untouched profiles rather than issuing another search.
        scheduleRetry();
        setApiNote(error instanceof Error
          ? `${discoverySucceeded ? '自動評価' : '自動補充'}: ${error.message}`
          : discoverySucceeded ? '自動候補評価に失敗しました' : '自動候補補充に失敗しました');
      } finally {
        autoReplenishingRef.current = false;
        setDiscovering(false);
        setRanking(false);
      }
    })();
  }, [autoRetryTick, localDay, state, discovering, ranking, enrichingX]);

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
    const relationshipDone = state.interactions.filter((interaction) => {
      const at = new Date(interaction.at);
      return interaction.action !== 'review' && sameLocalDay(at, now);
    }).length;
    const selfDone = state.selfProfile.analyzedAt && sameLocalDay(new Date(state.selfProfile.analyzedAt), now) ? 1 : 0;
    return relationshipDone + selfDone;
  }, [state.interactions, state.selfProfile.analyzedAt, localDay]);

  function onOpen(candidate: Candidate) {
    setPending(candidate);
    openCandidate(candidate);
  }

  function resolvePending(action: 'followed' | 'skipped' | 'later' | 'kept') {
    if (!pending) return;
    if (action !== 'later') setState((current) => resolveVisibleResult(current, pending, action));
    setPending(null);
  }

  async function rerankCandidates() {
    if (!apiConfigured) {
      setApiNote('Worker URLを設定するとAI再評価が使えます');
      return;
    }
    if (discovering || ranking || enrichingX) {
      setApiNote('別の候補処理が終わってから再評価してください');
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
      const result = await rankCandidates(state.mission, targets, state.budget.monthlyLimitUsd, 'local-user', true, state.relationshipPolicy.autoDraftReplies !== false);
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
    if (discovering || ranking || enrichingX) {
      setApiNote('別の候補処理が終わってから探索してください');
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
    if (discovering || ranking || enrichingX) {
      setApiNote('別の候補処理が終わってからX公式情報を更新してください');
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
        <div className="brand-mark" aria-hidden="true">S</div>
        <div className="topbar-copy">
          <strong>Social Mission</strong>
          <span className="status-line" title={statusNote}><i aria-hidden="true" />{statusNote}</span>
        </div>
        <div className="topbar-actions">
          <button className="help-button" onClick={() => setShowManual(true)} aria-label="使い方ガイドを開く">？</button>
          <BudgetPill state={state} />
        </div>
      </header>

      <main className="page">
        {tab === 'today' && <Today state={state} doneToday={doneToday} onOpen={onOpen} onTab={setTab} />}
        {tab === 'discover' && <Discover state={state} candidates={active} onOpen={onOpen} onChange={setState} onDiscover={discoverCandidates} onRerank={rerankCandidates} onEnrichX={enrichXCandidates} discovering={discovering} ranking={ranking} enrichingX={enrichingX} apiNote={statusNote} />}
        {tab === 'relations' && <Relations state={state} onOpen={onOpen} onChange={setState} />}
        {tab === 'me' && <Me state={state} onAnalyze={analyzeMe} analyzing={analyzingSelf} />}
        {tab === 'settings' && <Settings state={state} onChange={setState} onOpenManual={() => setShowManual(true)} />}
      </main>

      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {tabs.map((item) => (
          <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setTab(item.id)}>
            <span aria-hidden="true">{item.icon}</span><small>{item.label}</small>
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
  const freeOnly = state.budget.monthlyLimitUsd === 0;
  const hasSpend = state.budget.usedUsd > 0.00001;
  return <div className="budget-pill" title="今月のAI / API利用額">
    <small>今月</small>
    <strong>{freeOnly && !hasSpend ? '無料運用' : `$${state.budget.usedUsd.toFixed(2)}`}</strong>
    {freeOnly ? (hasSpend && <span>有料処理OFF</span>) : <span>/ ${state.budget.monthlyLimitUsd.toFixed(0)}</span>}
  </div>;
}

function Today({ state, doneToday, onOpen, onTab }: {
  state: AppState; doneToday: number; onOpen: (c: Candidate) => void; onTab: (tab: Tab) => void;
}) {
  const rawQueue = buildDailyQueue(state);
  const hasCandidates = state.candidates.some((candidate) => !candidate.skipped);
  const queue = hasCandidates ? rawQueue : [];
  const summary = queueSummary(queue);
  const configuredLimit = Math.max(1, state.relationshipPolicy.dailyQueueLimit ?? 30);
  const plannedTotal = hasCandidates ? Math.min(configuredLimit, doneToday + queue.length) : 0;
  const progress = plannedTotal > 0 ? Math.min(100, Math.round((doneToday / plannedTotal) * 100)) : 0;
  const queuedFollowIds = new Set(queue.filter((item) => item.action === 'follow').map((item) => item.candidateId));
  const followOverflowCount = hasCandidates
    ? state.candidates.filter((candidate) => !candidate.skipped
      && candidate.recommendedAction === 'follow'
      && !queuedFollowIds.has(candidate.id)
      && (!candidate.snoozedUntil || new Date(candidate.snoozedUntil).getTime() <= Date.now())).length
    : 0;

  return <>
    <section className="mission-card">
      <div className="mission-topline">
        <span className="section-kicker">今日のゴール</span>
        <button className="text-button" onClick={() => onTab('settings')}>目的を編集</button>
      </div>
      <h1>{state.mission.primaryGoal}</h1>
      <p>{state.mission.text}</p>
      <div className="mission-progress-head"><span>今日の進捗</span><strong>{hasCandidates ? `${doneToday} / ${plannedTotal}` : '準備前'}</strong></div>
      <div className="mission-progress" aria-label={`今日の進捗 ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
      <div className="today-summary" aria-label="今日の残り内訳">
        <span><b>{queue.length}</b>残り</span>
        <span><b>{summary.connect}</b>新規</span>
        <span><b>{summary.engage}</b>交流</span>
        <span><b>{summary.cleanup}</b>整理</span>
      </div>
    </section>

    <DailyQueue state={state} onOpenCandidate={onOpen} onOpenMe={() => onTab('me')} onOpenDiscover={() => onTab('discover')} onOpenSettings={() => onTab('settings')} />

    {followOverflowCount > 0 && <section className="follow-overflow-card">
      <div>
        <span className="section-kicker">フォロー候補</span>
        <strong>ほかに{followOverflowCount}人</strong>
        <p>Todayには新規フォローを最大{state.relationshipPolicy.dailyConnectionLimit ?? 20}件だけ混ぜています。残りは探すで一覧できます。</p>
      </div>
      <button className="secondary-button" onClick={() => onTab('discover')}>フォロー一覧を見る</button>
    </section>}

    {state.insights[0] && <section className="coach-card">
      <div className="coach-icon">✦</div>
      <div><span className="section-kicker">AIからのヒント</span><h3>{state.insights[0].title}</h3><p>{state.insights[0].body}</p></div>
      <button onClick={() => onTab('me')}>詳しく</button>
    </section>}
  </>;
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
  const [actionFilter, setActionFilter] = useState<'all' | 'follow' | 'reply' | 'like'>('all');
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [reference, setReference] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(12);
  const visible = candidates.filter((candidate) => {
    if (filter !== 'all' && candidate.platform !== filter) return false;
    if (actionFilter === 'all') return true;
    return candidate.recommendedAction === actionFilter;
  });
  const displayed = visible.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, visible.length - displayed.length);
  const now = Date.now();
  const matchesFilter = (candidate: Candidate) => filter === 'all' || candidate.platform === filter;
  const snoozedCount = state.candidates.filter((candidate) => {
    if (candidate.skipped || !matchesFilter(candidate) || !candidate.snoozedUntil) return false;
    const until = new Date(candidate.snoozedUntil).getTime();
    return Number.isFinite(until) && until > now;
  }).length;
  const storedCount = state.candidates.filter((candidate) => !candidate.skipped && matchesFilter(candidate)).length;
  const candidateOperationBusy = discovering || ranking || enrichingX;
  const actionCount = (action: 'follow' | 'reply' | 'like') => candidates.filter((candidate) => matchesFilter(candidate) && candidate.recommendedAction === action).length;

  useEffect(() => setVisibleLimit(12), [filter, actionFilter]);

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

  function editDraft(candidateId: string, draft: string) {
    onChange((current) => updateCandidateDraft(current, candidateId, draft));
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
    <PageHeading eyebrow="探す" title="つながる相手を見つける" text="基本は自動探索だけでOKです。見つかった候補はMissionとの相性順に並びます。" />

    <section className="discover-primary-card">
      <div className="discover-primary-copy">
        <span className="section-kicker">おすすめ</span>
        <h2>Missionから自動で探す</h2>
        <p>XとInstagramの公開情報から、今の目的に合う相手を探します。最終フォローや返信は公式SNSであなたが行います。</p>
      </div>
      <button className="discovery-button" disabled={candidateOperationBusy} onClick={onDiscover}>
        <span>✦</span>
        <strong>{discovering ? '候補を探しています…' : '新しい候補を探す'}</strong>
        <small>無料探索を優先 · X / Instagram</small>
      </button>
      <div className="operation-status"><span aria-hidden="true" />{apiNote}</div>
    </section>

    <div className="discover-tools">
      <details className="disclosure-card">
        <summary><span><strong>自分で候補を追加</strong><small>URLや @username が分かっているとき</small></span><b>＋</b></summary>
        <div className="disclosure-body">
          <div className="mini-segmented" role="group" aria-label="追加するSNS">
            <button aria-pressed={platform === 'instagram'} className={platform === 'instagram' ? 'active' : ''} onClick={() => setPlatform('instagram')}>Instagram</button>
            <button aria-pressed={platform === 'x'} className={platform === 'x' ? 'active' : ''} onClick={() => setPlatform('x')}>X</button>
          </div>
          <div className="import-row"><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="プロフィールURL または @username" /><button onClick={() => addReference()}>追加</button></div>
          <button className="secondary-button full" onClick={addFromClipboard}>クリップボードから読み取る</button>
        </div>
      </details>

      <details className="disclosure-card">
        <summary><span><strong>候補情報を更新・再評価</strong><small>普段は自動判断に任せてOK</small></span><b>↻</b></summary>
        <div className="disclosure-body advanced-actions">
          <button className="secondary-button" disabled={candidateOperationBusy} onClick={onEnrichX}>{enrichingX ? 'X公式情報を確認中…' : 'X公式情報を更新'}</button>
          <button className="primary-button" disabled={candidateOperationBusy} onClick={onRerank}>{ranking ? 'AIで再評価中…' : '候補をAIで再評価'}</button>
          <p>公式情報が変わった候補や、判断材料が増えた候補を更新したい場合に使います。</p>
        </div>
      </details>
    </div>

    <div className="candidate-list-head">
      <div><span className="section-kicker">候補</span><strong>{visible.length}人</strong></div>
      <div className="segmented" role="group" aria-label="候補のSNS絞り込み">
        {(['all', 'x', 'instagram'] as const).map((item) => <button key={item} aria-pressed={filter === item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'すべて' : item === 'x' ? 'X' : 'Instagram'}</button>)}
      </div>
    </div>
    <div className="action-filter" role="group" aria-label="おすすめ操作で絞り込み">
      {([
        ['all', 'すべて', candidates.filter((candidate) => filter === 'all' || candidate.platform === filter).length],
        ['follow', 'フォロー', actionCount('follow')],
        ['reply', '返信', actionCount('reply')],
        ['like', 'いいね', actionCount('like')],
      ] as const).map(([item, label, count]) => (
        <button key={item} aria-pressed={actionFilter === item} className={actionFilter === item ? 'active' : ''} onClick={() => setActionFilter(item)}>
          {label}{item !== 'all' ? ` ${count}` : ''}
        </button>
      ))}
    </div>
    {visible.length > 0 ? <>
      <div className="card-stack">{displayed.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} onOpen={onOpen} onLater={snoozeCandidate} onEditDraft={editDraft} />)}</div>
      {hiddenCount > 0 && <button className="load-more-button" onClick={() => setVisibleLimit((current) => Math.min(visible.length, current + 12))}>
        <span>次の{Math.min(12, hiddenCount)}人を見る</span><small>{displayed.length} / {visible.length}人を表示中</small>
      </button>}
    </> : <DiscoverEmptyState filter={filter} actionFilter={actionFilter} storedCount={storedCount} snoozedCount={snoozedCount} />}
  </>;
}

function DiscoverEmptyState({ filter, actionFilter, storedCount, snoozedCount }: {
  filter: 'all' | 'x' | 'instagram';
  actionFilter: 'all' | 'follow' | 'reply' | 'like';
  storedCount: number;
  snoozedCount: number;
}) {
  const platform = filter === 'all' ? '候補' : filter === 'x' ? 'X候補' : 'Instagram候補';
  const actionLabel = actionFilter === 'follow' ? 'フォロー候補' : actionFilter === 'reply' ? '返信候補' : actionFilter === 'like' ? 'いいね候補' : platform;
  if (snoozedCount > 0 && storedCount === snoozedCount) {
    return <section className="empty-state"><div>✓</div><strong>今日はここまで</strong><p>{snoozedCount}件の{platform}を明日へ移動済みです。日付が変わると自動で候補へ戻ります。</p></section>;
  }
  if (storedCount === 0) {
    return <section className="empty-state"><div>＋</div><strong>{platform}はまだありません</strong><p>上の「新しい候補を探す」から始めるのがおすすめです。設定のX/Instagram同期やURL追加でも足せます。実在しない人は出しません。</p></section>;
  }
  if (actionFilter !== 'all') {
    return <section className="empty-state"><div>○</div><strong>今の{actionLabel}はありません</strong><p>ほかのおすすめ操作やSNS絞り込みを変えると、残りの候補が見えます。</p></section>;
  }
  return <section className="empty-state"><div>○</div><strong>今日表示する{platform}はありません</strong><p>見送った候補と明日送りの候補は、今日の一覧から外れています。</p></section>;
}

function CandidateCard({ candidate, onOpen, onLater, onEditDraft, featured = false }: { candidate: Candidate; onOpen: (c: Candidate) => void; onLater: (c: Candidate) => void; onEditDraft: (id: string, draft: string) => void; featured?: boolean }) {
  const buttonLabel = candidateActionButtonLabel(candidate);
  const detailsAvailable = Boolean(candidate.strategy || candidate.publicMetrics || candidate.tags.length);
  const surface = engagementSurfaceLabel(candidate.platform, candidate.engagementUrl);
  const staleCue = staleConversationCue(daysSinceTimestamp(candidate.lastInteractionAt));
  // Buffer edits locally and commit (onEditDraft -> full state write) only on blur, so
  // typing doesn't serialize the whole app state to localStorage on every keystroke.
  const [draftText, setDraftText] = useState(candidate.draft ?? '');
  useEffect(() => setDraftText(candidate.draft ?? ''), [candidate.draft]);
  return <article className={featured ? 'candidate-card featured' : 'candidate-card'}>
    <div className="candidate-context">
      <span className={`action-pill action-${candidate.recommendedAction}`}>おすすめ · {actionLabel[candidate.recommendedAction]}</span>
      <span className="match-inline">相性 <b>{candidate.match}</b></span>
    </div>
    <div className="candidate-head">
      <div className={`platform-avatar ${candidate.platform}`}>{candidate.platform === 'x' ? 'X' : '◎'}</div>
      <div className="candidate-identity"><strong>{candidate.displayName}{candidate.verified ? ' ✓' : ''}</strong><span>@{candidate.username} · {kindLabel[candidate.kind]}</span></div>
    </div>
    {staleCue && <p className="stale-cue">{staleCue}</p>}
    {surface && (candidate.recommendedAction === 'reply' || candidate.recommendedAction === 'like') && <p className="engagement-surface">対象 · {surface}</p>}
    {candidate.bio && <p className="candidate-bio">{candidate.bio}</p>}
    <div className="candidate-reason"><span>おすすめ理由</span><p>{candidate.reason}</p></div>
    {candidate.draft !== undefined && <div className="draft-box">
      <span>そのまま使える返信案 · 編集できます</span>
      <textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} onBlur={() => onEditDraft(candidate.id, draftText)} rows={3} />
      <div className="draft-box-actions">
        {candidate.aiDraft !== undefined && draftText !== candidate.aiDraft && <button className="ghost-button" onClick={() => { setDraftText(candidate.aiDraft!); onEditDraft(candidate.id, candidate.aiDraft!); }}>元のAI案に戻す</button>}
        <button disabled={!draftText} onClick={() => copyDraft(draftText)}>コピー</button>
      </div>
    </div>}
    {detailsAvailable && <details className="candidate-details">
      <summary>判断材料を見る</summary>
      <div className="candidate-details-body">
        {candidate.publicMetrics && <div className="profile-metrics"><span><b>{compactNumber(candidate.publicMetrics.followers)}</b> フォロワー</span><span><b>{compactNumber(candidate.publicMetrics.posts)}</b> 投稿</span></div>}
        {candidate.strategy && <div className="strategy-note"><span>進め方</span><p>{candidate.strategy}</p></div>}
        {candidate.tags.length > 0 && <div className="tags">{candidate.tags.slice(0, 6).map((tag) => <span key={tag}>#{tag}</span>)}</div>}
      </div>
    </details>}
    <div className="candidate-actions">
      <button className="secondary-button" onClick={() => onLater(candidate)}>明日へ</button>
      <button className="primary-button" onClick={() => onOpen(candidate)}>{buttonLabel}<span>↗</span></button>
    </div>
  </article>;
}

function Relations({ state, onOpen, onChange }: { state: AppState; onOpen: (c: Candidate) => void; onChange: AppStateUpdater }) {
  const following = state.candidates
    .filter((candidate) => !candidate.skipped && candidate.stage !== 'discovered')
    .sort((a, b) => {
      const cleanupPriority = Number(b.recommendedAction === 'unfollow_review') - Number(a.recommendedAction === 'unfollow_review');
      return cleanupPriority || b.relationshipScore - a.relationshipScore;
    });
  const cleanup = following.filter((candidate) => candidate.recommendedAction === 'unfollow_review');
  return <>
    <PageHeading eyebrow="関係" title="つながった後を育てる" text="フォロー数ではなく、今どのくらい関係が深まっているかを記録します。" />
    <div className="relation-summary">
      <div><strong>{following.length}</strong><span>関係を記録中</span></div>
      <div><strong>{following.filter((c) => c.followBack === true).length}</strong><span>相互フォロー</span></div>
      <div><strong>{cleanup.length}</strong><span>整理候補</span></div>
    </div>
    {cleanup.length > 0 && <section className="cleanup-banner"><span className="section-kicker">確認が必要</span><strong>{cleanup.length}人のフォロー継続を確認</strong><p>自動で解除はしません。Missionとの相性とこれまでの交流を見て、公式SNSで最終判断します。</p></section>}
    {following.length > 0 ? <div className="relation-list">{following.map((candidate) => <article className={candidate.recommendedAction === 'unfollow_review' ? 'relation-card review' : 'relation-card'} key={candidate.id}>
      <button className="relation-main" onClick={() => onOpen(candidate)}>
        <div className={`mini-avatar ${candidate.platform}`}>{candidate.platform === 'x' ? 'X' : '◎'}</div>
        <div><strong>{candidate.displayName}</strong><span>@{candidate.username}</span><small className="stage-pill">{stageLabel[candidate.stage]}</small></div>
        <div className="relation-score"><strong>{candidate.relationshipScore}</strong><small>関係スコア</small></div>
      </button>
      {candidate.strategy && <p className="relation-advice">{candidate.strategy}</p>}
      <div className="followback-controls" role="group" aria-label={`${candidate.username} のフォローバック状態`}>
        <button aria-pressed={candidate.followBack === true} className={candidate.followBack === true ? 'active' : ''} onClick={() => onChange((current) => setFollowBackStatus(current, candidate.id, true))}>相互</button>
        <button aria-pressed={candidate.followBack === false} className={candidate.followBack === false ? 'active warn' : ''} onClick={() => onChange((current) => setFollowBackStatus(current, candidate.id, false))}>フォロバなし</button>
        <button aria-pressed={candidate.followBack == null} className={candidate.followBack == null ? 'active' : ''} onClick={() => onChange((current) => setFollowBackStatus(current, candidate.id, null))}>未確認</button>
      </div>
    </article>)}</div> : <section className="empty-state"><div>◎</div><strong>関係の記録はまだありません</strong><p>Todayからフォローや交流を記録すると、ここに相手との現在地がまとまります。</p></section>}
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
    <PageHeading eyebrow="自分" title="自分の発信も整える" text="相手探しだけでなく、プロフィールと最近の投稿がMissionに合っているかも確認できます。" />
    <section className="score-card"><div><span>Missionとの一致度</span><strong>{score == null ? '—' : score}</strong>{score != null && <small>/100</small>}</div><p>{state.selfProfile.summary || 'まだ分析していません。プロフィールか最近の投稿を入れると、今の状態と優先して直す場所を整理します。'}</p></section>
    <section className="form-card self-analysis-card">
      <div className="form-intro"><strong>まず現在の発信を入れる</strong><p>片方だけでも分析できます。X同期済みなら自動で入っている場合があります。</p></div>
      <label>プロフィール文<textarea value={profile} onChange={(event) => setProfile(event.target.value)} placeholder="X / Instagramのプロフィール文" /></label>
      <label>最近の投稿<textarea value={posts} onChange={(event) => setPosts(event.target.value)} placeholder="最近の投稿を数件まとめて貼り付け" /></label>
      <button className="primary-button" disabled={analyzing} onClick={() => onAnalyze(profile, posts)}>{analyzing ? '分析しています…' : '今の発信を分析する'}</button>
    </section>
    {state.selfProfile.strategy && <section className="coach-card self-result"><div className="coach-icon">↗</div><div><span className="section-kicker">次に直すこと</span><h3>目的へ近づく作戦</h3><p>{state.selfProfile.strategy}</p></div></section>}
    {state.selfProfile.profileRewrite && <section className="form-card rewrite-card"><div className="field-title"><div><strong>プロフィール改善案</strong><span>事実を足さず、初見で目的が伝わりやすい形</span></div><b>AI</b></div><p>{state.selfProfile.profileRewrite}</p><button className="secondary-button" onClick={() => copyDraft(state.selfProfile.profileRewrite!)}>改善案をコピー</button></section>}
    {state.insights.length > 0 && <section className="insights-section"><div className="section-heading-simple"><span className="section-kicker">改善ポイント</span><h2>覚えておきたいこと</h2></div><div className="insight-list">{state.insights.map((insight) => <article className="insight-card" key={insight.id}><div className={`priority ${insight.priority}`} /><div><span>{insightCategoryLabel[insight.category]}</span><strong>{insight.title}</strong><p>{insight.body}</p></div></article>)}</div></section>}
  </>;
}

function Settings({ state, onChange, onOpenManual }: { state: AppState; onChange: AppStateUpdater; onOpenManual: () => void }) {
  const [missionText, setMissionText] = useState(state.mission.text);
  const [primaryGoal, setPrimaryGoal] = useState(state.mission.primaryGoal);
  const [communicationDNA, setCommunicationDNA] = useState(state.mission.communicationDNA);
  const [budget, setBudget] = useState(state.budget.monthlyLimitUsd);
  const [followBackDays, setFollowBackDays] = useState(state.relationshipPolicy.followBackReviewAfterDays);
  const [saved, setSaved] = useState(false);

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
    setSaved(true);
  }

  function markEdited() {
    setSaved(false);
  }

  return <>
    <PageHeading eyebrow="設定" title="AIの判断軸を決める" text="普段触るのはここだけで十分です。接続や細かい調整は下の詳細設定へまとめています。" />
    <button className="text-button" onClick={onOpenManual}>使い方ガイドを見る</button>
    <section className="form-card settings-primary-card">
      <div className="form-intro"><strong>目的と話し方</strong><p>ここが「誰を選ぶか」「何を勧めるか」の基準になります。</p></div>
      <label>このアプリに任せたいこと<textarea value={missionText} onChange={(event) => { setMissionText(event.target.value); markEdited(); }} /></label>
      <label>最優先ゴール<input value={primaryGoal} onChange={(event) => { setPrimaryGoal(event.target.value); markEdited(); }} /></label>
      <label>あなたらしい話し方<textarea value={communicationDNA} onChange={(event) => { setCommunicationDNA(event.target.value); markEdited(); }} /></label>

      <details className="inline-disclosure">
        <summary><span><strong>予算と整理ルール</strong><small>必要なときだけ変更</small></span><b>⌄</b></summary>
        <div className="inline-disclosure-body">
          <label>月間AI / API予算 <span className="inline-value">${budget.toFixed(2)}</span><input className="range" type="range" min="0" max="10" step="0.5" value={budget} onChange={(event) => { setBudget(Number(event.target.value)); markEdited(); }} /></label>
          <label>フォローバック整理を確認するまで <span className="inline-value">{followBackDays}日</span><input className="range" type="range" min="7" max="90" step="1" value={followBackDays} onChange={(event) => { setFollowBackDays(Number(event.target.value)); markEdited(); }} /></label>
          <div className="hard-limit-row"><span><strong>予算上限を超えない</strong><small>設定額を超える有料API処理は実行しません</small></span><b>ON</b></div>
          <button type="button" className="policy-toggle" onClick={() => onChange((current) => updateRelationshipPolicy(current, { ...current.relationshipPolicy, autoDraftReplies: !(current.relationshipPolicy.autoDraftReplies !== false) }))}>
            <span><strong>返信文案を自動で提案する</strong><small>AI再評価のとき、返信・DMが適切な候補に下書き文を自動生成します(1回の評価につき最大5件)。オフでも評価自体は行われますが下書きは作られません。送信は引き続きご自身で公式アプリから行います。</small></span>
            <span className={state.relationshipPolicy.autoDraftReplies !== false ? 'toggle on' : 'toggle'} />
          </button>
        </div>
      </details>
      <button className="primary-button" onClick={persist} aria-live="polite">{saved ? '保存しました' : 'この設定を保存'}</button>
    </section>
    <BackupControls state={state} onRestore={onChange} />
  </>;
}

function autoReplenishDemand(state: AppState) {
  const total = clampInt(state.relationshipPolicy.dailyQueueLimit, 30, 1, 150);
  const connect = clampInt(state.relationshipPolicy.dailyConnectionLimit, 20, 0, 120);
  const conversation = clampInt(state.relationshipPolicy.dailyConversationLimit, 8, 0, 30);
  const light = clampInt(state.relationshipPolicy.dailyLightEngagementLimit, 8, 0, 30);
  const cleanup = clampInt(state.relationshipPolicy.dailyCleanupLimit, 5, 0, 30);
  const selfLimit = clampInt(state.relationshipPolicy.dailySelfImproveLimit, 1, 0, 1);
  const now = new Date();
  // Reserve the same single self-work slot before and after it is completed. Otherwise
  // finishing Me analysis would silently increase today's relationship quota by one.
  const plannedSelf = selfLimit > 0 && state.insights.length > 0 ? 1 : 0;
  const relationshipCapacity = connect + conversation + light + cleanup;
  const relationshipTarget = Math.max(0, Math.min(total - plannedSelf, relationshipCapacity));
  const completedToday = state.interactions.filter((interaction) => {
    const at = new Date(interaction.at);
    return interaction.action !== 'review' && sameLocalDay(at, now);
  }).length;
  const remainingTarget = Math.max(0, relationshipTarget - completedToday);
  const current = buildDailyQueue(state).filter((item) => item.kind === 'relationship').length;
  const lowWater = remainingTarget > 0 ? Math.max(1, Math.ceil(remainingTarget * 0.7)) : 0;
  return { current, remainingTarget, lowWater };
}

function sameLocalDay(a: Date, b: Date) {
  return Number.isFinite(a.getTime())
    && a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const normalized = Number.isFinite(value) ? Math.round(value!) : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function PageHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <header className="page-heading"><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{text}</p></header>;
}

function ResultSheet({ candidate, onResolve }: { candidate: Candidate; onResolve: (action: 'followed' | 'skipped' | 'later' | 'kept') => void }) {
  const cleanup = candidate.recommendedAction === 'unfollow_review';
  const completion = outcomeForAction(candidate);
  const copied = Boolean(candidate.draft?.trim());
  const surface = engagementSurfaceLabel(candidate.platform, candidate.engagementUrl);
  return <div className="sheet-backdrop"><section className="result-sheet" role="dialog" aria-modal="true" aria-labelledby="result-title">
    <div className="sheet-handle" />
    <span className="section-kicker">結果を記録</span>
    <h2 id="result-title">@{candidate.username} への{actionLabel[candidate.recommendedAction]}はどうでしたか？</h2>
    <p>{cleanup
      ? '公式SNSで確認した結果だけ記録します。自動でフォロー解除することはありません。'
      : copied
        ? '返信案はコピー済みです。公式アプリに貼り付けて送ったら、この1タップで記録できます。'
        : '公式SNSでの操作結果だけ記録します。次回のおすすめ精度に使います。'}</p>
    {surface && !cleanup && <p className="sheet-surface">開いた先 · {surface}</p>}
    <div className="sheet-actions">{cleanup ? <>
      <button className="sheet-primary" onClick={() => onResolve('kept')}>フォローを継続した</button>
      <button onClick={() => onResolve('skipped')}>フォロー解除した</button>
      <button className="muted" onClick={() => onResolve('later')}>まだ決めていない</button>
    </> : <>
      <button className="sheet-primary" onClick={() => onResolve(completion.result)}>{completion.label}</button>
      <button onClick={() => onResolve('skipped')}>今回は見送った</button>
      <button className="muted" onClick={() => onResolve('later')}>あとで記録する</button>
    </>}</div>
  </section></div>;
}

function candidateActionButtonLabel(candidate: Candidate) {
  const platform = platformLabel(candidate.platform);
  const hasDraft = Boolean(candidate.draft?.trim());
  switch (candidate.recommendedAction) {
    case 'follow': return hasDraft ? `コピーして${platform}でフォロー` : `${platform}で確認してフォロー`;
    case 'like': return `${platform}で対象投稿を開く`;
    case 'reply': return hasDraft ? `コピーして${platform}で開く` : `${platform}で返信先を開く`;
    case 'dm': return hasDraft ? `コピーして${platform}で開く` : `${platform}でDM先を開く`;
    case 'unfollow_review': return `${platform}でフォローを確認`;
    default: return `${platform}でプロフィールを確認`;
  }
}

function outcomeForAction(candidate: Candidate): { label: string; result: 'followed' | 'kept' } {
  switch (candidate.recommendedAction) {
    case 'follow': return { label: 'フォローした', result: 'followed' };
    case 'like': return { label: 'いいねした', result: 'kept' };
    case 'reply': return { label: '返信した', result: 'kept' };
    case 'dm': return { label: 'DMした', result: 'kept' };
    default: return { label: '確認・交流した', result: 'kept' };
  }
}

function compactNumber(value?: number) {
  const number = value || 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

export default App;
