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

export interface ExecutableSocialAction {
  id: string;
  platform: 'x' | 'instagram';
  candidateId: string;
  type: SocialActionType;
  status: SocialActionStatus;
  executionMode: ExecutionMode;
  source: string;
  externalEventId?: string;
  parentContentId?: string;
  targetUrl?: string;
  draft?: string;
}

export interface ExecuteRequest {
  executionId: string;
  draft?: string;
  action: ExecutableSocialAction;
  candidate: {
    id: string;
    platform: 'x' | 'instagram';
    platformUserId?: string;
    username: string;
    tags?: string[];
  };
}

export type ExecuteFailureCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_ACTION'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'HANDOFF_NOT_EXECUTABLE'
  | 'IDENTITY_CONFLICT'
  | 'BINDING_MISMATCH'
  | 'WRITE_DISABLED'
  | 'WRITE_COST_UNKNOWN'
  | 'ALREADY_EXECUTED'
  | 'CAPABILITY_DENIED';
