import type { ExecutionMode, SocialActionType, SocialCapabilities } from './types';

export const DISABLED_SOCIAL_CAPABILITIES: SocialCapabilities = {
  readMentions: false,
  readComments: false,
  readDm: false,
  sendReply: false,
  sendCommentReply: false,
  sendDm: false,
  follow: false,
  unfollow: false,
  like: false,
};

export const INSTAGRAM_PROFESSIONAL_CAPABILITIES: SocialCapabilities = {
  readMentions: false,
  readComments: true,
  readDm: false,
  sendReply: false,
  sendCommentReply: true,
  sendDm: false,
  follow: false,
  unfollow: false,
  like: false,
};

export function xCapabilitiesFromScopes(scopes: readonly string[]): SocialCapabilities {
  const granted = new Set(scopes);
  return {
    readMentions: granted.has('tweet.read'),
    readComments: false,
    readDm: granted.has('dm.read'),
    sendReply: granted.has('tweet.write'),
    sendCommentReply: false,
    sendDm: granted.has('dm.write'),
    follow: granted.has('follows.write'),
    unfollow: granted.has('follows.write'),
    like: granted.has('like.write'),
  };
}

export function executionModeForAction(type: SocialActionType, capabilities: SocialCapabilities): ExecutionMode {
  switch (type) {
    case 'reply_inbound':
    case 'reply_outbound':
      return capabilities.sendReply ? 'in_app' : 'handoff';
    case 'comment_reply':
      return capabilities.sendCommentReply ? 'in_app' : 'handoff';
    case 'dm_reply':
    case 'dm_outbound':
      return capabilities.sendDm ? 'in_app' : 'handoff';
    case 'follow':
      return capabilities.follow ? 'in_app' : 'handoff';
    case 'like':
      return capabilities.like ? 'in_app' : 'handoff';
    case 'unfollow_review':
      return capabilities.unfollow ? 'in_app' : 'handoff';
    case 'reconnect':
    case 'relationship_review':
      return 'handoff';
  }
}

export function requiredWriteCapability(type: SocialActionType): keyof SocialCapabilities | null {
  switch (type) {
    case 'reply_inbound':
    case 'reply_outbound':
      return 'sendReply';
    case 'comment_reply':
      return 'sendCommentReply';
    case 'dm_reply':
    case 'dm_outbound':
      return 'sendDm';
    case 'follow':
      return 'follow';
    case 'like':
      return 'like';
    case 'unfollow_review':
      return 'unfollow';
    default:
      return null;
  }
}
