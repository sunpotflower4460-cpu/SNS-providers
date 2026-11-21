import { discoverMuseXProfiles, xPostUrl, type DiscoveryEnv } from './discovery';
import { rankMuseBatch, recordMuseRankUsage } from './index';
import { readSchemaVersion } from './social/schemaVersion';
import { loadSyncCheckpoint } from './social/syncCheckpoints';
import { syncXInboundMentions } from './social/x/sync';
import { runWithSourceLease } from './syncLease';
import {
  CANDIDATE_RESERVE, EVENING_LIMIT, actionName, eligibleCandidate, parseRecord,
  readKnownCandidateHandles, readMuseCandidate, readMuseCandidates, readMuseContext, readMuseReplies, readMuseReply,
  recordMuseHandoff, saveMuseCandidates, saveMuseReplyDrafts, text, updateMuseGreeting, xHandle,
  type MuseCandidate, type MuseContext, type MuseReply,
} from './museStore';

type Env = DiscoveryEnv & Parameters<typeof rankMuseBatch>[1] & Parameters<typeof syncXInboundMentions>[0];
type RankItem = Parameters<typeof rankMuseBatch>[0]['candidates'][number];
type RankPurpose = Parameters<typeof rankMuseBatch>[2];

const CANDIDATE_PATH = /^\/api\/muse\/candidates\/([^/]+)(?:\/(record|draft))?$/;
const REPLY_PATH = /^\/api\/muse\/replies\/([^/]+)$/;
const MUSE_PATHS = new Set(['/api/muse/today', '/api/muse/candidates', '/api/muse/refresh']);
const JOB_RANK_WINDOW_MS = 80_000;
const BATCH_SIZE = 5;
const CONCURRENT_BATCHES = 2;

export function isMusePath(path: string) {
  return MUSE_PATHS.has(path) || CANDIDATE_PATH.test(path) || REPLY_PATH.test(path);
}

export async function handleMuseRequest(request: Request, path: string, env: Env, userId: string) {
  const method = request.method;
  const candidate = CANDIDATE_PATH.exec(path);
  const reply = REPLY_PATH.exec(path);
  try {
    const schema = await readSchemaVersion(env.DB);
    if (!schema.connected || schema.pending.length || schema.partial.length) {
      return failure(503, 'D1 migration 8 is required for the Muse bridge.');
    }
    if (path === '/api/muse/refresh' && method === 'POST') {
      const body = await request.json<{ phase?: unknown; dateJst?: unknown } | null>();
      if (body?.phase === 'intake') return success(await refreshIntake(env, userId));
      if (body?.phase === 'prepare' && [jstDate(), jstDate(-1)].includes(String(body.dateJst))) {
        return success(await prepareEvening(env, userId, String(body.dateJst)));
      }
      return failure(400, 'Choose a refresh phase and use its returned date.');
    }
    const context = await readMuseContext(env.DB, userId);
    if (path === '/api/muse/today' && method === 'GET') return success(await today(env.DB, userId, context));
    if (path === '/api/muse/candidates' && method === 'GET') {
      return success({ candidates: (await shortlist(env.DB, userId, context)).slice(0, CANDIDATE_RESERVE).map(candidateSummary) });
    }
    if (reply && method === 'GET') {
      const found = await readMuseReply(env.DB, userId, decodeURIComponent(reply[1]), context);
      return found ? success({ action: replySummary(found) }) : failure(404, 'X reply was not found.');
    }
    if (candidate) {
      const id = decodeURIComponent(candidate[1]).replace(/^candidate:/, '');
      if (!/^[A-Za-z0-9._-]{1,160}$/.test(id)) return failure(400, 'Invalid candidate ID.');
      const found = await readMuseCandidate(env.DB, userId, id, context);
      if (!found) return failure(404, 'Candidate was not found.');
      if (method === 'GET' && !candidate[2]) return success({ candidate: candidateSummary(found) });
      if (method === 'POST' && candidate[2] === 'record') return await recordHandoff(request, env.DB, userId, found, context);
      if (method === 'POST' && candidate[2] === 'draft') return await regenerateGreeting(env, userId, found, context);
    }
    return failure(405, 'Method not allowed.');
  } catch {
    return failure(503, 'Muse data could not be prepared or read. The next read can still show previously saved work.');
  }
}

