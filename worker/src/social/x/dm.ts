import { fetchWithTimeout } from '../../fetchWithTimeout';
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

export function normalizeXDmEvents(
  events: unknown,
  ownUserId: string,
  receivedAt: string,
): NormalizedXDmEvent[] {
  if (!Array.isArray(events)) return [];
  const normalized: NormalizedXDmEvent[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const item = normalizeOne(event, ownUserId, receivedAt);
    if (!item || seen.has(item.externalEventId)) continue;
    seen.add(item.externalEventId);
    normalized.push(item);
  }
  return normalized;
}

function normalizeOne(event: unknown, ownUserId: string, receivedAt: string): NormalizedXDmEvent | null {
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
  return {
    id: `x-dm-${id}`,
    platform: 'x',
    type: 'dm',
    externalEventId: id,
    externalUserId: ownMessage ? undefined : (senderId || undefined),
    conversationId,
    text: text || undefined,
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
