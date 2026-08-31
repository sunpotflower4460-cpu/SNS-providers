export type Platform = 'x' | 'instagram';
export type CandidateKind = 'fan' | 'artist' | 'creator' | 'media' | 'venue' | 'other';
export type RelationshipStage =
  | 'discovered'
  | 'interested'
  | 'following'
  | 'engaged'
  | 'recognized'
  | 'conversation'
  | 'relationship';

export type RecommendedAction = 'follow' | 'like' | 'reply' | 'dm' | 'review' | 'unfollow_review';

export interface Mission {
  text: string;
  /** Today's headline destination. Additional destinations live in secondaryGoals. */
  primaryGoal: string;
  secondaryGoals: string[];
  communicationDNA: string;
}

export interface PublicMetrics {
  followers: number;
  following: number;
  posts: number;
  listed?: number;
}

export interface Candidate {
  id: string;
  platform: Platform;
  username: string;
  displayName: string;
  bio: string;
  profileUrl: string;
  engagementUrl?: string;
  platformUserId?: string;
  verified?: boolean;
  publicMetrics?: PublicMetrics;
  profileSyncedAt?: string;
  profileSyncAttemptedAt?: string;
  kind: CandidateKind;
  match: number;
  relationshipScore: number;
  stage: RelationshipStage;
  reason: string;
  strategy?: string;
  tags: string[];
  recommendedAction: RecommendedAction;
  draft?: string;
  aiDraft?: string;
  followedAt?: string;
  followBack?: boolean | null;
  lastInteractionAt?: string;
  skipped?: boolean;
  snoozedUntil?: string;
}

export interface Interaction {
  id: string;
  candidateId: string;
  action: RecommendedAction | 'followed' | 'skipped' | 'kept';
  at: string;
  note?: string;
  socialActionId?: string;
  externalResultId?: string;
}

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

export type SocialActionSource =
  | 'x_mention'
  | 'x_dm'
  | 'x_discovery'
  | 'x_relationship'
  | 'x_follow'
  | 'x_unfollow'
  | 'x_like'
  | 'instagram_comment'
  | 'instagram_dm'
  | 'instagram_discovery'
  | 'relationship_engine'
  | 'manual';

export interface SocialAction {
  id: string;
  platform: Platform;
  candidateId: string;
  type: SocialActionType;
  status: SocialActionStatus;
  executionMode: ExecutionMode;
  source: SocialActionSource;
  externalEventId?: string;
  conversationId?: string;
  parentContentId?: string;
  targetUrl?: string;
  inboundText?: string;
  contextText?: string;
  aiDraft?: string;
  draft?: string;
  missionRelevance: number;
  relationshipValue: number;
  urgency: number;
  conversationOpportunity: number;
  authenticityRisk: number;
  priorityScore: number;
  reason: string;
  observedAt?: string;
  createdAt: string;
  updatedAt: string;
  snoozedUntil?: string;
  completedAt?: string;
  executionId?: string;
  failureReason?: string;
  unknownExecution?: boolean;
}

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

export type SocialEventType = 'mention' | 'reply' | 'comment' | 'dm' | 'follow';

export interface SocialEvent {
  id: string;
  platform: Platform;
  type: SocialEventType;
  externalEventId: string;
  externalUserId?: string;
  text?: string;
  conversationId?: string;
  contentId?: string;
  parentContentId?: string;
  permalink?: string;
  occurredAt: string;
  receivedAt: string;
  rawHash?: string;
}

export interface BudgetState {
  monthlyLimitUsd: number;
  effectiveLimitUsd?: number;
  hardLimit: boolean;
  usedUsd: number;
  xUsd: number;
  llmUsd: number;
  searchUsd: number;
  mode: 'free' | 'eco' | 'balanced' | 'growth';
}

export interface RelationshipPolicy {
  followBackReviewAfterDays: number;
  preserveHighMatch: boolean;
  autoDraftReplies?: boolean;
  dailyQueueLimit?: number;
  dailyConnectionLimit?: number;
  dailyConversationLimit?: number;
  dailyLightEngagementLimit?: number;
  dailyCleanupLimit?: number;
  dailySelfImproveLimit?: number;
  autoReplenishEnabled?: boolean;
}

export interface SelfInsight {
  id: string;
  title: string;
  body: string;
  category: 'profile' | 'content' | 'network';
  priority: 'high' | 'medium' | 'low';
}

export interface SelfProfileState {
  profileText: string;
  recentPostsText: string;
  score?: number;
  summary?: string;
  strategy?: string;
  profileRewrite?: string;
  analyzedAt?: string;
}

export interface XOwnedAccountState {
  username?: string;
  displayName?: string;
  verified?: boolean;
  publicMetrics?: PublicMetrics;
  lastSyncedAt?: string;
  followerSampleCount?: number;
  followingSampleCount?: number;
  recentPostCount?: number;
  followersComplete?: boolean;
  followingComplete?: boolean;
  postsComplete?: boolean;
  followerCycle?: number;
  followingCycle?: number;
  lastSyncCostUsd?: number;
  pacedCapUsd?: number;
  pacingDaysRemaining?: number;
}

export interface InstagramOwnedAccountState {
  lastSyncedAt?: string;
  mediaScanned?: number;
  commentEvents?: number;
  engagerCount?: number;
}

export interface AppState {
  mission: Mission;
  candidates: Candidate[];
  interactions: Interaction[];
  socialActions: SocialAction[];
  budget: BudgetState;
  relationshipPolicy: RelationshipPolicy;
  insights: SelfInsight[];
  selfProfile: SelfProfileState;
  xAccount: XOwnedAccountState;
  instagramAccount?: InstagramOwnedAccountState;
}

export type AppStateUpdater = (value: AppState | ((current: AppState) => AppState)) => void;
