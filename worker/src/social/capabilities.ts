import type { InstagramPermissionSnapshot } from './instagram/probe';
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
  INSTAGRAM_DM_WRITE_ENABLED?: string;
  X_REPLY_WRITE_ENABLED?: string;
  X_FOLLOW_WRITE_ENABLED?: string;
  X_UNFOLLOW_WRITE_ENABLED?: string;
  X_LIKE_WRITE_ENABLED?: string;
  X_DM_WRITE_ENABLED?: string;
}

export interface InstagramCapabilityView extends SocialCapabilities {
  configured: boolean;
  tokenValid: boolean;
  professionalAccount: boolean;
  permissionsVerified: boolean;
  reason?: string;
}

export interface XCapabilityView extends SocialCapabilities {
  connected: boolean;
  scopes: string[];
  reason?: string;
}

export interface LiveSocialCapabilitySnapshot {
  instagram: InstagramCapabilityView;
  x: XCapabilityView;
}

export function instagramConfigured(env: SocialCapabilityEnv) {
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim() || '';
  const userId = env.INSTAGRAM_USER_ID?.trim() || '';
  const version = env.INSTAGRAM_API_VERSION?.trim() || '';
  return Boolean(token && /^\d{4,30}$/.test(userId) && /^v\d+\.\d+$/.test(version));
}

export function productionWritesEnabled(env: SocialCapabilityEnv) {
  return env.SOCIAL_WRITE_MODE === 'test' || env.SOCIAL_WRITE_ENABLED === 'true';
}

export function instagramCommentReplyWriteEnabled(env: SocialCapabilityEnv) {
  if (env.SOCIAL_WRITE_MODE === 'test') return true;
  return env.SOCIAL_WRITE_ENABLED === 'true' && env.INSTAGRAM_COMMENT_REPLY_ENABLED === 'true';
}

export function instagramDmWriteEnabled(env: SocialCapabilityEnv) {
  if (env.SOCIAL_WRITE_MODE === 'test') return true;
  return env.SOCIAL_WRITE_ENABLED === 'true' && env.INSTAGRAM_DM_WRITE_ENABLED === 'true';
}

export function xReplyWriteEnabled(env: SocialCapabilityEnv) {
  if (env.SOCIAL_WRITE_MODE === 'test') return true;
  return env.SOCIAL_WRITE_ENABLED === 'true' && env.X_REPLY_WRITE_ENABLED === 'true';
}

export function xFollowWriteEnabled(env: SocialCapabilityEnv) {
  if (env.SOCIAL_WRITE_MODE === 'test') return true;
  return env.SOCIAL_WRITE_ENABLED === 'true' && env.X_FOLLOW_WRITE_ENABLED === 'true';
}

export function xUnfollowWriteEnabled(env: SocialCapabilityEnv) {
  if (env.SOCIAL_WRITE_MODE === 'test') return true;
  return env.SOCIAL_WRITE_ENABLED === 'true' && env.X_UNFOLLOW_WRITE_ENABLED === 'true';
}

export function xLikeWriteEnabled(env: SocialCapabilityEnv) {
  if (env.SOCIAL_WRITE_MODE === 'test') return true;
  return env.SOCIAL_WRITE_ENABLED === 'true' && env.X_LIKE_WRITE_ENABLED === 'true';
}

export function xDmWriteEnabled(env: SocialCapabilityEnv) {
  if (env.SOCIAL_WRITE_MODE === 'test') return true;
  return env.SOCIAL_WRITE_ENABLED === 'true' && env.X_DM_WRITE_ENABLED === 'true';
}

export function operationWriteEnabled(env: SocialCapabilityEnv, operation: string) {
  switch (operation) {
    case 'instagram_comment_reply': return instagramCommentReplyWriteEnabled(env);
    case 'instagram_dm_write': return instagramDmWriteEnabled(env);
    case 'x_reply_write': return xReplyWriteEnabled(env);
    case 'x_follow_write': return xFollowWriteEnabled(env);
    case 'x_unfollow_write': return xUnfollowWriteEnabled(env);
    case 'x_like_write': return xLikeWriteEnabled(env);
    case 'x_dm_write': return xDmWriteEnabled(env);
    default: return env.SOCIAL_WRITE_MODE === 'test';
  }
}

export function liveInstagramCapabilities(
  env: SocialCapabilityEnv,
  probe?: InstagramPermissionSnapshot | null,
): InstagramCapabilityView {
  const configured = instagramConfigured(env);
  const testMode = env.SOCIAL_WRITE_MODE === 'test';
  const tokenValid = testMode || probe?.tokenValid === true;
  const professionalAccount = testMode || probe?.professionalAccount === true;
  const verified = testMode || probe?.permissionsVerified === true;
  const comments = testMode || (verified && probe?.readComments === true);
  const messages = testMode || (verified && probe?.readDm === true);
  return {
    ...DISABLED_SOCIAL_CAPABILITIES,
    configured,
    tokenValid: configured && tokenValid,
    professionalAccount: configured && professionalAccount,
    permissionsVerified: configured && verified,
    reason: probe?.reason,
    readComments: configured && comments,
    sendCommentReply: comments && instagramCommentReplyWriteEnabled(env) && (testMode || configured),
    readDm: configured && messages,
    sendDm: messages && instagramDmWriteEnabled(env) && (testMode || configured),
    follow: false,
    unfollow: false,
    like: false,
  };
}

export function liveSocialCapabilities(
  env: SocialCapabilityEnv,
  grantedXScopes: readonly string[] = [],
  probe?: InstagramPermissionSnapshot | null,
  xConnected = false,
): LiveSocialCapabilitySnapshot {
  return {
    instagram: liveInstagramCapabilities(env, probe),
    x: liveXCapabilities(env, grantedXScopes, xConnected),
  };
}

export function liveXCapabilities(
  env: SocialCapabilityEnv,
  grantedXScopes: readonly string[] = [],
  connected = false,
): XCapabilityView {
  const granted = new Set(grantedXScopes);
  const testMode = env.SOCIAL_WRITE_MODE === 'test';
  const usable = testMode || connected || granted.size > 0;
  return {
    connected: usable,
    scopes: [...granted],
    readMentions: granted.has('tweet.read'),
    readComments: false,
    readDm: granted.has('dm.read'),
    sendReply: xReplyWriteEnabled(env) && (testMode || granted.has('tweet.write')),
    sendCommentReply: false,
    sendDm: xDmWriteEnabled(env) && (testMode || granted.has('dm.write')),
    follow: xFollowWriteEnabled(env) && (testMode || granted.has('follows.write')),
    unfollow: xUnfollowWriteEnabled(env) && (testMode || granted.has('follows.write')),
    like: xLikeWriteEnabled(env) && (testMode || granted.has('like.write')),
    reason: usable ? undefined : 'X is not connected.',
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
