export interface InstagramCommentEventInput {
  latestCommentId: string | null;
  mediaId: string | null;
  lastCommentText: string;
  lastCommentAt: string | null;
  latestMediaPermalink: string | null;
  engagerId: string;
  username: string;
}

export interface NormalizedSocialEvent {
  id: string;
  platform: 'instagram';
  type: 'comment';
  externalEventId: string;
  externalUserId?: string;
  text?: string;
  contentId: string;
  parentContentId: string;
  permalink?: string;
  occurredAt: string;
  receivedAt: string;
}

export function instagramCommentEvent(input: InstagramCommentEventInput, receivedAt: string): NormalizedSocialEvent | null {
  if (!input.latestCommentId || !input.mediaId) return null;
  if (input.lastCommentAt && Number.isNaN(new Date(input.lastCommentAt).getTime())) return null;
  return {
    id: `ig-comment-${input.latestCommentId}`,
    platform: 'instagram',
    type: 'comment',
    externalEventId: input.latestCommentId,
    externalUserId: input.engagerId,
    text: input.lastCommentText || undefined,
    contentId: input.latestCommentId,
    parentContentId: input.mediaId,
    permalink: input.latestMediaPermalink || undefined,
    occurredAt: input.lastCommentAt || receivedAt,
    receivedAt,
  };
}

export function sameLatestCommentEvent(input: InstagramCommentEventInput) {
  const hasAny = Boolean(input.lastCommentAt || input.latestCommentId || input.mediaId || input.lastCommentText || input.latestMediaPermalink);
  if (!hasAny) return true;
  return Boolean(input.latestCommentId && input.mediaId);
}
