import type { AppState, Candidate, Interaction, RelationshipPolicy, SelfInsight } from './types';

interface BackupEnvelope {
  format: 'social-mission-backup';
  version: 1;
  exportedAt: string;
  state: AppState;
}

const relationshipDefaults: RelationshipPolicy = {
  followBackReviewAfterDays: 30,
  preserveHighMatch: true,
  dailyQueueLimit: 30,
  dailyConnectionLimit: 20,
  dailyConversationLimit: 8,
  dailyLightEngagementLimit: 8,
  dailyCleanupLimit: 5,
  dailySelfImproveLimit: 2,
};

const legacyDemoCandidates = new Set([
  'x-1:x:music_listener',
  'ig-1:instagram:indie_creator',
  'x-2:x:songwriter_friend',
]);

const allowedStages = new Set(['discovered', 'interested', 'following', 'engaged', 'recognized', 'conversation', 'relationship']);
const allowedKinds = new Set(['fan', 'artist', 'creator', 'media', 'venue', 'other']);
const allowedActions = new Set(['follow', 'like', 'reply', 'dm', 'review', 'unfollow_review']);
const allowedInteractionActions = new Set([...allowedActions, 'followed', 'skipped', 'kept']);
const allowedBudgetModes = new Set(['free', 'eco', 'balanced', 'growth']);
const allowedInsightCategories = new Set(['profile', 'content', 'network']);
const allowedInsightPriorities = new Set(['high', 'medium', 'low']);

export function downloadBackup(state: AppState) {
  const payload: BackupEnvelope = {
    format: 'social-mission-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `social-mission-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function readBackup(file: File): Promise<AppState> {
  if (file.size > 5_000_000) throw new Error('バックアップファイルが大きすぎます');
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<BackupEnvelope>;
  if (parsed.format !== 'social-mission-backup' || parsed.version !== 1 || !parsed.state) {
    throw new Error('Social Missionのバックアップ形式ではありません');
  }
  const state = normalizeAppState(parsed.state);
  validateAppState(state);
  return state;
}

export function normalizeAppState(state: AppState): AppState {
  const candidates = Array.isArray(state?.candidates)
    ? state.candidates.map(normalizeCandidate).filter((candidate): candidate is Candidate => Boolean(candidate))
    : [];
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const normalizedInteractions = Array.isArray(state?.interactions)
    ? state.interactions.map(normalizeInteraction).filter((interaction): interaction is Interaction => interaction !== null)
    : [];
  const interactions = normalizedInteractions.filter((interaction) => candidateIds.has(interaction.candidateId));
  const secondaryGoals = Array.isArray(state?.mission?.secondaryGoals)
    ? state.mission.secondaryGoals.map((goal) => safeText(goal, 180)).filter(Boolean).slice(0, 20)
    : [];
  const insights = Array.isArray(state?.insights)
    ? state.insights.map(normalizeInsight).filter((insight): insight is SelfInsight => insight !== null).slice(0, 50)
    : [];

  return {
    mission: {
      text: safeText(state?.mission?.text, 4000),
      primaryGoal: safeText(state?.mission?.primaryGoal, 400) || '良質なつながりを増やす',
      secondaryGoals,
      communicationDNA: safeText(state?.mission?.communicationDNA, 4000),
    },
    candidates,
    interactions,
    budget: {
      monthlyLimitUsd: clampNumber(state?.budget?.monthlyLimitUsd, 0, 100, 3),
      hardLimit: true,
      usedUsd: clampNumber(state?.budget?.usedUsd, 0, 1_000_000, 0),
      xUsd: clampNumber(state?.budget?.xUsd, 0, 1_000_000, 0),
      llmUsd: clampNumber(state?.budget?.llmUsd, 0, 1_000_000, 0),
      searchUsd: clampNumber(state?.budget?.searchUsd, 0, 1_000_000, 0),
      mode: allowedBudgetModes.has(state?.budget?.mode) ? state.budget.mode : 'balanced',
    },
    relationshipPolicy: normalizeRelationshipPolicy(state?.relationshipPolicy),
    insights,
    selfProfile: {
      profileText: safeText(state?.selfProfile?.profileText, 20_000),
      recentPostsText: safeText(state?.selfProfile?.recentPostsText, 50_000),
      score: optionalScore(state?.selfProfile?.score),
      summary: safeText(state?.selfProfile?.summary, 3000) || undefined,
      strategy: safeText(state?.selfProfile?.strategy, 5000) || undefined,
      profileRewrite: safeText(state?.selfProfile?.profileRewrite, 3000) || undefined,
      analyzedAt: validOptionalIso(state?.selfProfile?.analyzedAt),
    },
    xAccount: normalizeXAccount(state?.xAccount),
    instagramAccount: normalizeInstagramAccount(state?.instagramAccount),
  };
}

export function validateAppState(state: AppState) {
  if (!state.mission || typeof state.mission.text !== 'string' || typeof state.mission.primaryGoal !== 'string' || !Array.isArray(state.mission.secondaryGoals)) throw new Error('Missionデータが不正です');
  if (!Array.isArray(state.candidates) || !Array.isArray(state.interactions)) throw new Error('候補・交流データが不正です');
  if (!state.budget || typeof state.budget.monthlyLimitUsd !== 'number' || !Number.isFinite(state.budget.monthlyLimitUsd) || state.budget.hardLimit !== true) throw new Error('予算データが不正です');
  if (!state.relationshipPolicy || typeof state.relationshipPolicy.followBackReviewAfterDays !== 'number') throw new Error('関係性ポリシーが不正です');
  if (!state.selfProfile || typeof state.selfProfile.profileText !== 'string' || typeof state.selfProfile.recentPostsText !== 'string') throw new Error('自己分析データが不正です');
  if (!state.xAccount || typeof state.xAccount !== 'object') throw new Error('Xアカウント同期データが不正です');

  for (const candidate of state.candidates) {
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.username !== 'string' || (candidate.platform !== 'x' && candidate.platform !== 'instagram')) {
      throw new Error('候補データに不正な項目があります');
    }
  }
}

