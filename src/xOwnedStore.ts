import { applyOwnedXSync } from './store';
import type { XFollowEvidenceTarget, XOwnedSyncResponse, XOwnedUser } from './xAccount';
import type { AppState, Candidate } from './types';

const MAX_NEW_INBOUND_CANDIDATES = 40;

export function applyOwnedXSyncWithDiscovery(state: AppState, result: XOwnedSyncResponse): AppState {
  // Cached snapshots can predate a newer live sync or enrichment. Replaying identity
  // reconcile/reset from cache would rewind platformUserId, wipe CRM, or invent
  // followBack=false. Follow/profile merges below still run with fromCache guards.
  const fromCache = result.source === 'cache';

  // X handles can be renamed while the immutable numeric user ID stays the same. Repair
  // old same-ID duplicates and route the current handle back onto the existing CRM record
  // before evaluating username-reuse identity changes. This preserves genuine history for
  // the same person without ever transferring history to a different immutable account.
  const stableIdentityState = fromCache ? state : reconcileOwnedXStableIdentities(state, result);

  // If the same handle now resolves to a different immutable X user ID, any follower-cycle
  // evidence in this response was prepared against the old identity. Reset that candidate's
  // identity-bound CRM data first, then skip this cycle's evidence for it. The next fresh
  // cycle will be prepared with the new platformUserId and can safely establish follow-back.
  const identityChangedIds = fromCache ? new Set<string>() : ownedXIdentityChanges(stableIdentityState, result);
  const identityResetState = fromCache
    ? stableIdentityState
    : resetOwnedXIdentityChanges(stableIdentityState, result, identityChangedIds);
  // A recycled handle can move through more than two immutable owners. If multiple stale
  // records are reset to the same newly observed ID in one response, collapse them again
  // immediately instead of leaving duplicate current identities until the next sync.
  const identitySafeState = fromCache
    ? identityResetState
    : reconcileOwnedXStableIdentities(identityResetState, result);
  let synced = applyOwnedXSync(identitySafeState, result);
  synced = preservePostSnapshotFollowState(identitySafeState, synced, result);
  synced = reconcileSelfInputs(state, synced, result);
  // Cached snapshots may still carry a previously completed followEvidence payload.
  // Replaying it on every cache hit would overwrite manual Relations decisions for ~20h.
  // Only apply full-cycle proof from a freshly observed owned sync.
  if (!fromCache) {
    synced = applyFullCycleFollowEvidence(synced, result, identityChangedIds);
  }
  if (!result.enabled || !result.followers?.length) return synced;

  const existingByUsername = new Map(
    synced.candidates
      .filter((candidate) => candidate.platform === 'x')
      .map((candidate) => [candidate.username.toLowerCase(), candidate]),
  );
  const existingByStableId = new Map(
    synced.candidates
      .filter((candidate) => candidate.platform === 'x' && stableXId(candidate.platformUserId))
      .map((candidate) => [stableXId(candidate.platformUserId), candidate]),
  );
  const followingIds = new Set((result.following || []).map((user) => user.id));
  const followingUsernames = new Set((result.following || []).map((user) => user.username.toLowerCase()));
  const additions: Candidate[] = [];
  const observedAt = result.syncedAt || new Date().toISOString();

  for (const follower of result.followers) {
    const username = follower.username.toLowerCase();
    const existing = existingByStableId.get(follower.id) || existingByUsername.get(username);
    // A follower list is a current snapshot, not an event stream. If the user has
    // explicitly dismissed this person, seeing the same follower again is not proof
    // of a new follow event, so keep the dismissal until fresh evidence exists.
    if (existing) continue;
    if (additions.length >= MAX_NEW_INBOUND_CANDIDATES) continue;
    const mutual = followingIds.has(follower.id) || followingUsernames.has(username);
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
      // Inbound followers are a first-party signal, but not mutual recognition yet.
      // Starting at recognized would unlock premature DM recommendations.
      stage: mutual ? 'following' : 'engaged',
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
    existingByStableId.set(follower.id, candidate);
  }

  return additions.length
    ? { ...synced, candidates: [...additions, ...synced.candidates] }
    : synced;
}

