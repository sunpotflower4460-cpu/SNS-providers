import type { AppState, Candidate, Interaction, RelationshipPolicy, SelfInsight } from './types';

interface BackupEnvelope {
  format: 'social-mission-backup';
  version: 1;
  exportedAt: string;
  state: AppState;
}

interface CandidateDedupeResult {
  candidates: Candidate[];
  aliases: Map<string, string>;
  invalidInteractionCandidateIds: Set<string>;
}

const relationshipDefaults: RelationshipPolicy = {
  followBackReviewAfterDays: 30,
  preserveHighMatch: true,
  dailyQueueLimit: 30,
  dailyConnectionLimit: 20,
  dailyConversationLimit: 8,
  dailyLightEngagementLimit: 8,
  dailyCleanupLimit: 5,
  dailySelfImproveLimit: 1,
  autoReplenishEnabled: true,
};

const legacyDemoCandidates = new Set([
  'x-1:x:music_listener',
  'ig-1:instagram:indie_creator',
  'x-2:x:songwriter_friend',
]);

const xReservedPaths = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings', 'compose', 'intent']);
const instagramReservedPaths = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer']);
const allowedStages = new Set(['discovered', 'interested', 'following', 'engaged', 'recognized', 'conversation', 'relationship']);
const allowedKinds = new Set(['fan', 'artist', 'creator', 'media', 'venue', 'other']);
const allowedActions = new Set(['follow', 'like', 'reply', 'dm', 'review', 'unfollow_review']);
const allowedInteractionActions = new Set([...allowedActions, 'followed', 'skipped', 'kept']);
const allowedBudgetModes = new Set(['free', 'eco', 'balanced', 'growth']);
const allowedInsightCategories = new Set(['profile', 'content', 'network']);
const allowedInsightPriorities = new Set(['high', 'medium', 'low']);
const MAX_SNOOZE_FUTURE_MS = 7 * 86_400_000;

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
  const normalizedCandidates = Array.isArray(state?.candidates)
    ? state.candidates.map(normalizeCandidate).filter((candidate): candidate is Candidate => Boolean(candidate))
    : [];
  const deduped = dedupeCandidates(normalizedCandidates);
  const candidates = deduped.candidates;
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const normalizedInteractions = Array.isArray(state?.interactions)
    ? state.interactions.map(normalizeInteraction).filter((interaction): interaction is Interaction => interaction !== null)
    : [];
  const interactions = dedupeById(normalizedInteractions
    // A duplicate logical ID that points at conflicting immutable identities is ambiguous
    // before alias resolution. Drop those rows while their original candidateId is still
    // visible; otherwise an alias to a safe survivor could accidentally launder the old
    // history into a different person.
    .filter((interaction) => !deduped.invalidInteractionCandidateIds.has(interaction.candidateId))
    .map((interaction) => {
      const candidateId = resolveCandidateAlias(interaction.candidateId, deduped.aliases);
      return candidateId === interaction.candidateId ? interaction : { ...interaction, candidateId };
    })
    .filter((interaction) => candidateIds.has(interaction.candidateId)));
  const secondaryGoals = Array.isArray(state?.mission?.secondaryGoals)
    ? state.mission.secondaryGoals.map((goal) => safeText(goal, 180)).filter(Boolean).slice(0, 20)
    : [];
  const normalizedInsights = Array.isArray(state?.insights)
    ? state.insights.map(normalizeInsight).filter((insight): insight is SelfInsight => insight !== null)
    : [];
  const insights = dedupeById(normalizedInsights).slice(0, 50);

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
      monthlyLimitUsd: clampNumber(state?.budget?.monthlyLimitUsd, 0, 10, 3),
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
      analyzedAt: validPastishOptionalIso(state?.selfProfile?.analyzedAt),
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
    followBackReviewAfterDays: clampInteger(policy?.followBackReviewAfterDays, 7, 90, relationshipDefaults.followBackReviewAfterDays),
    preserveHighMatch: typeof policy?.preserveHighMatch === 'boolean' ? policy.preserveHighMatch : relationshipDefaults.preserveHighMatch,
    dailyQueueLimit: clampInteger(policy?.dailyQueueLimit, 1, 150, relationshipDefaults.dailyQueueLimit || 30),
    dailyConnectionLimit: clampInteger(policy?.dailyConnectionLimit, 0, 120, relationshipDefaults.dailyConnectionLimit || 20),
    dailyConversationLimit: clampInteger(policy?.dailyConversationLimit, 0, 30, relationshipDefaults.dailyConversationLimit || 8),
    dailyLightEngagementLimit: clampInteger(policy?.dailyLightEngagementLimit, 0, 30, relationshipDefaults.dailyLightEngagementLimit || 8),
    dailyCleanupLimit: clampInteger(policy?.dailyCleanupLimit, 0, 30, relationshipDefaults.dailyCleanupLimit || 5),
    dailySelfImproveLimit: clampInteger(policy?.dailySelfImproveLimit, 0, 1, relationshipDefaults.dailySelfImproveLimit || 1),
    autoReplenishEnabled: typeof policy?.autoReplenishEnabled === 'boolean'
      ? policy.autoReplenishEnabled
      : relationshipDefaults.autoReplenishEnabled,
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
    platformUserId: normalizePlatformUserId(raw.platform, raw.platformUserId, username),
    verified: Boolean(raw.verified),
    publicMetrics: normalizeMetrics(raw.publicMetrics),
    profileSyncedAt: validPastishOptionalIso(raw.profileSyncedAt),
    profileSyncAttemptedAt: validPastishOptionalIso(raw.profileSyncAttemptedAt),
    kind: allowedKinds.has(raw.kind) ? raw.kind : 'other',
    match: clampScore(raw.match),
    relationshipScore: clampScore(raw.relationshipScore),
    stage: allowedStages.has(raw.stage) ? raw.stage : 'discovered',
    reason: safeText(raw.reason, 2400),
    strategy: safeText(raw.strategy, 3200) || undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => safeText(tag, 80)).filter(Boolean).slice(0, 30) : [],
    recommendedAction: allowedActions.has(raw.recommendedAction) ? raw.recommendedAction : 'review',
    draft: safeText(raw.draft, 2400) || undefined,
    followedAt: validPastishOptionalIso(raw.followedAt),
    followBack: typeof raw.followBack === 'boolean' ? raw.followBack : null,
    lastInteractionAt: validPastishOptionalIso(raw.lastInteractionAt),
    skipped: Boolean(raw.skipped),
    snoozedUntil: validSnoozeOptionalIso(raw.snoozedUntil),
  } as Candidate;
}

