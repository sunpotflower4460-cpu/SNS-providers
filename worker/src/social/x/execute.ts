import type { ProviderWriteResult } from '../types';

export async function replyToXTweet(): Promise<ProviderWriteResult> {
  return {
    certainty: 'failure',
    retryable: false,
    errorCode: 'WRITE_DISABLED',
    reason: 'X reply writes are not enabled in this milestone.',
    providerStatus: 'disabled',
  };
}