async function shortlist(db: D1Database, userId: string, context: MuseContext) {
  const people = await readMuseCandidates(db, userId, context);
  const uniqueIds = new Set<string>();
  return people.filter((person) => {
    if (!eligibleCandidate(person, context) || person.operation === 'review') return false;
    if (!person.platformUserId) return true;
    if (uniqueIds.has(person.platformUserId)) return false;
    uniqueIds.add(person.platformUserId);
    return true;
  });
}

async function today(db: D1Database, userId: string, context: MuseContext) {
  const [replies, candidates, refresh] = await Promise.all([
    readMuseReplies(db, userId, context), shortlist(db, userId, context),
    db.prepare(`SELECT evening_date, started_at, finished_at, summary_json FROM muse_refreshes
      WHERE user_id = ? ORDER BY evening_date DESC LIMIT 1`).bind(userId)
      .first<{ evening_date: string; started_at: string; finished_at: string | null; summary_json: string }>(),
  ]);
  return {
    target: EVENING_LIMIT,
    actions: replies.map(replySummary),
    candidates: candidates.slice(0, EVENING_LIMIT - replies.length).map(candidateSummary),
    candidateReserve: candidates.length,
    refresh: refresh && {
      dateJst: refresh.evening_date, startedAt: refresh.started_at, finishedAt: refresh.finished_at,
      ...parseRecord(refresh.summary_json),
    },
  };
}

function jstDate(dayOffset = 0) {
  return new Date(Date.now() + (9 + dayOffset * 24) * 60 * 60_000).toISOString().slice(0, 10);
}

