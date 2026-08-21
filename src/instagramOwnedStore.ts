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
    const relationshipScore = Math.min(85, 28 + engager.commentCount * 9 + Math.max(0, engager.mediaCount - 1) * 5);
    const match = Math.min(88, 68 + Math.min(20, engager.commentCount * 4));
    const reason = engager.commentCount > 1
      ? `あなたのInstagram投稿に${engager.commentCount}回コメント済み。すでに接点があるため、新規の無関係候補より交流優先度が高いです。`
      : 'あなたのInstagram投稿にコメント済み。すでに自然な接点があるため、関係を深める候補です。';
    const strategy = engager.lastCommentText
      ? `直近コメント「${engager.lastCommentText.slice(0, 120)}」の文脈から、まず自然に返信・プロフィール確認を優先。いきなり営業DMには進めません。`
      : '既に相手から反応があるため、まずコメント文脈の確認や自然な返信を優先します。';

    if (existing) {
      updates.set(existing.id, {
        ...existing,
        engagementUrl: engager.latestMediaPermalink || existing.engagementUrl,
        relationshipScore: Math.max(existing.relationshipScore, relationshipScore),
        match: Math.max(existing.match, match),
        stage: promoteStage(existing.stage),
        reason,
        strategy,
        recommendedAction: existing.recommendedAction === 'unfollow_review' ? existing.recommendedAction : 'reply',
        platformUserId: engager.id || existing.platformUserId,
        profileSyncedAt: syncedAt,
        lastInteractionAt: engager.lastCommentAt || existing.lastInteractionAt,
        tags: [...new Set([...existing.tags, 'inbound', 'commenter'])],
      });
      continue;
    }

    additions.push({
      id: `instagram-engager-${crypto.randomUUID()}`,
      platform: 'instagram',
      username: engager.username,
      displayName: engager.username,
      bio: '',
      profileUrl: engager.profileUrl,
      engagementUrl: engager.latestMediaPermalink || undefined,
      platformUserId: engager.id,
      profileSyncedAt: syncedAt,
      kind: 'fan',
      match,
      relationshipScore,
      stage: 'engaged',
      reason,
      strategy,
      tags: ['inbound', 'commenter'],
      recommendedAction: 'reply',
      lastInteractionAt: engager.lastCommentAt || syncedAt,
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

function promoteStage(stage: Candidate['stage']): Candidate['stage'] {
  if (stage === 'discovered' || stage === 'interested' || stage === 'following') return 'engaged';
  return stage;
}
