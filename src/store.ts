import type { AppState, Candidate, Interaction, Mission } from './types';

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
    usedUsd: 0.23,
    xUsd: 0.18,
    llmUsd: 0.05,
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
