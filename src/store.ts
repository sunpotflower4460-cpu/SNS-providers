import type { RankResult, XProfileResultList } from './api';
import { normalizeAppState } from './backup';
import { candidateRequestKey, missionRequestKey, selfRequestKey, xProfileRequestKey } from './requestContext';
import type { XOwnedSyncResponse } from './xAccount';
import type { AppState, Candidate, Interaction, Mission, Platform, RecommendedAction, RelationshipPolicy } from './types';

const KEY = 'sns-providers:v1';
const X_RESERVED_PATHS = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings', 'compose', 'intent']);
const INSTAGRAM_RESERVED_PATHS = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer']);

const defaultState: AppState = {
  mission: {
    text: 'アーティスト活動を促進するためにつながりやファン、フォロワーを増やしたい。数だけではなく、音楽を好きになってくれる人や仲間、将来のコラボにつながる関係を育てたい。',
    primaryGoal: 'ファンと良質なつながりを増やす',
    secondaryGoals: ['アーティスト仲間', 'クリエイターとのコラボ', '認知拡大'],
    communicationDNA: '親しみやすく、営業臭を出さない。相手の投稿内容に具体的に触れ、本当に興味を持った部分から自然な会話を始める。'
  },
  candidates: [],
  interactions: [],
  budget: {
    monthlyLimitUsd: 3,
    hardLimit: true,
    usedUsd: 0,
    xUsd: 0,
    llmUsd: 0,
    searchUsd: 0,
    mode: 'balanced'
  },
  relationshipPolicy: {
    followBackReviewAfterDays: 30,
    preserveHighMatch: true,
    autoDraftReplies: true,
    dailyQueueLimit: 30,
    dailyConnectionLimit: 20,
    dailyConversationLimit: 8,
    dailyLightEngagementLimit: 8,
    dailyCleanupLimit: 5,
    dailySelfImproveLimit: 1,
  },
  insights: [
    { id: 'i1', category: 'profile', priority: 'high', title: '初見の人への入口を強くする', body: '何を作っている人かに加えて、初めて来た人がすぐ音楽を聴ける導線をプロフィール上部に置くとMissionに近づきやすくなります。' },
    { id: 'i2', category: 'content', priority: 'medium', title: 'リスナー向け投稿を少し増やす', body: '制作側の投稿だけでなく、曲の世界観や聴きどころを短く体験できる投稿を混ぜるとファン候補との接点が増えます。' },
    { id: 'i3', category: 'network', priority: 'medium', title: '同業者への偏りを抑える', body: '新規交流の一部をリスナー・映像制作者・イベント関係へ振り分けるとネットワークがMissionに近づきます。' }
  ],
  selfProfile: {
    profileText: '',
    recentPostsText: ''
  },
  xAccount: {}
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const state: AppState = {
      ...defaultState,
      ...parsed,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      interactions: Array.isArray(parsed.interactions) ? parsed.interactions : [],
      mission: { ...defaultState.mission, ...(parsed.mission || {}) },
      budget: { ...defaultState.budget, ...(parsed.budget || {}) },
      relationshipPolicy: { ...defaultState.relationshipPolicy, ...(parsed.relationshipPolicy || {}) },
      selfProfile: { ...defaultState.selfProfile, ...(parsed.selfProfile || {}) },
      xAccount: { ...defaultState.xAccount, ...(parsed.xAccount || {}) },
    };
    return refreshRelationshipAdvice(normalizeAppState(state));
  } catch {
    return defaultState;
  }
}

export function saveState(state: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return { ok: true as const };
  } catch (error) {
    const quotaExceeded = error instanceof DOMException
      && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return {
      ok: false as const,
      reason: quotaExceeded
        ? 'ローカル保存容量がいっぱいです。Settingsからバックアップを書き出し、不要な候補を整理してください。'
        : 'ローカル保存に失敗しました。ブラウザのストレージ設定を確認してください。',
    };
  }
}

export function updateMission(state: AppState, mission: Mission): AppState {
  return { ...state, mission };
}

