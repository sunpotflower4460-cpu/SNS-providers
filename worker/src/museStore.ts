import { xPostUrl } from './discovery';
import type { SocialActionStatus } from './social/types';

export const EVENING_LIMIT = 30;
export const CANDIDATE_RESERVE = 60;

const ACTIONS = new Set(['follow', 'like', 'reply', 'review']);
const CONTACT_STAGES = new Set(['following', 'engaged', 'recognized', 'conversation', 'relationship']);
const CONTACT_ACTIONS = new Set(['followed', 'follow', 'like', 'reply', 'dm', 'kept', 'skipped', 'unfollow_review']);

export interface MuseCandidate {
  id: string;
  username: string;
  platformUserId: string | null;
  displayName: string;
  profileSummary: string;
  profileUrl: string;
  postUrl: string | null;
  activityText: string;
  match: number;
  reason: string;
  strategy: string;
  operation: string;
  draft: string | null;
  status: 'pending' | 'completed' | 'skipped';
  updatedAt: string | null;
}

export interface MuseReply {
  id: string;
  platform: 'x';
  type: 'reply_inbound';
  externalEventId: string;
  recipientId: string | null;
  username: string;
  status: SocialActionStatus;
  retryable: boolean;
  targetUrl: string | null;
  inboundText: string;
  observedAt: string;
  draft: string | null;
  draftSource: 'saved' | 'ai' | null;
  suppressed: boolean;
  contextHash: string | null;
}

export async function readMuseContext(db: D1Database, userId: string) {
  const [snapshot, contacts, owned] = await Promise.all([
    db.prepare('SELECT state_json, updated_at FROM state_snapshots WHERE user_id = ?').bind(userId)
      .first<{ state_json: string; updated_at: string }>(),
    db.prepare(`SELECT username, platform_user_id, 0 AS skipped FROM social_actions
      WHERE user_id = ? AND platform = 'x'
        AND (status IN ('completed', 'dismissed') OR (action_type = 'reply_inbound' AND status != 'expired'))
      UNION SELECT c.username, c.platform_user_id, CASE WHEN c.skipped = 1 OR i.action = 'skipped' THEN 1 ELSE 0 END
      FROM candidates c LEFT JOIN interactions i ON i.user_id = c.user_id AND i.candidate_id = c.id
      WHERE c.user_id = ? AND c.platform = 'x' AND (c.skipped = 1 OR c.followed_at IS NOT NULL
        OR i.action IN ('followed','follow','like','reply','dm','kept','skipped','unfollow_review'))`)
      .bind(userId, userId).all<{ username: string | null; platform_user_id: string | null; skipped: number }>(),
    db.prepare(`SELECT s.snapshot_json, t.x_user_id FROM x_oauth_tokens t
      LEFT JOIN x_owned_snapshots s ON s.user_id = t.user_id WHERE t.user_id = ?`).bind(userId)
      .first<{ snapshot_json: string | null; x_user_id: string | null }>(),
  ]);
  const state = parseRecord(snapshot?.state_json);
  const savedActions = new Map(records(state.socialActions).filter((action) => typeof action.id === 'string')
    .map((action) => [String(action.id), action]));
  const byId = new Map(records(state.candidates).filter((candidate) => candidate.platform === 'x' && typeof candidate.id === 'string')
    .map((candidate) => [String(candidate.id), candidate]));
  const handled = new Set(records(state.interactions).filter((interaction) => CONTACT_ACTIONS.has(String(interaction.action)))
    .map((interaction) => String(interaction.candidateId)));
  const blockedHandles = new Set<string>();
  const blockedIds = new Set<string>();
  const skippedHandles = new Set<string>();
  const skippedIds = new Set<string>();
  function exclude(identity: { username: unknown; platformUserId: unknown }, skip = false) {
    const handle = xHandle(identity.username);
    const id = providerId(identity.platformUserId);
    if (handle) blockedHandles.add(handle);
    if (id) blockedIds.add(id);
    if (skip && handle) skippedHandles.add(handle);
    if (skip && id) skippedIds.add(id);
  }
  for (const row of contacts.results) exclude({ username: row.username, platformUserId: row.platform_user_id }, row.skipped === 1);
  const ownedSnapshot = parseRecord(owned?.snapshot_json);
  const profile = record(ownedSnapshot.profile);
  const self = { username: profile.username || record(state.xAccount).username, platformUserId: owned?.x_user_id };
  exclude(self, true);
  for (const person of records(ownedSnapshot.following)) exclude({ username: person.username, platformUserId: person.id });
  const savedCandidates = new Map<string, MuseCandidate>();
  for (const [id, data] of byId) {
    const identity = { username: data.username, platformUserId: data.platformUserId };
    const skipped = data.skipped === true;
    if (skipped || handled.has(id) || data.followedAt || CONTACT_STAGES.has(String(data.stage))) exclude(identity, skipped);
    if (typeof data.snoozedUntil === 'string' && Date.parse(data.snoozedUntil) > Date.now()) exclude(identity);
    if (Array.isArray(data.tags) && data.tags.includes('identity-conflict')) exclude(identity, true);
    const username = xHandle(data.username);
    if (!username) continue;
    const postUrl = xPostUrl(text(data.engagementUrl, 2000), username);
    const candidate = {
      id: `web-x-${username}`,
      username,
      platformUserId: providerId(data.platformUserId),
      displayName: text(data.displayName, 160) || username,
      profileSummary: text(data.bio, 500),
      profileUrl: `https://x.com/${username}`,
      postUrl,
      activityText: text(data.bio, 500),
      match: score(data.match),
      reason: text(data.reason, 500),
      strategy: text(data.strategy, 500),
      operation: actionName(data.recommendedAction, postUrl),
      draft: text(data.draft ?? data.aiDraft, 280) || null,
      status: skipped ? 'skipped' as const : 'pending' as const,
      updatedAt: snapshot?.updated_at || null,
    };
    if (!savedCandidates.has(candidate.id)) savedCandidates.set(candidate.id, candidate);
  }
  const mission = record(state.mission);
  const missionText = [text(mission.primaryGoal, 400), text(mission.text, 2000),
    ...(Array.isArray(mission.secondaryGoals) ? mission.secondaryGoals.slice(0, 8).map((goal) => text(goal, 160)) : [])]
    .filter(Boolean).join('\n');
  const policy = record(state.relationshipPolicy);
  return {
    savedActions, savedCandidates, blockedHandles, blockedIds, skippedHandles, skippedIds,
    mission: missionText || '個人ゲーム開発、ローファイ・チル音楽、オリジナルキャラクターの活動を通じて、つながりと自然な会話を育てる。',
    communicationDNA: text(mission.communicationDNA, 1200) || '親しみやすく、相手の具体的な活動に触れて自然な会話を始める。',
    discover: policy.autoReplenishEnabled !== false,
    draft: policy.autoDraftReplies !== false,
  };
}

