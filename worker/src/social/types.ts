export type SocialActionType =
  | 'reply_inbound'
  | 'reply_outbound'
  | 'comment_reply'
  | 'dm_reply'
  | 'dm_outbound'
  | 'follow'
  | 'like'
  | 'reconnect'
  | 'relationship_review'
  | 'unfollow_review';

export type SocialActionStatus =
  | 'pending'
  | 'ready'
  | 'snoozed'
  | 'executing'
  | 'completed'
  | 'dismissed'
  | 'failed'
  | 'expired';

export type ExecutionMode = 'in_app' | 'handoff';

export interface SocialCapabilities {
  readMentions: boolean;
  readComments: boolean;
  readDm: boolean;
  sendReply: boolean;
  sendCommentReply: boolean;
  sendDm: boolean;
  follow: boolean;
  unfollow: boolean;
  like: boolean;
}

export interface CanonicalSocialAction {
  id: string;
  userId: string;
  platform: 'x' | 'instagram';
  candidateId: string;
  type: SocialActionType;
  status: SocialActionStatus;
  executionMode: ExecutionMode;
  source: string;
  externalEventId?: string;
  conversationId?: string;
  parentContentId?: string;
  targetUrl?: string;
  observedAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  platformUserId?: string;
  username?: string;
  identityConflict: boolean;
  retryable: boolean;
}

export interface CanonicalSocialEvent {
  id: string;
  userId: string;
  platform: 'x' | 'instagram';
  type: string;
  externalEventId: string;
  externalUserId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  receivedAt: string;
}

export interface CanonicalCandidateIdentity {
  id: string;
  platform: 'x' | 'instagram';
  platformUserId?: string;
  username: string;
  identityConflict: boolean;
}

export interface ExecuteRequest {
  executionId: string;
  draft: string;
}

export interface CanonicalExecuteContext {
  executionId: string;
  draft: string;
  action: CanonicalSocialAction;
  candidate: CanonicalCandidateIdentity;
  event: CanonicalSocialEvent | null;
}

export type ExecuteFailureCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_ACTION'
  | 'NOT_FOUND'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'HANDOFF_NOT_EXECUTABLE'
  | 'IDENTITY_CONFLICT'
  | 'BINDING_MISMATCH'
  | 'WRITE_DISABLED'
  | 'WRITE_COST_UNKNOWN'
  | 'ALREADY_EXECUTED'
  | 'CAPABILITY_DENIED'
  | 'RETRY_NOT_SAFE'
  | 'UNKNOWN_RESULT';

export interface WriteTarget {
  platform: 'x' | 'instagram';
  operation: string;
  externalEventId: string;
  parentContentId?: string;
  targetUrl?: string;
  conversationId?: string;
}

export interface ProviderWriteResult {
  certainty: 'success' | 'failure' | 'unknown';
  externalResultId?: string;
  providerStatus?: string;
  retryable?: boolean;
  errorCode?: string;
  reason?: string;
}
