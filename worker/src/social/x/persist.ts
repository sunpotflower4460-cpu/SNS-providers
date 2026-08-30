import { xInboundActionId, xInboundEventRowId } from '../ids';
import { upsertProviderSocialAction, upsertSocialEvent } from '../repository';
import type { CanonicalSocialAction, CanonicalSocialEvent } from '../types';
import type { NormalizedXSocialEvent } from './inbound';

export async function persistXInboundEvidence(
  db: D1Database,
  userId: string,
  events: NormalizedXSocialEvent[],
  executionMode: 'in_app' | 'handoff' = 'handoff',
) {
  for (const event of events) {
    if (!event.externalUserId) continue;
    const row: CanonicalSocialEvent = {
      id: xInboundEventRowId(event.type, event.externalEventId),
      userId,
      platform: 'x',
      type: event.type,
      externalEventId: event.externalEventId,
      externalUserId: event.externalUserId,
      payload: {
        text: event.text || '',
        username: event.username || '',
        conversationId: event.conversationId || '',
        permalink: event.permalink || '',
        contentId: event.contentId,
      },
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
    };
    await upsertSocialEvent(db, row);

    const action: CanonicalSocialAction = {
      id: xInboundActionId(event.type, event.externalEventId),
      userId,
      platform: 'x',
      candidateId: event.externalUserId,
      type: 'reply_inbound',
      status: 'ready',
      executionMode,
      source: 'x_mention',
      externalEventId: event.externalEventId,
      conversationId: event.conversationId,
      parentContentId: event.contentId,
      targetUrl: event.permalink,
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
