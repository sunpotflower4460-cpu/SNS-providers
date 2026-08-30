import { xDmActionId, xDmEventRowId } from '../ids';
import { upsertProviderSocialAction, upsertSocialEvent } from '../repository';
import type { CanonicalSocialAction, CanonicalSocialEvent } from '../types';
import type { NormalizedXDmEvent } from './dm';

export async function persistXDmEvidence(
  db: D1Database,
  userId: string,
  events: NormalizedXDmEvent[],
  executionMode: 'in_app' | 'handoff' = 'handoff',
) {
  for (const event of events) {
    if (event.ownMessage || !event.externalUserId) continue;
    const row: CanonicalSocialEvent = {
      id: xDmEventRowId(event.externalEventId),
      userId,
      platform: 'x',
      type: 'dm',
      externalEventId: event.externalEventId,
      externalUserId: event.externalUserId,
      payload: {
        text: event.text || '',
        conversationId: event.conversationId,
        username: event.username || '',
      },
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
    };
    await upsertSocialEvent(db, row);

    const action: CanonicalSocialAction = {
      id: xDmActionId(event.externalEventId),
      userId,
      platform: 'x',
      candidateId: event.externalUserId,
      type: 'dm_reply',
      status: 'ready',
      executionMode,
      source: 'x_dm',
      externalEventId: event.externalEventId,
      conversationId: event.conversationId,
      observedAt: event.occurredAt,
      createdAt: event.receivedAt,
      updatedAt: event.receivedAt,
      platformUserId: event.externalUserId,
      username: event.username,
      identityConflict: false,
      retryable: true,
    };
    await upsertProviderSocialAction(db, action);
  }
}