function normalizeRelationshipPolicy(policy: RelationshipPolicy | undefined): RelationshipPolicy {
  return {
    followBackReviewAfterDays: clampInteger(policy?.followBackReviewAfterDays, 7, 180, relationshipDefaults.followBackReviewAfterDays),
    preserveHighMatch: typeof policy?.preserveHighMatch === 'boolean' ? policy.preserveHighMatch : relationshipDefaults.preserveHighMatch,
    dailyQueueLimit: clampInteger(policy?.dailyQueueLimit, 1, 200, relationshipDefaults.dailyQueueLimit || 30),
    dailyConnectionLimit: clampInteger(policy?.dailyConnectionLimit, 0, 200, relationshipDefaults.dailyConnectionLimit || 20),
    dailyConversationLimit: clampInteger(policy?.dailyConversationLimit, 0, 100, relationshipDefaults.dailyConversationLimit || 8),
    dailyLightEngagementLimit: clampInteger(policy?.dailyLightEngagementLimit, 0, 100, relationshipDefaults.dailyLightEngagementLimit || 8),
    dailyCleanupLimit: clampInteger(policy?.dailyCleanupLimit, 0, 100, relationshipDefaults.dailyCleanupLimit || 5),
    dailySelfImproveLimit: clampInteger(policy?.dailySelfImproveLimit, 0, 20, relationshipDefaults.dailySelfImproveLimit || 2),
  };
}

function normalizeCandidate(raw: Candidate): Candidate | null {
  if (!raw || typeof raw !== 'object' || (raw.platform !== 'x' && raw.platform !== 'instagram')) return null;
  const id = safeText(raw.id, 180);
  const username = sanitizeUsername(raw.platform, raw.username);
  if (!id || !username || legacyDemoCandidates.has(`${id}:${raw.platform}:${username.toLowerCase()}`)) return null;

  return {
    id,
    platform: raw.platform,
    username,
    displayName: safeText(raw.displayName, 180) || username,
    bio: safeText(raw.bio, 5000),
    profileUrl: raw.platform === 'x' ? `https://x.com/${username}` : `https://www.instagram.com/${username}/`,
    engagementUrl: safeSocialUrl(raw.platform, raw.engagementUrl),
    platformUserId: safeText(raw.platformUserId, 100) || undefined,
    verified: Boolean(raw.verified),
    publicMetrics: normalizeMetrics(raw.publicMetrics),
    profileSyncedAt: validOptionalIso(raw.profileSyncedAt),
    kind: allowedKinds.has(raw.kind) ? raw.kind : 'other',
    match: clampScore(raw.match),
    relationshipScore: clampScore(raw.relationshipScore),
    stage: allowedStages.has(raw.stage) ? raw.stage : 'discovered',
    reason: safeText(raw.reason, 2400),
    strategy: safeText(raw.strategy, 3200) || undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => safeText(tag, 80)).filter(Boolean).slice(0, 30) : [],
    recommendedAction: allowedActions.has(raw.recommendedAction) ? raw.recommendedAction : 'review',
    draft: safeText(raw.draft, 2400) || undefined,
    followedAt: validOptionalIso(raw.followedAt),
    followBack: typeof raw.followBack === 'boolean' ? raw.followBack : null,
    lastInteractionAt: validOptionalIso(raw.lastInteractionAt),
    skipped: Boolean(raw.skipped),
    snoozedUntil: validOptionalIso(raw.snoozedUntil),
  } as Candidate;
}

