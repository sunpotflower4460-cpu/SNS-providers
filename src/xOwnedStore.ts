import { applyOwnedXSync } from './store';
import type { XOwnedSyncResponse } from './xAccount';
import type { AppState, Candidate } from './types';

const MAX_NEW_INBOUND_CANDIDATES = 40;

export function applyOwnedXSyncWithDiscovery(state: AppState, result: XOwnedSyncResponse): AppState {
  // If the same handle now resolves to a different immutable X user ID, any follower-cycle
  // evidence in this response was prepared against the old identity. Reset that candidate's
  // identity-bound CRM data first, then skip this cycle's evidence for it. The next fresh
  // cycle will be prepared with the new platformUserId and can safely establish follow-back.
  const identityChangedIds = ownedXIdentityChanges(state, result);
  const identitySafeState = resetOwnedXIdentityChanges(state, result, identityChangedIds);
  let synced = applyOwnedXSync(identitySafeState, result);
  synced = reconcileSelfInputs(state, synced, result);
  synced = applyFullCycleFollowEvidence(synced, result, identityChangedIds);
  if (!result.enabled || !result.followers?.length) return synced;

  const existingByUsername = new Map(
    synced.candidates
      .filter((candidate) => candidate.platform === 'x')
      .map((candidate) => [candidate.username.toLowerCase(), candidate]),
  );
  const followingSet = new Set((result.following || []).map((user) => user.username.toLowerCase()));
  const additions: Candidate[] = [];
  const observedAt = result.syncedAt || new Date().toISOString();

  for (const follower of result.followers) {
    const username = follower.username.toLowerCase();
    const existing = existingByUsername.get(username);
    // A follower list is a current snapshot, not an event stream. If the user has
    // explicitly dismissed this person, seeing the same follower again is not proof
    // of a new follow event, so keep the dismissal until fresh evidence exists.
    if (existing) continue;
    if (additions.length >= MAX_NEW_INBOUND_CANDIDATES) continue;
    const mutual = followingSet.has(username);
    const candidate: Candidate = {
      id: `x-${crypto.randomUUID()}`,
      platform: 'x',
      username: follower.username,
      displayName: follower.name || follower.username,
      bio: follower.description || '',
      profileUrl: `https://x.com/${follower.username}`,
      platformUserId: follower.id,
      verified: follower.verified,
      publicMetrics: follower.publicMetrics,
      profileSyncedAt: observedAt,
      kind: 'other',
      match: 60,
      relationshipScore: mutual ? 32 : 24,
      stage: 'recognized',
      reason: 'X公式同期で、すでにあなたをフォローしている人として見つかりました。既存ファン・交流候補としてMission再評価する価値があります。',
      strategy: 'まずプロフィールや最近の発信との相性を確認し、営業的なDMではなく自然な交流余地があるか判断します。',
      tags: ['inbound-follower', 'x-owned-sync'],
      recommendedAction: 'review',
      // We do not know the historical follow date for an account first seen through the
      // official snapshot. For a mutual, start the conservative review clock at the first
      // observed sync so it participates in future full-cycle follow evidence.
      followedAt: mutual ? observedAt : undefined,
      followBack: mutual ? true : null,
    };
    additions.push(candidate);
    existingByUsername.set(username, candidate);
  }

  return additions.length
    ? { ...synced, candidates: [...additions, ...synced.candidates] }
    : synced;
}

function ownedXIdentityChanges(state: AppState, result: XOwnedSyncResponse) {
  if (!result.enabled) return new Set<string>();
  const byUsername = new Map(
    [...(result.followers || []), ...(result.following || [])]
      .map((user) => [user.username.toLowerCase(), user.id]),
  );
  return new Set(state.candidates
    .filter((candidate) => {
      if (candidate.platform !== 'x' || !candidate.platformUserId) return false;
      const currentId = byUsername.get(candidate.username.toLowerCase());
      return Boolean(currentId && currentId !== candidate.platformUserId);
    })
    .map((candidate) => candidate.id));
}

