import type { AppState, Candidate, RecommendedAction } from './types';

export type DailyQueueKind = 'relationship' | 'self';

export interface DailyQueueItem {
  id: string;
  kind: DailyQueueKind;
  candidateId?: string;
  action: RecommendedAction | 'self_improve';
  title: string;
  reason: string;
  priority: number;
}

const actionWeight: Record<RecommendedAction, number> = {
  dm: 28,
  reply: 25,
  like: 18,
  follow: 17,
  unfollow_review: 15,
  review: 8,
};

export function buildDailyQueue(state: AppState, limit = 20): DailyQueueItem[] {
  const today = localDateKey(new Date());
  const completedCandidateIds = new Set(
    state.interactions
      .filter((interaction) => localDateKey(new Date(interaction.at)) === today)
      .map((interaction) => interaction.candidateId),
  );

  const relationshipItems = state.candidates
    .filter((candidate) => !candidate.skipped && !completedCandidateIds.has(candidate.id))
    .map(candidateToQueueItem)
    .sort((a, b) => b.priority - a.priority);

  const selfItems = state.insights
    .slice()
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 2)
    .map((insight, index): DailyQueueItem => ({
      id: `self-${insight.id}`,
      kind: 'self',
      action: 'self_improve',
      title: insight.title,
      reason: insight.body,
      priority: 72 - index * 4 + (insight.priority === 'high' ? 10 : insight.priority === 'medium' ? 5 : 0),
    }));

  return interleaveByGoal(relationshipItems, selfItems).slice(0, Math.max(1, limit));
}

export function queueSummary(items: DailyQueueItem[]) {
  return {
    connect: items.filter((item) => item.action === 'follow').length,
    engage: items.filter((item) => ['like', 'reply', 'dm'].includes(item.action)).length,
    cleanup: items.filter((item) => item.action === 'unfollow_review').length,
    self: items.filter((item) => item.kind === 'self').length,
  };
}

function candidateToQueueItem(candidate: Candidate): DailyQueueItem {
  const relationshipBoost = Math.min(18, Math.round(candidate.relationshipScore * 0.2));
  const missionBoost = Math.round(candidate.match * 0.55);
  const followBackBoost = candidate.recommendedAction === 'unfollow_review' && candidate.followBack === false ? 7 : 0;
  const priority = missionBoost + relationshipBoost + actionWeight[candidate.recommendedAction] + followBackBoost;

  return {
    id: `candidate-${candidate.id}`,
    kind: 'relationship',
    candidateId: candidate.id,
    action: candidate.recommendedAction,
    title: queueTitle(candidate),
    reason: candidate.strategy || candidate.reason,
    priority,
  };
}

function queueTitle(candidate: Candidate) {
  const name = candidate.displayName || `@${candidate.username}`;
  switch (candidate.recommendedAction) {
    case 'follow': return `${name} と新しくつながる`;
    case 'like': return `${name} の投稿を見に行く`;
    case 'reply': return `${name} と会話を始める`;
    case 'dm': return `${name} との会話を深める`;
    case 'unfollow_review': return `${name} のフォロー継続を確認`;
    default: return `${name} を確認する`;
  }
}

function interleaveByGoal(relationshipItems: DailyQueueItem[], selfItems: DailyQueueItem[]) {
  const result: DailyQueueItem[] = [];
  const buckets = {
    conversation: relationshipItems.filter((item) => ['reply', 'dm'].includes(item.action)),
    connect: relationshipItems.filter((item) => item.action === 'follow'),
    light: relationshipItems.filter((item) => ['like', 'review'].includes(item.action)),
    cleanup: relationshipItems.filter((item) => item.action === 'unfollow_review'),
  };
  const order = [buckets.conversation, buckets.connect, buckets.light, selfItems, buckets.cleanup];

  while (order.some((bucket) => bucket.length)) {
    for (const bucket of order) {
      const item = bucket.shift();
      if (item) result.push(item);
    }
  }
  return result;
}

function priorityRank(priority: 'high' | 'medium' | 'low') {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
