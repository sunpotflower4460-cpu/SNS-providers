// Artist OS managed mode: READ-ONLY relationship enrichment of My-SNS inbound events.
//
// Reads the My-SNS inbound-events feed (GET only), joins each event to a known candidate strictly by
// (platform, platformUserId) in the AppState snapshot, and returns RelationshipEnrichmentArtifact
// envelopes (mirror of Artist-OS src/contracts/relationship.ts). Intelligence only: no reply text, no
// handle/message echo, no external write, no AI call, no provider call. Every failure is explicit.
// Rules are documented in docs/artist-os-managed-mode.md.

import { fetchWithTimeout } from './fetchWithTimeout';

export const ENRICHMENT_PLATFORMS = ['instagram', 'x', 'youtube', 'line', 'tiktok', 'threads', 'facebook'] as const;
export const RELATIONSHIP_STAGES = ['unknown', 'discovered', 'interested', 'following', 'engaged', 'recognized', 'conversation', 'relationship'] as const;
export const RELATIONSHIP_PRIORITIES = ['low', 'normal', 'high'] as const;
export const RECOMMENDED_HANDLING = ['reply', 'reply_later', 'no_reply', 'human_review', 'unknown'] as const;
export const RELATIONSHIP_REASON_CODES = [
  'repeat-interaction', 'high-match', 'low-match', 'new-contact', 'no-candidate-match',
  'mission-aligned', 'stage-advanced-recently', 'dormant', 'insufficient-data',
] as const;

export type EnrichmentPlatform = (typeof ENRICHMENT_PLATFORMS)[number];
export type RelationshipStageOut = (typeof RELATIONSHIP_STAGES)[number];
export type ReasonCode = (typeof RELATIONSHIP_REASON_CODES)[number];

export const MAX_ENRICHMENT_EVENTS = 200;
export const MY_SNS_INBOUND_PATH = '/api/service/v1/inbound-events';
export const MY_SNS_MAX_RESPONSE_BYTES = 1_000_000;
export const MY_SNS_TIMEOUT_MS = 8_000;
export const ANALYZER = { name: 'sns-providers-relationship', version: '1.0.0' } as const;

// Scoring thresholds (documented).
export const HIGH_MATCH_MIN = 70;
export const LOW_MATCH_MAX = 29;
export const REPEAT_INTERACTION_MIN = 2;
export const HIGH_VALUE_SCORE_MIN = 70;
export const NORMAL_VALUE_SCORE_MIN = 35;
export const DORMANT_AFTER_DAYS = 90;

const EXTERNAL_EVENT_ID = /^[A-Za-z0-9._\-=]{1,200}$/;
const EVENT_KINDS = ['comment', 'dm', 'mention', 'reply'] as const;
const REPLY_STATES = ['none', 'scheduled', 'sent', 'failed', 'cancelled'] as const;
const CANDIDATE_STAGES = ['discovered', 'interested', 'following', 'engaged', 'recognized', 'conversation', 'relationship'] as const;
const HIGH_STAGES = new Set(['recognized', 'conversation', 'relationship']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function inList<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
function validIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

// ---------- Config ----------

export interface EnrichmentEnv {
  ARTIST_OS_MODE?: string;
  ARTIST_OS_READ_TOKEN_SHA256?: string;
  MY_SNS_URL?: string;
  MY_SNS_READ_TOKEN?: string;
}

export function validReadTokenHash(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value.trim().toLowerCase());
}

/** Returns the My-SNS inbound-events URL (origin + fixed path only), or null when MY_SNS_URL is unusable. */
export function resolveMySnsInboundUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 300) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.username || url.password) return null;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return `${url.origin}${MY_SNS_INBOUND_PATH}`;
}

/** My-SNS side configuration (needed for the route to produce anything). */
export function mySnsConfigProblem(env: EnrichmentEnv): string | null {
  if (!resolveMySnsInboundUrl(env.MY_SNS_URL)) return 'MY_SNS_URL is not configured or is not a valid https URL.';
  if (typeof env.MY_SNS_READ_TOKEN !== 'string' || !env.MY_SNS_READ_TOKEN.trim()) return 'MY_SNS_READ_TOKEN is not configured.';
  return null;
}

