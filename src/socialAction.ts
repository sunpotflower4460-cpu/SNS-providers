import { executionModeForAction, capabilitiesForPlatform } from './socialCapabilities';
import type {
  AppState,
  Candidate,
  Interaction,
  SocialAction,
  SocialActionSource,
  SocialActionStatus,
  SocialActionType,
} from './types';

export const SOCIAL_ACTION_TYPES: readonly SocialActionType[] = [
  'reply_inbound',
  'reply_outbound',
  'comment_reply',
  'dm_reply',
  'dm_outbound',
  'follow',
  'like',
  'reconnect',
  'relationship_review',
  'unfollow_review',
];

export const SOCIAL_ACTION_STATUSES: readonly SocialActionStatus[] = [
  'pending',
  'ready',
  'snoozed',
  'executing',
  'completed',
  'dismissed',
  'failed',
  'expired',
];

export const SOCIAL_ACTION_SOURCES: readonly SocialActionSource[] = [
  'x_mention',
  'x_dm',
  'x_discovery',
  'x_relationship',
  'instagram_comment',
  'instagram_dm',
  'instagram_discovery',
  'relationship_engine',
  'manual',
];

export const PRIORITY_WEIGHTS = {
  missionRelevance: 0.25,
  relationshipValue: 0.20,
  urgency: 0.30,
  conversationOpportunity: 0.25,
  authenticityRisk: -0.20,
} as const;

export const INBOUND_TYPE_BOOST: Record<SocialActionType, number> = {
  dm_reply: 30,
  reply_inbound: 25,
  comment_reply: 25,
  dm_outbound: 8,
  reply_outbound: 10,
  reconnect: 12,
  relationship_review: 8,
  follow: 6,
  like: 4,
  unfollow_review: 2,
};

const ACTION_TYPES = new Set<string>(SOCIAL_ACTION_TYPES);
const ACTION_STATUSES = new Set<string>(SOCIAL_ACTION_STATUSES);
const ACTION_SOURCES = new Set<string>(SOCIAL_ACTION_SOURCES);
const TERMINAL_STATUSES = new Set<SocialActionStatus>(['completed', 'dismissed', 'expired']);
const ACTIVE_STATUSES = new Set<SocialActionStatus>(['pending', 'ready', 'failed']);
const MAX_ACTIONS = 500;
const MAX_SNOOZE_FUTURE_MS = 7 * 86_400_000;
const INBOUND_EXPIRE_MS = 14 * 86_400_000;
const EXECUTING_STALE_MS = 15 * 60 * 1000;

export interface SocialActionClock {
  now(): Date;
  id(): string;
}

const defaultClock: SocialActionClock = {
  now: () => new Date(),
  id: () => `sa-${crypto.randomUUID()}`,
};

export function socialActionExternalKey(action: Pick<SocialAction, 'platform' | 'source' | 'externalEventId'>) {
  const eventId = action.externalEventId?.trim() || '';
  return eventId ? `${action.platform}:${action.source}:${eventId}` : '';
}

export function scoreSocialAction(action: Pick<
  SocialAction,
  'missionRelevance' | 'relationshipValue' | 'urgency' | 'conversationOpportunity' | 'authenticityRisk' | 'type'
>) {
  const weighted = action.missionRelevance * PRIORITY_WEIGHTS.missionRelevance
    + action.relationshipValue * PRIORITY_WEIGHTS.relationshipValue
    + action.urgency * PRIORITY_WEIGHTS.urgency
    + action.conversationOpportunity * PRIORITY_WEIGHTS.conversationOpportunity
    + action.authenticityRisk * PRIORITY_WEIGHTS.authenticityRisk
    + INBOUND_TYPE_BOOST[action.type];
  return clampScore(weighted);
}

export function deriveLocalActionScores(candidate: Candidate, type: SocialActionType, observedAt?: string, nowMs = Date.now()) {
  const inbound = type === 'reply_inbound' || type === 'comment_reply' || type === 'dm_reply';
  const cold = type === 'follow' || type === 'dm_outbound';
  return {
    missionRelevance: clampScore(candidate.match),
    relationshipValue: clampScore(candidate.relationshipScore),
    urgency: urgencyFromTimestamp(observedAt, inbound, nowMs),
    conversationOpportunity: inbound ? 78 : cold ? 28 : 52,
    authenticityRisk: inbound ? 12 : cold ? 62 : 28,
  };
}

