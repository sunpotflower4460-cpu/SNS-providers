import type { InstagramEngagerSyncResponse } from './instagramAccount';
import type { AppState, Candidate } from './types';

export function applyInstagramEngagers(state: AppState, result: InstagramEngagerSyncResponse): AppState {
  if (!result.enabled) return state;
  const syncedAt = result.syncedAt || new Date().toISOString();
  const byUsername = new Map(state.candidates.filter((candidate) => candidate.platform === 'instagram').map((candidate) => [candidate.username.toLowerCase(), candidate]));
  const additions: Candidate[] = [];
  const updates = new Map<string, Candidate>();

  for (const engager of result.engagers || []) {
    const username = engager.username.trim().replace(/^@/, '').toLowerCase();
    if (!username) continue;
    const existing = byUsername.get(username);
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
      // A cached/old comment must not undo an explicit user dismissal. Only a comment
      // whose timestamp is newer than the dismissal/last known signal may reactivate it.
      if (existing.skipped && !freshContact) continue;

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

      updates.set(existing.id, {
        ...existing,
        skipped: false,
        engagementUrl,
        relationshipScore: Math.max(existing.relationshipScore, relationshipScore),
        match: Math.max(existing.match, match),
        stage: promoteStage(existing.stage),
        reason: refreshOpportunityCopy ? reason : existing.reason,
        strategy: refreshOpportunityCopy ? exactTargetStrategy : existing.strategy,
        recommendedAction,
        draft: recommendedAction === 'reply' ? existing.draft : undefined,
        platformUserId: engager.id || existing.platformUserId,
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

  const candidates = state.candidates.map((candidate) => updates.get(candidate.id) || candidate);
  return {
    ...state,
    candidates: [...additions, ...candidates],
    instagramAccount: {
      lastSyncedAt: syncedAt,
      mediaScanned: result.mediaScanned || 0,
      commentEvents: result.commentEvents || 0,
      engagerCount: result.engagers?.length || 0,
    },
  };
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