/** Whether the route is usable by Artist OS's read token (managed mode itself is checked by the caller). Used by health. */
export function enrichmentConfigProblem(env: EnrichmentEnv): string | null {
  if (!validReadTokenHash(env.ARTIST_OS_READ_TOKEN_SHA256)) return 'ARTIST_OS_READ_TOKEN_SHA256 is not configured.';
  return mySnsConfigProblem(env);
}

// ---------- My-SNS feed validation ----------

export interface MySnsInboundEvent {
  platform: EnrichmentPlatform;
  kind: (typeof EVENT_KINDS)[number];
  externalEventId: string;
  contactRef?: { platform: EnrichmentPlatform; externalContactId: string };
  needsAction: boolean;
  replyState: (typeof REPLY_STATES)[number];
}

/** Hand-written strict validation of the fields we use. Unknown upstream keys are tolerated and dropped. */
export function validateMySnsFeed(raw: unknown): { ok: true; events: MySnsInboundEvent[] } | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: 'feed is not an object' };
  if (raw.contractVersion !== 1) return { ok: false, reason: 'unsupported contractVersion' };
  if (raw.service !== 'my-sns') return { ok: false, reason: 'unexpected service' };
  if (!validIso(raw.generatedAt)) return { ok: false, reason: 'invalid generatedAt' };
  if (!Array.isArray(raw.events)) return { ok: false, reason: 'events is not an array' };
  if (raw.events.length > 1000) return { ok: false, reason: 'too many events' };
  const events: MySnsInboundEvent[] = [];
  for (const e of raw.events) {
    if (!isRecord(e)) return { ok: false, reason: 'event is not an object' };
    if (e.sourceSystem !== 'my-sns' || e.ownerSystem !== 'my-sns') return { ok: false, reason: 'event is not owned by my-sns' };
    if (typeof e.eventId !== 'string' || !e.eventId || e.eventId.length > 256) return { ok: false, reason: 'invalid eventId' };
    if (!inList(ENRICHMENT_PLATFORMS, e.platform)) return { ok: false, reason: 'invalid platform' };
    if (!inList(EVENT_KINDS, e.kind)) return { ok: false, reason: 'invalid kind' };
    if (typeof e.externalEventId !== 'string' || !EXTERNAL_EVENT_ID.test(e.externalEventId)) return { ok: false, reason: 'invalid externalEventId' };
    if (!validIso(e.receivedAt)) return { ok: false, reason: 'invalid receivedAt' };
    if (typeof e.needsAction !== 'boolean') return { ok: false, reason: 'invalid needsAction' };
    if (!inList(REPLY_STATES, e.replyState)) return { ok: false, reason: 'invalid replyState' };
    if (e.authorHandle !== undefined && (typeof e.authorHandle !== 'string' || e.authorHandle.length > 300)) return { ok: false, reason: 'invalid authorHandle' };
    if (e.textExcerpt !== undefined && (typeof e.textExcerpt !== 'string' || e.textExcerpt.length > 5000)) return { ok: false, reason: 'invalid textExcerpt' };
    if (e.seedRef !== undefined && (typeof e.seedRef !== 'string' || e.seedRef.length > 300)) return { ok: false, reason: 'invalid seedRef' };
    let contactRef: MySnsInboundEvent['contactRef'];
    if (e.contactRef !== undefined) {
      const c = e.contactRef;
      if (!isRecord(c) || !inList(ENRICHMENT_PLATFORMS, c.platform) || typeof c.externalContactId !== 'string' || !c.externalContactId.trim() || c.externalContactId.length > 200) {
        return { ok: false, reason: 'invalid contactRef' };
      }
      contactRef = { platform: c.platform, externalContactId: c.externalContactId.trim() };
    }
    // Only the fields needed for scoring are kept; handle/text/seedRef are validated then discarded.
    events.push({ platform: e.platform, kind: e.kind, externalEventId: e.externalEventId, ...(contactRef ? { contactRef } : {}), needsAction: e.needsAction, replyState: e.replyState });
  }
  return { ok: true, events };
}

