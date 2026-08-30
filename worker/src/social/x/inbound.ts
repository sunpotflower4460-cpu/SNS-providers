export interface XInboundTweet {
  id?: unknown;
  text?: unknown;
  author_id?: unknown;
  conversation_id?: unknown;
  created_at?: unknown;
  in_reply_to_user_id?: unknown;
}

export interface XInboundUser {
  id?: unknown;
  username?: unknown;
  name?: unknown;
}

export interface NormalizedXSocialEvent {
  id: string;
  platform: 'x';
  type: 'mention' | 'reply';
  externalEventId: string;
  externalUserId?: string;
  text?: string;
  conversationId?: string;
  contentId: string;
  parentContentId?: string;
  permalink?: string;
  occurredAt: string;
  receivedAt: string;
}

export function normalizeXInboundEvents(
  tweets: unknown,
  users: unknown,
  receivedAt: string,
): NormalizedXSocialEvent[] {
  if (!Array.isArray(tweets)) return [];
  const userById = new Map<string, XInboundUser>();
  if (Array.isArray(users)) {
    for (const user of users) {
      if (!isRecord(user) || typeof user.id !== 'string' || !/^\d{1,30}$/.test(user.id)) continue;
      userById.set(user.id, user);
    }
  }

  const events: NormalizedXSocialEvent[] = [];
  const seen = new Set<string>();
  for (const tweet of tweets) {
    const event = normalizeXTweet(tweet, userById, receivedAt);
    if (!event || seen.has(event.externalEventId)) continue;
    seen.add(event.externalEventId);
    events.push(event);
  }
  return events;
}

function normalizeXTweet(
  tweet: unknown,
  userById: Map<string, XInboundUser>,
  receivedAt: string,
): NormalizedXSocialEvent | null {
  if (!isRecord(tweet) || typeof tweet.id !== 'string' || !/^\d{1,30}$/.test(tweet.id)) return null;
  const authorId = typeof tweet.author_id === 'string' && /^\d{1,30}$/.test(tweet.author_id) ? tweet.author_id : '';
  const username = authorId && typeof userById.get(authorId)?.username === 'string'
    ? sanitizeXUsername(String(userById.get(authorId)?.username))
    : '';
  const createdAt = typeof tweet.created_at === 'string' && validPastishIso(tweet.created_at) ? tweet.created_at : receivedAt;
  const text = typeof tweet.text === 'string' ? tweet.text.trim().slice(0, 4000) : '';
  const conversationId = typeof tweet.conversation_id === 'string' && /^\d{1,30}$/.test(tweet.conversation_id)
    ? tweet.conversation_id
    : undefined;
  const isReply = typeof tweet.in_reply_to_user_id === 'string' && /^\d{1,30}$/.test(tweet.in_reply_to_user_id);
  return {
    id: `x-${isReply ? 'reply' : 'mention'}-${tweet.id}`,
    platform: 'x',
    type: isReply ? 'reply' : 'mention',
    externalEventId: tweet.id,
    externalUserId: authorId || undefined,
    text: text || undefined,
    conversationId,
    contentId: tweet.id,
    permalink: username ? `https://x.com/${username}/status/${tweet.id}` : undefined,
    occurredAt: createdAt,
    receivedAt,
  };
}

function sanitizeXUsername(value: string) {
  const username = value.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';
}

function validPastishIso(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() + 5 * 60 * 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
