import { requiredWriteCapability } from './capabilities';
import type { ExecuteFailureCode, ExecuteRequest, SocialCapabilities } from './types';

const ACTION_TYPES = new Set([
  'reply_inbound', 'reply_outbound', 'comment_reply', 'dm_reply', 'dm_outbound',
  'follow', 'like', 'reconnect', 'relationship_review', 'unfollow_review',
]);
const TERMINAL = new Set(['completed', 'dismissed', 'expired']);
const EXECUTION_ID = /^[A-Za-z0-9._-]{8,180}$/;

export interface ExecuteGuardOk {
  ok: true;
}

export interface ExecuteGuardErr {
  ok: false;
  code: ExecuteFailureCode;
  reason: string;
}

export function assertSingleActionExecute(body: unknown): ExecuteGuardErr | ExecuteRequest {
  if (!isRecord(body)) return fail('INVALID_ACTION', 'Execute body must be a JSON object.');
  if (Object.prototype.hasOwnProperty.call(body, 'actions') || Array.isArray(body.action)) {
    return fail('INVALID_ACTION', 'Bulk social writes are not permitted.');
  }
  const executionId = typeof body.executionId === 'string' ? body.executionId.trim() : '';
  if (!EXECUTION_ID.test(executionId)) return fail('INVALID_ACTION', 'executionId is required and must be a single durable key.');
  if (!isRecord(body.action) || !isRecord(body.candidate)) return fail('INVALID_ACTION', 'action and candidate are required.');
  const action = body.action;
  const candidate = body.candidate;
  if (typeof action.id !== 'string' || !action.id.trim()) return fail('INVALID_ACTION', 'action.id is required.');
  if (action.platform !== 'x' && action.platform !== 'instagram') return fail('INVALID_ACTION', 'action.platform is invalid.');
  if (typeof action.candidateId !== 'string' || !action.candidateId.trim()) return fail('INVALID_ACTION', 'action.candidateId is required.');
  if (typeof action.type !== 'string' || !ACTION_TYPES.has(action.type)) return fail('INVALID_ACTION', 'action.type is invalid.');
  if (typeof action.status !== 'string') return fail('INVALID_ACTION', 'action.status is invalid.');
  if (action.executionMode !== 'in_app' && action.executionMode !== 'handoff') return fail('INVALID_ACTION', 'action.executionMode is invalid.');
  if (typeof candidate.id !== 'string' || candidate.id.trim() !== action.candidateId.trim()) {
    return fail('BINDING_MISMATCH', 'Candidate binding does not match the action.');
  }
  if (candidate.platform !== action.platform) return fail('BINDING_MISMATCH', 'Candidate platform does not match the action.');
  const draft = typeof body.draft === 'string' ? body.draft.trim().slice(0, 2400) : (typeof action.draft === 'string' ? action.draft.trim().slice(0, 2400) : '');
  const platform = action.platform;
  return {
    executionId,
    draft,
    action: {
      id: action.id.trim(),
      platform,
      candidateId: action.candidateId.trim(),
      type: action.type as ExecuteRequest['action']['type'],
      status: action.status as ExecuteRequest['action']['status'],
      executionMode: action.executionMode,
      source: typeof action.source === 'string' ? action.source : '',
      externalEventId: typeof action.externalEventId === 'string' ? action.externalEventId : undefined,
      parentContentId: typeof action.parentContentId === 'string' ? action.parentContentId : undefined,
      targetUrl: typeof action.targetUrl === 'string' ? action.targetUrl : undefined,
      draft,
    },
    candidate: {
      id: candidate.id.trim(),
      platform,
      platformUserId: typeof candidate.platformUserId === 'string' ? candidate.platformUserId : undefined,
      username: typeof candidate.username === 'string' ? candidate.username : '',
      tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    },
  };
}

export function assertExecutable(
  request: ExecuteRequest,
  capabilities: SocialCapabilities,
  options: { writesEnabled: boolean; writeCostKnown: boolean } = { writesEnabled: false, writeCostKnown: false },
): ExecuteGuardOk | ExecuteGuardErr {
  const { action, candidate, draft } = request;
  if (action.status === 'completed') return fail('COMPLETED', 'This social action has already been completed.');
  if (action.status === 'expired') return fail('EXPIRED', 'This social action has expired and cannot be written.');
  if (TERMINAL.has(action.status)) return fail('INVALID_ACTION', 'This social action is no longer executable.');
  if (action.executionMode !== 'in_app') return fail('HANDOFF_NOT_EXECUTABLE', 'HANDOFF actions cannot call a provider write.');
  if (candidate.tags?.includes('identity-conflict')) {
    return fail('IDENTITY_CONFLICT', 'Identity conflict blocks direct social execution.');
  }
  const required = requiredWriteCapability(action.type);
  if (required && !capabilities[required]) return fail('CAPABILITY_DENIED', 'Connected capabilities do not allow this write.');
  if (needsExternalTarget(action.type) && !action.externalEventId && !action.targetUrl && !action.parentContentId) {
    return fail('BINDING_MISMATCH', 'This write is missing a concrete external event or target.');
  }
  if (needsDraft(action.type) && !draft) return fail('INVALID_ACTION', 'User-approved text is required for this write.');
  if (!options.writesEnabled) return fail('WRITE_DISABLED', 'Provider writes are disabled until an explicit capability upgrade and write adapter are enabled.');
  if (!options.writeCostKnown) return fail('WRITE_COST_UNKNOWN', 'Billable social writes fail closed when accounting is unavailable.');
  return { ok: true };
}

export function needsDraft(type: ExecuteRequest['action']['type']) {
  return type === 'reply_inbound'
    || type === 'reply_outbound'
    || type === 'comment_reply'
    || type === 'dm_reply'
    || type === 'dm_outbound';
}

function needsExternalTarget(type: ExecuteRequest['action']['type']) {
  return type === 'comment_reply' || type === 'reply_inbound' || type === 'reply_outbound' || type === 'like';
}

function fail(code: ExecuteFailureCode, reason: string): ExecuteGuardErr {
  return { ok: false, code, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