function normalizeInteraction(raw: Interaction): Interaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = safeText(raw.id, 180);
  const candidateId = safeText(raw.candidateId, 180);
  const action = typeof raw.action === 'string' && allowedInteractionActions.has(raw.action) ? raw.action : '';
  const at = validOptionalIso(raw.at);
  if (!id || !candidateId || !action || !at) return null;
  return {
    id,
    candidateId,
    action: action as Interaction['action'],
    at,
    note: safeText(raw.note, 2000) || undefined,
  };
}

function normalizeInsight(raw: SelfInsight): SelfInsight | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = safeText(raw.id, 180);
  const title = safeText(raw.title, 300);
  const body = safeText(raw.body, 3000);
  if (!id || !title || !body) return null;
  return {
    id,
    title,
    body,
    category: allowedInsightCategories.has(raw.category) ? raw.category : 'profile',
    priority: allowedInsightPriorities.has(raw.priority) ? raw.priority : 'medium',
  };
}

function normalizeXAccount(account: AppState['xAccount'] | undefined): AppState['xAccount'] {
  if (!account || typeof account !== 'object') return {};
  return {
    username: safeText(account.username, 15) || undefined,
    displayName: safeText(account.displayName, 180) || undefined,
    verified: typeof account.verified === 'boolean' ? account.verified : undefined,
    publicMetrics: normalizeMetrics(account.publicMetrics),
    lastSyncedAt: validOptionalIso(account.lastSyncedAt),
    followerSampleCount: optionalNonNegativeInt(account.followerSampleCount),
    followingSampleCount: optionalNonNegativeInt(account.followingSampleCount),
    recentPostCount: optionalNonNegativeInt(account.recentPostCount),
    followersComplete: typeof account.followersComplete === 'boolean' ? account.followersComplete : undefined,
    followingComplete: typeof account.followingComplete === 'boolean' ? account.followingComplete : undefined,
    postsComplete: typeof account.postsComplete === 'boolean' ? account.postsComplete : undefined,
    followerCycle: optionalNonNegativeInt(account.followerCycle),
    followingCycle: optionalNonNegativeInt(account.followingCycle),
    lastSyncCostUsd: optionalNonNegativeNumber(account.lastSyncCostUsd),
    pacedCapUsd: optionalNonNegativeNumber(account.pacedCapUsd),
    pacingDaysRemaining: optionalNonNegativeInt(account.pacingDaysRemaining),
  };
}

function normalizeInstagramAccount(account: AppState['instagramAccount']): AppState['instagramAccount'] {
  if (!account || typeof account !== 'object') return undefined;
  return {
    lastSyncedAt: validOptionalIso(account.lastSyncedAt),
    mediaScanned: optionalNonNegativeInt(account.mediaScanned),
    commentEvents: optionalNonNegativeInt(account.commentEvents),
    engagerCount: optionalNonNegativeInt(account.engagerCount),
  };
}

function sanitizeUsername(platform: Candidate['platform'], value: unknown) {
  if (typeof value !== 'string') return '';
  const username = value.trim().replace(/^@/, '');
  if (platform === 'x') return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';
  return /^[A-Za-z0-9._]{1,30}$/.test(username) ? username : '';
}

function safeSocialUrl(platform: Candidate['platform'], value?: string) {
  if (!value || typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const allowedHosts = platform === 'x' ? new Set(['x.com', 'twitter.com']) : new Set(['instagram.com']);
    return allowedHosts.has(host) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeMetrics(metrics: Candidate['publicMetrics']) {
  if (!metrics || typeof metrics !== 'object') return undefined;
  return {
    followers: nonNegativeInt(metrics.followers),
    following: nonNegativeInt(metrics.following),
    posts: nonNegativeInt(metrics.posts),
    ...(metrics.listed == null ? {} : { listed: nonNegativeInt(metrics.listed) }),
  };
}

function nonNegativeInt(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function optionalNonNegativeInt(value: unknown) {
  if (value == null) return undefined;
  return nonNegativeInt(value);
}

function optionalNonNegativeNumber(value: unknown) {
  if (value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : undefined;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function optionalScore(value: unknown) {
  if (value == null) return undefined;
  return clampScore(value);
}

function clampScore(value: unknown) {
  return clampInteger(value, 0, 100, 0);
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validOptionalIso(value?: string) {
  if (!value || typeof value !== 'string') return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
