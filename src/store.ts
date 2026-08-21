import type { RankResult, XProfileResult } from './api';
import type { XOwnedSyncResponse } from './xAccount';
import type { AppState, Candidate, Interaction, Mission, Platform, RecommendedAction, RelationshipPolicy } from './types';

const KEY = 'sns-providers:v1';
const LEGACY_DEMO_CANDIDATES = new Set([
  'x-1:x:music_listener',
  'ig-1:instagram:indie_creator',
  'x-2:x:songwriter_friend',
]);

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
    dailyQueueLimit: 30,
    dailyConnectionLimit: 20,
    dailyConversationLimit: 8,
    dailyLightEngagementLimit: 8,
    dailyCleanupLimit: 5,
    dailySelfImproveLimit: 2,
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
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.filter((candidate) => !isLegacyDemoCandidate(candidate)) : [];
    const interactions = Array.isArray(parsed.interactions)
      ? parsed.interactions.filter((interaction) => candidates.some((candidate) => candidate.id === interaction.candidateId))
      : [];
    const state: AppState = {
      ...defaultState,
      ...parsed,
      candidates,
      interactions,
      mission: { ...defaultState.mission, ...(parsed.mission || {}) },
      budget: { ...defaultState.budget, ...(parsed.budget || {}) },
      relationshipPolicy: { ...defaultState.relationshipPolicy, ...(parsed.relationshipPolicy || {}) },
      selfProfile: { ...defaultState.selfProfile, ...(parsed.selfProfile || {}) },
      xAccount: { ...defaultState.xAccount, ...(parsed.xAccount || {}) },
    };
    return refreshRelationshipAdvice(state);
  } catch {
    return defaultState;
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY, JSON.stringify(state));
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
  if (!result) return state;
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
    budget: {
      ...state.budget,
      usedUsd: Math.max(0, state.budget.usedUsd + Math.max(0, costUsd)),
      llmUsd: Math.max(0, state.budget.llmUsd + Math.max(0, costUsd)),
    },
  };
}

export function syncBudget(state: AppState, usedUsd: number, serverLimitUsd: number): AppState {
  return {
    ...state,
    budget: {
      ...state.budget,
      usedUsd: Math.max(0, usedUsd),
      monthlyLimitUsd: Math.min(state.budget.monthlyLimitUsd, Math.max(0, serverLimitUsd)),
    },
  };
}

export function addCandidateFromReference(state: AppState, platform: Platform, rawReference: string): AppState {
  const username = parseUsername(platform, rawReference);
  if (!username) return state;
  if (state.candidates.some((candidate) => candidate.platform === platform && candidate.username.toLowerCase() === username.toLowerCase())) return state;

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
    reason: '候補プールへ追加しました。プロフィール情報を補足するか、AI再評価でMissionとの相性を判定できます。',
    tags: [],
    recommendedAction: 'review',
  };
  return { ...state, candidates: [candidate, ...state.candidates] };
}

