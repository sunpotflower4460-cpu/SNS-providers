import { buildDailyQueue, type DailyQueueItem } from './daily';
import { activeSocialActions, isInboundType } from './socialAction';
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
  for (const item of socialItems) {
    if (item.candidate && item.action) {
      for (const queueAction of queueActionsCoveredBy(item.action.type)) {
        covered.add(`${item.candidate.id}:${queueAction}`);
      }
    }
  }

  const queueItems = buildDailyQueue(state)
    .filter((item) => {
      if (item.kind === 'self') return true;
      if (!item.candidateId) return false;
      return !covered.has(`${item.candidateId}:${item.action}`);
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
  if (type === 'unfollow_review') return 'cleanup';
  if (type === 'relationship_review' || type === 'reconnect' || type === 'dm_outbound') return 'nurture';
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
