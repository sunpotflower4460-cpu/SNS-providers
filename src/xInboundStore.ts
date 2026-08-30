import { upsertSocialActions, remapSocialActionCandidateIds, xInboundActionId } from './socialAction';
import { capabilitiesForPlatform, executionModeForAction } from './socialCapabilities';
import type { XInboundEventResult, XInboundSyncResponse } from './api';
import type { AppState, Candidate, SocialAction } from './types';

export function applyXInboundEvents(state: AppState, result: XInboundSyncResponse): AppState {
  if (!result.enabled || !result.events?.length) return state;
  const receivedAt = result.syncedAt || new Date().toISOString();
  let next = state;
  const incoming: Array<Partial<SocialAction> & Pick<SocialAction, 'platform' | 'candidateId' | 'type' | 'source'>> = [];

  for (const event of result.events) {
    if (!event.externalUserId || !/^\d{1,30}$/.test(event.externalUserId)) continue;
    const resolved = resolveXInboundCandidate(next, event, receivedAt);
    next = resolved.state;
    if (resolved.identityConflict) {
      incoming.push({
        id: xInboundActionId(event.type, event.externalEventId),
        platform: 'x',
        candidateId: resolved.candidate.id,
        type: 'reply_inbound',
        source: 'x_mention',
        status: 'ready',
        executionMode: 'handoff',
        externalEventId: event.externalEventId,
        conversationId: event.conversationId,
        parentContentId: event.externalEventId,
        targetUrl: event.permalink,
        inboundText: event.text,
        observedAt: event.occurredAt || receivedAt,
        reason: '同じユーザー名が別のXアカウントに紐づいているため、公式画面で確認してください。',
      });
      continue;
    }
    incoming.push({
      id: xInboundActionId(event.type, event.externalEventId),
      platform: 'x',
      candidateId: resolved.candidate.id,
      type: 'reply_inbound',
      source: 'x_mention',
      status: 'ready',
      executionMode: executionModeForAction('reply_inbound', capabilitiesForPlatform('x')),
      externalEventId: event.externalEventId,
      conversationId: event.conversationId,
      parentContentId: event.externalEventId,
      targetUrl: event.permalink,
      inboundText: event.text,
      observedAt: event.occurredAt || receivedAt,
      reason: event.text
        ? `Xに新しい${event.type === 'reply' ? '返信' : 'メンション'}があります。「${event.text.slice(0, 80)}」`
        : `Xに新しい${event.type === 'reply' ? '返信' : 'メンション'}があります。`,
    });
  }

  const remapped = {
    ...next,
    socialActions: remapSocialActionCandidateIds(next.socialActions || [], new Map(), new Set()),
  };
  return incoming.length ? upsertSocialActions(remapped, incoming) : remapped;
}

function resolveXInboundCandidate(
  state: AppState,
  event: XInboundEventResult,
  receivedAt: string,
): { state: AppState; candidate: Candidate; identityConflict: boolean } {
  const authorId = event.externalUserId!;
  const username = (event.username || '').trim().replace(/^@/, '');
  const byStableId = state.candidates.find((candidate) => (
    candidate.platform === 'x' && candidate.platformUserId === authorId
  ));
  if (byStableId) {
    const renamed = username && byStableId.username.toLowerCase() !== username.toLowerCase();
    if (!renamed) return { state, candidate: byStableId, identityConflict: false };
    const candidates = state.candidates.map((candidate) => candidate.id === byStableId.id
      ? { ...candidate, username, profileUrl: `https://x.com/${username}`, displayName: candidate.displayName || username }
      : candidate);
    return { state: { ...state, candidates }, candidate: { ...byStableId, username }, identityConflict: false };
  }

  const byUsername = username
    ? state.candidates.find((candidate) => (
      candidate.platform === 'x' && candidate.username.toLowerCase() === username.toLowerCase()
    ))
    : undefined;
  if (byUsername) {
    const existingId = byUsername.platformUserId?.trim() || '';
    if (existingId && existingId !== authorId) {
      const candidates = state.candidates.map((candidate) => candidate.id === byUsername.id
        ? { ...candidate, tags: [...new Set([...candidate.tags, 'identity-conflict'])].slice(0, 30) }
        : candidate);
      return {
        state: { ...state, candidates },
        candidate: { ...byUsername, tags: [...new Set([...byUsername.tags, 'identity-conflict'])] },
        identityConflict: true,
      };
    }
    const candidates = state.candidates.map((candidate) => candidate.id === byUsername.id
      ? {
        ...candidate,
        platformUserId: authorId,
        lastInteractionAt: latestIso(candidate.lastInteractionAt, event.occurredAt) || receivedAt,
      }
      : candidate);
    return { state: { ...state, candidates }, candidate: { ...byUsername, platformUserId: authorId }, identityConflict: false };
  }

  const candidate: Candidate = {
    id: `x-${crypto.randomUUID()}`,
    platform: 'x',
    username: username || `user_${authorId.slice(-6)}`,
    displayName: username || authorId,
    bio: '',
    profileUrl: username ? `https://x.com/${username}` : `https://x.com/i/user/${authorId}`,
    platformUserId: authorId,
    kind: 'other',
    match: 55,
    relationshipScore: 35,
    stage: 'engaged',
    reason: 'Xのメンション/返信から取り込みました。',
    tags: ['inbound', 'mention'],
    recommendedAction: 'reply',
    lastInteractionAt: event.occurredAt || receivedAt,
  };
  return { state: { ...state, candidates: [candidate, ...state.candidates] }, candidate, identityConflict: false };
}

function latestIso(left?: string, right?: string) {
  const leftMs = left ? new Date(left).getTime() : Number.NaN;
  const rightMs = right ? new Date(right).getTime() : Number.NaN;
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) return leftMs >= rightMs ? left : right;
  if (Number.isFinite(rightMs)) return right;
  if (Number.isFinite(leftMs)) return left;
  return undefined;
}