// ---------- My-SNS read client (GET only) ----------

export type MySnsFetchResult =
  | { ok: true; events: MySnsInboundEvent[] }
  | { ok: false; code: 'MY_SNS_UNREACHABLE' | 'MY_SNS_TIMEOUT' | 'MY_SNS_HTTP_ERROR' | 'MY_SNS_RESPONSE_TOO_LARGE' | 'MY_SNS_RESPONSE_INVALID' | 'MY_SNS_NOT_CONFIGURED'; reason: string };

async function readCapped(response: Response, cap: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

/** The only outbound call of the enrichment path: GET {MY_SNS_URL}/api/service/v1/inbound-events. */
export async function fetchMySnsInboundEvents(env: EnrichmentEnv): Promise<MySnsFetchResult> {
  const target = resolveMySnsInboundUrl(env.MY_SNS_URL);
  const token = typeof env.MY_SNS_READ_TOKEN === 'string' ? env.MY_SNS_READ_TOKEN.trim() : '';
  if (!target || !token) return { ok: false, code: 'MY_SNS_NOT_CONFIGURED', reason: 'My-SNS read access is not configured.' };
  let response: Response;
  try {
    response = await fetchWithTimeout(target, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
    }, MY_SNS_TIMEOUT_MS, 'My-SNS inbound-events');
  } catch (error) {
    // Never include error text (it could carry URL details); static reasons only.
    const timedOut = error instanceof Error && /timed out/i.test(error.message);
    return timedOut
      ? { ok: false, code: 'MY_SNS_TIMEOUT', reason: 'My-SNS did not respond in time.' }
      : { ok: false, code: 'MY_SNS_UNREACHABLE', reason: 'My-SNS could not be reached.' };
  }
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* ignore */ }
    return { ok: false, code: 'MY_SNS_HTTP_ERROR', reason: `My-SNS responded with HTTP ${response.status}.` };
  }
  let text: string | null;
  try { text = await readCapped(response, MY_SNS_MAX_RESPONSE_BYTES); } catch { return { ok: false, code: 'MY_SNS_UNREACHABLE', reason: 'My-SNS response could not be read.' }; }
  if (text === null) return { ok: false, code: 'MY_SNS_RESPONSE_TOO_LARGE', reason: 'My-SNS response exceeded the size limit.' };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, code: 'MY_SNS_RESPONSE_INVALID', reason: 'My-SNS response was not valid JSON.' }; }
  const feed = validateMySnsFeed(parsed);
  if (!feed.ok) return { ok: false, code: 'MY_SNS_RESPONSE_INVALID', reason: `My-SNS response failed validation (${feed.reason}).` };
  return { ok: true, events: feed.events };
}

// ---------- Relationship state (AppState snapshot) ----------

export interface RelationshipCandidate {
  id: string;
  platform: string;
  platformUserId: string;
  stage: string;
  match: number | null;
  relationshipScore: number | null;
  lastInteractionAt?: string;
}
export interface RelationshipState {
  candidates: RelationshipCandidate[];
  /** Interaction counts per candidate id; null when the snapshot has no usable interactions array. */
  interactionCounts: Map<string, number> | null;
}

function finiteScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** Parses the state_snapshots.state_json blob. Returns null when it is not usable (caller fails closed). */
export function parseRelationshipState(stateJson: unknown): RelationshipState | null {
  if (typeof stateJson !== 'string') return null;
  let state: unknown;
  try { state = JSON.parse(stateJson); } catch { return null; }
  if (!isRecord(state) || !Array.isArray(state.candidates)) return null;
  const candidates: RelationshipCandidate[] = [];
  for (const c of state.candidates) {
    if (!isRecord(c) || typeof c.id !== 'string' || typeof c.platform !== 'string') continue;
    if (typeof c.platformUserId !== 'string' || !c.platformUserId.trim()) continue; // no stable id => cannot join
    candidates.push({
      id: c.id,
      platform: c.platform,
      platformUserId: c.platformUserId.trim(),
      stage: typeof c.stage === 'string' ? c.stage : '',
      match: finiteScore(c.match),
      relationshipScore: finiteScore(c.relationshipScore),
      ...(validIso(c.lastInteractionAt) ? { lastInteractionAt: c.lastInteractionAt } : {}),
    });
  }
  let interactionCounts: Map<string, number> | null = null;
  if (Array.isArray(state.interactions)) {
    interactionCounts = new Map();
    for (const i of state.interactions) {
      if (!isRecord(i) || typeof i.candidateId !== 'string' || i.action === 'skipped') continue;
      interactionCounts.set(i.candidateId, (interactionCounts.get(i.candidateId) || 0) + 1);
    }
  }
  return { candidates, interactionCounts };
}

// ---------- Scoring (pure) ----------

export interface EnrichmentPayload {
  subject: { platform: EnrichmentPlatform; externalEventId: string };
  candidateRef?: string;
  relationshipStage: RelationshipStageOut;
  relationshipValue: number | null;
  priority: (typeof RELATIONSHIP_PRIORITIES)[number];
  recommendedHandling: (typeof RECOMMENDED_HANDLING)[number];
  reasonCodes: ReasonCode[];
  interactionCount?: number;
  generatedAt: string;
  analyzer: { name: string; version: string };
}

export function scoreRelationship(event: MySnsInboundEvent, state: RelationshipState, now: Date): EnrichmentPayload {
  const generatedAt = now.toISOString();
  const base = { subject: { platform: event.platform, externalEventId: event.externalEventId }, generatedAt, analyzer: { ...ANALYZER } };

  // Rule 0: already handled by My-SNS (scheduled/sent) or not needing action => no_reply, regardless of relationship.
  const alreadyHandled = event.replyState === 'sent' || event.replyState === 'scheduled' || !event.needsAction;

  // Join key: (platform, platformUserId). Never handle/title. contactRef.platform must equal the event platform.
  const contact = event.contactRef && event.contactRef.platform === event.platform ? event.contactRef.externalContactId : null;
  const matches = contact ? state.candidates.filter((c) => c.platform === event.platform && c.platformUserId === contact) : [];

  if (matches.length !== 1) {
    const ambiguous = matches.length > 1;
    const reasonCodes: ReasonCode[] = !contact
      ? ['no-candidate-match', 'insufficient-data']
      : ambiguous ? ['no-candidate-match', 'insufficient-data'] : ['no-candidate-match', 'new-contact'];
    // Rule U: unknown contact. DM, or no/ambiguous contact identity => human_review; public kinds => reply.
    const handling: EnrichmentPayload['recommendedHandling'] = alreadyHandled ? 'no_reply' : (event.kind === 'dm' || !contact || ambiguous) ? 'human_review' : 'reply';
    return { ...base, relationshipStage: 'unknown', relationshipValue: null, priority: 'normal', recommendedHandling: handling, reasonCodes };
  }

  const c = matches[0];
  const stage: RelationshipStageOut = inList(CANDIDATE_STAGES, c.stage) ? c.stage : 'unknown';
  const score = c.relationshipScore;
  const interactionCount = state.interactionCounts ? (state.interactionCounts.get(c.id) || 0) : undefined;
  const reasonCodes: ReasonCode[] = [];
  if (interactionCount !== undefined && interactionCount >= REPEAT_INTERACTION_MIN) reasonCodes.push('repeat-interaction');
  if (c.match !== null && c.match >= HIGH_MATCH_MIN) reasonCodes.push('high-match');
  if (c.match !== null && c.match <= LOW_MATCH_MAX) reasonCodes.push('low-match');
  if (c.lastInteractionAt && now.getTime() - Date.parse(c.lastInteractionAt) > DORMANT_AFTER_DAYS * 86_400_000) reasonCodes.push('dormant');
  if (stage === 'unknown' || score === null) reasonCodes.push('insufficient-data');
  else if (reasonCodes.length === 0 && interactionCount === 0 && score === 0) reasonCodes.push('insufficient-data');

  // Priority: high for a recognized+ stage or relationship score >= 70; low for a discovered/interested/following
  // contact with score < 35 (or an unreadable stage/score); otherwise normal.
  let priority: EnrichmentPayload['priority'];
  if (HIGH_STAGES.has(stage) || (score !== null && score >= HIGH_VALUE_SCORE_MIN)) priority = 'high';
  else if (stage === 'engaged' || (score !== null && score >= NORMAL_VALUE_SCORE_MIN)) priority = 'normal';
  else priority = stage === 'unknown' || score === null ? 'normal' : 'low';

  let handling: EnrichmentPayload['recommendedHandling'];
  if (alreadyHandled) handling = 'no_reply';
  else if (stage === 'unknown' || score === null) handling = 'human_review';
  else handling = priority === 'low' ? 'reply_later' : 'reply';

  return {
    ...base,
    candidateRef: c.id.slice(0, 256),
    relationshipStage: stage,
    relationshipValue: score === null ? null : Math.round(score) / 100,
    priority,
    recommendedHandling: handling,
    reasonCodes: reasonCodes.slice(0, 8),
    ...(interactionCount !== undefined ? { interactionCount } : {}),
  };
}

