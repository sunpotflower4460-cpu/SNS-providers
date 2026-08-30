import { instagramDmActionId, instagramDmEventRowId } from '../ids';
import { loadCanonicalEvent, upsertProviderSocialAction, upsertSocialEvent } from '../repository';
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
    const existing = await loadCanonicalEvent(db, userId, 'instagram', 'dm', event.externalEventId);
    const existingConversation = typeof existing?.payload?.conversationId === 'string' ? existing.payload.conversationId : '';
    const incomingConversation = event.conversationId?.trim() || '';
    const conversationId = incomingConversation || existingConversation;
    const unresolved = !conversationId;
    const row: CanonicalSocialEvent = {
      id: instagramDmEventRowId(event.externalEventId),
      userId,
      platform: 'instagram',
      type: 'dm',
      externalEventId: event.externalEventId,
      externalUserId: event.externalUserId,
      payload: {
        text: event.text || '',
        conversationId: conversationId || undefined,
        conversationUnresolved: unresolved,
        username: event.username || '',
        displayName: event.displayName || '',
        recipientProfessionalId: event.recipientProfessionalId || '',
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
      status: expired || unresolved ? (expired ? 'expired' : 'ready') : 'ready',
      executionMode: expired || unresolved ? 'handoff' : executionMode,
      source: 'instagram_dm',
      externalEventId: event.externalEventId,
      conversationId: unresolved ? undefined : conversationId,
      observedAt: event.occurredAt,
      createdAt: event.receivedAt,
      updatedAt: event.receivedAt,
      platformUserId: event.externalUserId,
      username: event.username,
      identityConflict: false,
      retryable: !expired && !unresolved,
      resultMetadata: unresolved ? { conversationUnresolved: true } : undefined,
    };
    await upsertProviderSocialAction(db, action);
  }
}