export function updateRelationshipPolicy(state: AppState, policy: RelationshipPolicy): AppState {
  return refreshRelationshipAdvice({
    ...state,
    relationshipPolicy: { ...state.relationshipPolicy, ...policy },
  });
}

export function setFollowBackStatus(state: AppState, candidateId: string, followBack: boolean | null): AppState {
  const candidates = state.candidates.map((candidate) => candidate.id === candidateId ? { ...candidate, followBack } : candidate);
  return refreshRelationshipAdvice({ ...state, candidates });
}

export function updateSelfProfileInputs(state: AppState, profileText: string, recentPostsText: string): AppState {
  return { ...state, selfProfile: { ...state.selfProfile, profileText, recentPostsText } };
}

export function applySelfAnalysis(state: AppState, result: RankResult | undefined, costUsd = 0): AppState {
  const budget = {
    ...state.budget,
    usedUsd: Math.max(0, state.budget.usedUsd + Math.max(0, costUsd)),
    llmUsd: Math.max(0, state.budget.llmUsd + Math.max(0, costUsd)),
  };
  if (!result) return { ...state, budget };
  if (result.requestMissionKey && result.requestMissionKey !== missionRequestKey(state.mission)) {
    return { ...state, budget };
  }
  if (result.requestSelfKey && result.requestSelfKey !== selfRequestKey(state.selfProfile.profileText, state.selfProfile.recentPostsText)) {
    return { ...state, budget };
  }
  return {
    ...state,
    selfProfile: {
      ...state.selfProfile,
      score: clampScore(result.match),
      summary: result.reason?.trim() || state.selfProfile.summary,
      strategy: result.strategy?.trim() || state.selfProfile.strategy,
      profileRewrite: result.draft?.trim() || undefined,
      analyzedAt: new Date().toISOString(),
    },
    budget,
  };
}

export function syncBudget(state: AppState, usedUsd: number, serverLimitUsd: number): AppState {
  const nextUsed = Math.max(0, usedUsd);
  const previousUsed = Math.max(0, state.budget.usedUsd);
  // Category totals are client-side estimates. When the authoritative ledger total changes,
  // scale them so x/llm/search never disagree with usedUsd after a cloud budget sync.
  const scale = previousUsed > 0 ? nextUsed / previousUsed : 0;
  const xUsd = previousUsed > 0 ? Math.max(0, state.budget.xUsd) * scale : 0;
  const llmUsd = previousUsed > 0 ? Math.max(0, state.budget.llmUsd) * scale : 0;
  const searchUsd = previousUsed > 0 ? Math.max(0, state.budget.searchUsd) * scale : 0;
  return {
    ...state,
    budget: {
      ...state.budget,
      usedUsd: nextUsed,
      xUsd,
      llmUsd,
      searchUsd,
      monthlyLimitUsd: Math.min(state.budget.monthlyLimitUsd, Math.max(0, serverLimitUsd)),
    },
  };
}

