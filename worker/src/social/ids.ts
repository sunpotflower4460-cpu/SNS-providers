export function instagramCommentActionId(commentId: string) {
  return `sa-ig-comment-${commentId}`;
}

export function instagramCommentEventId(commentId: string) {
  return `ig-comment-${commentId}`;
}

export function xInboundActionId(type: 'mention' | 'reply', tweetId: string) {
  return `sa-x-${type}-${tweetId}`;
}

export function xInboundEventRowId(type: 'mention' | 'reply', tweetId: string) {
  return `x-${type}-${tweetId}`;
}

export function isCanonicalInstagramCommentActionId(actionId: string) {
  return /^sa-ig-comment-\d{1,30}$/.test(actionId);
}

export function isCanonicalXInboundActionId(actionId: string) {
  return /^sa-x-(?:mention|reply)-\d{1,30}$/.test(actionId);
}
