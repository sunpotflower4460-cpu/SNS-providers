import type { Platform, SocialEvent, SocialEventType } from './types';

const EVENT_TYPES = new Set<SocialEventType>(['mention', 'reply', 'comment', 'dm', 'follow']);
const MAX_TEXT = 4_000;
const MAX_ID = 180;

export function socialEventKey(event: Pick<SocialEvent, 'platform' | 'type' | 'externalEventId'>) {
  return `${event.platform}:${event.type}:${event.externalEventId}`;
}

export function normalizeSocialEvent(raw: unknown): SocialEvent | null {
  if (!isRecord(raw)) return null;
  const platform = raw.platform === 'x' || raw.platform === 'instagram' ? raw.platform as Platform : '';
  const type = typeof raw.type === 'string' && EVENT_TYPES.has(raw.type as SocialEventType)
    ? raw.type as SocialEventType
    : '';
  const id = safeId(raw.id);
  const externalEventId = safeId(raw.externalEventId);
  const occurredAt = validPastishIso(raw.occurredAt);
  const receivedAt = validPastishIso(raw.receivedAt);
  if (!platform || !type || !id || !externalEventId || !occurredAt || !receivedAt) return null;

  return {
    id,
    platform,
    type,
    externalEventId,
    externalUserId: safeId(raw.externalUserId) || undefined,
    text: safeText(raw.text, MAX_TEXT) || undefined,
    conversationId: safeId(raw.conversationId) || undefined,
    contentId: safeId(raw.contentId) || undefined,
    parentContentId: safeId(raw.parentContentId) || undefined,
    permalink: typeof raw.permalink === 'string' ? raw.permalink.slice(0, 2000) : undefined,
    occurredAt,
    receivedAt,
    rawHash: safeId(raw.rawHash) || undefined,
  };
}

function safeId(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_ID) : '';
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validPastishIso(value: unknown) {
  if (typeof value !== 'string' || !value) return '';
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() + 5 * 60 * 1000
    ? new Date(time).toISOString()
    : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
