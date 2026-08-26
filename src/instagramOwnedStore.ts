import type { InstagramEngagerSyncResponse } from './instagramAccount';
import type { AppState, Candidate } from './types';

export function applyInstagramEngagers(state: AppState, result: InstagramEngagerSyncResponse): AppState {
  if (!result.enabled) return state;
  const syncedAt = result.syncedAt || new Date().toISOString();
  const instagramCandidates = state.candidates.filter((candidate) => candidate.platform === 'instagram');

  // Older app versions merged Instagram commenters by handle only. A rename could
  // therefore leave two CRM records carrying the same immutable Graph user ID. Collapse
  // those legacy duplicates first and remap their interactions to one deterministic
  // survivor so history stays attached to the person rather than to an old handle.
  const legacyIdentityAliases = new Map<string, string>();
  const byStableId = new Map<string, Candidate>();
  for (const candidate of instagramCandidates) {
    const stableId = stableInstagramId(candidate.platformUserId);
    if (!stableId) continue;
    const previous = byStableId.get(stableId);
    if (!previous) {
      byStableId.set(stableId, candidate);
      continue;
    }
    const preferred = preferIdentityCandidate(previous, candidate);
    const duplicate = preferred.id === previous.id ? candidate : previous;
    byStableId.set(stableId, preferred);
    legacyIdentityAliases.set(duplicate.id, preferred.id);
  }

  const canonicalInstagramCandidates = instagramCandidates.filter((candidate) => !legacyIdentityAliases.has(candidate.id));
  const byUsername = new Map(canonicalInstagramCandidates.map((candidate) => [candidate.username.toLowerCase(), candidate]));
  const additions: Candidate[] = [];
  const updates = new Map<string, Candidate>();
  const identityResetIds = new Set<string>();
  const conflictingRemovedIds = new Set<string>();

  for (const engager of result.engagers || []) {
    const username = engager.username.trim().replace(/^@/, '').toLowerCase();
    if (!username) continue;
    const incomingStableId = stableInstagramId(engager.id);
    const stableExisting = incomingStableId ? byStableId.get(incomingStableId) : undefined;
    const usernameExisting = byUsername.get(username);

    // A numeric Graph user ID is the authoritative identity. If the same person renamed
    // their Instagram handle, merge the new comment signal into that existing CRM record
    // instead of creating a second candidate. If the new handle also points at a stale
    // different-ID candidate, discard that ambiguous stale record rather than attaching
    // its history to the current immutable identity.
    if (stableExisting && usernameExisting && stableExisting.id !== usernameExisting.id) {
      conflictingRemovedIds.add(usernameExisting.id);
      updates.delete(usernameExisting.id);
    }
    const existing = stableExisting || usernameExisting;
    const freshContact = !existing?.skipped || isFreshCommentAfterDismissal(existing, engager.lastCommentAt);
    const newCommentSignal = existing ? isNewerCommentSignal(existing, engager.lastCommentAt) : Boolean(engager.lastCommentAt);
    const relationshipScore = Math.min(85, 28 + engager.commentCount * 9 + Math.max(0, engager.mediaCount - 1) * 5);
    const match = Math.min(88, 68 + Math.min(20, engager.commentCount * 4));
    const baseReason = engager.commentCount > 1
      ? `あなたのInstagram投稿に${engager.commentCount}回コメント済み。すでに接点があるため、新規の無関係候補より交流優先度が高いです。`
      : 'あなたのInstagram投稿にコメント済み。すでに自然な接点があるため、関係を深める候補です。';
    const reason = existing?.skipped && freshContact
      ? `過去に候補から外していましたが、その後の新しいInstagramコメント接点を確認したため再確認候補へ戻しました。${baseReason}`
      : baseReason;
    const strategy = engager.lastCommentText
      ? `直近コメント「${engager.lastCommentText.slice(0, 120)}」の文脈から、まず自然に返信・プロフィール確認を優先。いきなり営業DMには進めません。`
      : '既に相手から反応があるため、まずコメント文脈の確認や自然な返信を優先します。';

    if (existing) {
      const existingStableId = stableInstagramId(existing.platformUserId);
      const identityChanged = Boolean(existingStableId && incomingStableId && existingStableId !== incomingStableId);
      const renamed = existing.username.toLowerCase() !== username;

      if (identityChanged) {
        identityResetIds.add(existing.id);
        const engagementUrl = engager.latestMediaPermalink || undefined;
        const recommendedAction: Candidate['recommendedAction'] = engagementUrl ? 'reply' : 'review';
        updates.set(existing.id, {
          ...existing,
          username: engager.username,
          displayName: sameUsername(existing.displayName, existing.username) ? engager.username : existing.displayName,
          skipped: false,
          snoozedUntil: undefined,
          profileUrl: engager.profileUrl,
          engagementUrl,
          platformUserId: incomingStableId,
          profileSyncedAt: syncedAt,
          kind: 'fan',
          match,
          relationshipScore,
          stage: 'engaged',
          reason: `Instagramの公式ユーザーIDが以前の記録と異なります。同じ@usernameを別アカウントが使用している可能性があるため、過去の関係履歴を新しい相手へ引き継がず再確認します。${baseReason}`,
          strategy: engagementUrl
            ? strategy
            : '新しいアカウントからのコメント接点は確認できましたが対象投稿URLがないため、古い投稿を流用せずプロフィールから確認します。',
          tags: ['inbound', 'commenter'],
          recommendedAction,
          draft: undefined,
          followedAt: undefined,
          followBack: null,
          lastInteractionAt: latestIso(undefined, engager.lastCommentAt) || syncedAt,
        });
        continue;
      }

      // A cached/old comment must not undo an explicit user dismissal. Only a comment
      // whose timestamp is newer than the dismissal/last known signal may reactivate it.
      // Identity metadata is different: if Graph proves the same immutable person merely
      // changed handle, keep the dismissed record dismissed but update its current route.
      if (existing.skipped && !freshContact) {
        if (stableExisting && renamed) {
          updates.set(existing.id, {
            ...existing,
            username: engager.username,
            displayName: sameUsername(existing.displayName, existing.username) ? engager.username : existing.displayName,
            profileUrl: engager.profileUrl,
            platformUserId: incomingStableId || existing.platformUserId,
            profileSyncedAt: syncedAt,
          });
        }
        continue;
      }

      // Do not replay the same inbound comment after the user already handled it. A
      // completed reply/like clears the exact target; cached syncs must not recreate the
      // old action unless Instagram reports a genuinely newer comment timestamp.
      // A genuinely newer comment must also carry its own media target. Reusing an older
      // engagementUrl would send the user to the wrong post when the new media permalink
      // is unavailable, so that case intentionally falls back to review.
      const newEngagementUrl = newCommentSignal ? engager.latestMediaPermalink || undefined : undefined;
      const engagementUrl = newCommentSignal ? newEngagementUrl : existing.engagementUrl;
      const recommendedAction: Candidate['recommendedAction'] = newCommentSignal
        ? newEngagementUrl ? 'reply' : 'review'
        : existing.recommendedAction;
      const refreshOpportunityCopy = newCommentSignal || (existing.skipped && freshContact);
      const exactTargetStrategy = newCommentSignal && !newEngagementUrl
        ? '新しいInstagramコメントは確認できましたが、対象投稿URLを取得できなかったため古い投稿を流用せず、プロフィールから内容を確認します。'
        : strategy;
      // A username-based fallback ID is not immutable. Never let it overwrite a numeric
      // Graph user ID already known for this candidate; upgrade fallback -> numeric when
      // possible, but only compare two numeric IDs for identity-change detection above.
      const platformUserId = incomingStableId || existingStableId || engager.id || existing.platformUserId;

      updates.set(existing.id, {
        ...existing,
        username: engager.username,
        displayName: renamed && sameUsername(existing.displayName, existing.username) ? engager.username : existing.displayName,
        profileUrl: engager.profileUrl,
        skipped: false,
        engagementUrl,
        relationshipScore: Math.max(existing.relationshipScore, relationshipScore),
        match: Math.max(existing.match, match),
        stage: promoteStage(existing.stage),
        reason: refreshOpportunityCopy ? reason : existing.reason,
        strategy: refreshOpportunityCopy ? exactTargetStrategy : existing.strategy,
        recommendedAction,
        draft: recommendedAction === 'reply' ? existing.draft : undefined,
        platformUserId,
        profileSyncedAt: syncedAt,
        lastInteractionAt: latestIso(existing.lastInteractionAt, engager.lastCommentAt),
        tags: [...new Set([...existing.tags, 'inbound', 'commenter'])],
      });
      continue;
    }

    const engagementUrl = engager.latestMediaPermalink || undefined;
    const recommendedAction: Candidate['recommendedAction'] = engagementUrl ? 'reply' : 'review';
    additions.push({
      id: `instagram-engager-${crypto.randomUUID()}`,
      platform: 'instagram',
      username: engager.username,
      displayName: engager.username,
      bio: '',
      profileUrl: engager.profileUrl,
      engagementUrl,
      platformUserId: engager.id,
      profileSyncedAt: syncedAt,
      kind: 'fan',
      match,
      relationshipScore,
      stage: 'engaged',
      reason,
      strategy,
      tags: ['inbound', 'commenter'],
      recommendedAction,
      lastInteractionAt: latestIso(undefined, engager.lastCommentAt) || syncedAt,
    });
  }

  const candidates = state.candidates
    .filter((candidate) => !legacyIdentityAliases.has(candidate.id) && !conflictingRemovedIds.has(candidate.id))
    .map((candidate) => updates.get(candidate.id) || candidate);
  const invalidInteractionCandidateIds = new Set([...identityResetIds, ...conflictingRemovedIds]);
  const interactions = state.interactions
    .map((interaction) => {
      const candidateId = resolveIdentityAlias(interaction.candidateId, legacyIdentityAliases);
      return candidateId === interaction.candidateId ? interaction : { ...interaction, candidateId };
    })
    .filter((interaction) => !invalidInteractionCandidateIds.has(interaction.candidateId));

  return {
    ...state,
    candidates: [...additions, ...candidates],
    interactions,
    instagramAccount: {
      lastSyncedAt: syncedAt,
      mediaScanned: result.mediaScanned || 0,
      commentEvents: result.commentEvents || 0,
      engagerCount: result.engagers?.length || 0,
    },
  };
}

