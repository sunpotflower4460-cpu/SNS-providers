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
  platformUserId?: string;
  verified?: boolean;
  publicMetrics?: PublicMetrics;
  profileSyncedAt?: string;
  kind: CandidateKind;
  match: number;
  relationshipScore: number;
  stage: RelationshipStage;
  reason: string;
  strategy?: string;
  tags: string[];
  recommendedAction: RecommendedAction;
  draft?: string;
  followedAt?: string;
  followBack?: boolean | null;
  lastInteractionAt?: string;
  skipped?: boolean;
}

export interface Interaction {
  id: string;
  candidateId: string;
  action: RecommendedAction | 'followed' | 'skipped' | 'kept';
  at: string;
  note?: string;
}

export interface BudgetState {
  monthlyLimitUsd: number;
  hardLimit: boolean;
  usedUsd: number;
  xUsd: number;
  llmUsd: number;
  searchUsd: number;
  mode: 'free' | 'eco' | 'balanced' | 'growth';
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

export interface AppState {
  mission: Mission;
  candidates: Candidate[];
  interactions: Interaction[];
  budget: BudgetState;
  insights: SelfInsight[];
  selfProfile: SelfProfileState;
}
