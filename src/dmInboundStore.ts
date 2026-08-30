import { upsertSocialActions, remapSocialActionCandidateIds } from './socialAction';
import { capabilitiesForPlatform, executionModeForAction } from './socialCapabilities';
import type { AppState, Candidate, Platform, SocialAction } from './types';

export interface InboundDmEvent {
  id?: string;
  actionId?: string;
  type?: string;
  externalEventId: string;
  externalUserId?: string;
  conversationId?: string;
  username?: string;
  text?: string;
  occurredAt: string;
}

export function applyXDmEvents(state: AppState, events: InboundDmEvent[], syncedAt?: string): AppState {
  return applyDmEvents(state, 'x', events, syncedAt);
}

export function applyInstagramDmEvents(state: AppState, events: InboundDmEvent[], syncedAt?: string): AppState {
  return applyDmEvents(state, 'instagram', events, syncedAt);
}

export function applyDmEvents(
  state: AppState,
  platform: Platform,
  events: InboundDmEvent[],
  syncedAt?: string,
): AppState {
  if (!events.length) return state;
  const receivedAt = syncedAt || new Date().toISOString();
  let next = state;
  const incoming: Array<Partial<SocialAction> & Pick<SocialAction, 'platform' | 'candidateId' | 'type' | 'source'>> = [];

  for (const event of events) {
    if (!event.externalUserId || !/^[A-Za-z0-9._-]{1,36}$/.test(event.externalUserId)) continue;
    if (platform === 'x' && !/^\d{1,30}$/.test(event.externalUserId)) continue;
    const resolved = resolveDmCandidate(next, platform, event, receivedAt);
    next = resolved.state;
    const conversationId = event.conversationId || '';
    incoming.push({
      id: event.actionId || (platform === 'x' ? `sa-x-dm-${event.externalEventId}` : `sa-ig-dm-${event.externalEventId}`),
      platform,
      candidateId: resolved.candidate.id,
      type: 'dm_reply',
      source: platform === 'x' ? 'x_dm' : 'instagram_dm',
      status: 'ready',
      executionMode: resolved.identityConflict
        ? 'handoff'
        : executionModeForAction('dm_reply', capabilitiesForPlatform(platform)),
      externalEventId: event.externalEventId,
      conversationId,
      inboundText: event.text,
      observedAt: event.occurredAt || receivedAt,
      reason: resolved.identityConflict
        ? '同じユーザー名が別アカウントに紐づいているため、公式画面で確認してください。'
        : event.text
          ? `届いているDMがあります。「${event.text.slice(0, 80)}」`
          : '届いているDMがあります。Missionに合う返信かを確認してください。',
    });
  }

  const remapped = {
    ...next,
    socialActions: remapSocialActionCandidateIds(next.socialActions || [], new Map(), new Set()),
  };
  return incoming.length ? upsertSocialActions(remapped, incoming) : remapped;
}

function resolveDmCandidate(
  state: AppState,
  platform: Platform,
  event: InboundDmEvent,
  receivedAt: string,
): { state: AppState; candidate: Candidate; identityConflict: boolean } {
  const authorId = event.externalUserId!;
  const username = (event.username || '').trim().replace(/^@/, '');
  const byStableId = state.candidates.find((candidate) => (
    candidate.platform === platform && candidate.platformUserId === authorId
  ));
  if (byStableId) {
    return { state, candidate: byStableId, identityConflict: false };
  }

  const byUsername = username
    ? state.candidates.find((candidate) => (
      candidate.platform === platform && candidate.username.toLowerCase() === username.toLowerCase()
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
      ? { ...candidate, platformUserId: authorId, lastInteractionAt: event.occurredAt || receivedAt }
      : candidate);
    return { state: { ...state, candidates }, candidate: { ...byUsername, platformUserId: authorId }, identityConflict: false };
  }

  const candidate: Candidate = {
    id: `${platform}-${crypto.randomUUID()}`,
    platform,
    username: username || `user_${authorId.slice(-6)}`,
    displayName: username || authorId,
    bio: '',
    profileUrl: platform === 'x'
      ? (username ? `https://x.com/${username}` : `https://x.com/i/user/${authorId}`)
      : (username ? `https://instagram.com/${username}` : `https://instagram.com/`),
    platformUserId: authorId,
    kind: 'other',
    match: 58,
    relationshipScore: 40,
    stage: 'recognized',
    reason: platform === 'x' ? 'XのDMから取り込みました。' : 'InstagramのDMから取り込みました。',
    tags: ['inbound', 'dm'],
    recommendedAction: 'dm',
    lastInteractionAt: event.occurredAt || receivedAt,
  };
  return { state: { ...state, candidates: [candidate, ...state.candidates] }, candidate, identityConflict: false };
}