export function addCandidateFromReference(state: AppState, platform: Platform, rawReference: string): AppState {
  const username = parseUsername(platform, rawReference);
  if (!username) return state;
  const existing = state.candidates.find((candidate) => candidate.platform === platform && candidate.username.toLowerCase() === username.toLowerCase());
  if (existing) {
    if (!existing.skipped) return state;
    const hasHistoricalIdentity = Boolean(
      stablePlatformUserId(existing.platformUserId)
      || existing.followedAt
      || existing.lastInteractionAt
      || existing.relationshipScore > 0
      || state.interactions.some((interaction) => interaction.candidateId === existing.id),
    );
    const candidates = state.candidates.map((candidate) => candidate.id === existing.id ? {
      ...candidate,
      skipped: false,
      snoozedUntil: undefined,
      engagementUrl: undefined,
      followBack: hasHistoricalIdentity ? null : candidate.followBack,
      recommendedAction: 'review' as const,
      draft: undefined,
      tags: hasHistoricalIdentity
        ? [...new Set([...candidate.tags, 'identity-conflict'])].slice(0, 30)
        : candidate.tags,
      reason: hasHistoricalIdentity
        ? '以前の候補を@username指定で戻しましたが、ハンドルだけでは過去と同じ人物だと確認できません。過去の履歴は保持しつつ、現在の公式identityを確認するまで直接アクションを停止します。'
        : '以前に見送った候補を、手動操作で再び候補へ戻しました。',
      strategy: hasHistoricalIdentity
        ? '現在の公式プロフィールとユーザーIDを確認し、過去の履歴が同じ相手に属すると確認できてから交流を再開します。'
        : '過去の関係履歴は残したまま、現在のプロフィールと発信を確認して次の交流を判断します。',
    } : candidate);
    return refreshRelationshipAdvice({ ...state, candidates });
  }

  const candidate: Candidate = {
    id: `${platform}-${crypto.randomUUID()}`,
    platform,
    username,
    displayName: username,
    bio: '',
    profileUrl: platform === 'x' ? `https://x.com/${username}` : `https://www.instagram.com/${username}/`,
    kind: 'other',
    match: 50,
    relationshipScore: 0,
    stage: 'discovered',
    reason: '候補プールへ追加しました。フォロー候補としてTodayに出ます。AI再評価は任意です。',
    tags: [],
    recommendedAction: 'review',
  };
  return { ...state, candidates: [candidate, ...state.candidates] };
}