function normalizeInteraction(raw: Interaction): Interaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = safeText(raw.id, 180);
  const candidateId = safeText(raw.candidateId, 180);
  const action = typeof raw.action === 'string' && allowedInteractionActions.has(raw.action) ? raw.action : '';
  const at = validPastishOptionalIso(raw.at);
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
    username: sanitizeUsername('x', account.username) || undefined,
    displayName: safeText(account.displayName, 180) || undefined,
    verified: typeof account.verified === 'boolean' ? account.verified : undefined,
    publicMetrics: normalizeMetrics(account.publicMetrics),
    lastSyncedAt: validPastishOptionalIso(account.lastSyncedAt),
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
    lastSyncedAt: validPastishOptionalIso(account.lastSyncedAt),
    mediaScanned: optionalNonNegativeInt(account.mediaScanned),
    commentEvents: optionalNonNegativeInt(account.commentEvents),
    engagerCount: optionalNonNegativeInt(account.engagerCount),
  };
}

function sanitizeUsername(platform: Candidate['platform'], value: unknown) {
  if (typeof value !== 'string') return '';
  const username = value.trim().replace(/^@/, '');
  const lowered = username.toLowerCase();
  if (platform === 'x') {
    if (xReservedPaths.has(lowered)) return '';
    return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';
  }
  if (instagramReservedPaths.has(lowered)) return '';
  return /^[A-Za-z0-9._]{1,30}$/.test(username) ? username : '';
}

