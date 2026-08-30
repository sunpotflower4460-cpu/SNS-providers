import { fetchWithTimeout } from '../../fetchWithTimeout';
import { classifyProviderHttpStatus, providerErrorDetail } from '../httpStatus';
import { X_TWEET_ID, X_USER_ID } from '../ids';
import type { ProviderWriteResult } from '../types';

export interface XLikeInput {
  sourceUserId: string;
  tweetId: string;
  accessToken: string;
}

export async function likeXTweet(input: XLikeInput): Promise<ProviderWriteResult> {
  if (!X_USER_ID.test(input.sourceUserId) || !X_TWEET_ID.test(input.tweetId)) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'BINDING_MISMATCH',
      reason: 'X like requires a canonical tweet ID and authenticated user ID.',
      providerStatus: 'invalid_target',
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
    const response = await fetchWithTimeout(`https://api.x.com/2/users/${encodeURIComponent(input.sourceUserId)}/likes`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tweet_id: input.tweetId }),
    }, 30_000, 'X like');
    const payload = await response.json().catch(() => null) as {
      data?: { liked?: unknown };
      detail?: unknown;
      title?: unknown;
      errors?: Array<{ message?: unknown }>;
    } | null;
    const classified = classifyProviderHttpStatus(response.status);
    if (classified === 'success') {
      if (payload?.data?.liked !== true) {
        return {
          certainty: 'unknown',
          retryable: false,
          errorCode: 'UNKNOWN_RESULT',
          reason: 'X accepted the like call but did not confirm liked=true.',
          providerStatus: String(response.status),
        };
      }
      return {
        certainty: 'success',
        externalResultId: input.tweetId,
        providerStatus: 'liked',
        metadata: { liked: true },
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
      reason: 'X like result is unknown because the provider response was lost.',
      providerStatus: 'network_unknown',
    };
  }
}

export function extractXTweetId(value: string) {
  const trimmed = value.trim();
  if (X_TWEET_ID.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com') return '';
    const match = url.pathname.match(/\/status\/(\d{1,30})(?:\/|$)/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}
