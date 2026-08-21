import { applyOwnedXSync } from './store';
import type { XOwnedSyncResponse } from './xAccount';
import type { AppState, Candidate } from './types';

const MAX_NEW_INBOUND_CANDIDATES = 40;

export function applyOwnedXSyncWithDiscovery(state: AppState, result: XOwnedSyncResponse): AppState {
  const synced = applyOwnedXSync(state, result);
  if (!result.enabled || !result.followers?.length) return synced;

  const existing = new Set(synced.candidates.map((candidate) => `${candidate.platform}:${candidate.username.toLowerCase()}`));
  const followingSet = new Set((result.following || []).map((user) => user.username.toLowerCase()));
  const additions: Candidate[] = [];

  for (const follower of result.followers) {
    if (additions.length >= MAX_NEW_INBOUND_CANDIDATES) break;
    const key = `x:${follower.username.toLowerCase()}`;
    if (existing.has(key)) continue;
    existing.add(key);
    const mutual = followingSet.has(follower.username.toLowerCase());
    additions.push({
      id: `x-${crypto.randomUUID()}`,
      platform: 'x',
      username: follower.username,
      displayName: follower.name || follower.username,
      bio: follower.description || '',
      profileUrl: `https://x.com/${follower.username}`,
      platformUserId: follower.id,
      verified: follower.verified,
      publicMetrics: follower.publicMetrics,
      profileSyncedAt: result.syncedAt || new Date().toISOString(),
      kind: 'other',
      match: 60,
      relationshipScore: mutual ? 32 : 24,
      stage: 'recognized',
      reason: 'X公式同期で、すでにあなたをフォローしている人として見つかりました。既存ファン・交流候補としてMission再評価する価値があります。',
      strategy: 'まずプロフィールや最近の発信との相性を確認し、営業的なDMではなく自然な交流余地があるか判断します。',
      tags: ['inbound-follower', 'x-owned-sync'],
      recommendedAction: 'review',
      followBack: mutual ? true : null,
    });
  }

  return additions.length ? { ...synced, candidates: [...additions, ...synced.candidates] } : synced;
}