// ---------- Artifact envelope + strict validator ----------

export interface EnrichmentEnvelope {
  schemaVersion: 1;
  artifactId: string;
  kind: 'RelationshipEnrichmentArtifact';
  producer: 'sns-providers';
  createdAt: string;
  subjectRefs: [];
  payloadVersion: 1;
  payload: EnrichmentPayload;
}

const PAYLOAD_KEYS = new Set(['subject', 'candidateRef', 'relationshipStage', 'relationshipValue', 'priority', 'recommendedHandling', 'reasonCodes', 'interactionCount', 'generatedAt', 'analyzer']);
const ENVELOPE_KEYS = new Set(['schemaVersion', 'artifactId', 'kind', 'producer', 'createdAt', 'subjectRefs', 'payloadVersion', 'payload']);

/** Strict, mirror of RelationshipEnrichmentPayloadSchema (`.strict()`): any extra key or wrong type is rejected. */
export function validateEnrichmentPayload(p: unknown): p is EnrichmentPayload {
  if (!isRecord(p)) return false;
  if (Object.keys(p).some((k) => !PAYLOAD_KEYS.has(k))) return false;
  const s = p.subject;
  if (!isRecord(s) || Object.keys(s).length !== 2 || !inList(ENRICHMENT_PLATFORMS, s.platform) || typeof s.externalEventId !== 'string' || !EXTERNAL_EVENT_ID.test(s.externalEventId)) return false;
  if (p.candidateRef !== undefined && (typeof p.candidateRef !== 'string' || !p.candidateRef.trim() || p.candidateRef.length > 256)) return false;
  if (!inList(RELATIONSHIP_STAGES, p.relationshipStage)) return false;
  if (p.relationshipValue !== null && !(typeof p.relationshipValue === 'number' && p.relationshipValue >= 0 && p.relationshipValue <= 1)) return false;
  if (!inList(RELATIONSHIP_PRIORITIES, p.priority) || !inList(RECOMMENDED_HANDLING, p.recommendedHandling)) return false;
  if (!Array.isArray(p.reasonCodes) || p.reasonCodes.length > 8 || p.reasonCodes.some((r) => !inList(RELATIONSHIP_REASON_CODES, r))) return false;
  if (p.interactionCount !== undefined && !(typeof p.interactionCount === 'number' && Number.isInteger(p.interactionCount) && p.interactionCount >= 0)) return false;
  if (!validIso(p.generatedAt)) return false;
  const a = p.analyzer;
  if (!isRecord(a) || Object.keys(a).length !== 2 || typeof a.name !== 'string' || a.name.length > 64 || typeof a.version !== 'string' || a.version.length > 32) return false;
  return true;
}

