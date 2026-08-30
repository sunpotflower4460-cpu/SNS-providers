import { fetchWithTimeout } from '../../fetchWithTimeout';
import { queryRecord } from '../query';
import { classifyProviderHttpStatus, providerErrorDetail } from '../httpStatus';
import type { ProviderWriteResult } from '../types';

const CONVERSATION_ID = /^[A-Za-z0-9._-]{1,64}$/;
const EVENT_ID = /^[A-Za-z0-9._-]{1,64}$/;

export interface XDmSendInput {
  conversationId: string;
  message: string;
  accessToken: string;
}

export interface NormalizedXDmEvent {
  id: string;
  platform: 'x';
  type: 'dm';
  externalEventId: string;
  externalUserId?: string;
  conversationId: string;
  text?: string;
  username?: string;
  displayName?: string;
  occurredAt: string;
  receivedAt: string;
  ownMessage: boolean;
}

export async function sendXDm(input: XDmSendInput): Promise<ProviderWriteResult> {
  if (!CONVERSATION_ID.test(input.conversationId)) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'BINDING_MISMATCH',
      reason: 'X DM requires a canonical conversation ID from server evidence.',
      providerStatus: 'invalid_target',
    };
  }
  const message = input.message.trim();
  if (!message) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'INVALID_ACTION',
      reason: 'User-approved DM text is required.',
      providerStatus: 'invalid_message',
    };
  }
  if (!input.accessToken.trim()) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'WRITE_DISABLED',
      reason: 'X write adapter is not connected.',
      providerStatus: 'unconfigured',
    };
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.x.com/2/dm_conversations/${encodeURIComponent(input.conversationId)}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: message.slice(0, 2400) }),
      },
      30_000,
      'X DM send',
    );
    const payload = await response.json().catch(() => null) as {
      data?: { dm_conversation_id?: unknown; dm_event_id?: unknown };
      detail?: unknown;
      title?: unknown;
      errors?: Array<{ message?: unknown }>;
    } | null;
    const classified = classifyProviderHttpStatus(response.status);
    if (classified === 'success') {
      const conversationId = typeof payload?.data?.dm_conversation_id === 'string' ? payload.data.dm_conversation_id : '';
      const eventId = typeof payload?.data?.dm_event_id === 'string' ? payload.data.dm_event_id : '';
      if (!CONVERSATION_ID.test(conversationId) || !EVENT_ID.test(eventId)) {
        return {
          certainty: 'unknown',
          retryable: false,
          errorCode: 'UNKNOWN_RESULT',
          reason: 'X accepted the DM but did not return dm_conversation_id and dm_event_id.',
          providerStatus: String(response.status),
        };
      }
      if (conversationId !== input.conversationId) {
        return {
          certainty: 'unknown',
          retryable: false,
          errorCode: 'UNKNOWN_RESULT',
          reason: 'X DM response conversation id did not match the canonical target.',
          providerStatus: String(response.status),
        };
      }
      return {
        certainty: 'success',
        externalResultId: eventId,
        providerStatus: String(response.status),
        metadata: { conversationId, dmEventId: eventId },
      };
    }
    return {
      certainty: classified === 'failure' ? 'failure' : 'unknown',
      retryable: classified !== 'failure',
      errorCode: classified === 'failure' ? 'INVALID_ACTION' : 'UNKNOWN_RESULT',
      reason: `X API returned ${response.status}${providerErrorDetail(payload)}`,
      providerStatus: String(response.status),
    };
  } catch {
    return {
      certainty: 'unknown',
      retryable: false,
      errorCode: 'UNKNOWN_RESULT',
      reason: 'X DM result is unknown because the provider response was lost.',
      providerStatus: 'network_unknown',
    };
  }
}

export function xDmEventsUrl(paginationToken?: string) {
  const params = new URLSearchParams({
    max_results: '100',
    'dm_event.fields': 'id,text,event_type,dm_conversation_id,sender_id,created_at',
    event_types: 'MessageCreate',
    expansions: 'sender_id',
    'user.fields': 'username,name,profile_image_url',
  });
  if (paginationToken) params.set('pagination_token', paginationToken);
  return {
    method: 'GET',
    path: '/2/dm_events',
    url: `https://api.x.com/2/dm_events?${params.toString()}`,
    query: queryRecord(params),
  };
}