async function refreshIntake(env: Env, userId: string) {
  const dateJst = jstDate();
  // Claim the date before any provider call. A replay never restarts billable intake.
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO muse_refreshes (user_id, evening_date, started_at)
    VALUES (?, ?, ?)`).bind(userId, dateJst, new Date().toISOString()).run();
  if (!claim.meta.changes) return { dateJst, alreadyStarted: true };

  let mentions = 'error';
  let mentionCostUsd: number | null = null;
  try {
    const checkpoint = await loadSyncCheckpoint(env.DB, userId, 'x_mentions');
    const sinceSync = Date.now() - Date.parse(checkpoint.available ? checkpoint.checkpoint?.updatedAt || '' : '');
    if (sinceSync >= 0 && sinceSync < 15 * 60_000 && checkpoint.available && checkpoint.checkpoint?.extra.backlogComplete === true) {
      mentions = 'cached';
      mentionCostUsd = 0;
    } else if (checkpoint.available) {
      const result = await runWithSourceLease(env.DB, userId, 'x_mentions_sync', 5 * 60_000,
        // One bounded page keeps the request within D1 limits. The normal checkpoint retains any continuation.
        () => syncXInboundMentions(env, { userId, maxResults: 10 }, 1));
      mentions = result.enabled ? ('checkpointComplete' in result && !result.checkpointComplete ? 'partial' : 'ok')
        : result.source === 'error' ? 'error' : 'unavailable';
      mentionCostUsd = result.costUsd;
    }
  } catch {
    // Candidate preparation can continue after an intake problem.
  }
  await env.DB.prepare(`UPDATE muse_refreshes SET intake_finished_at = ?, summary_json = json_patch(summary_json, ?)
    WHERE user_id = ? AND evening_date = ?`)
    .bind(new Date().toISOString(), JSON.stringify({ mentions, mentionCostUsd }), userId, dateJst).run();
  return { dateJst, alreadyStarted: false };
}

async function prepareEvening(env: Env, userId: string, dateJst: string) {
  const run = await env.DB.prepare(`SELECT started_at, intake_finished_at FROM muse_refreshes
    WHERE user_id = ? AND evening_date = ?`).bind(userId, dateJst)
    .first<{ started_at: string; intake_finished_at: string | null }>();
  const context = await readMuseContext(env.DB, userId);
  const age = Date.now() - Date.parse(run?.started_at || '');
  if (!run || (!run.intake_finished_at && age < 5 * 60_000)) {
    return { dateJst, alreadyStarted: true, ...(await today(env.DB, userId, context)) };
  }
  const startedAt = new Date().toISOString();
  const expired = new Date(Date.now() - 3 * 60_000).toISOString();
  const claim = await env.DB.prepare(`UPDATE muse_refreshes SET preparation_started_at = ?
    WHERE user_id = ? AND evening_date = ? AND finished_at IS NULL
      AND (preparation_started_at IS NULL OR preparation_started_at < ?)`)
    .bind(startedAt, userId, dateJst, expired).run();
  if (!claim.meta.changes) return { dateJst, alreadyStarted: true, ...(await today(env.DB, userId, context)) };

  const pool = await readMuseCandidates(env.DB, userId, context);
  const reserve = pool.filter((candidate) => eligibleCandidate(candidate, context) && candidate.operation !== 'review').length;
  let discovery: Awaited<ReturnType<typeof discoverMuseXProfiles>> | undefined;
  let discoveryStatus = 'skipped';
  if (context.discover && reserve < CANDIDATE_RESERVE) {
    discoveryStatus = 'unavailable';
    try {
      const known = await readKnownCandidateHandles(env.DB, userId);
      const excluded = new Set([...context.blockedHandles, ...pool.map((candidate) => candidate.username), ...known]);
      discovery = await discoverMuseXProfiles(context.mission, env, excluded);
      if (discovery.enabled) discoveryStatus = 'ok';
      if (discovery.credits) {
        await env.DB.prepare(`INSERT INTO budget_ledger (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at)
          VALUES (?, ?, 'tavily', 'muse_search_free', 0, ?, 0, 0, ?)`)
          .bind(crypto.randomUUID(), userId, discovery.credits, startedAt).run();
      }
    } catch {
      // Keep the existing Inbox and candidate pool available if the search fails.
    }
  }
  const replies = await readMuseReplies(env.DB, userId, context);
  const deadline = Date.now() + JOB_RANK_WINDOW_MS;
  const drafted = await prepareReplyDrafts(env, userId, context, replies, deadline);
  const discovered = (discovery?.profiles || []).map(discoveredCandidate);
  const prepared = await prepareCandidates(env, userId, context, [...pool, ...discovered], deadline);
  const summary = {
    discovery: discoveryStatus, discoveryCredits: discovery?.credits ?? 0,
    newCandidates: prepared, newReplyDrafts: drafted,
  };
  await env.DB.prepare(`UPDATE muse_refreshes SET finished_at = ?, summary_json = json_patch(summary_json, ?)
    WHERE user_id = ? AND evening_date = ? AND preparation_started_at = ?`)
    .bind(new Date().toISOString(), JSON.stringify(summary), userId, dateJst, startedAt).run();
  return { dateJst, alreadyStarted: false, ...(await today(env.DB, userId, context)) };
}

async function prepareReplyDrafts(env: Env, userId: string, context: MuseContext, replies: MuseReply[], deadline: number) {
  if (!context.draft) return 0;
  const pending = replies.filter((reply) => reply.contextHash && !reply.draft && reply.targetUrl
    && (reply.status === 'ready' || reply.status === 'pending' || (reply.status === 'failed' && reply.retryable)));
  const items = pending.map((reply) => ({
    id: reply.id, username: reply.username, engagementUrl: reply.targetUrl!, activityText: reply.inboundText.slice(0, 1400),
  }));
  const results = await rankBatches(env, userId, context, items, 'inbound_reply', deadline);
  return saveMuseReplyDrafts(env.DB, userId, pending.flatMap((reply) => {
    const draft = results.get(reply.id)?.draft;
    return draft ? [{ id: reply.id, contextHash: reply.contextHash!, draft }] : [];
  }));
}

async function prepareCandidates(env: Env, userId: string, context: MuseContext, people: MuseCandidate[], deadline: number) {
  const fresh = people.filter((person) => !person.updatedAt && eligibleCandidate(person, context));
  const backfill = people.filter((person) => person.updatedAt && person.activityText && !person.draft
    && person.operation !== 'review' && eligibleCandidate(person, context));
  const visibleBackfill = backfill.slice(0, Math.floor(EVENING_LIMIT / 2));
  const todo = [...visibleBackfill, ...fresh, ...backfill.slice(visibleBackfill.length)].slice(0, CANDIDATE_RESERVE);
  const results = await rankBatches(env, userId, context, todo.map(rankInput), 'greeting', deadline);
  const additions = fresh.flatMap((person) => {
    const ranked = results.get(person.id);
    return ranked ? [{
      ...person, match: ranked.match, reason: ranked.reason, strategy: ranked.strategy,
      operation: actionName(ranked.recommendedAction, person.postUrl), draft: ranked.draft || null,
    }] : [];
  });
  const greetings = backfill.flatMap((person) => {
    const draft = results.get(person.id)?.draft;
    return draft ? [{ ...person, draft }] : [];
  });
  const inserted = await saveMuseCandidates(env.DB, userId, [...additions, ...greetings]);
  // Backfill blanks on rows already present in D1. Existing drafts stay as the reviewed version.
  if (greetings.length) {
    await env.DB.prepare(`UPDATE candidates SET greeting_draft = json_extract(item.value, '$.draft'), updated_at = ?
      FROM json_each(?) AS item WHERE candidates.user_id = ? AND candidates.id = json_extract(item.value, '$.id')
      AND candidates.updated_at = json_extract(item.value, '$.updatedAt') AND candidates.greeting_draft IS NULL
      AND NOT EXISTS (SELECT 1 FROM interactions WHERE candidate_id = candidates.id AND user_id = candidates.user_id)`)
      .bind(new Date().toISOString(), JSON.stringify(greetings), userId).run();
  }
  return inserted;
}

function rankInput(person: MuseCandidate): RankItem {
  return {
    id: person.id, username: person.username, platform: 'x', bio: person.profileSummary,
    currentMatch: person.match, engagementUrl: person.postUrl || undefined, activityText: person.activityText,
  };
}

async function rankBatches(env: Env, userId: string, context: MuseContext, items: RankItem[], purpose: RankPurpose, deadline: number) {
  type Result = Awaited<ReturnType<typeof rankMuseBatch>>['results'][number];
  const results = new Map<string, Result>();
  let provider: 'groq' | 'sakura' | null = null;
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const stride = BATCH_SIZE * CONCURRENT_BATCHES;
  for (let start = 0; start < items.length; start += stride) {
    const chunks = Array.from({ length: CONCURRENT_BATCHES }, (_, index) =>
      items.slice(start + index * BATCH_SIZE, start + (index + 1) * BATCH_SIZE)).filter((chunk) => chunk.length);
    const settled = await Promise.allSettled(chunks.map((candidates) => rankMuseBatch({
      userId, mission: context.mission, communicationDNA: context.communicationDNA, candidates,
      draftsEnabled: context.draft,
    }, env, purpose, deadline)));
    for (const batch of settled) {
      if (batch.status !== 'fulfilled') continue;
      for (const result of batch.value.results) results.set(result.id, result);
      if (batch.value.provider === 'sakura' || batch.value.provider === 'groq') provider = batch.value.provider;
      usage.prompt_tokens += batch.value.usage?.prompt_tokens || 0;
      usage.completion_tokens += batch.value.usage?.completion_tokens || 0;
    }
  }
  if (provider) await recordMuseRankUsage(env, userId, provider, usage);
  return results;
}

function discoveredCandidate(result: Awaited<ReturnType<typeof discoverMuseXProfiles>>['profiles'][number]): MuseCandidate {
  const username = xHandle(result.username);
  return {
    id: `web-x-${username}`, username, platformUserId: null, displayName: result.title || username,
    profileSummary: result.profileSummary, profileUrl: `https://x.com/${username}`, postUrl: xPostUrl(result.sourceUrl, username),
    activityText: result.snippet, match: Math.round(45 + result.score * 25),
    reason: '活動テーマに沿った公開情報として見つかりました。', strategy: '',
    operation: 'review', draft: null, status: 'pending', updatedAt: null,
  };
}