export function validateEnrichmentEnvelope(e: unknown): e is EnrichmentEnvelope {
  if (!isRecord(e) || Object.keys(e).some((k) => !ENVELOPE_KEYS.has(k))) return false;
  return e.schemaVersion === 1 && typeof e.artifactId === 'string' && e.artifactId.length >= 1 && e.artifactId.length <= 256
    && e.kind === 'RelationshipEnrichmentArtifact' && e.producer === 'sns-providers' && validIso(e.createdAt)
    && Array.isArray(e.subjectRefs) && e.subjectRefs.length === 0 && e.payloadVersion === 1 && validateEnrichmentPayload(e.payload);
}

export function buildEnrichmentEnvelope(payload: EnrichmentPayload): EnrichmentEnvelope {
  return {
    schemaVersion: 1,
    artifactId: `rel_${payload.subject.platform}_${payload.subject.externalEventId}`,
    kind: 'RelationshipEnrichmentArtifact',
    producer: 'sns-providers',
    createdAt: payload.generatedAt,
    subjectRefs: [],
    payloadVersion: 1,
    payload,
  };
}

/** Pure: one artifact per distinct (platform, externalEventId), first occurrence wins, capped at 200. */
export function buildEnrichmentArtifacts(events: readonly MySnsInboundEvent[], state: RelationshipState, now: Date): EnrichmentEnvelope[] {
  const seen = new Set<string>();
  const out: EnrichmentEnvelope[] = [];
  for (const event of events) {
    const key = `${event.platform}\u0000${event.externalEventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const envelope = buildEnrichmentEnvelope(scoreRelationship(event, state, now));
    if (!validateEnrichmentEnvelope(envelope)) continue; // defence in depth: never emit an invalid artifact
    out.push(envelope);
    if (out.length >= MAX_ENRICHMENT_EVENTS) break;
  }
  return out;
}

// ---------- Report (route body) ----------

export interface EnrichmentDb {
  prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } };
}

export type EnrichmentReportResult =
  | { status: 200; body: { contractVersion: 1; service: 'sns-providers'; generatedAt: string; artifacts: EnrichmentEnvelope[] } }
  | { status: 502 | 503 | 504; body: { ok: false; contractVersion: 1; service: 'sns-providers'; code: string; reason: string } };

function failure(status: 502 | 503 | 504, code: string, reason: string): EnrichmentReportResult {
  return { status, body: { ok: false, contractVersion: 1, service: 'sns-providers', code, reason } };
}

export async function buildRelationshipEnrichmentReport(env: EnrichmentEnv & { DB: EnrichmentDb }, now = new Date()): Promise<EnrichmentReportResult> {
  const problem = mySnsConfigProblem(env);
  if (problem) return failure(503, 'ENRICHMENT_NOT_CONFIGURED', problem);
  const feed = await fetchMySnsInboundEvents(env);
  if (!feed.ok) {
    const status = feed.code === 'MY_SNS_NOT_CONFIGURED' ? 503 : feed.code === 'MY_SNS_TIMEOUT' ? 504 : 502;
    return failure(status, feed.code, feed.reason);
  }
  if (feed.events.length === 0) return { status: 200, body: { contractVersion: 1, service: 'sns-providers', generatedAt: now.toISOString(), artifacts: [] } };
  let state: RelationshipState | null = null;
  try {
    const row = await env.DB.prepare('SELECT state_json, updated_at FROM state_snapshots WHERE user_id = ?').bind('local-user').first<{ state_json: string }>();
    state = row ? parseRelationshipState(row.state_json) : null;
  } catch {
    state = null;
  }
  if (!state) return failure(503, 'RELATIONSHIP_STATE_UNAVAILABLE', 'The relationship state snapshot is missing, unreadable or invalid; no enrichment was produced.');
  return { status: 200, body: { contractVersion: 1, service: 'sns-providers', generatedAt: now.toISOString(), artifacts: buildEnrichmentArtifacts(feed.events, state, now) } };
}
