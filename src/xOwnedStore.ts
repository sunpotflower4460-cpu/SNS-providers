import { applyOwnedXSync } from './store';
import type { XOwnedSyncResponse } from './xAccount';
import type { AppState, Candidate } from './types';

const MAX_NEW_INBOUND_CANDIDATES = 40;

export function applyOwnedXSyncWithDiscovery(state: AppState, result: XOwnedSyncResponse): AppState {
  let synced = applyOwnedXSync(state, result);
  synced = applyFullCycleFollowEvidence(synced, result);
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

function applyFullCycleFollowEvidence(state: AppState, result: XOwnedSyncResponse): AppState {
  const evidence = result.followEvidence;
  if (!evidence?.complete || evidence.targetCount <= 0) return state;
  const seen = new Set(evidence.seenKeys);
  const unseen = new Set(evidence.unseenKeys);
  if (!seen.size && !unseen.size) return state;

  const now = Date.now();
  const waitDays = Math.max(1, Math.min(180, state.relationshipPolicy.followBackReviewAfterDays));
  const candidates = state.candidates.map((candidate) => {
    if (candidate.platform !== 'x' || !candidate.followedAt) return candidate;
    if (seen.has(candidate.id)) {
      return {
        ...candidate,
        followBack: true,
        recommendedAction: candidate.recommendedAction === 'unfollow_review' ? 'review' as const : candidate.recommendedAction,
        strategy: candidate.recommendedAction === 'unfollow_review'
          ? 'X followersを1周確認して相互フォローを確認しました。関係性の質を見ながら継続交流します。'
          : candidate.strategy,
      };
    }
    if (!unseen.has(candidate.id)) return candidate;

    const followedAt = new Date(candidate.followedAt).getTime();
    const days = Number.isFinite(followedAt) ? Math.max(0, Math.floor((now - followedAt) / 86_400_000)) : 0;
    const lastInteractionAt = candidate.lastInteractionAt ? new Date(candidate.lastInteractionAt).getTime() : Number.NaN;
    const daysSinceInteraction = Number.isFinite(lastInteractionAt) ? Math.floor((now - lastInteractionAt) / 86_400_000) : Number.POSITIVE_INFINITY;
    const recentlyReviewedOrActive = daysSinceInteraction < waitDays;
    const highMatch = candidate.match >= 80;
    const meaningfulRelationship = candidate.relationshipScore >= 35
      || candidate.stage === 'engaged'
      || candidate.stage === 'recognized'
      || candidate.stage === 'conversation'
      || candidate.stage === 'relationship'
      || recentlyReviewedOrActive;
    const reviewDue = days >= waitDays && !((state.relationshipPolicy.preserveHighMatch && highMatch) || meaningfulRelationship);

    return {
      ...candidate,
      followBack: false,
      recommendedAction: reviewDue ? 'unfollow_review' as const : candidate.recommendedAction === 'unfollow_review' ? 'review' as const : candidate.recommendedAction,
      strategy: reviewDue
        ? `X followersを1周確認し、フォローから${days}日フォローバックなし。Mission一致度と交流履歴も弱いため、公式アプリで継続を確認する候補です。`
        : recentlyReviewedOrActive
          ? 'X followersを1周確認して現時点のフォローバックなしを確認しましたが、最近の交流または継続判断があるため今は整理しません。'
          : `X followersを1周確認して現時点のフォローバックなしを確認しました。${days < waitDays ? `整理レビューまではあと${waitDays - days}日あります。` : 'Mission一致度または交流価値が高いため継続候補です。'}`,
    };
  });

  return { ...state, candidates };
}