function resetOwnedXIdentityChanges(state: AppState, result: XOwnedSyncResponse, changedIds: Set<string>): AppState {
  if (!result.enabled || !changedIds.size) return state;
  const followers = result.followers || [];
  const following = result.following || [];
  const followerByUsername = new Map(followers.map((user) => [user.username.toLowerCase(), user]));
  const followingByUsername = new Map(following.map((user) => [user.username.toLowerCase(), user]));
  const followersComplete = Boolean(result.coverage?.followers.complete);
  const syncedAt = result.syncedAt || new Date().toISOString();

  const candidates = state.candidates.map((candidate) => {
    if (!changedIds.has(candidate.id)) return candidate;
    const username = candidate.username.toLowerCase();
    const profile = followerByUsername.get(username) || followingByUsername.get(username);
    if (!profile) return candidate;
    const isFollower = followerByUsername.has(username);
    const isFollowing = followingByUsername.has(username);
    const active = !candidate.skipped;
    return {
      ...candidate,
      platformUserId: profile.id,
      displayName: profile.name || profile.username,
      bio: profile.description || '',
      verified: profile.verified,
      publicMetrics: profile.publicMetrics,
      profileSyncedAt: syncedAt,
      profileSyncAttemptedAt: syncedAt,
      kind: 'other' as const,
      match: 50,
      relationshipScore: 0,
      stage: active && isFollowing ? 'following' as const : active && isFollower ? 'recognized' as const : 'discovered' as const,
      reason: 'Xの公式ユーザーIDが以前の記録と異なります。同じ@usernameを別アカウントが使用している可能性があるため、過去の関係履歴を新しい相手へ引き継がず再確認します。',
      strategy: '以前の相手と同一人物だと推測せず、現在の公式プロフィールと発信からMissionとの相性をあらためて判断します。',
      tags: [],
      recommendedAction: 'review' as const,
      draft: undefined,
      followedAt: active && isFollowing ? syncedAt : undefined,
      followBack: active ? isFollower ? true : isFollowing && followersComplete ? false : null : null,
      lastInteractionAt: undefined,
      snoozedUntil: undefined,
    };
  });

  return {
    ...state,
    candidates,
    // Interaction rows belong to the previous immutable identity. Keeping them attached
    // to the reused candidate ID would silently credit the new account with old history.
    interactions: state.interactions.filter((interaction) => !changedIds.has(interaction.candidateId)),
  };
}

function reconcileSelfInputs(original: AppState, synced: AppState, result: XOwnedSyncResponse): AppState {
  if (!result.enabled || !result.profile) return synced;

  // /users/me is always read for an enabled owned sync, so an empty description is an
  // authoritative empty bio, not a signal to retain a stale local value.
  const profileText = result.profile.description;
  // A zero requested post allocation means posts were not read at all (budget/pacing),
  // so preserve the prior text. If posts were actually requested and the result is empty,
  // the empty list is authoritative and stale imported posts should be cleared.
  const postsWereRead = (result.requested?.posts ?? 0) > 0;
  const recentPostsText = postsWereRead
    ? (result.posts || []).map((post) => post.text.trim()).filter(Boolean).join('\n\n---\n\n')
    : original.selfProfile.recentPostsText;

  const changed = profileText !== original.selfProfile.profileText
    || recentPostsText !== original.selfProfile.recentPostsText;
  if (!changed) return { ...synced, selfProfile: original.selfProfile };

  // Content changed, so prior AI score/strategy/rewrite is stale. Keep only the fresh
  // source material and require a new analysis before showing advice as current.
  return {
    ...synced,
    selfProfile: {
      profileText,
      recentPostsText,
    },
  };
}

function applyFullCycleFollowEvidence(state: AppState, result: XOwnedSyncResponse, identityChangedIds = new Set<string>()): AppState {
  const evidence = result.followEvidence;
  if (!evidence?.complete || evidence.targetCount <= 0) return state;
  const seen = new Set(evidence.seenKeys);
  const unseen = new Set(evidence.unseenKeys);
  if (!seen.size && !unseen.size) return state;

  const now = Date.now();
  const waitDays = Math.max(1, Math.min(180, state.relationshipPolicy.followBackReviewAfterDays));
  const candidates = state.candidates.map((candidate) => {
    if (candidate.skipped || candidate.platform !== 'x' || !candidate.followedAt) return candidate;
    if (identityChangedIds.has(candidate.id)) return candidate;
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
