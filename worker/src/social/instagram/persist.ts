import { instagramCommentActionId, instagramCommentEventId } from '../ids';
import { upsertProviderSocialAction, upsertSocialEvent } from '../repository';
import type { CanonicalSocialAction, CanonicalSocialEvent } from '../types';
import { instagramCommentEvent, sameLatestCommentEvent, type InstagramCommentEventInput } from './inbound';

export interface PersistableInstagramEngager {
  id: string;
  username: string;
  lastCommentText: string;
  lastCommentAt: string | null;
  latestCommentId: string | null;
  mediaId: string | null;
  latestMediaPermalink: string | null;
}

export async function persistInstagramCommentEvidence(
  db: D1Database,
  userId: string,
  engagers: PersistableInstagramEngager[],
  receivedAt: string,
  executionMode: 'in_app' | 'handoff',
) {
  for (const engager of engagers) {
    const input: InstagramCommentEventInput = {
      latestCommentId: engager.latestCommentId,
      mediaId: engager.mediaId,
      lastCommentText: engager.lastCommentText,
      lastCommentAt: engager.lastCommentAt,
      latestMediaPermalink: engager.latestMediaPermalink,
      engagerId: engager.id,
      username: engager.username,
    };
    if (!sameLatestCommentEvent(input)) continue;
    const event = instagramCommentEvent(input, receivedAt);
    if (!event) continue;
    const row: CanonicalSocialEvent = {
      id: instagramCommentEventId(event.externalEventId),
      userId,
      platform: 'instagram',
      type: 'comment',
      externalEventId: event.externalEventId,
      externalUserId: event.externalUserId,
      payload: {
        text: event.text || '',
        mediaId: event.parentContentId,
        permalink: event.permalink || '',
        username: engager.username,
        engagerId: engager.id,
        lastCommentText: engager.lastCommentText,
        lastCommentAt: engager.lastCommentAt,
        latestCommentId: engager.latestCommentId,
        latestMediaPermalink: engager.latestMediaPermalink,
      },
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
    };
    await upsertSocialEvent(db, row);

    const nowIso = receivedAt;
    const action: CanonicalSocialAction = {
      id: instagramCommentActionId(event.externalEventId),
      userId,
      platform: 'instagram',
      candidateId: event.externalUserId || engager.id,
      type: 'comment_reply',
      status: 'ready',
      executionMode,
      source: 'instagram_comment',
      externalEventId: event.externalEventId,
      parentContentId: event.parentContentId,
      targetUrl: event.permalink,
      observedAt: event.occurredAt,
      createdAt: nowIso,
      updatedAt: nowIso,
      platformUserId: /^\d{1,30}$/.test(engager.id) ? engager.id : event.externalUserId,
      username: engager.username,
      identityConflict: false,
      retryable: true,
    };
    await upsertProviderSocialAction(db, action);
  }
}
