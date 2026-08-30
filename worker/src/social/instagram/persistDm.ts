import { instagramDmActionId, instagramDmEventRowId } from '../ids';
import { upsertProviderSocialAction, upsertSocialEvent } from '../repository';
import type { CanonicalSocialAction, CanonicalSocialEvent } from '../types';
import { instagramMessagingWindowOpen, type NormalizedInstagramDmEvent } from './dm';

export async function persistInstagramDmEvidence(
  db: D1Database,
  userId: string,
  events: NormalizedInstagramDmEvent[],
  executionMode: 'in_app' | 'handoff',
) {
  for (const event of events) {
    if (event.ownMessage || !event.externalUserId) continue;
    const row: CanonicalSocialEvent = {
      id: instagramDmEventRowId(event.externalEventId),
      userId,
      platform: 'instagram',
      type: 'dm',
      externalEventId: event.externalEventId,
      externalUserId: event.externalUserId,
      payload: {
        text: event.text || '',
        conversationId: event.conversationId,
      },
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
    };
    await upsertSocialEvent(db, row);

    const expired = !instagramMessagingWindowOpen(event.occurredAt);
    const action: CanonicalSocialAction = {
      id: instagramDmActionId(event.externalEventId),
      userId,
      platform: 'instagram',
      candidateId: event.externalUserId,
      type: 'dm_reply',
      status: expired ? 'expired' : 'ready',
      executionMode: expired ? 'handoff' : executionMode,
      source: 'instagram_dm',
      externalEventId: event.externalEventId,
      conversationId: event.conversationId,
      observedAt: event.occurredAt,
      createdAt: event.receivedAt,
      updatedAt: event.receivedAt,
      platformUserId: event.externalUserId,
      identityConflict: false,
      retryable: !expired,
    };
    await upsertProviderSocialAction(db, action);
  }
}
