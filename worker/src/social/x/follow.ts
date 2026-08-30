import { fetchWithTimeout } from '../../fetchWithTimeout';
import { classifyProviderHttpStatus, providerErrorDetail } from '../httpStatus';
import { X_USER_ID } from '../ids';
import type { ProviderWriteResult } from '../types';

export interface XFollowInput {
  sourceUserId: string;
  targetUserId: string;
  accessToken: string;
}

export async function followXUser(input: XFollowInput): Promise<ProviderWriteResult> {
  if (!X_USER_ID.test(input.sourceUserId) || !X_USER_ID.test(input.targetUserId)) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'BINDING_MISMATCH',
      reason: 'X follow requires canonical immutable source and target user IDs.',
      providerStatus: 'invalid_target',
    };
  }
  if (input.sourceUserId === input.targetUserId) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'INVALID_ACTION',
      reason: 'Cannot follow the authenticated account.',
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
    const response = await fetchWithTimeout(`https://api.x.com/2/users/${encodeURIComponent(input.sourceUserId)}/following`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target_user_id: input.targetUserId }),
    }, 30_000, 'X follow');
    const payload = await response.json().catch(() => null) as {
      data?: { following?: unknown; pending_follow?: unknown };
      detail?: unknown;
      title?: unknown;
      errors?: Array<{ message?: unknown }>;
    } | null;
    const classified = classifyProviderHttpStatus(response.status);
    if (classified === 'success') {
      const following = payload?.data?.following === true;
      const pendingFollow = payload?.data?.pending_follow === true;
      if (!following && !pendingFollow) {
        return {
          certainty: 'unknown',
          retryable: false,
          errorCode: 'UNKNOWN_RESULT',
          reason: 'X accepted the follow call but did not confirm following or pending_follow.',
          providerStatus: String(response.status),
        };
      }
      return {
        certainty: 'success',
        externalResultId: input.targetUserId,
        providerStatus: pendingFollow ? 'pending_follow' : 'following',
        metadata: {
          following,
          pendingFollow,
          relationship: pendingFollow ? 'pending_follow' : 'following',
        },
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
      reason: 'X follow result is unknown because the provider response was lost.',
      providerStatus: 'network_unknown',
    };
  }
}

export async function unfollowXUser(input: XFollowInput): Promise<ProviderWriteResult> {
  if (!X_USER_ID.test(input.sourceUserId) || !X_USER_ID.test(input.targetUserId)) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'BINDING_MISMATCH',
      reason: 'X unfollow requires canonical immutable source and target user IDs.',
      providerStatus: 'invalid_target',
    };
  }
  if (input.sourceUserId === input.targetUserId) {
    return {
      certainty: 'failure',
      retryable: false,
      errorCode: 'INVALID_ACTION',
      reason: 'Cannot unfollow the authenticated account.',
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
    const url = `https://api.x.com/2/users/${encodeURIComponent(input.sourceUserId)}/following/${encodeURIComponent(input.targetUserId)}`;
    const response = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: 'application/json',
      },
    }, 30_000, 'X unfollow');
    const payload = await response.json().catch(() => null) as {
      data?: { following?: unknown };
      detail?: unknown;
      title?: unknown;
      errors?: Array<{ message?: unknown }>;
    } | null;
    const classified = classifyProviderHttpStatus(response.status);
    if (classified === 'success') {
      if (payload?.data?.following !== false) {
        return {
          certainty: 'unknown',
          retryable: false,
          errorCode: 'UNKNOWN_RESULT',
          reason: 'X accepted the unfollow call but did not confirm following=false.',
          providerStatus: String(response.status),
        };
      }
      return {
        certainty: 'success',
        externalResultId: input.targetUserId,
        providerStatus: 'unfollowed',
        metadata: { following: false },
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
      reason: 'X unfollow result is unknown because the provider response was lost.',
      providerStatus: 'network_unknown',
    };
  }
}