async function recordHandoff(request: Request, db: D1Database, userId: string, candidate: MuseCandidate, context: MuseContext) {
  const body = await request.json<{ outcome?: unknown } | null>();
  const outcome = body?.outcome;
  if (outcome !== 'completed' && outcome !== 'skipped') return failure(400, 'Choose one explicit handoff outcome.');
  if (candidate.status === outcome) return success({ id: `candidate:${candidate.id}`, status: outcome, idempotent: true });
  if (!eligibleCandidate(candidate, context) || (outcome === 'completed' && candidate.operation === 'review')) {
    return failure(409, 'This candidate is no longer available to record.');
  }
  const result = await recordMuseHandoff(db, userId, candidate, outcome);
  return result ? success({ id: `candidate:${candidate.id}`, ...result }) : failure(409, 'The handoff outcome already changed.');
}

async function regenerateGreeting(env: Env, userId: string, candidate: MuseCandidate, context: MuseContext) {
  if (!eligibleCandidate(candidate, context) || !candidate.activityText) {
    return failure(409, 'Available public activity and an open candidate are required.');
  }
  const ranked = await rankMuseBatch({
    userId, mission: context.mission, communicationDNA: context.communicationDNA,
    candidates: [rankInput(candidate)], draftsEnabled: true,
  }, env, 'greeting', Date.now() + 55_000);
  if (ranked.provider === 'groq' || ranked.provider === 'sakura') {
    await recordMuseRankUsage(env, userId, ranked.provider, ranked.usage || {});
  }
  const draft = ranked.results[0]?.draft;
  if (!draft) return failure(422, 'A free AI provider could not prepare a grounded draft.');
  const inserted = await saveMuseCandidates(env.DB, userId, [{ ...candidate, draft }]);
  if (!inserted && !await updateMuseGreeting(env.DB, userId, candidate, draft)) {
    return failure(409, 'The candidate changed. Read the current candidate before requesting another draft.');
  }
  return success({ candidate: candidateSummary({ ...candidate, draft }) });
}

function candidateSummary(candidate: MuseCandidate, index?: number) {
  return {
    id: `candidate:${candidate.id}`, platform: 'x', mode: 'handoff', status: candidate.status,
    username: candidate.username, displayName: candidate.displayName, profileSummary: candidate.profileSummary,
    profileUrl: candidate.profileUrl, postUrl: candidate.postUrl,
    targetUrl: candidate.operation === 'follow' ? candidate.profileUrl : candidate.postUrl,
    activityText: candidate.activityText, match: candidate.match, rank: index === undefined ? null : index + 1,
    reason: candidate.reason, strategy: candidate.strategy, operation: candidate.operation, draft: candidate.draft,
  };
}

function replySummary(reply: MuseReply) {
  const { contextHash: _contextHash, ...item } = reply;
  return item;
}

function success(body: Record<string, unknown>) { return { status: 200, body: { ok: true, ...body } }; }
function failure(status: number, error: string) { return { status, body: { ok: false, error } }; }