export type MuseContext = Awaited<ReturnType<typeof readMuseContext>>;

export function eligibleCandidate(candidate: MuseCandidate, context: MuseContext) {
  return candidate.status === 'pending' && !context.blockedHandles.has(candidate.username)
    && (!candidate.platformUserId || !context.blockedIds.has(candidate.platformUserId));
}

const candidateSelect = `SELECT c.*, (SELECT i.action FROM interactions i
  WHERE i.candidate_id = c.id AND i.user_id = c.user_id
  ORDER BY i.occurred_at DESC LIMIT 1) AS handoff_action
  FROM candidates c WHERE c.user_id = ? AND c.platform = 'x'`;

export async function readMuseCandidates(db: D1Database, userId: string, context: MuseContext) {
  // Official-app completions are durable even when the PWA backup still suggests the same person.
  const result = await db.prepare(`${candidateSelect} AND c.skipped = 0 AND c.followed_at IS NULL
    AND c.recommended_action IN ('follow','like','reply')
    AND NOT EXISTS (SELECT 1 FROM interactions WHERE user_id = c.user_id AND candidate_id = c.id
      AND action IN ('followed','follow','like','reply','dm','kept','skipped','unfollow_review'))
    ORDER BY c.mission_match DESC, c.id LIMIT 400`).bind(userId).all<Record<string, unknown>>();
  const pool = new Map([...context.savedCandidates.values()].map((candidate) => [candidate.username, candidate]));
  for (const row of result.results) {
    const candidate = mapCandidate(row);
    if (!candidate) continue;
    const overlaid = pool.get(candidate.username);
    pool.set(candidate.username, { ...candidate, platformUserId: candidate.platformUserId || overlaid?.platformUserId || null });
  }
  return [...pool.values()].sort((left, right) => right.match - left.match || left.id.localeCompare(right.id));
}

export async function readKnownCandidateHandles(db: D1Database, userId: string) {
  const rows = await db.prepare("SELECT username FROM candidates WHERE user_id = ? AND platform = 'x'")
    .bind(userId).all<{ username: string }>();
  return rows.results.map((row) => xHandle(row.username));
}

export async function readMuseCandidate(db: D1Database, userId: string, id: string, context: MuseContext) {
  const row = await db.prepare(`${candidateSelect} AND (c.id = ? OR lower(c.username) = ?) LIMIT 1`)
    .bind(userId, id, id.replace(/^web-x-/, '')).first<Record<string, unknown>>();
  return row ? mapCandidate(row) : context.savedCandidates.get(id) || null;
}