export function normalizeSocialAction(raw: unknown, nowMs = Date.now()): SocialAction | null {
  if (!isRecord(raw)) return null;
  if (raw.platform !== 'x' && raw.platform !== 'instagram') return null;
  const id = safeText(raw.id, 180);
  const candidateId = safeText(raw.candidateId, 180);
  const type = typeof raw.type === 'string' && ACTION_TYPES.has(raw.type) ? raw.type as SocialActionType : '';
  const source = typeof raw.source === 'string' && ACTION_SOURCES.has(raw.source) ? raw.source as SocialActionSource : '';
  const createdAt = validPastishIso(raw.createdAt, nowMs);
  const updatedAt = validPastishIso(raw.updatedAt, nowMs) || createdAt;
  if (!id || !candidateId || !type || !source || !createdAt) return null;

  let status = typeof raw.status === 'string' && ACTION_STATUSES.has(raw.status)
    ? raw.status as SocialActionStatus
    : 'pending';
  const snoozedUntil = validSnoozeIso(raw.snoozedUntil, nowMs);
  if (status === 'snoozed' && (!snoozedUntil || new Date(snoozedUntil).getTime() <= nowMs)) {
    status = 'ready';
  }
  if (status === 'executing') {
    const executingStarted = new Date(updatedAt).getTime();
    if (!Number.isFinite(executingStarted) || nowMs - executingStarted > EXECUTING_STALE_MS) {
      status = 'failed';
    }
  }
  const observedAt = validPastishIso(raw.observedAt, nowMs);
  if ((status === 'pending' || status === 'ready' || status === 'failed') && isInboundType(type) && observedAt) {
    const observedMs = new Date(observedAt).getTime();
    if (Number.isFinite(observedMs) && nowMs - observedMs > INBOUND_EXPIRE_MS) status = 'expired';
  }

  const executionMode = raw.executionMode === 'in_app' || raw.executionMode === 'handoff'
    ? raw.executionMode
    : executionModeForAction(type, capabilitiesForPlatform(raw.platform));

  const missionRelevance = clampScore(raw.missionRelevance);
  const relationshipValue = clampScore(raw.relationshipValue);
  const urgency = clampScore(raw.urgency);
  const conversationOpportunity = clampScore(raw.conversationOpportunity);
  const authenticityRisk = clampScore(raw.authenticityRisk);

  const action: SocialAction = {
    id,
    platform: raw.platform,
    candidateId,
    type,
    status,
    executionMode,
    source,
    externalEventId: safeText(raw.externalEventId, 180) || undefined,
    conversationId: safeText(raw.conversationId, 180) || undefined,
    parentContentId: safeText(raw.parentContentId, 180) || undefined,
    targetUrl: safeText(raw.targetUrl, 2000) || undefined,
    inboundText: safeText(raw.inboundText, 4000) || undefined,
    contextText: safeText(raw.contextText, 4000) || undefined,
    aiDraft: safeText(raw.aiDraft, 2400) || undefined,
    draft: safeText(raw.draft, 2400) || undefined,
    missionRelevance,
    relationshipValue,
    urgency,
    conversationOpportunity,
    authenticityRisk,
    priorityScore: scoreSocialAction({
      type,
      missionRelevance,
      relationshipValue,
      urgency,
      conversationOpportunity,
      authenticityRisk,
    }),
    reason: safeText(raw.reason, 2400),
    observedAt: observedAt || undefined,
    createdAt,
    updatedAt,
    snoozedUntil: status === 'snoozed' ? snoozedUntil : undefined,
    completedAt: status === 'completed' ? (validPastishIso(raw.completedAt, nowMs) || updatedAt) : undefined,
    executionId: safeText(raw.executionId, 180) || undefined,
    failureReason: status === 'failed' ? (safeText(raw.failureReason, 500) || undefined) : undefined,
  };
  return action;
}

export function normalizeSocialActions(raw: unknown, nowMs = Date.now()): SocialAction[] {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .map((item) => normalizeSocialAction(item, nowMs))
    .filter((action): action is SocialAction => Boolean(action));
  return dedupeSocialActions(normalized).slice(0, MAX_ACTIONS);
}