function normalizePlatformUserId(platform: Candidate['platform'], value: unknown, username: string) {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  if (/^\d{1,30}$/.test(id)) return id;
  if (platform === 'instagram' && id.toLowerCase() === `username:${username.toLowerCase()}`) {
    return `username:${username.toLowerCase()}`;
  }
  return undefined;
}

function safeSocialUrl(platform: Candidate['platform'], value?: string) {
  if (!value || typeof value !== 'string' || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    if (platform === 'x') {
      if (host !== 'x.com' && host !== 'twitter.com') return undefined;
      const [username, statusSegment, postId] = parts;
      if (parts.length < 3
        || !/^[A-Za-z0-9_]{1,15}$/.test(username || '')
        || statusSegment !== 'status'
        || !/^\d{1,30}$/.test(postId || '')) return undefined;
      return `https://x.com/${username}/status/${postId}`;
    }
    if (host !== 'instagram.com') return undefined;
    const [kind, shortcode] = parts;
    if (!['p', 'reel', 'reels', 'tv'].includes((kind || '').toLowerCase())
      || !/^[A-Za-z0-9_-]{1,100}$/.test(shortcode || '')) return undefined;
    return `https://www.instagram.com/${kind.toLowerCase()}/${shortcode}/`;
  } catch {
    return undefined;
  }
}

function dedupeCandidates(candidates: Candidate[]): CandidateDedupeResult {
  const aliases = new Map<string, string>();
  const invalidInteractionCandidateIds = new Set<string>();

  // Candidate IDs are logical primary keys. If a corrupted restore reuses one ID for two
  // different immutable people (or even two platforms), there is no safe way to know which
  // identity its old interaction rows belong to. Keep one deterministic candidate but drop
  // interaction history for that ambiguous ID instead of transferring it to the wrong person.
  const byId = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
      continue;
    }
    const existingStable = stableCandidateIdentity(existing);
    const incomingStable = stableCandidateIdentity(candidate);
    if (existing.platform !== candidate.platform
      || (existingStable && incomingStable && existingStable !== incomingStable)) {
      invalidInteractionCandidateIds.add(candidate.id);
    }
    byId.set(candidate.id, preferRestoredCandidate(existing, candidate));
  }

  // Numeric platform user IDs are authoritative across handle renames. Merge those first
  // and retain an alias chain so interactions from an old handle follow the same person.
  const afterStableIdentity: Candidate[] = [];
  const byStableIdentity = new Map<string, Candidate>();
  for (const candidate of byId.values()) {
    const stableIdentity = stableCandidateIdentity(candidate);
    if (!stableIdentity) {
      afterStableIdentity.push(candidate);
      continue;
    }
    const existing = byStableIdentity.get(stableIdentity);
    if (!existing) {
      byStableIdentity.set(stableIdentity, candidate);
      afterStableIdentity.push(candidate);
      continue;
    }
    const preferred = preferRestoredCandidate(existing, candidate);
    const duplicate = preferred.id === existing.id ? candidate : existing;
    aliases.set(duplicate.id, preferred.id);
    byStableIdentity.set(stableIdentity, preferred);
    if (preferred.id !== existing.id) replaceCandidate(afterStableIdentity, existing.id, preferred);
  }

  // Username is only a safe fallback identity while it does not contradict two known
  // immutable IDs. If the same handle is present with different numeric IDs, keep both
  // records separate so a recycled handle cannot inherit the previous person's CRM history.
  const profileGroups = new Map<string, Candidate[]>();
  for (const candidate of afterStableIdentity) {
    const profileKey = `${candidate.platform}:${candidate.username.toLowerCase()}`;
    const group = profileGroups.get(profileKey) || [];
    group.push(candidate);
    profileGroups.set(profileKey, group);
  }

  const finalCandidates: Candidate[] = [];
  for (const group of profileGroups.values()) {
    if (group.length === 1) {
      finalCandidates.push(group[0]);
      continue;
    }
    const knownIdentities = new Set(group.map(stableCandidateIdentity).filter(Boolean));
    if (knownIdentities.size > 1) {
      // The handle now points at more than one known immutable identity in restored data.
      // Preserve both CRM records/history, but make neither executable: a profile/follow/
      // reply/DM/unfollow URL is handle-based and could otherwise act on the current owner
      // while displaying historical context that belongs to the previous owner.
      finalCandidates.push(...group.map(quarantineRestoredHandleConflict));
      continue;
    }
    let preferred = group[0];
    for (const candidate of group.slice(1)) preferred = preferRestoredCandidate(preferred, candidate);
    for (const candidate of group) {
      if (candidate.id !== preferred.id) aliases.set(candidate.id, preferred.id);
    }
    finalCandidates.push(preferred);
  }

  return { candidates: finalCandidates, aliases, invalidInteractionCandidateIds };
}