export function applyXProfiles(state: AppState, profiles: XProfileResult[], costUsd = 0): AppState {
  const byUsername = new Map(profiles.map((profile) => [profile.username.toLowerCase(), profile]));
  const syncedAt = new Date().toISOString();
  const candidates = state.candidates.map((candidate) => {
    if (candidate.platform !== 'x') return candidate;
    const profile = byUsername.get(candidate.username.toLowerCase());
    if (!profile) return candidate;
    return {
      ...candidate,
      platformUserId: profile.id,
      displayName: profile.name || candidate.displayName,
      bio: profile.description || candidate.bio,
      verified: profile.verified,
      publicMetrics: profile.publicMetrics,
      profileSyncedAt: syncedAt,
    };
  });
  return {
    ...state,
    candidates,
    budget: {
      ...state.budget,
      usedUsd: Math.max(0, state.budget.usedUsd + Math.max(0, costUsd)),
      xUsd: Math.max(0, state.budget.xUsd + Math.max(0, costUsd)),
    },
  };
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

  const candidates = state.candidates.map((candidate) => {
    if (candidate.platform !== 'x') return candidate;
    const username = candidate.username.toLowerCase();
    const relatedProfile = profileByUsername.get(username);
    const isFollower = followerSet.has(username);
    const isFollowing = followingSet.has(username);
    const followBack = isFollower ? true : followersComplete && candidate.followedAt ? false : candidate.followBack;
    const stage = isFollowing && (candidate.stage === 'discovered' || candidate.stage === 'interested') ? 'following' as const : candidate.stage;
    return {
      ...candidate,
      stage,
      followBack,
      platformUserId: relatedProfile?.id || candidate.platformUserId,
      displayName: relatedProfile?.name || candidate.displayName,
      bio: relatedProfile?.description || candidate.bio,
      verified: relatedProfile ? relatedProfile.verified : candidate.verified,
      publicMetrics: relatedProfile?.publicMetrics || candidate.publicMetrics,
      profileSyncedAt: relatedProfile ? syncedAt : candidate.profileSyncedAt,
    };
  });

  const profileText = result.profile.description || state.selfProfile.profileText;
  const recentPostsText = posts.map((post) => post.text.trim()).filter(Boolean).join('\n\n---\n\n') || state.selfProfile.recentPostsText;
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
      followersComplete,
      followingComplete: Boolean(result.coverage?.following.complete),
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
  const byId = new Map(results.map((result) => [result.id, result]));
  const candidates = state.candidates.map((candidate) => {
    const result = byId.get(candidate.id);
    if (!result) return candidate;
    const recommendedAction = isRecommendedAction(result.recommendedAction) ? result.recommendedAction : candidate.recommendedAction;
    return {
      ...candidate,
      match: clampScore(result.match),
      kind: isCandidateKind(result.kind) ? result.kind : candidate.kind,
      recommendedAction,
      reason: result.reason?.trim() || candidate.reason,
      strategy: result.strategy?.trim() || candidate.strategy,
      draft: result.draft?.trim() || undefined,
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

export function recordInteraction(state: AppState, candidateId: string, action: Interaction['action']): AppState {
  const now = new Date().toISOString();
  const target = state.candidates.find((candidate) => candidate.id === candidateId);
  const cleanupKeep = action === 'kept' && target?.recommendedAction === 'unfollow_review';
  const recordedAction: Interaction['action'] = cleanupKeep ? 'review' : action;
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
    if (recordedAction === 'skipped') return { ...candidate, skipped: true };
    if (recordedAction === 'kept') {
      return {
        ...candidate,
        stage: advanceRelationshipStage(candidate.stage, priorEngagements),
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

function advanceRelationshipStage(stage: Candidate['stage'], priorEngagements: number): Candidate['stage'] {
  if (stage === 'discovered' || stage === 'interested' || stage === 'following') return 'engaged';
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
  const replyReady = Boolean(candidate.engagementUrl) || ['engaged', 'recognized', 'conversation', 'relationship'].includes(candidate.stage);
  const dmReady = ['recognized', 'conversation', 'relationship'].includes(candidate.stage);
  if (candidate.recommendedAction === 'reply' && !replyReady) {
    return {
      ...candidate,
      recommendedAction: 'review',
      draft: undefined,
      strategy: '返信できる具体的な接点がまだ確認できないため、まずプロフィールや実際の投稿を確認します。',
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

function isLegacyDemoCandidate(candidate: Candidate) {
  return LEGACY_DEMO_CANDIDATES.has(`${candidate.id}:${candidate.platform}:${candidate.username.toLowerCase()}`);
}

function parseUsername(platform: Platform, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withoutAt = trimmed.replace(/^@/, '');
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const accepted = platform === 'x' ? ['x.com', 'twitter.com'] : ['instagram.com'];
    if (accepted.includes(host)) return sanitizeUsername(url.pathname.split('/').filter(Boolean)[0] || '');
  } catch {
    // Plain handles are supported below.
  }
  return sanitizeUsername(withoutAt);
}

function sanitizeUsername(value: string) {
  return value.split(/[/?#]/)[0].replace(/[^a-zA-Z0-9._]/g, '').slice(0, 64);
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
