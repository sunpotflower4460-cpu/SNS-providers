export function instagramCommentActionId(commentId: string) {
  return `sa-ig-comment-${commentId}`;
}

export function instagramCommentEventId(commentId: string) {
  return `ig-comment-${commentId}`;
}

export function instagramDmActionId(eventId: string) {
  return `sa-ig-dm-${eventId}`;
}

export function instagramDmEventRowId(eventId: string) {
  return `ig-dm-${eventId}`;
}

export function xInboundActionId(type: 'mention' | 'reply', tweetId: string) {
  return `sa-x-${type}-${tweetId}`;
}

export function xInboundEventRowId(type: 'mention' | 'reply', tweetId: string) {
  return `x-${type}-${tweetId}`;
}

export function xFollowActionId(targetUserId: string) {
  return `sa-x-follow-${targetUserId}`;
}

export function xUnfollowActionId(targetUserId: string) {
  return `sa-x-unfollow-${targetUserId}`;
}

export function xLikeActionId(tweetId: string) {
  return `sa-x-like-${tweetId}`;
}

export function xDmActionId(eventId: string) {
  return `sa-x-dm-${eventId}`;
}

export function xDmEventRowId(eventId: string) {
  return `x-dm-${eventId}`;
}

export function isCanonicalInstagramCommentActionId(actionId: string) {
  return /^sa-ig-comment-\d{1,30}$/.test(actionId);
}

export function isCanonicalXInboundActionId(actionId: string) {
  return /^sa-x-(?:mention|reply)-\d{1,30}$/.test(actionId);
}

export function isProviderCanonicalActionId(actionId: string) {
  return /^sa-(?:ig-comment|ig-dm|x-mention|x-reply|x-follow|x-unfollow|x-like|x-dm)-[A-Za-z0-9._-]{1,80}$/.test(actionId);
}

export const X_USER_ID = /^\d{1,30}$/;
export const X_TWEET_ID = /^\d{1,30}$/;
export const IG_OBJECT_ID = /^\d{1,30}$/;
