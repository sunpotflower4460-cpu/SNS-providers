import type { AppState, Candidate, Interaction, RelationshipPolicy } from './types';

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
  const relationshipPolicy = state.relationshipPolicy && typeof state.relationshipPolicy === 'object'
    ? { ...relationshipDefaults, ...state.relationshipPolicy }
    : { ...relationshipDefaults };
  const candidates = Array.isArray(state.candidates)
    ? state.candidates.map(normalizeCandidate).filter((candidate): candidate is Candidate => Boolean(candidate))
    : [];
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const interactions = Array.isArray(state.interactions)
    ? state.interactions.map(normalizeInteraction).filter((interaction): interaction is Interaction => Boolean(interaction) && candidateIds.has(interaction.candidateId))
    : [];

  return {
    ...state,
    relationshipPolicy,
    xAccount: state.xAccount && typeof state.xAccount === 'object' ? state.xAccount : {},
    instagramAccount: state.instagramAccount && typeof state.instagramAccount === 'object' ? state.instagramAccount : undefined,
    candidates,
    interactions,
    insights: Array.isArray(state.insights) ? state.insights : [],
  };
}

export function validateAppState(state: AppState) {
  if (!state.mission || typeof state.mission.text !== 'string') throw new Error('Missionデータが不正です');
  if (!Array.isArray(state.candidates) || !Array.isArray(state.interactions)) throw new Error('候補・交流データが不正です');
  if (!state.budget || typeof state.budget.monthlyLimitUsd !== 'number' || !Number.isFinite(state.budget.monthlyLimitUsd)) throw new Error('予算データが不正です');
  if (!state.relationshipPolicy || typeof state.relationshipPolicy.followBackReviewAfterDays !== 'number') throw new Error('関係性ポリシーが不正です');
  if (!state.selfProfile || typeof state.selfProfile.profileText !== 'string') throw new Error('自己分析データが不正です');
  if (!state.xAccount || typeof state.xAccount !== 'object') throw new Error('Xアカウント同期データが不正です');

  for (const candidate of state.candidates) {
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.username !== 'string' || (candidate.platform !== 'x' && candidate.platform !== 'instagram')) {
      throw new Error('候補データに不正な項目があります');
    }
  }
}

function normalizeCandidate(raw: Candidate): Candidate | null {
  if (!raw || typeof raw !== 'object' || (raw.platform !== 'x' && raw.platform !== 'instagram')) return null;
  const id = safeText(raw.id, 180);
  const username = sanitizeUsername(raw.platform, raw.username);
  if (!id || !username || legacyDemoCandidates.has(`${id}:${raw.platform}:${username.toLowerCase()}`)) return null;

  return {
    ...raw,
    id,
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

function clampScore(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function safeText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validOptionalIso(value?: string) {
  if (!value || typeof value !== 'string') return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
