import type {
  ExecutionMode,
  Platform,
  SocialActionType,
  SocialCapabilities,
} from './types';

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

export function capabilitiesForPlatform(
  platform: Platform,
  xScopes: readonly string[] = [],
): SocialCapabilities {
  if (platform === 'instagram') {
    return liveSnapshot?.instagram || DISABLED_SOCIAL_CAPABILITIES;
  }
  if (liveSnapshot?.x) return liveSnapshot.x;
  return xCapabilitiesFromScopes(xScopes);
}

export const SOCIAL_CAPABILITIES_CHANGED = 'sns-social-capabilities-changed';

let liveSnapshot: {
  instagram: SocialCapabilities;
  x: SocialCapabilities;
} | null = null;

export function setLiveSocialCapabilities(snapshot: { instagram: SocialCapabilities; x: SocialCapabilities } | null) {
  liveSnapshot = snapshot;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SOCIAL_CAPABILITIES_CHANGED));
}

export function getLiveSocialCapabilities() {
  return liveSnapshot;
}

export function executionModeForAction(
  type: SocialActionType,
  capabilities: SocialCapabilities,
): ExecutionMode {
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

export function requiredCapability(
  type: SocialActionType,
): keyof SocialCapabilities | null {
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
    case 'reconnect':
    case 'relationship_review':
      return null;
  }
}
