import type { Candidate, RecommendedAction } from './types';

const inboundReplyTags = new Set(['inbound', 'commenter', 'mention']);

/**
 * Action shown in Today/Discover/handoff without a live Worker/LLM call.
 * Last-known recommendedAction wins when it is already executable. Otherwise
 * infer follow/like/reply from stored relationship evidence only — never invent people.
 */
export function queueAction(candidate: Candidate): RecommendedAction {
  if (candidate.tags.includes('identity-conflict')) return 'review';

  const stored = candidate.recommendedAction;
  if (stored === 'unfollow_review') return 'unfollow_review';
  if (stored === 'dm') return 'dm';
  if ((candidate.recommendedAction === 'like' || candidate.recommendedAction === 'reply') && !candidate.engagementUrl) {
    return localFallbackAction(candidate);
  }
  if (stored === 'follow' || stored === 'like' || stored === 'reply') return stored;
  return localFallbackAction(candidate);
}

export function isExecutableQueueAction(action: RecommendedAction) {
  return action === 'follow'
    || action === 'like'
    || action === 'reply'
    || action === 'dm'
    || action === 'unfollow_review';
}

function localFallbackAction(candidate: Candidate): RecommendedAction {
  const inboundReply = candidate.tags.some((tag) => inboundReplyTags.has(tag));
  if (inboundReply && candidate.engagementUrl) return 'reply';
  if (!candidate.followedAt) return 'follow';
  if (candidate.engagementUrl) return 'like';
  return 'review';
}