function stableCandidateIdentity(candidate: Candidate) {
  const id = candidate.platformUserId?.trim() || '';
  return /^\d{1,30}$/.test(id) ? `${candidate.platform}:${id}` : '';
}

function quarantineRestoredHandleConflict(candidate: Candidate): Candidate {
  const warning = '同じ@usernameに異なる公式ユーザーIDの記録があります。ハンドルが別の人へ再利用された可能性があるため、過去の関係履歴を維持したまま自動アクションを停止しました。';
  return {
    ...candidate,
    engagementUrl: undefined,
    recommendedAction: 'review',
    draft: undefined,
    followBack: null,
    reason: `${warning}${candidate.reason ? ` ${candidate.reason}` : ''}`.slice(0, 2400),
    strategy: `${warning} 公式SNSで現在のプロフィールを確認し、どの履歴が現在の相手に属するか判断してから再開してください。`.slice(0, 3200),
    tags: [...new Set([...candidate.tags, 'identity-conflict'])].slice(0, 30),
  };
}

function preferRestoredCandidate(left: Candidate, right: Candidate) {
  const leftInteraction = safeTime(left.lastInteractionAt);
  const rightInteraction = safeTime(right.lastInteractionAt);
  if (leftInteraction !== rightInteraction) return rightInteraction > leftInteraction ? right : left;
  if (left.relationshipScore !== right.relationshipScore) return right.relationshipScore > left.relationshipScore ? right : left;
  if (Boolean(left.skipped) !== Boolean(right.skipped)) return left.skipped ? right : left;
  const leftProfile = safeTime(left.profileSyncedAt);
  const rightProfile = safeTime(right.profileSyncedAt);
  if (leftProfile !== rightProfile) return rightProfile > leftProfile ? right : left;
  return left.id.localeCompare(right.id) <= 0 ? left : right;
}

function replaceCandidate(candidates: Candidate[], existingId: string, replacement: Candidate) {
  const index = candidates.findIndex((candidate) => candidate.id === existingId);
  if (index >= 0) candidates[index] = replacement;
}

function resolveCandidateAlias(candidateId: string, aliases: Map<string, string>) {
  let current = candidateId;
  const seen = new Set<string>();
  while (aliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = aliases.get(current)!;
  }
  return current;
}

function safeTime(value?: string | null) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
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

function validSnoozeOptionalIso(value?: string) {
  if (!value || typeof value !== 'string') return undefined;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time > Date.now() + MAX_SNOOZE_FUTURE_MS) return undefined;
  return new Date(time).toISOString();
}

function validPastishOptionalIso(value?: string) {
  if (!value || typeof value !== 'string') return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() + 5 * 60 * 1000
    ? new Date(time).toISOString()
    : undefined;
}
