import { requiredWriteCapability } from './capabilities';
import type {
  CanonicalExecuteContext,
  CanonicalSocialAction,
  ExecuteFailureCode,
  ExecuteRequest,
  SocialCapabilities,
  WriteTarget,
} from './types';

const ACTION_STATUSES = new Set([
  'pending', 'ready', 'snoozed', 'executing', 'completed', 'dismissed', 'failed', 'expired',
]);
const EXECUTABLE_STATUSES = new Set(['pending', 'ready', 'failed']);
const TERMINAL = new Set(['completed', 'dismissed', 'expired']);
const EXECUTION_ID = /^[A-Za-z0-9._-]{8,180}$/;
const COMMENT_ID = /^\d{1,30}$/;

export interface ExecuteGuardOk {
  ok: true;
}

export interface ExecuteGuardErr {
  ok: false;
  code: ExecuteFailureCode;
  reason: string;
}

export function parseExecuteBody(body: unknown): ExecuteGuardErr | ExecuteRequest {
  if (!isRecord(body)) return fail('INVALID_ACTION', 'Execute body must be a JSON object.');
  if (Object.prototype.hasOwnProperty.call(body, 'actions') || Array.isArray(body.action)) {
    return fail('INVALID_ACTION', 'Bulk social writes are not permitted.');
  }
  const executionId = typeof body.executionId === 'string' ? body.executionId.trim() : '';
  if (!EXECUTION_ID.test(executionId)) return fail('INVALID_ACTION', 'executionId is required and must be a single durable key.');
  const draft = typeof body.draft === 'string' ? body.draft.trim().slice(0, 2400) : '';
  return { executionId, draft };
}

/** @deprecated Use parseExecuteBody. Kept as an alias so source invariants stay explicit. */
export function assertSingleActionExecute(body: unknown): ExecuteGuardErr | ExecuteRequest {
  return parseExecuteBody(body);
}

export function assertExecutable(
  context: CanonicalExecuteContext,
  capabilities: SocialCapabilities,
  options: { writesEnabled: boolean; writeCostKnown: boolean } = { writesEnabled: false, writeCostKnown: false },
): ExecuteGuardOk | ExecuteGuardErr {
  const { action, candidate, draft, event } = context;
  if (!ACTION_STATUSES.has(action.status)) return fail('INVALID_ACTION', 'This social action is not in an executable state.');
  if (action.status === 'completed') return fail('COMPLETED', 'This social action has already been completed.');
  if (action.status === 'expired') return fail('EXPIRED', 'This social action has expired and cannot be written.');
  if (TERMINAL.has(action.status)) return fail('INVALID_ACTION', 'This social action is no longer executable.');
  if (action.status === 'executing') return fail('ALREADY_EXECUTED', 'This social action is already being executed.');
  if (action.status === 'snoozed') return fail('INVALID_ACTION', 'This social action is not in an executable state.');
  if (!EXECUTABLE_STATUSES.has(action.status)) return fail('INVALID_ACTION', 'This social action is not in an executable state.');
  if (action.status === 'failed' && action.retryable === false) {
    return fail('RETRY_NOT_SAFE', 'This failed write is not safe to retry.');
  }
  const required = requiredWriteCapability(action.type);
  if (required && !capabilities[required]) {
    if (action.executionMode !== 'in_app') return fail('HANDOFF_NOT_EXECUTABLE', 'HANDOFF actions cannot call a provider write.');
    return fail('CAPABILITY_DENIED', 'Connected capabilities do not allow this write.');
  }
  if (action.identityConflict || candidate.identityConflict) {
    return fail('IDENTITY_CONFLICT', 'Identity conflict blocks direct social execution.');
  }
  if (needsDraft(action.type) && !draft) return fail('INVALID_ACTION', 'User-approved text is required for this write.');
  if (!options.writesEnabled) return fail('WRITE_DISABLED', 'Provider writes are disabled until an explicit capability upgrade and write adapter are enabled.');
  if (!options.writeCostKnown) return fail('WRITE_COST_UNKNOWN', 'Billable social writes fail closed when accounting is unavailable.');

  const target = resolveWriteTarget(action, event);
  if ('ok' in target && target.ok === false) return target;
  return { ok: true };
}

export function resolveWriteTarget(
  action: CanonicalSocialAction,
  event: CanonicalExecuteContext['event'],
): WriteTarget | ExecuteGuardErr {
  if (action.type === 'comment_reply') {
    if (action.platform !== 'instagram' || action.source !== 'instagram_comment') {
      return fail('BINDING_MISMATCH', 'Instagram comment replies require a server-side Instagram comment action.');
    }
    if (!event || event.platform !== 'instagram' || event.type !== 'comment') {
      return fail('BINDING_MISMATCH', 'This write is missing verified provider comment evidence.');
    }
    const commentId = event.externalEventId;
    const mediaId = typeof event.payload.mediaId === 'string' ? event.payload.mediaId : action.parentContentId;
    if (!COMMENT_ID.test(commentId) || !mediaId || !COMMENT_ID.test(mediaId)) {
      return fail('BINDING_MISMATCH', 'Malformed or missing Instagram comment/media identity blocks execution.');
    }
    if (action.externalEventId && action.externalEventId !== commentId) {
      return fail('BINDING_MISMATCH', 'SocialAction is not bound to the verified comment event.');
    }
    const permalink = typeof event.payload.permalink === 'string' ? event.payload.permalink : action.targetUrl;
    return {
      platform: 'instagram',
      operation: 'instagram_comment_reply',
      externalEventId: commentId,
      parentContentId: mediaId,
      targetUrl: permalink,
    };
  }
  if (action.type === 'reply_inbound' || action.type === 'reply_outbound') {
    if (!event || event.platform !== 'x') {
      return fail('BINDING_MISMATCH', 'X replies require a verified inbound tweet event.');
    }
    return {
      platform: 'x',
      operation: 'x_reply_write',
      externalEventId: event.externalEventId,
      parentContentId: action.parentContentId,
      conversationId: event.payload && typeof event.payload.conversationId === 'string'
        ? event.payload.conversationId
        : action.conversationId,
      targetUrl: action.targetUrl,
    };
  }
  if (needsExternalTarget(action.type) && !action.externalEventId && !action.targetUrl && !action.parentContentId) {
    return fail('BINDING_MISMATCH', 'This write is missing a concrete external event or target.');
  }
  return fail('WRITE_DISABLED', 'Live writes are not enabled for this operation yet.');
}

export function needsDraft(type: CanonicalSocialAction['type']) {
  return type === 'reply_inbound'
    || type === 'reply_outbound'
    || type === 'comment_reply'
    || type === 'dm_reply'
    || type === 'dm_outbound';
}

export function writeOperationFor(type: CanonicalSocialAction['type'], platform: CanonicalSocialAction['platform']) {
  switch (type) {
    case 'comment_reply': return 'instagram_comment_reply';
    case 'dm_reply':
    case 'dm_outbound':
      return platform === 'instagram' ? 'instagram_dm_write' : 'x_dm_write';
    case 'follow': return 'x_follow_write';
    case 'reply_inbound':
    case 'reply_outbound':
      return 'x_reply_write';
    default: return `${platform}_write`;
  }
}

function needsExternalTarget(type: CanonicalSocialAction['type']) {
  return type === 'comment_reply' || type === 'reply_inbound' || type === 'reply_outbound' || type === 'like';
}

function fail(code: ExecuteFailureCode, reason: string): ExecuteGuardErr {
  return { ok: false, code, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