function mapCandidate(row: Record<string, unknown>): MuseCandidate | null {
  const username = xHandle(row.username);
  if (!username) return null;
  const postUrl = xPostUrl(text(row.engagement_url, 2000), username);
  return {
    id: text(row.id, 180), username,
    platformUserId: providerId(row.platform_user_id),
    displayName: text(row.display_name, 160) || username,
    profileSummary: text(row.bio, 500),
    profileUrl: `https://x.com/${username}`,
    postUrl,
    activityText: text(row.activity_text, 500),
    match: score(row.mission_match),
    reason: text(row.reason, 500),
    strategy: text(row.strategy, 500),
    operation: actionName(row.recommended_action, postUrl),
    draft: text(row.greeting_draft, 280) || null,
    status: row.skipped === 1 || row.handoff_action === 'skipped' ? 'skipped'
      : CONTACT_ACTIONS.has(String(row.handoff_action)) ? 'completed' : 'pending',
    updatedAt: text(row.updated_at, 64) || null,
  };
}

export async function saveMuseCandidates(db: D1Database, userId: string, candidates: MuseCandidate[]) {
  if (!candidates.length) return 0;
  const now = new Date().toISOString();
  const result = await db.prepare(`INSERT OR IGNORE INTO candidates (
    id, user_id, platform, username, display_name, bio, profile_url, mission_match, reason,
    recommended_action, source, created_at, updated_at, platform_user_id, engagement_url, activity_text, strategy, greeting_draft)
    SELECT json_extract(value, '$.id'), ?, 'x', json_extract(value, '$.username'),
      json_extract(value, '$.displayName'), json_extract(value, '$.profileSummary'), json_extract(value, '$.profileUrl'),
      json_extract(value, '$.match'), json_extract(value, '$.reason'), json_extract(value, '$.operation'),
      'muse', ?, ?, json_extract(value, '$.platformUserId'), json_extract(value, '$.postUrl'),
      json_extract(value, '$.activityText'), json_extract(value, '$.strategy'), json_extract(value, '$.draft')
    FROM json_each(?)`).bind(userId, now, now, JSON.stringify(candidates)).run();
  return result.meta.changes;
}