function reconcileOwnedXStableIdentities(state: AppState, result: XOwnedSyncResponse): AppState {
  if (!result.enabled) return state;
  const incomingUsers = uniqueOwnedUsers([...(result.followers || []), ...(result.following || [])]);
  const officialUsernameById = new Map(incomingUsers.map((user) => [user.id, user.username.toLowerCase()]));
  const xCandidates = state.candidates.filter((candidate) => candidate.platform === 'x');

  // Repair legacy duplicates first. Older versions could create a new candidate when an
  // existing X user renamed their handle because discovery was keyed only by username.
  const byStableId = new Map<string, Candidate>();
  const legacyIdentityAliases = new Map<string, string>();
  for (const candidate of xCandidates) {
    const stableId = stableXId(candidate.platformUserId);
    if (!stableId) continue;
    const previous = byStableId.get(stableId);
    if (!previous) {
      byStableId.set(stableId, candidate);
      continue;
    }
    const preferred = preferXIdentityCandidate(previous, candidate, officialUsernameById.get(stableId));
    const duplicate = preferred.id === previous.id ? candidate : previous;
    byStableId.set(stableId, preferred);
    legacyIdentityAliases.set(duplicate.id, preferred.id);
  }

  const canonicalX = xCandidates.filter((candidate) => !legacyIdentityAliases.has(candidate.id));
  const byUsername = new Map<string, Candidate[]>();
  for (const candidate of canonicalX) {
    const username = candidate.username.toLowerCase();
    const group = byUsername.get(username) || [];
    group.push(candidate);
    byUsername.set(username, group);
  }
  const updates = new Map<string, Candidate>();
  const conflictingRemovedIds = new Set<string>();
  const syncedAt = result.syncedAt || new Date().toISOString();

  for (const user of incomingUsers) {
    const stableExisting = byStableId.get(user.id);
    if (!stableExisting) continue;
    const username = user.username.toLowerCase();
    const usernameExisting = byUsername.get(username) || [];
    for (const conflicting of usernameExisting) {
      if (conflicting.id === stableExisting.id) continue;
      const conflictingStableId = stableXId(conflicting.platformUserId);
      // Same-response rename: this row's official handle moved elsewhere in this payload.
      // Do not delete it while claiming the vacated handle — the rename update below (or
      // later in this loop) must keep its CRM history attached to the immutable ID.
      if (conflictingStableId) {
        const officialUsername = officialUsernameById.get(conflictingStableId);
        if (officialUsername && officialUsername !== username) continue;
      }
      // The current official handle belongs to stableExisting. Every other candidate that
      // still occupies this handle is either an old no-ID observation or a different prior
      // immutable identity. Remove all of them, not just whichever happened to win Map order.
      conflictingRemovedIds.add(conflicting.id);
      updates.delete(conflicting.id);
    }

    const renamed = stableExisting.username.toLowerCase() !== username;
    const identityConflictResolved = stableExisting.tags.includes('identity-conflict');
    const profileChanged = renamed
      || identityConflictResolved
      || stableExisting.bio !== user.description
      || stableExisting.verified !== user.verified
      || stableExisting.displayName !== (user.name || user.username);
    if (!profileChanged) continue;

    updates.set(stableExisting.id, {
      ...stableExisting,
      username: user.username,
      displayName: renamed && sameUsername(stableExisting.displayName, stableExisting.username)
        ? user.name || user.username
        : user.name || stableExisting.displayName,
      profileUrl: `https://x.com/${user.username}`,
      platformUserId: user.id,
      bio: user.description || '',
      verified: user.verified,
      publicMetrics: user.publicMetrics,
      profileSyncedAt: syncedAt,
      profileSyncAttemptedAt: syncedAt,
      ...(identityConflictResolved ? {
        engagementUrl: undefined,
        followBack: null,
        recommendedAction: 'review' as const,
        draft: undefined,
        reason: 'X公式同期で、現在の@usernameと公式ユーザーIDの組み合わせを確認しました。以前のハンドル競合は解消しましたが、次の行動は現在のプロフィールを確認してから判断します。',
        strategy: '現在の公式プロフィールと発信を確認し、過去の別アカウント履歴を混ぜずに関係を再評価します。',
        tags: stableExisting.tags.filter((tag) => tag !== 'identity-conflict'),
      } : {}),
    });
  }

  if (!legacyIdentityAliases.size && !conflictingRemovedIds.size && !updates.size) return state;

  const candidates = state.candidates
    .filter((candidate) => !legacyIdentityAliases.has(candidate.id) && !conflictingRemovedIds.has(candidate.id))
    .map((candidate) => updates.get(candidate.id) || candidate);
  const interactions = state.interactions
    .map((interaction) => {
      const candidateId = resolveIdentityAlias(interaction.candidateId, legacyIdentityAliases);
      return candidateId === interaction.candidateId ? interaction : { ...interaction, candidateId };
    })
    .filter((interaction) => !conflictingRemovedIds.has(interaction.candidateId));

  return { ...state, candidates, interactions };
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
      stage: active && isFollowing ? 'following' as const : active && isFollower ? 'engaged' as const : 'discovered' as const,
      reason: 'Xの公式ユーザーIDが以前の記録と異なります。同じ@usernameを別アカウントが使用している可能性があるため、過去の関係履歴を新しい相手へ引き継がず再確認します。',
      strategy: '以前の相手と同一人物だと推測せず、現在の公式プロフィールと発信からMissionとの相性をあらためて判断します。',
      tags: [],
      recommendedAction: 'review' as const,
      draft: undefined,
      engagementUrl: undefined,
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

function preservePostSnapshotFollowState(before: AppState, after: AppState, result: XOwnedSyncResponse): AppState {
  if (!result.enabled || !result.startedAt) return after;
  const startedAtMs = new Date(result.startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) return after;
  const beforeById = new Map(before.candidates.map((candidate) => [candidate.id, candidate]));
  let changed = false;
  const candidates = after.candidates.map((candidate) => {
    const prior = beforeById.get(candidate.id);
    if (!prior?.followedAt) return candidate;
    const followedAtMs = new Date(prior.followedAt).getTime();
    if (!Number.isFinite(followedAtMs) || followedAtMs <= startedAtMs) return candidate;
    // This follow began after the server captured the X observation boundary. A complete
    // following/followers snapshot (including a 20-hour cache) cannot prove absence or a
    // non-follow-back about that newer follow. Restore wiped follow state and reject
    // negatives until a later fresh cycle actually observes the post-boundary follow.
    let next = candidate;
    let localChanged = false;
    if (!candidate.followedAt) {
      next = { ...next, followedAt: prior.followedAt };
      localChanged = true;
    }
    if (candidate.followBack === false && prior.followBack !== false) {
      next = {
        ...next,
        followBack: prior.followBack,
        recommendedAction: next.recommendedAction === 'unfollow_review' ? 'review' as const : next.recommendedAction,
      };
      localChanged = true;
    }
    if (localChanged) changed = true;
    return localChanged ? next : candidate;
  });
  return changed ? { ...after, candidates } : after;
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
  const targetByKey = new Map(evidence.targets.map((target) => [target.key, target]));
  if (!seen.size && !unseen.size) return state;

  const now = Date.now();
  const waitDays = Math.max(1, Math.min(180, state.relationshipPolicy.followBackReviewAfterDays));
  const snapshotStartedAtMs = result.startedAt ? new Date(result.startedAt).getTime() : Number.NaN;
  const candidates = state.candidates.map((candidate) => {
    if (candidate.skipped || candidate.platform !== 'x' || !candidate.followedAt) return candidate;
    // Restored handle conflicts are deliberately non-executable until official identity
    // reconciliation resolves them. Never let an older/cached full-cycle result turn the
    // quarantine back into follow-back or unfollow advice.
    if (candidate.tags.includes('identity-conflict')) return candidate;
    if (identityChangedIds.has(candidate.id)) return candidate;
    const target = targetByKey.get(candidate.id);
    // The async X result may arrive after a JSON/D1 restore replaced the candidate that
    // originally owned this ID. Apply full-cycle proof only when the current candidate is
    // still the exact tracked handle/immutable identity. If an immutable ID was not known
    // when the cycle began, fail closed once the current candidate has gained one and wait
    // for the next cycle to prove the binding using that ID.
    if (!target || !matchesFollowEvidenceTarget(candidate, target)) return candidate;
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
    // A complete cycle can still be stale relative to a follow recorded while this sync
    // was running (or after a cached snapshot was created). Never turn that newer follow
    // into a negative; a later cycle must observe it first.
    if (Number.isFinite(snapshotStartedAtMs) && Number.isFinite(followedAt) && followedAt > snapshotStartedAtMs) return candidate;
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

function matchesFollowEvidenceTarget(candidate: Candidate, target: XFollowEvidenceTarget) {
  if (candidate.username.toLowerCase() !== target.username.toLowerCase()) return false;
  if (target.platformUserId) return candidate.platformUserId === target.platformUserId;
  return !candidate.platformUserId;
}

function uniqueOwnedUsers(users: XOwnedUser[]) {
  const byId = new Map<string, XOwnedUser>();
  for (const user of users) byId.set(user.id, user);
  return [...byId.values()];
}

function stableXId(value?: string | null) {
  const id = value?.trim() || '';
  return /^\d{1,30}$/.test(id) ? id : '';
}

function sameUsername(left?: string, right?: string) {
  return (left || '').trim().replace(/^@/, '').toLowerCase() === (right || '').trim().replace(/^@/, '').toLowerCase();
}

function preferXIdentityCandidate(left: Candidate, right: Candidate, officialUsername?: string) {
  const leftMatchesOfficial = Boolean(officialUsername && left.username.toLowerCase() === officialUsername);
  const rightMatchesOfficial = Boolean(officialUsername && right.username.toLowerCase() === officialUsername);
  if (leftMatchesOfficial !== rightMatchesOfficial) return rightMatchesOfficial ? right : left;
  const leftInteraction = safeTime(left.lastInteractionAt);
  const rightInteraction = safeTime(right.lastInteractionAt);
  if (leftInteraction !== rightInteraction) return rightInteraction > leftInteraction ? right : left;
  if (left.relationshipScore !== right.relationshipScore) return right.relationshipScore > left.relationshipScore ? right : left;
  if (Boolean(left.skipped) !== Boolean(right.skipped)) return left.skipped ? right : left;
  const leftProfile = safeTime(left.profileSyncedAt);
  const rightProfile = safeTime(right.profileSyncedAt);
  if (leftProfile !== rightProfile) return rightProfile > leftProfile ? right : left;
  return left.id.localeCompare(right.id) <= 0 ? left : right;
}

function resolveIdentityAlias(candidateId: string, aliases: Map<string, string>) {
  let current = candidateId;
  const seen = new Set<string>();
  while (aliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = aliases.get(current)!;
  }
  return current;
}

function safeTime(value?: string | null) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}