function stableInstagramId(value?: string | null) {
  const id = value?.trim() || '';
  return /^\d{1,30}$/.test(id) ? id : '';
}

function sameUsername(left?: string, right?: string) {
  return (left || '').trim().replace(/^@/, '').toLowerCase() === (right || '').trim().replace(/^@/, '').toLowerCase();
}

function preferIdentityCandidate(left: Candidate, right: Candidate) {
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

function isFreshCommentAfterDismissal(candidate: Candidate, incomingAt: string | null) {
  if (!incomingAt) return false;
  const incoming = new Date(incomingAt).getTime();
  if (!Number.isFinite(incoming)) return false;
  const baselines = [candidate.lastInteractionAt, candidate.profileSyncedAt]
    .map((value) => value ? new Date(value).getTime() : Number.NaN)
    .filter(Number.isFinite);
  if (!baselines.length) return false;
  return incoming > Math.max(...baselines);
}

function isNewerCommentSignal(candidate: Candidate, incomingAt: string | null) {
  if (!incomingAt) return false;
  const incoming = new Date(incomingAt).getTime();
  if (!Number.isFinite(incoming)) return false;
  if (!candidate.lastInteractionAt) return true;
  const handled = new Date(candidate.lastInteractionAt).getTime();
  return !Number.isFinite(handled) || incoming > handled;
}

function latestIso(current?: string, incoming?: string | null) {
  const currentMs = current ? new Date(current).getTime() : Number.NaN;
  const incomingMs = incoming ? new Date(incoming).getTime() : Number.NaN;
  if (Number.isFinite(currentMs) && Number.isFinite(incomingMs)) return incomingMs > currentMs ? incoming! : current!;
  if (Number.isFinite(incomingMs)) return incoming!;
  if (Number.isFinite(currentMs)) return current!;
  return undefined;
}

function promoteStage(stage: Candidate['stage']): Candidate['stage'] {
  if (stage === 'discovered' || stage === 'interested' || stage === 'following') return 'engaged';
  return stage;
}