export function applyXProfiles(state: AppState, profiles: XProfileResultList, attemptedUsernames: string[], costUsd = 0): AppState {
  const byUsername = new Map(profiles.map((profile) => [profile.username.toLowerCase(), profile]));
  const attempted = new Set(attemptedUsernames.map((username) => username.trim().toLowerCase()).filter(Boolean));
  const requestCandidateKeys = profiles.requestCandidateKeys;
  const attemptedAt = new Date().toISOString();
  const candidates = state.candidates.map((candidate) => {
    if (candidate.platform !== 'x' || candidate.skipped) return candidate;
    const username = candidate.username.toLowerCase();
    if (!attempted.has(username)) return candidate;

    // Client-only request context is attached to the exact validated profile array by
    // enrichXProfiles(). A candidate created after the request has no key and must not be
    // touched. A candidate whose official profile/identity changed while the request was
    // in flight keeps that newer state; only its attempt timestamp is advanced so the
    // already-paid request is not immediately repeated.
    if (requestCandidateKeys) {
      const requestKey = requestCandidateKeys[candidate.id];
      if (!requestKey) return candidate;
      if (requestKey !== xProfileRequestKey(candidate)) {
        return { ...candidate, profileSyncAttemptedAt: attemptedAt };
      }
    }

    const profile = byUsername.get(username);
    if (!profile) {
      // A valid paid lookup that found no profile should still back off repeat reads.
      // Keep the last successful sync timestamp separate from the last attempted read.
      return { ...candidate, profileSyncAttemptedAt: attemptedAt };
    }

    const currentStableId = stablePlatformUserId(candidate.platformUserId);
    if (currentStableId && currentStableId !== profile.id) {
      // Generic username enrichment cannot safely decide whether this is a real handle
      // transfer or a stale response that arrived after another official sync/restore.
      // Never rewrite an existing immutable identity or move its CRM history to the new ID.
      // Preserve the old person and history, quarantine direct actions, and let a later
      // identity-bound official observation resolve which current record owns the handle.
      return {
        ...candidate,
        profileSyncAttemptedAt: attemptedAt,
        engagementUrl: undefined,
        followBack: null,
        recommendedAction: 'review' as const,
        draft: undefined,
        reason: 'X公式プロフィール確認で、この@usernameに以前の記録とは異なる公式ユーザーIDが返りました。古い応答やハンドル再利用の可能性があるため、過去の相手を新しいIDへ置き換えず再確認します。',
        strategy: '過去の関係履歴と公式ユーザーIDはそのまま保持し、現在のプロフィールを確認できる新しい証拠が揃うまでフォロー・返信・DM・整理へ進めません。',
        tags: [...new Set([...candidate.tags, 'identity-conflict'])],
      };
    }

    if (!currentStableId && candidate.tags.includes('identity-conflict')) {
      // A restored/manual history that is still unbound cannot be assigned to the current
      // handle owner by a username-only lookup. Doing so could merge a previous unknown
      // person into a known current ID. Keep the historical record quarantined until a
      // stronger owned-account reconciliation can decide which record to retain.
      return {
        ...candidate,
        profileSyncAttemptedAt: attemptedAt,
        engagementUrl: undefined,
        followBack: null,
        recommendedAction: 'review' as const,
        draft: undefined,
      };
    }

    const identityConflictResolved = Boolean(currentStableId
      && currentStableId === profile.id
      && candidate.tags.includes('identity-conflict'));
    const profileContextChanged = identityConflictResolved
      || candidate.bio !== profile.description
      || candidate.verified !== profile.verified;
    const staleFollowAdvice = profileContextChanged
      && candidate.recommendedAction === 'follow'
      && !candidate.followedAt;
    return {
      ...candidate,
      platformUserId: profile.id,
      displayName: profile.name || candidate.displayName,
      bio: profile.description,
      verified: profile.verified,
      publicMetrics: profile.publicMetrics,
      profileSyncedAt: attemptedAt,
      profileSyncAttemptedAt: attemptedAt,
      engagementUrl: identityConflictResolved ? undefined : candidate.engagementUrl,
      followBack: identityConflictResolved ? null : candidate.followBack,
      recommendedAction: identityConflictResolved || staleFollowAdvice ? 'review' as const : candidate.recommendedAction,
      draft: identityConflictResolved || staleFollowAdvice ? undefined : candidate.draft,
      reason: identityConflictResolved
        ? 'X公式プロフィール確認で、保存済みの公式ユーザーIDが現在もこの@usernameの所有者であることを確認しました。直接アクションは再評価してから再開します。'
        : staleFollowAdvice
          ? 'X公式プロフィール情報で候補の判断材料が更新されたため、以前のフォロー推薦はいったん無効化しました。'
          : candidate.reason,
      strategy: identityConflictResolved
        ? '現在の公式identityを確認できたためハンドル競合の隔離を解除しました。最新プロフィールを基準にMissionとの相性と次の行動を再評価します。'
        : staleFollowAdvice
          ? '最新の公式プロフィールを反映した状態でAI再評価してから、フォローするかを決めます。古い推薦のままTodayには出しません。'
          : candidate.strategy,
      tags: identityConflictResolved
        ? [...candidate.tags.filter((tag) => tag !== 'identity-conflict'), 'hold-review'].slice(0, 30)
        : staleFollowAdvice
          ? [...new Set([...candidate.tags, 'hold-review'])].slice(0, 30)
          : candidate.tags,
    };
  });
  const normalized = normalizeAppState({
    ...state,
    candidates,
    budget: {
      ...state.budget,
      usedUsd: Math.max(0, state.budget.usedUsd + Math.max(0, costUsd)),
      xUsd: Math.max(0, state.budget.xUsd + Math.max(0, costUsd)),
    },
  });
  return refreshRelationshipAdvice(normalized);
}

