import { buildDailyQueue, type DailyQueueItem } from './daily';
import { activeSocialActions, engagementSurfaceKey, isInboundType } from './socialAction';
import type { AppState, Candidate, SocialAction, SocialActionType } from './types';

export type InboxCategory = 'reply' | 'outreach' | 'connect' | 'nurture' | 'cleanup';

export interface MissionInboxItem {
  id: string;
  kind: 'social' | 'queue';
  category: InboxCategory;
  priority: number;
  action?: SocialAction;
  queueItem?: DailyQueueItem;
  candidate?: Candidate;
}

export function buildMissionInbox(state: AppState, nowMs = Date.now()): MissionInboxItem[] {
  const candidateById = new Map(state.candidates.map((candidate) => [candidate.id, candidate]));
  const socialItems = activeSocialActions(state, nowMs)
    .map((action): MissionInboxItem | null => {
      const candidate = candidateById.get(action.candidateId);
      if (!candidate || candidate.skipped) return null;
      return {
        id: `social-${action.id}`,
        kind: 'social',
        category: categoryForAction(action.type),
        priority: action.priorityScore,
        action,
        candidate,
      };
    })
    .filter((item): item is MissionInboxItem => item != null && item.kind === 'social');

  const covered = new Set<string>();
  const coverFamily = (action: SocialAction) => {
    for (const queueAction of queueActionsCoveredBy(action.type)) {
      covered.add(`${action.candidateId}:${queueAction}`);
    }
  };
  const coverSurface = (action: SocialAction) => {
    for (const queueAction of queueActionsCoveredBy(action.type)) {
      const key = engagementSurfaceKey(action.candidateId, queueAction, action.targetUrl);
      if (key) covered.add(key);
    }
  };
  for (const item of socialItems) {
    if (item.action) coverFamily(item.action);
  }
  for (const action of state.socialActions || []) {
    if (action.status === 'snoozed') {
      const until = action.snoozedUntil ? new Date(action.snoozedUntil).getTime() : 0;
      if (Number.isFinite(until) && until > nowMs) coverFamily(action);
      continue;
    }
    if (action.status === 'executing') {
      coverFamily(action);
      continue;
    }
    if (action.status === 'dismissed' || action.status === 'completed') {
      coverSurface(action);
    }
  }

  const queueItems = buildDailyQueue(state)
    .filter((item) => {
      if (item.kind === 'self') return true;
      if (!item.candidateId) return false;
      if (covered.has(`${item.candidateId}:${item.action}`)) return false;
      const candidate = candidateById.get(item.candidateId);
      const surface = engagementSurfaceKey(item.candidateId, item.action, candidate?.engagementUrl);
      return !surface || !covered.has(surface);
    })
    .map((item): MissionInboxItem => ({
      id: `queue-${item.id}`,
      kind: 'queue',
      category: categoryForQueueAction(item.action),
      priority: item.priority,
      queueItem: item,
      candidate: item.candidateId ? candidateById.get(item.candidateId) : undefined,
    }));

  return [...socialItems, ...queueItems].sort((left, right) => {
    const categoryDelta = categoryRank(left.category) - categoryRank(right.category);
    if (categoryDelta) return categoryDelta;
    return right.priority - left.priority;
  });
}

export function fallbackDailyQueue(state: AppState, nowMs = Date.now()): DailyQueueItem[] {
  return buildMissionInbox(state, nowMs)
    .filter((item) => item.kind === 'queue' && item.queueItem)
    .map((item) => item.queueItem!);
}

export function hasDeferredSocialWork(state: AppState, nowMs = Date.now()): boolean {
  return (state.socialActions || []).some((action) => {
    if (action.status !== 'snoozed') return false;
    const until = action.snoozedUntil ? new Date(action.snoozedUntil).getTime() : 0;
    return Number.isFinite(until) && until > nowMs;
  });
}

export function inboxSummary(items: MissionInboxItem[]) {
  return {
    total: items.length,
    reply: items.filter((item) => item.category === 'reply').length,
    outreach: items.filter((item) => item.category === 'outreach').length,
    connect: items.filter((item) => item.category === 'connect').length,
    nurture: items.filter((item) => item.category === 'nurture').length,
    cleanup: items.filter((item) => item.category === 'cleanup').length,
  };
}

export function categoryForAction(type: SocialActionType): InboxCategory {
  if (isInboundType(type)) return 'reply';
  if (type === 'follow') return 'connect';
  if (type === 'like') return 'nurture';
  if (type === 'unfollow_review' || type === 'relationship_review') return 'cleanup';
  if (type === 'reconnect' || type === 'dm_outbound') return 'nurture';
  return 'outreach';
}

function categoryForQueueAction(action: DailyQueueItem['action']): InboxCategory {
  if (action === 'reply' || action === 'dm') return 'reply';
  if (action === 'follow') return 'connect';
  if (action === 'unfollow_review') return 'cleanup';
  if (action === 'self_improve' || action === 'review') return 'nurture';
  return 'outreach';
}

function queueActionsCoveredBy(type: SocialActionType): string[] {
  switch (type) {
    case 'comment_reply':
    case 'reply_inbound':
    case 'reply_outbound':
      return ['reply'];
    case 'dm_reply':
    case 'dm_outbound':
      return ['dm'];
    case 'follow':
      return ['follow'];
    case 'like':
      return ['like'];
    case 'unfollow_review':
      return ['unfollow_review'];
    default:
      return ['review'];
  }
}

function categoryRank(category: InboxCategory) {
  switch (category) {
    case 'reply': return 0;
    case 'outreach': return 1;
    case 'connect': return 2;
    case 'nurture': return 3;
    case 'cleanup': return 4;
  }
}
