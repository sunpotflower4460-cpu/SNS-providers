import { fetchWithTimeout } from '../../fetchWithTimeout';
import { classifyProviderHttpStatus, providerErrorDetail } from '../httpStatus';
import type { ProviderWriteResult } from '../types';

const OBJECT_ID = /^\d{1,36}$/;
const MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface InstagramDmSendInput {
  igUserId: string;
  recipientId: string;
  message: string;
  accessToken: string;
  apiVersion: string;
  lastInboundAt?: string;
}

export interface NormalizedInstagramDmEvent {
  id: string;
  platform: 'instagram';
  type: 'dm';
  externalEventId: string;
  externalUserId?: string;
  conversationId?: string;
  conversationUnresolved?: boolean;
  username?: string;
  displayName?: string;
  text?: string;
  occurredAt: string;
  receivedAt: string;
  ownMessage: boolean;
  recipientProfessionalId?: string;
}

export function instagramMessagingWindowOpen(lastInboundAt: string | undefined, nowMs = Date.now()) {
  if (!lastInboundAt) return false;
  const occurred = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(occurred)) return false;
  if (occurred > nowMs + 5 * 60 * 1000) return false;
  return nowMs - occurred <= MESSAGE_WINDOW_MS;
}

export async function sendInstagramDm(input: InstagramDmSendInput): Promise<ProviderWriteResult> {
  if (!OBJECT_ID.test(input.igUserId) || !OBJECT_ID.test(input.recipientId)) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'BINDING_MISMATCH',
      reason: 'Instagram DM requires a professional account ID and Instagram-scoped recipient ID.',
      providerStatus: 'invalid_target',
    };
  }
  if (input.igUserId === input.recipientId) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'INVALID_ACTION',
      reason: 'Cannot send an Instagram DM to the authenticated account.',
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
  if (!instagramMessagingWindowOpen(input.lastInboundAt)) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'EXPIRED',
      reason: 'Instagram messaging window has expired. Policy allows a reply only within 24 hours of the last inbound message.',
      providerStatus: 'expired_window',
    };
  }
  if (!/^v\d+\.\d+$/.test(input.apiVersion) || !input.accessToken.trim()) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'WRITE_DISABLED',
      reason: 'Instagram write adapter is not configured.',
      providerStatus: 'unconfigured',
    };
  }

  const url = `https://graph.instagram.com/${input.apiVersion}/${encodeURIComponent(input.igUserId)}/messages`;
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: input.recipientId },
        message: { text: message.slice(0, 1000) },
      }),
    }, 30_000, 'Instagram DM send');
    const payload = await response.json().catch(() => null) as {
      message_id?: unknown;
      recipient_id?: unknown;
      error?: { message?: string };
    } | null;
    const classified = classifyProviderHttpStatus(response.status);
    if (classified === 'success') {
      const messageId = typeof payload?.message_id === 'string' ? payload.message_id : '';
      if (!messageId) {
        return {
          certainty: 'unknown',
          retryable: false,
          errorCode: 'UNKNOWN_RESULT',
          reason: 'Instagram accepted the DM but did not return a message_id.',
          providerStatus: String(response.status),
        };
      }
      return {
        certainty: 'success',
        externalResultId: messageId,
        providerStatus: String(response.status),
        metadata: {
          messageId,
          recipientId: typeof payload?.recipient_id === 'string' ? payload.recipient_id : input.recipientId,
        },
      };
    }
    return {
      certainty: classified === 'failure' ? 'failure' : 'unknown',
      retryable: classified !== 'failure',
      errorCode: classified === 'failure' ? 'INVALID_ACTION' : 'UNKNOWN_RESULT',
      reason: `Instagram Graph API returned ${response.status}${providerErrorDetail(payload)}`,
      providerStatus: String(response.status),
    };
  } catch {
    return {
      certainty: 'unknown',
      retryable: false,
      errorCode: 'UNKNOWN_RESULT',
      reason: 'Instagram DM result is unknown because the provider response was lost.',
      providerStatus: 'network_unknown',
    };
  }
}

export function normalizeInstagramDmMessages(
  conversationId: string,
  messages: unknown,
  ownUserId: string,
  receivedAt: string,
  participant?: { id?: string; username?: string; name?: string },
): NormalizedInstagramDmEvent[] {
  if (!OBJECT_ID.test(conversationId) || !Array.isArray(messages)) return [];
  const events: NormalizedInstagramDmEvent[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const item = normalizeOne(conversationId, message, ownUserId, receivedAt, participant);
    if (!item || seen.has(item.externalEventId)) continue;
    seen.add(item.externalEventId);
    events.push(item);
  }
  return events;
}

function normalizeOne(
  conversationId: string,
  message: unknown,
  ownUserId: string,
  receivedAt: string,
  participant?: { id?: string; username?: string; name?: string },
): NormalizedInstagramDmEvent | null {
  if (!isRecord(message)) return null;
  const id = typeof message.id === 'string' && message.id.trim() ? message.id.trim() : '';
  if (!id) return null;
  const from = isRecord(message.from) && typeof message.from.id === 'string' ? message.from.id : '';
  const text = typeof message.message === 'string'
    ? message.message.trim().slice(0, 4000)
    : typeof message.text === 'string'
      ? message.text.trim().slice(0, 4000)
      : '';
  const created = typeof message.created_time === 'string' && validIso(message.created_time)
    ? message.created_time
    : receivedAt;
  const ownMessage = Boolean(from && from === ownUserId);
  return {
    id: `ig-dm-${id}`,
    platform: 'instagram',
    type: 'dm',
    externalEventId: id,
    externalUserId: ownMessage ? undefined : (from || undefined),
    conversationId,
    conversationUnresolved: false,
    username: !ownMessage && participant?.username ? participant.username : undefined,
    displayName: !ownMessage && participant?.name ? participant.name : undefined,
    text: text || undefined,
    occurredAt: created,
    receivedAt,
    ownMessage,
  };
}

function validIso(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