export function applyOwnedXSync(state: AppState, result: XOwnedSyncResponse): AppState {
  if (!result.enabled || !result.profile) return state;
  const followers = result.followers || [];
  const following = result.following || [];
  const posts = result.posts || [];
  const followerSet = new Set(followers.map((user) => user.username.toLowerCase()));
  const followingSet = new Set(following.map((user) => user.username.toLowerCase()));
  const profileByUsername = new Map([...followers, ...following].map((user) => [user.username.toLowerCase(), user]));
  const followersComplete = Boolean(result.coverage?.followers.complete);
  const syncedAt = result.syncedAt || new Date().toISOString();

  const followingComplete = Boolean(result.coverage?.following.complete);
  // Cached snapshots may still advertise previously-complete coverage. Negatives and
  // follow-state clears must only come from a freshly observed owned sync; cache hits may
  // still promote positive follower evidence.
  const fromCache = result.source === 'cache';
  const candidates = state.candidates.map((candidate) => {
    if (candidate.platform !== 'x') return candidate;
    const username = candidate.username.toLowerCase();
    const relatedProfile = profileByUsername.get(username);
    const isFollower = followerSet.has(username);
    const isFollowing = followingSet.has(username);
    const unboundIdentityConflict = candidate.tags.includes('identity-conflict')
      && !stablePlatformUserId(candidate.platformUserId);
    // Username-only owned sync must not attach the current official ID to a restored
    // unbound identity-conflict row. That would let the next stable-id reconcile clear
    // quarantine and absorb old CRM history into whoever owns the handle now.
    const bindableProfile = relatedProfile && !unboundIdentityConflict ? relatedProfile : undefined;
    // When a fresh full following cycle proves we no longer follow them, clear historical
    // follow state so unfollow_review cannot linger for already-unfollowed accounts.
    // Never clear from cache: the snapshot may predate a follow recorded after startedAt.
    const followedAt = candidate.skipped
      ? candidate.followedAt
      : isFollowing
        ? candidate.followedAt ?? syncedAt
        : followingComplete && !fromCache
          ? undefined
          : candidate.followedAt;
    // Negative follow-back inference requires a fresh complete followers cycle while we
    // still follow them. Cache hits may confirm positives but must not invent negatives.
    const followBack = candidate.skipped
      ? candidate.followBack
      : isFollower
        ? true
        : isFollowing && followersComplete && followedAt && !fromCache
          ? false
          : !followedAt
            ? null
            : candidate.followBack;
    const stage = !candidate.skipped && isFollowing && (candidate.stage === 'discovered' || candidate.stage === 'interested') ? 'following' as const : candidate.stage;
    return {
      ...candidate,
      stage,
      followedAt,
      followBack,
      platformUserId: bindableProfile?.id || candidate.platformUserId,
      displayName: bindableProfile?.name || candidate.displayName,
      bio: bindableProfile ? bindableProfile.description : candidate.bio,
      verified: bindableProfile ? bindableProfile.verified : candidate.verified,
      publicMetrics: bindableProfile?.publicMetrics || candidate.publicMetrics,
      profileSyncedAt: bindableProfile ? syncedAt : candidate.profileSyncedAt,
      profileSyncAttemptedAt: bindableProfile ? syncedAt : candidate.profileSyncAttemptedAt,
    };
  });

  const profileText = result.profile.description;
  const postsWereRead = (result.requested?.posts ?? 0) > 0;
  const fetchedPostsText = posts.map((post) => post.text.trim()).filter(Boolean).join('\n\n---\n\n');
  const recentPostsText = postsWereRead ? fetchedPostsText : state.selfProfile.recentPostsText;
  const selfInputsChanged = profileText !== state.selfProfile.profileText || recentPostsText !== state.selfProfile.recentPostsText;

  return refreshRelationshipAdvice({
    ...state,
    candidates,
    selfProfile: selfInputsChanged ? {
      profileText,
      recentPostsText,
    } : state.selfProfile,
    xAccount: {
      username: result.profile.username,
      displayName: result.profile.name,
      verified: result.profile.verified,
      publicMetrics: result.profile.publicMetrics,
      lastSyncedAt: syncedAt,
      followerSampleCount: result.coverage?.followers.fetched ?? followers.length,
      followingSampleCount: result.coverage?.following.fetched ?? following.length,
      recentPostCount: result.coverage?.posts.fetched ?? posts.length,
      mentionSampleCount: 0,
      mentionsUnavailable: false,
      followersComplete,
      followingComplete,
      postsComplete: Boolean(result.coverage?.posts.complete),
    },
    budget: {
      ...state.budget,
      usedUsd: Math.max(0, state.budget.usedUsd + Math.max(0, result.costUsd || 0)),
      xUsd: Math.max(0, state.budget.xUsd + Math.max(0, result.costUsd || 0)),
    },
  });
}