export function upsertSocialActions(
  state: AppState,
  incoming: Array<Partial<SocialAction> & Pick<SocialAction, 'platform' | 'candidateId' | 'type' | 'source'>>,
  clock: SocialActionClock = defaultClock,
): AppState {
  const now = clock.now();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const existing = [...(state.socialActions || [])];
  const byExternal = new Map<string, number>();
  const byId = new Map<string, number>();
  existing.forEach((action, index) => {
    byId.set(action.id, index);
    const key = socialActionExternalKey(action);
    if (key) byExternal.set(key, index);
  });

  for (const raw of incoming) {
    const candidate = state.candidates.find((item) => item.id === raw.candidateId);
    if (!candidate || candidate.platform !== raw.platform) continue;
    const identityConflict = candidate.tags.includes('identity-conflict');
    const scores = deriveLocalActionScores(candidate, raw.type, raw.observedAt, nowMs);
    const executionMode = identityConflict
      ? 'handoff' as const
      : (raw.executionMode === 'in_app' || raw.executionMode === 'handoff'
        ? raw.executionMode
        : executionModeForAction(raw.type, capabilitiesForPlatform(raw.platform)));
    const draft = incomingDraft(raw);
    const nextPartial: SocialAction = {
      id: raw.id || clock.id(),
      platform: raw.platform,
      candidateId: raw.candidateId,
      type: raw.type,
      status: raw.status && ACTION_STATUSES.has(raw.status) ? raw.status : 'ready',
      executionMode,
      source: raw.source,
      externalEventId: raw.externalEventId,
      conversationId: raw.conversationId,
      parentContentId: raw.parentContentId,
      targetUrl: raw.targetUrl,
      inboundText: raw.inboundText,
      contextText: raw.contextText,
      aiDraft: raw.aiDraft ?? draft,
      draft,
      missionRelevance: raw.missionRelevance ?? scores.missionRelevance,
      relationshipValue: scores.relationshipValue,
      urgency: raw.urgency ?? scores.urgency,
      conversationOpportunity: raw.conversationOpportunity ?? scores.conversationOpportunity,
      authenticityRisk: raw.authenticityRisk ?? scores.authenticityRisk,
      priorityScore: 0,
      reason: raw.reason || candidate.reason,
      observedAt: raw.observedAt || nowIso,
      createdAt: raw.createdAt || nowIso,
      updatedAt: nowIso,
    };
    nextPartial.priorityScore = scoreSocialAction(nextPartial);
    const normalized = normalizeSocialAction(nextPartial, nowMs);
    if (!normalized) continue;

    const externalKey = socialActionExternalKey(normalized);
    const existingIndex = (externalKey ? byExternal.get(externalKey) : undefined)
      ?? (normalized.id ? byId.get(normalized.id) : undefined);

    if (existingIndex == null) {
      const index = existing.length;
      existing.push(normalized);
      byId.set(normalized.id, index);
      if (externalKey) byExternal.set(externalKey, index);
      continue;
    }

    const previous = existing[existingIndex];
    existing[existingIndex] = mergeExistingAction(previous, normalized, nowIso, nowMs);
  }

  return { ...state, socialActions: existing.slice(0, MAX_ACTIONS) };
}

export function snoozeSocialAction(state: AppState, actionId: string, until?: string, clock: SocialActionClock = defaultClock): AppState {
  const now = clock.now();
  const snoozedUntil = until || nextLocalMidnight(now).toISOString();
  return updateAction(state, actionId, (action) => {
    if (TERMINAL_STATUSES.has(action.status) || action.status === 'executing') return action;
    return {
      ...action,
      status: 'snoozed',
      snoozedUntil,
      updatedAt: now.toISOString(),
    };
  });
}

export function dismissSocialAction(state: AppState, actionId: string, clock: SocialActionClock = defaultClock): AppState {
  const nowIso = clock.now().toISOString();
  return updateAction(state, actionId, (action) => {
    if (TERMINAL_STATUSES.has(action.status) || action.status === 'executing') return action;
    return {
      ...action,
      status: 'dismissed',
      snoozedUntil: undefined,
      updatedAt: nowIso,
    };
  });
}