export async function paginateXDmEvents(input: {
  ownUserId: string;
  paginationToken?: string;
  knownNewest?: string;
  pendingNewestId?: string;
  maxPages: number;
  receivedAt: string;
  getJson: (url: string) => Promise<{ data?: unknown[]; includes?: { users?: unknown[] }; meta?: { next_token?: string } }>;
}) {
  let paginationToken = input.paginationToken;
  const knownNewest = input.knownNewest || '';
  let newestId = input.pendingNewestId || knownNewest;
  const allEvents: ReturnType<typeof normalizeXDmEvents> = [];
  let pages = 0;
  let complete = false;
  let reachedKnownBoundary = false;
  const requests: Array<{ method: string; path: string; url: string; query: Record<string, string> }> = [];
  while (pages < input.maxPages) {
    const request = xDmEventsUrl(paginationToken);
    requests.push(request);
    const payload = await input.getJson(request.url);
    pages += 1;
    const pageEvents = normalizeXDmEvents(payload.data || [], input.ownUserId, input.receivedAt, payload.includes?.users || []);
    for (const event of pageEvents) {
      if (knownNewest && event.externalEventId === knownNewest) reachedKnownBoundary = true;
      if (!newestId || event.externalEventId > newestId) newestId = event.externalEventId;
    }
    allEvents.push(...pageEvents);
    const next = typeof payload.meta?.next_token === 'string' ? payload.meta.next_token : '';
    if (!next || reachedKnownBoundary) {
      complete = true;
      paginationToken = undefined;
      break;
    }
    paginationToken = next;
  }
  return {
    events: allEvents,
    newestId,
    complete,
    continuation: complete ? null : (paginationToken || null),
    pages,
    requests,
  };
}

export function normalizeXDmEvents(
  events: unknown,
  ownUserId: string,
  receivedAt: string,
  users: unknown = [],
): NormalizedXDmEvent[] {
  if (!Array.isArray(events)) return [];
  const userById = new Map<string, { username?: string; name?: string }>();
  if (Array.isArray(users)) {
    for (const user of users) {
      if (!isRecord(user) || typeof user.id !== 'string') continue;
      userById.set(user.id, {
        username: typeof user.username === 'string' ? user.username : undefined,
        name: typeof user.name === 'string' ? user.name : undefined,
      });
    }
  }
  const normalized: NormalizedXDmEvent[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const item = normalizeOne(event, ownUserId, receivedAt, userById);
    if (!item || seen.has(item.externalEventId)) continue;
    seen.add(item.externalEventId);
    normalized.push(item);
  }
  return normalized;
}

function normalizeOne(
  event: unknown,
  ownUserId: string,
  receivedAt: string,
  userById: Map<string, { username?: string; name?: string }>,
): NormalizedXDmEvent | null {
  if (!isRecord(event)) return null;
  const id = typeof event.id === 'string' && EVENT_ID.test(event.id) ? event.id : '';
  const conversationId = typeof event.dm_conversation_id === 'string' && CONVERSATION_ID.test(event.dm_conversation_id)
    ? event.dm_conversation_id
    : '';
  if (!id || !conversationId) return null;
  const eventType = typeof event.event_type === 'string' ? event.event_type : '';
  if (eventType && eventType !== 'MessageCreate') return null;
  const senderId = typeof event.sender_id === 'string' && /^\d{1,30}$/.test(event.sender_id) ? event.sender_id : '';
  const text = typeof event.text === 'string' ? event.text.trim().slice(0, 4000) : '';
  const createdAt = typeof event.created_at === 'string' && validPastishIso(event.created_at) ? event.created_at : receivedAt;
  const ownMessage = Boolean(senderId && senderId === ownUserId);
  const profile = senderId ? userById.get(senderId) : undefined;
  return {
    id: `x-dm-${id}`,
    platform: 'x',
    type: 'dm',
    externalEventId: id,
    externalUserId: ownMessage ? undefined : (senderId || undefined),
    conversationId,
    text: text || undefined,
    username: profile?.username,
    displayName: profile?.name,
    occurredAt: createdAt,
    receivedAt,
    ownMessage,
  };
}

function validPastishIso(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() + 5 * 60 * 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
