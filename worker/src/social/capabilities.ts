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

export interface SocialCapabilityEnv {
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_API_VERSION?: string;
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  INSTAGRAM_COMMENT_REPLY_ENABLED?: string;
}

export interface LiveSocialCapabilitySnapshot {
  instagram: SocialCapabilities & {
    configured: boolean;
    tokenAvailable: boolean;
    accountTypeSupported: boolean;
    writeAdapterEnabled: boolean;
    productionWriteEnabled: boolean;
  };
  x: SocialCapabilities;
}

export function instagramConfigured(env: SocialCapabilityEnv) {
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim() || '';
  const userId = env.INSTAGRAM_USER_ID?.trim() || '';
  const version = env.INSTAGRAM_API_VERSION?.trim() || '';
  return Boolean(token && /^\d{4,30}$/.test(userId) && /^v\d+\.\d+$/.test(version));
}

export function instagramCommentReplyWriteEnabled(env: SocialCapabilityEnv) {
  if (env.SOCIAL_WRITE_MODE === 'test') return true;
  return env.SOCIAL_WRITE_ENABLED === 'true' && env.INSTAGRAM_COMMENT_REPLY_ENABLED === 'true';
}

export function liveInstagramCapabilities(env: SocialCapabilityEnv): LiveSocialCapabilitySnapshot['instagram'] {
  const configured = instagramConfigured(env);
  const productionWriteEnabled = env.SOCIAL_WRITE_ENABLED === 'true' && env.INSTAGRAM_COMMENT_REPLY_ENABLED === 'true';
  const writeAdapterEnabled = true;
  const sendCommentReply = writeAdapterEnabled && instagramCommentReplyWriteEnabled(env) && (env.SOCIAL_WRITE_MODE === 'test' || configured);
  return {
    ...DISABLED_SOCIAL_CAPABILITIES,
    configured,
    tokenAvailable: Boolean(env.INSTAGRAM_ACCESS_TOKEN?.trim()),
    accountTypeSupported: configured,
    writeAdapterEnabled,
    productionWriteEnabled,
    readComments: configured,
    sendCommentReply,
  };
}

export function liveSocialCapabilities(env: SocialCapabilityEnv, grantedXScopes: readonly string[] = []): LiveSocialCapabilitySnapshot {
  return {
    instagram: liveInstagramCapabilities(env),
    x: xCapabilitiesFromScopes(grantedXScopes),
  };
}

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