export function failSocialAction(state: AppState, actionId: string, failureReason: string, clock: SocialActionClock = defaultClock): AppState {
  const nowIso = clock.now().toISOString();
  return updateAction(state, actionId, (action) => {
    if (TERMINAL_STATUSES.has(action.status)) return action;
    return {
      ...action,
      status: 'failed',
      failureReason: failureReason.trim().slice(0, 500) || '実行に失敗しました',
      updatedAt: nowIso,
    };
  });
}

export function completeSocialAction(
  state: AppState,
  actionId: string,
  options: { executionId?: string; externalResultId?: string; note?: string } = {},
  clock: SocialActionClock = defaultClock,
): AppState {
  const action = (state.socialActions || []).find((item) => item.id === actionId);
  if (!action || TERMINAL_STATUSES.has(action.status)) return state;
  const now = clock.now();
  const nowIso = now.toISOString();
  const socialActions = (state.socialActions || []).map((item) => item.id === actionId
    ? {
        ...item,
        status: 'completed' as const,
        completedAt: nowIso,
        updatedAt: nowIso,
        snoozedUntil: undefined,
        executionId: options.executionId || item.executionId,
        failureReason: undefined,
      }
    : item);

  const candidate = state.candidates.find((item) => item.id === action.candidateId);
  if (!candidate || candidate.skipped) return { ...state, socialActions };

  const recordedAction = interactionActionFor(action.type);
  const priorEngagements = state.interactions.filter((interaction) => interaction.candidateId === candidate.id && interaction.action === 'kept').length;
  const interaction: Interaction = {
    id: clock.id(),
    candidateId: candidate.id,
    action: recordedAction,
    at: nowIso,
    note: options.note,
    socialActionId: action.id,
    externalResultId: options.externalResultId,
  };

  const candidates = state.candidates.map((item) => {
    if (item.id !== candidate.id) return item;
    return applyCompletedActionToCandidate(item, action.type, recordedAction, priorEngagements, nowIso);
  });

  return {
    ...state,
    socialActions,
    interactions: [interaction, ...state.interactions],
    candidates,
  };
}

export function markSocialActionsCompleted(
  state: AppState,
  candidateId: string,
  recordedAction: Interaction['action'],
  clock: SocialActionClock = defaultClock,
): AppState {
  const matchingTypes = socialActionTypesForInteraction(recordedAction);
  if (!matchingTypes.length) return state;
  const nowIso = clock.now().toISOString();
  let changed = false;
  const socialActions = (state.socialActions || []).map((action) => {
    if (action.candidateId !== candidateId) return action;
    if (!matchingTypes.includes(action.type)) return action;
    if (TERMINAL_STATUSES.has(action.status)) return action;
    changed = true;
    return {
      ...action,
      status: 'completed' as const,
      completedAt: nowIso,
      updatedAt: nowIso,
      snoozedUntil: undefined,
      failureReason: undefined,
    };
  });
  return changed ? { ...state, socialActions } : state;
}

export function dismissMatchingSocialActions(
  state: AppState,
  candidateId: string,
  clock: SocialActionClock = defaultClock,
): AppState {
  const nowIso = clock.now().toISOString();
  let changed = false;
  const socialActions = (state.socialActions || []).map((action) => {
    if (action.candidateId !== candidateId) return action;
    if (TERMINAL_STATUSES.has(action.status) || action.status === 'executing') return action;
    changed = true;
    return {
      ...action,
      status: 'dismissed' as const,
      snoozedUntil: undefined,
      updatedAt: nowIso,
    };
  });
  return changed ? { ...state, socialActions } : state;
}

export function activeSocialActions(state: AppState, nowMs = Date.now()) {
  return (state.socialActions || [])
    .map((action) => normalizeSocialAction(action, nowMs))
    .filter((action): action is SocialAction => {
      if (!action) return false;
      if (action.status === 'snoozed') {
        const until = action.snoozedUntil ? new Date(action.snoozedUntil).getTime() : 0;
        return Number.isFinite(until) && until <= nowMs;
      }
      return ACTIVE_STATUSES.has(action.status);
    })
    .sort((left, right) => right.priorityScore - left.priorityScore || (right.observedAt || '').localeCompare(left.observedAt || ''));
}

