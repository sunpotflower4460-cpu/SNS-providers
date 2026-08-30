import { fetchWithTimeout } from '../../fetchWithTimeout';
import type { ProviderWriteResult } from '../types';

export interface InstagramReplyInput {
  commentId: string;
  message: string;
  accessToken: string;
  apiVersion: string;
}

const COMMENT_ID = /^\d{1,30}$/;

export async function replyToInstagramComment(input: InstagramReplyInput): Promise<ProviderWriteResult> {
  if (!COMMENT_ID.test(input.commentId)) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'BINDING_MISMATCH',
      reason: 'Instagram comment id is missing or malformed.',
      providerStatus: 'invalid_target',
    };
  }
  const message = input.message.trim();
  if (!message) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'INVALID_ACTION',
      reason: 'User-approved reply text is required.',
      providerStatus: 'invalid_message',
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

  const url = `https://graph.instagram.com/${input.apiVersion}/${encodeURIComponent(input.commentId)}/replies`;
  const body = new URLSearchParams({ message: message.slice(0, 2200) });
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    }, 30_000, 'Instagram comment reply');
    const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: string; code?: unknown } } | null;
    if (response.ok) {
      const id = typeof payload?.id === 'string' && /^\d{1,30}$/.test(payload.id) ? payload.id : '';
      if (!id) {
        return {
          certainty: 'unknown',
          retryable: false,
          errorCode: 'UNKNOWN_RESULT',
          reason: 'Instagram accepted the reply but did not return a confirmed comment id.',
          providerStatus: String(response.status),
        };
      }
      return {
        certainty: 'success',
        externalResultId: id,
        providerStatus: String(response.status),
      };
    }
    const retryable = response.status === 429 || response.status >= 500;
    const detail = payload?.error?.message ? `: ${payload.error.message.slice(0, 180)}` : '';
    return {
      certainty: retryable ? 'unknown' : 'failure',
      retryable,
      errorCode: retryable ? 'UNKNOWN_RESULT' : 'INVALID_ACTION',
      reason: `Instagram Graph API returned ${response.status}${detail}`,
      providerStatus: String(response.status),
    };
  } catch {
    return {
      certainty: 'unknown',
      retryable: false,
      errorCode: 'UNKNOWN_RESULT',
      reason: 'Instagram reply result is unknown because the provider response was lost.',
      providerStatus: 'network_unknown',
    };
  }
}