export function applyRankResults(state: AppState, results: RankResult[], costUsd = 0): AppState {
  const currentMissionKey = missionRequestKey(state.mission);
  const byId = new Map(results.map((result) => [result.id, result]));
  const candidates = state.candidates.map((candidate) => {
    const result = byId.get(candidate.id);
    if (!result) return candidate;
    if (result.requestMissionKey && result.requestMissionKey !== currentMissionKey) return candidate;
    if (result.requestCandidateKey && result.requestCandidateKey !== candidateRequestKey(candidate)) return candidate;
    const recommendedAction = isRecommendedAction(result.recommendedAction) ? result.recommendedAction : candidate.recommendedAction;
    return {
      ...candidate,
      match: clampScore(result.match),
      kind: isCandidateKind(result.kind) ? result.kind : candidate.kind,
      recommendedAction,
      reason: result.reason?.trim() || candidate.reason,
      strategy: result.strategy?.trim() || candidate.strategy,
      draft: result.draft?.trim() || undefined,
      aiDraft: result.draft?.trim() || undefined,
      tags: candidate.tags.filter((tag) => tag !== 'hold-review'),
    };
  });
  return refreshRelationshipAdvice({
    ...state,
    candidates,
    budget: {
      ...state.budget,
      usedUsd: Math.max(0, state.budget.usedUsd + Math.max(0, costUsd)),
      llmUsd: Math.max(0, state.budget.llmUsd + Math.max(0, costUsd)),
    },
  });
}

export function updateCandidateDraft(state: AppState, candidateId: string, draft: string): AppState {
  const candidates = state.candidates.map((candidate) => candidate.id === candidateId ? { ...candidate, draft: draft.slice(0, 2400) } : candidate);
  return { ...state, candidates };
}

export function recordInteraction(state: AppState, candidateId: string, action: Interaction['action']): AppState {
  const now = new Date().toISOString();
  const target = state.candidates.find((candidate) => candidate.id === candidateId);
  // Result sheets can stay open while another sync/restore changes the candidate pool.
  // Never create an orphan interaction for a candidate that no longer exists or has
  // already been dismissed by a newer state transition.
  if (!target || target.skipped) return state;
  const cleanupKeep = action === 'kept' && target.recommendedAction === 'unfollow_review';
  const cleanupRemove = action === 'skipped' && target.recommendedAction === 'unfollow_review';
  // Keep cleanup completion distinct from a profile-only review. It is real Today work,
  // but it must not count as relationship engagement or advance stage/score.
  const recordedAction: Interaction['action'] = cleanupKeep ? 'unfollow_review' : action;
  const priorEngagements = state.interactions.filter((interaction) => interaction.candidateId === candidateId && interaction.action === 'kept').length;
  const interactions = [{ id: crypto.randomUUID(), candidateId, action: recordedAction, at: now }, ...state.interactions];
  const candidates = state.candidates.map((candidate) => {
    if (candidate.id !== candidateId) return candidate;
    if (recordedAction === 'followed') {
      const stage = candidate.stage === 'discovered' || candidate.stage === 'interested' ? 'following' as const : candidate.stage;
      return {
        ...candidate,
        stage,
        followedAt: candidate.followedAt ?? now,
        followBack: candidate.followBack ?? null,
        relationshipScore: addRelationshipScore(candidate.relationshipScore, 6),
        lastInteractionAt: now,
      };
    }
    if (recordedAction === 'skipped') {
      return {
        ...candidate,
        skipped: true,
        followedAt: cleanupRemove ? undefined : candidate.followedAt,
        followBack: cleanupRemove ? null : candidate.followBack,
        recommendedAction: 'review' as const,
        draft: undefined,
        lastInteractionAt: now,
        strategy: cleanupRemove
          ? '公式SNS側でフォロー解除した記録を反映しました。過去の関係履歴は保持します。'
          : candidate.strategy,
      };
    }
    if (recordedAction === 'kept') {
      return {
        ...candidate,
        stage: advanceRelationshipStage(candidate.stage, priorEngagements, candidate.followedAt),
        relationshipScore: addRelationshipScore(candidate.relationshipScore, 12),
        lastInteractionAt: now,
      };
    }
    if (cleanupKeep) {
      return {
        ...candidate,
        recommendedAction: 'review' as const,
        draft: undefined,
        lastInteractionAt: now,
        strategy: '今回はフォローを継続する判断を記録しました。一定期間後に関係性をもう一度確認します。',
      };
    }
    return { ...candidate, lastInteractionAt: now };
  });
  return refreshRelationshipAdvice({ ...state, interactions, candidates });
}