export function isInboundType(type: SocialActionType) {
  return type === 'reply_inbound' || type === 'comment_reply' || type === 'dm_reply';
}

function mergeExistingAction(previous: SocialAction, incoming: SocialAction, nowIso: string, nowMs: number): SocialAction {
  const previousObserved = previous.observedAt ? new Date(previous.observedAt).getTime() : Number.NEGATIVE_INFINITY;
  const incomingObserved = incoming.observedAt ? new Date(incoming.observedAt).getTime() : Number.NEGATIVE_INFINITY;
  const incomingIsNewer = Number.isFinite(incomingObserved) && incomingObserved > previousObserved;
  const incomingIsSameOrNewer = Number.isFinite(incomingObserved) && incomingObserved >= previousObserved;
  if (TERMINAL_STATUSES.has(previous.status) && !incomingIsNewer) {
    return previous;
  }
  if (previous.status === 'completed' || previous.status === 'dismissed' || previous.status === 'expired') {
    return previous;
  }
  const takeContext = incomingIsSameOrNewer || !Number.isFinite(previousObserved);
  const merged: SocialAction = {
    ...previous,
    inboundText: takeContext && incoming.inboundText ? incoming.inboundText : previous.inboundText,
    contextText: takeContext ? incoming.contextText : previous.contextText,
    targetUrl: takeContext ? incoming.targetUrl : previous.targetUrl,
    parentContentId: takeContext ? incoming.parentContentId : previous.parentContentId,
    conversationId: incoming.conversationId || previous.conversationId,
    observedAt: takeContext ? incoming.observedAt : previous.observedAt,
    reason: takeContext && incoming.reason ? incoming.reason : previous.reason,
    missionRelevance: incoming.missionRelevance,
    relationshipValue: incoming.relationshipValue,
    urgency: incoming.urgency,
    conversationOpportunity: incoming.conversationOpportunity,
    authenticityRisk: incoming.authenticityRisk,
    executionMode: incoming.executionMode,
    updatedAt: nowIso,
  };
  merged.priorityScore = scoreSocialAction(merged);
  return normalizeSocialAction(merged, nowMs) || previous;
}

function dedupeSocialActions(actions: SocialAction[]) {
  const byId = new Map<string, SocialAction>();
  const byExternal = new Map<string, string>();
  for (const action of actions) {
    const existingById = byId.get(action.id);
    if (existingById) {
      byId.set(action.id, preferAction(existingById, action));
      continue;
    }
    const key = socialActionExternalKey(action);
    if (key) {
      const existingId = byExternal.get(key);
      if (existingId) {
        const existing = byId.get(existingId);
        if (existing) byId.set(existingId, preferAction(existing, action));
        continue;
      }
      byExternal.set(key, action.id);
    }
    byId.set(action.id, action);
  }
  return [...byId.values()];
}

function preferAction(left: SocialAction, right: SocialAction) {
  const leftObserved = left.observedAt ? new Date(left.observedAt).getTime() : Number.NEGATIVE_INFINITY;
  const rightObserved = right.observedAt ? new Date(right.observedAt).getTime() : Number.NEGATIVE_INFINITY;
  if (leftObserved !== rightObserved) return rightObserved > leftObserved ? right : left;
  const leftUpdated = new Date(left.updatedAt).getTime();
  const rightUpdated = new Date(right.updatedAt).getTime();
  return rightUpdated > leftUpdated ? right : left;
}

function updateAction(state: AppState, actionId: string, updater: (action: SocialAction) => SocialAction): AppState {
  let changed = false;
  const socialActions = (state.socialActions || []).map((action) => {
    if (action.id !== actionId) return action;
    const next = updater(action);
    if (next !== action) changed = true;
    return next;
  });
  return changed ? { ...state, socialActions } : state;
}

