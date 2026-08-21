import type { RankResult } from './api';
import type { AppState, Candidate, Interaction, Mission, Platform, RecommendedAction } from './types';

const KEY = 'sns-providers:v1';

const seedCandidates: Candidate[] = [
  {
    id: 'x-1', platform: 'x', username: 'music_listener', displayName: 'Music Listener',
    bio: 'Indie / acoustic / live music listener.', profileUrl: 'https://x.com/music_listener',
    kind: 'fan', match: 94, relationshipScore: 12, stage: 'discovered',
    reason: 'インディー／弾き語りへの関心が高く、ファン候補としてMissionとの一致度が高いです。',
    tags: ['indie', 'acoustic', 'listener'], recommendedAction: 'follow'
  },
  {
    id: 'ig-1', platform: 'instagram', username: 'indie_creator', displayName: 'Indie Creator',
    bio: 'Independent visual creator and music lover.', profileUrl: 'https://www.instagram.com/indie_creator/',
    kind: 'creator', match: 88, relationshipScore: 18, stage: 'interested',
    reason: '音楽と映像の両方に関心があり、将来の制作交流やコラボ候補として相性があります。',
    tags: ['visual', 'music', 'creator'], recommendedAction: 'follow'
  },
  {
    id: 'x-2', platform: 'x', username: 'songwriter_friend', displayName: 'Songwriter',
    bio: 'Singer-songwriter. Recording demos every week.', profileUrl: 'https://x.com/songwriter_friend',
    kind: 'artist', match: 91, relationshipScore: 42, stage: 'engaged',
    reason: '活動規模と制作テーマが近く、同業者同士の継続的な交流価値が高い候補です。',
    tags: ['songwriter', 'recording'], recommendedAction: 'reply',
    draft: '制作途中を出すのって勇気いりますよね。自分も音楽を作っていて、完成前の段階だからこそ見えるものがあるなと思います。'
  }
];

const defaultState: AppState = {
  mission: {
    text: 'アーティスト活動を促進するためにつながりやファン、フォロワーを増やしたい。数だけではなく、音楽を好きになってくれる人や仲間、将来のコラボにつながる関係を育てたい。',
    primaryGoal: 'ファンと良質なつながりを増やす',
    secondaryGoals: ['アーティスト仲間', 'クリエイターとのコラボ', '認知拡大'],
    communicationDNA: '親しみやすく、営業臭を出さない。相手の投稿内容に具体的に触れ、本当に興味を持った部分から自然な会話を始める。'
  },
  candidates: seedCandidates,
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
  insights: [
    { id: 'i1', category: 'profile', priority: 'high', title: '初見の人への入口を強くする', body: '何を作っている人かに加えて、初めて来た人がすぐ音楽を聴ける導線をプロフィール上部に置くとMissionに近づきやすくなります。' },
    { id: 'i2', category: 'content', priority: 'medium', title: 'リスナー向け投稿を少し増やす', body: '制作側の投稿だけでなく、曲の世界観や聴きどころを短く体験できる投稿を混ぜるとファン候補との接点が増えます。' },
    { id: 'i3', category: 'network', priority: 'medium', title: '同業者への偏りを抑える', body: '新規交流の一部をリスナー・映像制作者・イベント関係へ振り分けるとネットワークがMissionに近づきます。' }
  ]
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaultState, ...JSON.parse(raw) } : defaultState;
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

export function applyRankResults(state: AppState, results: RankResult[], costUsd = 0): AppState {
  const byId = new Map(results.map((result) => [result.id, result]));
  const candidates = state.candidates.map((candidate) => {
    const result = byId.get(candidate.id);
    if (!result) return candidate;
    return {
      ...candidate,
      match: clampScore(result.match),
      kind: isCandidateKind(result.kind) ? result.kind : candidate.kind,
      recommendedAction: isRecommendedAction(result.recommendedAction) ? result.recommendedAction : candidate.recommendedAction,
      reason: result.reason?.trim() || candidate.reason,
    };
  });
  return {
    ...state,
    candidates,
    budget: { ...state.budget, usedUsd: Math.max(0, state.budget.usedUsd + Math.max(0, costUsd)) },
  };
}

export function recordInteraction(state: AppState, candidateId: string, action: Interaction['action']): AppState {
  const now = new Date().toISOString();
  const interactions = [{ id: crypto.randomUUID(), candidateId, action, at: now }, ...state.interactions];
  const candidates = state.candidates.map((candidate) => {
    if (candidate.id !== candidateId) return candidate;
    if (action === 'followed') return { ...candidate, stage: 'following' as const, followedAt: candidate.followedAt ?? now, lastInteractionAt: now };
    if (action === 'skipped') return { ...candidate, skipped: true };
    if (action === 'kept') return { ...candidate, lastInteractionAt: now };
    return { ...candidate, lastInteractionAt: now };
  });
  return { ...state, interactions, candidates };
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
