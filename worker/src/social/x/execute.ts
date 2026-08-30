import { fetchWithTimeout } from '../../fetchWithTimeout';
import type { ProviderWriteResult } from '../types';

export interface XReplyInput {
  tweetId: string;
  message: string;
  accessToken: string;
}

const TWEET_ID = /^\d{1,30}$/;

export async function replyToXTweet(input: XReplyInput): Promise<ProviderWriteResult> {
  if (!TWEET_ID.test(input.tweetId)) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'BINDING_MISMATCH',
      reason: 'X tweet id is missing or malformed.',
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
    const response = await fetchWithTimeout('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: message.slice(0, 2400),
        reply: { in_reply_to_tweet_id: input.tweetId },
      }),
    }, 30_000, 'X tweet reply');
    const payload = await response.json().catch(() => null) as {
      data?: { id?: unknown };
      detail?: unknown;
      title?: unknown;
      errors?: Array<{ message?: unknown }>;
    } | null;
    if (response.ok) {
      const id = typeof payload?.data?.id === 'string' && TWEET_ID.test(payload.data.id) ? payload.data.id : '';
      if (!id) {
        return {
          certainty: 'unknown',
          retryable: false,
          errorCode: 'UNKNOWN_RESULT',
          reason: 'X accepted the reply but did not return a confirmed tweet id.',
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
    const detail = xErrorDetail(payload);
    return {
      certainty: retryable ? 'unknown' : 'failure',
      retryable,
      errorCode: retryable ? 'UNKNOWN_RESULT' : 'INVALID_ACTION',
      reason: `X API returned ${response.status}${detail}`,
      providerStatus: String(response.status),
    };
  } catch {
    return {
      certainty: 'unknown',
      retryable: false,
      errorCode: 'UNKNOWN_RESULT',
      reason: 'X reply result is unknown because the provider response was lost.',
      providerStatus: 'network_unknown',
    };
  }
}

function xErrorDetail(payload: { detail?: unknown; title?: unknown; errors?: Array<{ message?: unknown }> } | null) {
  const detail = typeof payload?.detail === 'string' ? payload.detail
    : typeof payload?.title === 'string' ? payload.title
      : typeof payload?.errors?.[0]?.message === 'string' ? payload.errors[0].message
        : '';
  return detail ? `: ${detail.slice(0, 180)}` : '';
}