function advanceRelationshipStage(stage: Candidate['stage'], priorEngagements: number, followedAt?: string): Candidate['stage'] {
  // Keep CRM progression conservative: discovered/interested contacts must have a recorded
  // follow before "kept" engagement can promote them into engaged/DM-adjacent stages.
  if (stage === 'discovered' || stage === 'interested') {
    return followedAt ? 'engaged' : stage;
  }
  if (stage === 'following') return 'engaged';
  if (stage === 'engaged' && priorEngagements >= 1) return 'recognized';
  if (stage === 'recognized' && priorEngagements >= 2) return 'conversation';
  if (stage === 'conversation' && priorEngagements >= 4) return 'relationship';
  return stage;
}

function addRelationshipScore(score: number, increment: number) {
  const current = Number.isFinite(score) ? score : 0;
  return Math.max(0, Math.min(100, Math.round(current + increment)));
}

function refreshRelationshipAdvice(state: AppState): AppState {
  const now = Date.now();
  const waitDays = Math.max(1, Math.min(180, state.relationshipPolicy.followBackReviewAfterDays));
  const candidates = state.candidates.map((rawCandidate) => {
    if (rawCandidate.skipped) return rawCandidate;
    const candidate = normalizeLocalRelationshipAction(rawCandidate);
    if (!candidate.followedAt || candidate.followBack !== false) {
      if (candidate.followBack === true && candidate.recommendedAction === 'unfollow_review') {
        return { ...candidate, recommendedAction: 'review' as const, strategy: '相互フォローを確認済み。関係性の質を見ながら継続交流します。' };
      }
      return candidate;
    }

    const followedAt = new Date(candidate.followedAt).getTime();
    if (!Number.isFinite(followedAt)) return candidate;
    const days = Math.floor((now - followedAt) / 86_400_000);
    if (days < waitDays) return candidate;

    const lastInteractionAt = candidate.lastInteractionAt ? new Date(candidate.lastInteractionAt).getTime() : Number.NaN;
    const daysSinceInteraction = Number.isFinite(lastInteractionAt) ? Math.floor((now - lastInteractionAt) / 86_400_000) : Number.POSITIVE_INFINITY;
    const recentlyReviewedOrActive = daysSinceInteraction < waitDays;
    const highMatch = candidate.match >= 80;
    const meaningfulRelationship = candidate.relationshipScore >= 35 || candidate.stage === 'engaged' || candidate.stage === 'recognized' || candidate.stage === 'conversation' || candidate.stage === 'relationship' || recentlyReviewedOrActive;
    if ((state.relationshipPolicy.preserveHighMatch && highMatch) || meaningfulRelationship) {
      return {
        ...candidate,
        recommendedAction: candidate.recommendedAction === 'unfollow_review' ? 'review' as const : candidate.recommendedAction,
        strategy: recentlyReviewedOrActive
          ? '最近の交流または継続判断があるため、今は整理せず関係性の変化を見ます。'
          : `フォローバックは${days}日確認できていませんが、Mission一致度または交流価値が高いため継続候補です。`,
      };
    }

    return {
      ...candidate,
      recommendedAction: 'unfollow_review' as const,
      draft: undefined,
      strategy: `フォローから${days}日、フォローバックなし。Mission一致度と交流履歴も弱いため、公式アプリで確認して整理する候補です。`,
    };
  });
  return { ...state, candidates };
}