function applyCompletedActionToCandidate(
  candidate: Candidate,
  type: SocialActionType,
  recordedAction: Interaction['action'],
  priorEngagements: number,
  nowIso: string,
): Candidate {
  if (recordedAction === 'followed') {
    const stage = candidate.stage === 'discovered' || candidate.stage === 'interested' ? 'following' as const : candidate.stage;
    return {
      ...candidate,
      stage,
      followedAt: candidate.followedAt ?? nowIso,
      followBack: candidate.followBack ?? null,
      relationshipScore: addRelationshipScore(candidate.relationshipScore, 6),
      lastInteractionAt: nowIso,
    };
  }
  if (recordedAction === 'kept') {
    const increment = type === 'dm_reply' || type === 'dm_outbound' ? 10 : type === 'comment_reply' || type === 'reply_inbound' ? 8 : 6;
    return {
      ...candidate,
      stage: conservativeAdvance(candidate.stage, priorEngagements, candidate.followedAt, type),
      relationshipScore: addRelationshipScore(candidate.relationshipScore, increment),
      lastInteractionAt: nowIso,
    };
  }
  if (type === 'unfollow_review' && recordedAction === 'unfollow_review') {
    return {
      ...candidate,
      recommendedAction: 'review',
      draft: undefined,
      lastInteractionAt: nowIso,
    };
  }
  return { ...candidate, lastInteractionAt: nowIso };
}

function conservativeAdvance(
  stage: Candidate['stage'],
  priorEngagements: number,
  followedAt: string | undefined,
  type: SocialActionType,
): Candidate['stage'] {
  if (stage === 'discovered' || stage === 'interested') {
    return followedAt ? 'engaged' : stage;
  }
  if (stage === 'following') return 'engaged';
  const inbound = isInboundType(type);
  if (stage === 'engaged' && inbound && priorEngagements >= 1) return 'recognized';
  if (stage === 'recognized' && inbound && priorEngagements >= 2) return 'conversation';
  if (stage === 'conversation' && inbound && priorEngagements >= 4) return 'relationship';
  return stage;
}

function interactionActionFor(type: SocialActionType): Interaction['action'] {
  switch (type) {
    case 'follow':
      return 'followed';
    case 'unfollow_review':
      return 'unfollow_review';
    case 'like':
    case 'reply_inbound':
    case 'reply_outbound':
    case 'comment_reply':
    case 'dm_reply':
    case 'dm_outbound':
    case 'reconnect':
      return 'kept';
    default:
      return 'review';
  }
}

function socialActionTypesForInteraction(action: Interaction['action']): SocialActionType[] {
  if (action === 'followed') return ['follow'];
  if (action === 'kept') return ['like', 'reply_inbound', 'reply_outbound', 'comment_reply', 'dm_reply', 'dm_outbound', 'reconnect'];
  if (action === 'unfollow_review') return ['unfollow_review'];
  if (action === 'review') return ['relationship_review'];
  return [];
}

function incomingDraft(raw: Partial<SocialAction>) {
  const draft = raw.draft ?? raw.aiDraft;
  return typeof draft === 'string' && draft.trim() ? draft.trim().slice(0, 2400) : undefined;
}

function urgencyFromTimestamp(observedAt: string | undefined, inbound: boolean, nowMs: number) {
  if (!observedAt) return inbound ? 40 : 20;
  const observedMs = new Date(observedAt).getTime();
  if (!Number.isFinite(observedMs) || observedMs > nowMs + 5 * 60 * 1000) return inbound ? 40 : 20;
  const ageHours = Math.max(0, (nowMs - observedMs) / 3_600_000);
  if (inbound) {
    if (ageHours <= 2) return 96;
    if (ageHours <= 12) return 84;
    if (ageHours <= 24) return 70;
    if (ageHours <= 72) return 46;
    return 22;
  }
  if (ageHours <= 24) return 48;
  if (ageHours <= 72) return 36;
  return 18;
}

function nextLocalMidnight(now: Date) {
  const until = new Date(now);
  until.setHours(24, 0, 0, 0);
  return until;
}

function addRelationshipScore(score: number, increment: number) {
  const current = Number.isFinite(score) ? score : 0;
  return Math.max(0, Math.min(100, Math.round(current + increment)));
}

function clampScore(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validSnoozeIso(value: unknown, nowMs: number) {
  if (typeof value !== 'string' || !value) return undefined;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time > nowMs + MAX_SNOOZE_FUTURE_MS) return undefined;
  return new Date(time).toISOString();
}

function validPastishIso(value: unknown, nowMs: number) {
  if (typeof value !== 'string' || !value) return '';
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= nowMs + 5 * 60 * 1000
    ? new Date(time).toISOString()
    : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