export async function recordMuseHandoff(db: D1Database, userId: string, candidate: MuseCandidate, outcome: 'completed' | 'skipped') {
  await saveMuseCandidates(db, userId, [candidate]);
  const id = `muse-handoff:${candidate.id}`;
  const action = outcome === 'skipped' ? 'skipped' : candidate.operation === 'follow' ? 'followed' : candidate.operation;
  const inserted = await db.prepare(`INSERT OR IGNORE INTO interactions (id, user_id, candidate_id, action, note, occurred_at)
    SELECT ?, user_id, id, ?, '申告による公式Xアプリの操作記録', ? FROM candidates
    WHERE user_id = ? AND id = ? AND platform = 'x' AND recommended_action = ?`)
    .bind(id, action, new Date().toISOString(), userId, candidate.id, candidate.operation).run();
  const prior = await db.prepare('SELECT action, occurred_at FROM interactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<{ action: string; occurred_at: string }>();
  return prior?.action === action ? { status: outcome, recordedAt: prior.occurred_at, idempotent: !inserted.meta.changes } : null;
}

export async function updateMuseGreeting(db: D1Database, userId: string, candidate: MuseCandidate, draft: string) {
  // Two regenerations cannot overwrite one another, and a reported/dismissed item cannot be reopened.
  const result = await db.prepare(`UPDATE candidates SET greeting_draft = ?, updated_at = ?
    WHERE user_id = ? AND id = ? AND updated_at = ? AND skipped = 0
      AND NOT EXISTS (SELECT 1 FROM interactions WHERE user_id = ? AND candidate_id = ? AND id = ?)`)
    .bind(draft, new Date().toISOString(), userId, candidate.id, candidate.updatedAt, userId, candidate.id, `muse-handoff:${candidate.id}`).run();
  return result.meta.changes === 1;
}

const replySelect = `SELECT a.id, a.external_event_id, a.platform_user_id, a.username, a.status, a.retryable,
  a.target_url, a.observed_at, a.created_at, a.identity_conflict, e.external_user_id, e.payload_json,
  d.context_hash, d.draft AS ai_draft
  FROM social_actions a LEFT JOIN social_events e ON e.id = (SELECT ev.id FROM social_events ev
    WHERE ev.user_id = a.user_id AND ev.platform = a.platform AND ev.external_event_id = a.external_event_id
      AND ev.event_type IN ('reply','mention') ORDER BY ev.event_type = 'reply' DESC LIMIT 1)
  LEFT JOIN muse_reply_drafts d ON d.action_id = a.id AND d.user_id = a.user_id
  WHERE a.user_id = ? AND a.platform = 'x' AND a.action_type = 'reply_inbound' AND a.source IN ('x_mention','x_inbound')`;

export async function readMuseReplies(db: D1Database, userId: string, context: MuseContext) {
  const rows = await db.prepare(`${replySelect} AND a.status IN ('pending','ready','failed','executing')
    ORDER BY COALESCE(a.observed_at,a.created_at) DESC, a.id LIMIT 200`).bind(userId).all<Record<string, unknown>>();
  const replies = await Promise.all(rows.results.map((row) => mapReply(row, context)));
  return replies.filter((reply) => !reply.suppressed).slice(0, EVENING_LIMIT);
}

export async function readMuseReply(db: D1Database, userId: string, id: string, context: MuseContext) {
  const row = await db.prepare(`${replySelect} AND a.id = ?`).bind(userId, id).first<Record<string, unknown>>();
  return row ? mapReply(row, context) : null;
}

async function mapReply(row: Record<string, unknown>, context: MuseContext): Promise<MuseReply> {
  const id = String(row.id);
  const payload = parseRecord(row.payload_json);
  const eventId = providerId(row.external_event_id) || '';
  const recipientId = providerId(row.platform_user_id) || providerId(row.external_user_id);
  const username = xHandle(row.username) || xHandle(payload.username);
  const targetUrl = eventId ? xPostUrl(text(payload.permalink || row.target_url, 2000), username, eventId)
    || `https://x.com/i/web/status/${eventId}` : null;
  const inboundText = text(payload.text, 4000);
  const verified = row.identity_conflict !== 1 && eventId && recipientId && recipientId === row.external_user_id;
  const contextHash = verified && inboundText ? await sha256([eventId, recipientId, inboundText]) : null;
  const saved = context.savedActions.get(id);
  const sameAction = saved?.platform === 'x' && saved.type === 'reply_inbound' && saved.externalEventId === eventId;
  const savedDraft = sameAction ? saved.draft ?? saved.aiDraft : null;
  const blockedBySavedReply = sameAction && (saved.unknownExecution === true
    || ['completed', 'dismissed', 'expired', 'executing'].includes(String(saved.status)));
  const aiDraft = contextHash && contextHash === row.context_hash ? text(row.ai_draft, 280) : '';
  const draft = typeof savedDraft === 'string' ? text(savedDraft, 2400) : aiDraft;
  return {
    id, platform: 'x', type: 'reply_inbound', externalEventId: eventId, recipientId, username,
    status: row.status as SocialActionStatus, retryable: row.retryable === 1, targetUrl, inboundText,
    observedAt: String(row.observed_at || row.created_at), draft: draft || null,
    draftSource: draft ? (typeof savedDraft === 'string' ? 'saved' : 'ai') : null,
    suppressed: blockedBySavedReply || context.skippedHandles.has(username) || Boolean(recipientId && context.skippedIds.has(recipientId)),
    contextHash,
  };
}

export async function saveMuseReplyDrafts(db: D1Database, userId: string, drafts: Array<{ id: string; contextHash: string; draft: string }>) {
  if (!drafts.length) return 0;
  const result = await db.prepare(`INSERT INTO muse_reply_drafts (user_id, action_id, context_hash, draft, updated_at)
    SELECT a.user_id, a.id, json_extract(value, '$.contextHash'), json_extract(value, '$.draft'), ?
    FROM json_each(?) JOIN social_actions a ON a.id = json_extract(value, '$.id')
    WHERE a.user_id = ? AND a.status IN ('ready','pending','failed')
    ON CONFLICT(user_id, action_id) DO UPDATE SET context_hash = excluded.context_hash, draft = excluded.draft, updated_at = excluded.updated_at
    WHERE muse_reply_drafts.context_hash != excluded.context_hash`)
    .bind(new Date().toISOString(), JSON.stringify(drafts), userId).run();
  return result.meta.changes;
}

export function actionName(value: unknown, postUrl: string | null) {
  if (typeof value !== 'string' || !ACTIONS.has(value)) return 'review';
  return (value === 'like' || value === 'reply') && !postUrl ? 'review' : value;
}

export function score(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

export function xHandle(value: unknown) {
  const handle = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : '';
}

function providerId(value: unknown) {
  return typeof value === 'string' && /^\d{1,30}$/.test(value) ? value : null;
}

export function text(value: unknown, length: number) {
  return typeof value === 'string' ? value.trim().slice(0, length) : '';
}

export function parseRecord(value: unknown): Record<string, unknown> {
  try {
    return typeof value === 'string' ? record(JSON.parse(value)) : {};
  } catch {
    return {};
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

async function sha256(fields: string[]) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(fields)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