function normalizeLocalRelationshipAction(candidate: Candidate): Candidate {
  if (candidate.tags.includes('identity-conflict')) {
    return {
      ...candidate,
      engagementUrl: undefined,
      followBack: null,
      recommendedAction: 'review',
      draft: undefined,
      strategy: candidate.strategy || '現在の@usernameと過去の関係履歴が同じ人物に属すると確認できるまで、直接アクションを停止します。',
    };
  }
  // Reply/like need a concrete post/media URL. Stage alone must never invent a reply surface
  // (inbound followers can be engaged without any conversation target).
  const hasConcreteEngagementTarget = Boolean(candidate.engagementUrl);
  const dmReady = ['recognized', 'conversation', 'relationship'].includes(candidate.stage);
  if (candidate.recommendedAction === 'follow' && candidate.followedAt) {
    return {
      ...candidate,
      recommendedAction: 'review',
      draft: undefined,
      strategy: 'すでにフォロー済みとして記録されているため、重複フォローではなく現在の関係性や投稿を確認します。',
    };
  }
  if (candidate.recommendedAction === 'unfollow_review' && !candidate.followedAt) {
    return {
      ...candidate,
      recommendedAction: 'review',
      draft: undefined,
      strategy: 'フォロー済みの記録がないため、フォロー解除候補にはせず現在の状態を確認します。',
    };
  }
  if ((candidate.recommendedAction === 'reply' || candidate.recommendedAction === 'like') && !hasConcreteEngagementTarget) {
    return {
      ...candidate,
      recommendedAction: 'review',
      draft: undefined,
      strategy: '反応できる具体的な投稿がまだ確認できないため、まずプロフィールや実際の発信を確認します。',
    };
  }
  if (candidate.recommendedAction === 'dm' && !dmReady) {
    return {
      ...candidate,
      recommendedAction: 'review',
      draft: undefined,
      strategy: 'DMへ進むにはまだ関係が浅いため、まず公開の交流を積み重ねます。',
    };
  }
  return candidate;
}

function parseUsername(platform: Platform, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withoutAt = trimmed.replace(/^@/, '');
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const accepted = platform === 'x' ? ['x.com', 'twitter.com'] : ['instagram.com'];
    if (accepted.includes(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      const first = parts[0] || '';
      if (!first) return '';
      const lowered = first.toLowerCase();
      if (platform === 'x' && X_RESERVED_PATHS.has(lowered)) return '';
      // Instagram post/reel/story URLs do not contain the profile owner as the first
      // segment, so accepting them as a profile would create fake @p/@reel candidates.
      if (platform === 'instagram' && (INSTAGRAM_RESERVED_PATHS.has(lowered) || parts.length !== 1)) return '';
      return sanitizeUsername(platform, first);
    }
  } catch {
    // Plain handles are supported below.
  }
  return sanitizeUsername(platform, withoutAt);
}

function sanitizeUsername(platform: Platform, value: string) {
  const username = value.split(/[/?#]/)[0].replace(/^@/, '').trim();
  const lowered = username.toLowerCase();
  if (platform === 'x') {
    if (X_RESERVED_PATHS.has(lowered)) return '';
    return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';
  }
  if (INSTAGRAM_RESERVED_PATHS.has(lowered)) return '';
  return /^[A-Za-z0-9._]{1,30}$/.test(username) ? username : '';
}

function stablePlatformUserId(value?: string | null) {
  const id = value?.trim() || '';
  return /^\d{1,30}$/.test(id) ? id : '';
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
}

function isCandidateKind(value?: string): value is Candidate['kind'] {
  return ['fan', 'artist', 'creator', 'media', 'venue', 'other'].includes(value || '');
}

function isRecommendedAction(value?: string): value is RecommendedAction {
  return ['follow', 'like', 'reply', 'dm', 'review', 'unfollow_review'].includes(value || '');
}