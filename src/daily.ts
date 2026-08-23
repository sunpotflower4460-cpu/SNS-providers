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

export function buildDailyQueue(state: AppState): DailyQueueItem[] {
  const today = localDateKey(new Date());
  const limits = workloadLimits(state);
  const now = Date.now();
  const completedCandidateIds = new Set(
    state.interactions
      .filter((interaction) => localDateKey(new Date(interaction.at)) === today)
      .map((interaction) => interaction.candidateId),
  );
  const lastHandledAt = latestInteractionByCandidate(state);
  const selfAnalyzedToday = state.selfProfile.analyzedAt
    ? localDateKey(new Date(state.selfProfile.analyzedAt)) === today
    : false;

  const relationshipItems = state.candidates
    .filter((candidate) => !candidate.skipped
      && !isSnoozed(candidate, now)
      && !completedCandidateIds.has(candidate.id)
      && !isCoolingDown(candidate, lastHandledAt.get(candidate.id), now))
    .map((candidate) => candidateToQueueItem(candidate, now))
    .sort((a, b) => b.priority - a.priority);

  const selfItems = selfAnalyzedToday ? [] : state.insights
    .slice()
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, limits.self)
    .map((insight, index): DailyQueueItem => ({
      id: `self-${insight.id}`,
      kind: 'self',
      action: 'self_improve',
      title: insight.title,
      reason: insight.body,
      priority: 72 - index * 4 + (insight.priority === 'high' ? 10 : insight.priority === 'medium' ? 5 : 0),
    }));

  return interleaveByGoal(relationshipItems, selfItems, limits).slice(0, limits.total);
}

export function queueSummary(items: DailyQueueItem[]) {
  return {
    connect: items.filter((item) => item.action === 'follow').length,
    engage: items.filter((item) => ['like', 'reply', 'dm'].includes(item.action)).length,
    cleanup: items.filter((item) => item.action === 'unfollow_review').length,
    self: items.filter((item) => item.kind === 'self').length,
  };
}

function candidateToQueueItem(candidate: Candidate, now: number): DailyQueueItem {
  const action = effectiveAction(candidate);
  const relationshipBoost = Math.min(18, Math.round(candidate.relationshipScore * 0.2));
  const missionBoost = Math.round(candidate.match * 0.55);
  const followBackBoost = action === 'unfollow_review' && candidate.followBack === false ? 7 : 0;
  const priority = missionBoost + relationshipBoost + actionWeight[action] + followBackBoost + freshnessBoost(candidate, action, now);

  return {
    id: `candidate-${candidate.id}`,
    kind: 'relationship',
    candidateId: candidate.id,
    action,
    title: queueTitle(candidate, action),
    reason: candidate.strategy || candidate.reason,
    priority,
  };
}

function effectiveAction(candidate: Candidate): RecommendedAction {
  // Like/reply are only "do this now" actions when the app knows the concrete post/media
  // surface. Otherwise Today should say review rather than forcing the user to choose a post.
  if ((candidate.recommendedAction === 'like' || candidate.recommendedAction === 'reply') && !candidate.engagementUrl) {
    return 'review';
  }
  return candidate.recommendedAction;
}

function freshnessBoost(candidate: Candidate, action: RecommendedAction, now: number) {
  if ((action !== 'reply' && action !== 'like') || !candidate.engagementUrl || !candidate.lastInteractionAt) return 0;
  const signalAt = new Date(candidate.lastInteractionAt).getTime();
  if (!Number.isFinite(signalAt) || signalAt > now + 5 * 60 * 1000) return 0;
  const ageHours = Math.max(0, (now - signalAt) / 3_600_000);
  if (ageHours <= 6) return 18;
  if (ageHours <= 24) return 12;
  if (ageHours <= 72) return 6;
  return 0;
}

function queueTitle(candidate: Candidate, action: RecommendedAction) {
  const name = candidate.displayName || `@${candidate.username}`;
  switch (action) {
    case 'follow': return `${name} と新しくつながる`;
    case 'like': return `${name} のこの投稿に反応する`;
    case 'reply': return `${name} のこの投稿へ返信する`;
    case 'dm': return `${name} との会話を深める`;
    case 'unfollow_review': return `${name} のフォロー継続を確認`;
    default: return `${name} を確認する`;
  }
}

function interleaveByGoal(
  relationshipItems: DailyQueueItem[],
  selfItems: DailyQueueItem[],
  limits: ReturnType<typeof workloadLimits>,
) {
  const result: DailyQueueItem[] = [];
  const buckets = {
    conversation: relationshipItems.filter((item) => ['reply', 'dm'].includes(item.action)).slice(0, limits.conversation),
    connect: relationshipItems.filter((item) => item.action === 'follow').slice(0, limits.connect),
    light: relationshipItems.filter((item) => ['like', 'review'].includes(item.action)).slice(0, limits.light),
    cleanup: relationshipItems.filter((item) => item.action === 'unfollow_review').slice(0, limits.cleanup),
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

function latestInteractionByCandidate(state: AppState) {
  const latest = new Map<string, string>();
  const latestMs = new Map<string, number>();
  for (const interaction of state.interactions) {
    const at = new Date(interaction.at).getTime();
    if (!Number.isFinite(at)) continue;
    const current = latestMs.get(interaction.candidateId) ?? Number.NEGATIVE_INFINITY;
    if (at > current) {
      latestMs.set(interaction.candidateId, at);
      latest.set(interaction.candidateId, interaction.at);
    }
  }
  return latest;
}

function isCoolingDown(candidate: Candidate, handledAt: string | undefined, now: number) {
  if (!handledAt || candidate.recommendedAction === 'unfollow_review') return false;
  const handledMs = new Date(handledAt).getTime();
  if (!Number.isFinite(handledMs) || handledMs > now + 5 * 60 * 1000) return false;

  // A newer inbound signal (for example a new Instagram comment) should immediately
  // reopen the relationship even if we handled the person recently.
  const signalMs = candidate.lastInteractionAt ? new Date(candidate.lastInteractionAt).getTime() : Number.NaN;
  if (Number.isFinite(signalMs) && signalMs > handledMs + 60_000 && signalMs <= now + 5 * 60 * 1000) return false;

  const cooldownHours = candidate.recommendedAction === 'reply' || candidate.recommendedAction === 'dm'
    ? 36
    : candidate.recommendedAction === 'like'
      ? 48
      : candidate.recommendedAction === 'review'
        ? 72
        : 24;
  return now - handledMs < cooldownHours * 3_600_000;
}

function workloadLimits(state: AppState) {
  const policy = state.relationshipPolicy;
  return {
    total: clampInt(policy.dailyQueueLimit, 30, 1, 150),
    connect: clampInt(policy.dailyConnectionLimit, 20, 0, 120),
    conversation: clampInt(policy.dailyConversationLimit, 8, 0, 30),
    light: clampInt(policy.dailyLightEngagementLimit, 8, 0, 30),
    cleanup: clampInt(policy.dailyCleanupLimit, 5, 0, 30),
    self: clampInt(policy.dailySelfImproveLimit, 2, 0, 5),
  };
}

function isSnoozed(candidate: Candidate, now: number) {
  if (!candidate.snoozedUntil) return false;
  const until = new Date(candidate.snoozedUntil).getTime();
  return Number.isFinite(until) && until > now;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? Math.round(value!) : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function priorityRank(priority: 'high' | 'medium' | 'low') {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
