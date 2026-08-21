import type { DiscoveredProfileResult } from './api';
import type { AppState, Candidate } from './types';
import './discovery.css';

export function mergeDiscoveredProfiles(state: AppState, profiles: DiscoveredProfileResult[]): AppState {
  const existing = new Set(state.candidates.map((candidate) => `${candidate.platform}:${candidate.username.toLowerCase()}`));
  const additions: Candidate[] = [];

  for (const profile of profiles) {
    const key = `${profile.platform}:${profile.username.toLowerCase()}`;
    if (existing.has(key)) continue;
    existing.add(key);
    additions.push({
      id: `${profile.platform}-${crypto.randomUUID()}`,
      platform: profile.platform,
      username: profile.username,
      displayName: profile.title || profile.username,
      bio: profile.snippet || '',
      profileUrl: profile.profileUrl,
      kind: 'other',
      match: Math.max(45, Math.min(70, Math.round(45 + profile.score * 25))),
      relationshipScore: 0,
      stage: 'discovered',
      reason: '無料Web検索から候補として発見しました。Missionへの本評価はAI再評価または本人確認で行います。',
      strategy: 'まずプロフィール内容を確認し、関連性が十分なら交流候補として残します。',
      tags: ['web-discovered'],
      recommendedAction: 'review',
    });
  }

  return additions.length ? { ...state, candidates: [...additions, ...state.candidates] } : state;
}
