#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = '/tmp/sns-providers-cloud-complete-tests';
await mkdir(outDir, { recursive: true });

async function emit(destRel, sourceUrl) {
  const source = await readFile(sourceUrl, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
    },
    fileName: sourceUrl.pathname,
  });
  const rewritten = outputText.replace(/from ['"](\.{1,2}\/[^'"]+)['"]/g, (_, spec) => `from '${spec}.js'`);
  const dest = `${outDir}/${destRel}`;
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, rewritten);
}

const files = [
  ['budgetIntegrity.js', '../worker/src/budgetIntegrity.ts'],
  ['fetchWithTimeout.js', '../worker/src/fetchWithTimeout.ts'],
  ['syncLease.js', '../worker/src/syncLease.ts'],
  ['xOAuth.js', '../worker/src/xOAuth.ts'],
  ['social/types.js', '../worker/src/social/types.ts'],
  ['social/ids.js', '../worker/src/social/ids.ts'],
  ['social/httpStatus.js', '../worker/src/social/httpStatus.ts'],
  ['social/capabilities.js', '../worker/src/social/capabilities.ts'],
  ['social/executeGuard.js', '../worker/src/social/executeGuard.ts'],
  ['social/repository.js', '../worker/src/social/repository.ts'],
  ['social/execute.js', '../worker/src/social/execute.ts'],
  ['social/lifecycle.js', '../worker/src/social/lifecycle.ts'],
  ['social/prepare.js', '../worker/src/social/prepare.ts'],
  ['social/reconcile.js', '../worker/src/social/reconcile.ts'],
  ['social/query.js', '../worker/src/social/query.ts'],
  ['social/budgetCeiling.js', '../worker/src/social/budgetCeiling.ts'],
  ['social/fingerprint.js', '../worker/src/social/fingerprint.ts'],
  ['social/x/followReconcile.js', '../worker/src/social/x/followReconcile.ts'],
  ['social/x/likeReconcile.js', '../worker/src/social/x/likeReconcile.ts'],
  ['social/instagram/execute.js', '../worker/src/social/instagram/execute.ts'],
  ['social/instagram/dm.js', '../worker/src/social/instagram/dm.ts'],
  ['social/instagram/probe.js', '../worker/src/social/instagram/probe.ts'],
  ['social/instagram/persist.js', '../worker/src/social/instagram/persist.ts'],
  ['social/instagram/inbound.js', '../worker/src/social/instagram/inbound.ts'],
  ['social/instagram/webhook.js', '../worker/src/social/instagram/webhook.ts'],
  ['social/x/execute.js', '../worker/src/social/x/execute.ts'],
  ['social/x/follow.js', '../worker/src/social/x/follow.ts'],
  ['social/x/like.js', '../worker/src/social/x/like.ts'],
  ['social/x/dm.js', '../worker/src/social/x/dm.ts'],
  ['social/x/lookup.js', '../worker/src/social/x/lookup.ts'],
];
for (const [dest, src] of files) {
  await emit(dest, new URL(src, import.meta.url));
}

const { executeSocialAction, knownWriteCost } = await import(pathToFileURL(`${outDir}/social/execute.js`).href);
const { parseExecuteBody, resolveWriteTarget } = await import(pathToFileURL(`${outDir}/social/executeGuard.js`).href);
const { snoozeCanonicalAction, dismissCanonicalAction } = await import(pathToFileURL(`${outDir}/social/lifecycle.js`).href);
const { prepareSocialAction } = await import(pathToFileURL(`${outDir}/social/prepare.js`).href);
const { reconcileExecution } = await import(pathToFileURL(`${outDir}/social/reconcile.js`).href);
const { liveXCapabilities, liveInstagramCapabilities } = await import(pathToFileURL(`${outDir}/social/capabilities.js`).href);
const { handleInstagramWebhookVerification } = await import(pathToFileURL(`${outDir}/social/instagram/webhook.js`).href);

function fail(message) {
  throw new Error(message);
}

function createMemoryD1() {
  const actions = new Map();
  const events = new Map();
  const executions = new Map();
  const ledger = [];

  function actionKey(userId, id) { return `${userId}::${id}`; }
  function eventKey(userId, platform, type, ext) { return `${userId}::${platform}::${type}::${ext}`; }
  function execKey(userId, idem) { return `${userId}::${idem}`; }

  return {
    _actions: actions,
    _events: events,
    _executions: executions,
    _ledger: ledger,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM social_actions WHERE user_id = ? AND id = ?')) {
                return actions.get(actionKey(params[0], params[1])) || null;
              }
              if (normalized.includes('FROM social_events WHERE user_id = ? AND platform = ? AND event_type = ? AND external_event_id = ?')) {
                return events.get(eventKey(params[0], params[1], params[2], params[3])) || null;
              }
              if (normalized.includes('FROM social_executions WHERE user_id = ? AND idempotency_key = ?')) {
                return executions.get(execKey(params[0], params[1])) || null;
              }
              if (normalized.includes('FROM social_executions WHERE user_id = ? AND action_id = ?')) {
                const matches = [...executions.values()].filter((row) => row.user_id === params[0] && row.action_id === params[1]);
                return matches.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
              }
              if (normalized.includes('FROM current_usage') && normalized.includes('timestamp_integrity')) {
                const used = ledger.filter((row) => row.user_id === params[0]).reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);
                return { used, invalid_count: 0, unassignable_count: 0 };
              }
              return null;
            },
            async all() {
              if (normalized.includes('FROM social_actions WHERE user_id = ?')) {
                const rows = [...actions.values()].filter((row) => row.user_id === params[0]);
                return { results: rows };
              }
              return { results: [] };
            },
            async run() {
              if (normalized.startsWith('INSERT INTO social_events')) {
                const row = {
                  id: params[0], user_id: params[1], platform: params[2], event_type: params[3],
                  external_event_id: params[4], external_user_id: params[5], payload_json: params[6],
                  occurred_at: params[7], received_at: params[8],
                };
                events.set(eventKey(row.user_id, row.platform, row.event_type, row.external_event_id), row);
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('INSERT INTO social_actions')) {
                const row = {
                  id: params[0], user_id: params[1], platform: params[2], candidate_id: params[3],
                  action_type: params[4], status: params[5], execution_mode: params[6], source: params[7],
                  external_event_id: params[8], conversation_id: params[9], parent_content_id: params[10],
                  target_url: params[11], observed_at: params[12], created_at: params[13], updated_at: params[14],
                  completed_at: params[15], platform_user_id: params[16], username: params[17],
                  identity_conflict: params[18], retryable: params[19],
                  snoozed_until: params[20] ?? null,
                  result_metadata_json: params[21] ?? '{}',
                };
                actions.set(actionKey(row.user_id, row.id), row);
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('INSERT OR IGNORE INTO social_executions')) {
                const key = execKey(params[1], params[5]);
                if (executions.has(key)) return { meta: { changes: 0 } };
                executions.set(key, {
                  id: params[0], user_id: params[1], action_id: params[2], platform: params[3],
                  operation: params[4], idempotency_key: params[5], external_result_id: params[6],
                  status: params[7], error_code: params[8], created_at: params[9], completed_at: params[10],
                  reservation_id: null,
                });
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('INSERT INTO budget_ledger')) {
                const reservation = normalized.startsWith('WITH');
                ledger.push(reservation
                  ? { id: params[3], user_id: params[4], provider: params[5], operation: params[6], cost_usd: params[7] }
                  : { id: params[0], user_id: params[1], provider: params[2], operation: params[3], cost_usd: params[4] });
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('DELETE FROM budget_ledger WHERE id = ? AND user_id = ?')) {
                const before = ledger.length;
                for (let i = ledger.length - 1; i >= 0; i -= 1) {
                  if (ledger[i].id === params[0] && ledger[i].user_id === params[1]) ledger.splice(i, 1);
                }
                return { meta: { changes: before === ledger.length ? 0 : 1 } };
              }
              if (normalized.includes("SET status = 'executing'")) {
                const row = actions.get(actionKey(params[2], params[1]));
                if (!row) return { meta: { changes: 0 } };
                if (!['pending', 'ready', 'failed'].includes(row.status)) return { meta: { changes: 0 } };
                if (row.status === 'failed' && Number(row.retryable) === 0) return { meta: { changes: 0 } };
                row.status = 'executing';
                row.updated_at = params[0];
                return { meta: { changes: 1 } };
              }
              if (normalized.includes("SET status = 'snoozed'")) {
                const row = actions.get(actionKey(params[3], params[2]));
                if (!row || !['pending', 'ready', 'failed', 'snoozed'].includes(row.status)) return { meta: { changes: 0 } };
                row.status = 'snoozed';
                row.snoozed_until = params[0];
                row.updated_at = params[1];
                return { meta: { changes: 1 } };
              }
              if (normalized.includes("SET status = 'dismissed'")) {
                const row = actions.get(actionKey(params[2], params[1]));
                if (!row || !['pending', 'ready', 'failed', 'snoozed'].includes(row.status)) return { meta: { changes: 0 } };
                row.status = 'dismissed';
                row.snoozed_until = null;
                row.updated_at = params[0];
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('SET status = ?, completed_at = ?, updated_at = ?, retryable = 0')) {
                const row = actions.get(actionKey(params[3], params[4]));
                if (!row) return { meta: { changes: 0 } };
                row.status = params[0];
                row.completed_at = params[1];
                row.updated_at = params[2];
                row.retryable = 0;
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('SET status = ?, retryable = ?, updated_at = ?')) {
                const row = actions.get(actionKey(params[3], params[4]));
                if (!row) return { meta: { changes: 0 } };
                row.status = params[0];
                row.retryable = params[1];
                row.updated_at = params[2];
                return { meta: { changes: 1 } };
              }
              if (normalized.includes("SET error_code = 'SENDING'")) {
                const row = executions.get(execKey(params[0], params[1]));
                if (!row || row.status !== 'pending' || row.error_code != null) return { meta: { changes: 0 } };
                row.error_code = 'SENDING';
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('UPDATE social_executions SET reservation_id')) {
                const row = executions.get(execKey(params[1], params[2]));
                if (!row) return { meta: { changes: 0 } };
                row.reservation_id = params[0];
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('UPDATE social_executions SET status = ?')) {
                const row = executions.get(execKey(params[4], params[5]));
                if (!row) return { meta: { changes: 0 } };
                row.status = params[0];
                row.external_result_id = params[1];
                row.error_code = params[2];
                row.completed_at = params[3];
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

function envBase() {
  return {
    DB: createMemoryD1(),
    SOCIAL_WRITE_MODE: 'test',
    SOCIAL_WRITE_ENABLED: 'true',
    X_FOLLOW_WRITE_ENABLED: 'true',
    X_UNFOLLOW_WRITE_ENABLED: 'true',
    X_LIKE_WRITE_ENABLED: 'true',
    X_DM_WRITE_ENABLED: 'true',
    X_REPLY_WRITE_ENABLED: 'true',
    INSTAGRAM_DM_WRITE_ENABLED: 'true',
    INSTAGRAM_COMMENT_REPLY_ENABLED: 'true',
    DEFAULT_MONTHLY_BUDGET_USD: '3',
  };
}

function seedAction(db, overrides = {}) {
  const row = {
    id: 'sa-x-follow-99',
    user_id: 'local-user',
    platform: 'x',
    candidate_id: 'cand-1',
    action_type: 'follow',
    status: 'ready',
    execution_mode: 'in_app',
    source: 'x_follow',
    external_event_id: '99',
    conversation_id: null,
    parent_content_id: null,
    target_url: 'https://x.com/bob',
    observed_at: '2026-08-30T12:00:00.000Z',
    created_at: '2026-08-30T12:00:00.000Z',
    updated_at: '2026-08-30T12:00:00.000Z',
    completed_at: null,
    platform_user_id: '99',
    username: 'bob',
    identity_conflict: 0,
    retryable: 1,
    snoozed_until: null,
    result_metadata_json: '{}',
    ...overrides,
  };
  db._actions.set(`local-user::${row.id}`, row);
  return row;
}

{
  const parsed = parseExecuteBody({ executionId: 'exec-abc-12', draft: 'hi', tweetId: 'evil', conversationId: 'evil-convo', platform: 'instagram' });
  if ('ok' in parsed && parsed.ok === false) fail(parsed.reason);
  if (parsed.tweetId || parsed.conversationId || parsed.platform) fail('Execute body accepted client targeting fields.');
  const bulk = parseExecuteBody({ executionId: 'exec-abc-12', draft: 'x', actions: [{ id: 'a' }, { id: 'b' }] });
  if (!('ok' in bulk) || bulk.ok !== false) fail('Bulk execute body was accepted.');
}

{
  const env = envBase();
  seedAction(env.DB);
  const snoozed = await snoozeCanonicalAction(env.DB, 'local-user', 'sa-x-follow-99', {});
  if (snoozed.status !== 200 || snoozed.body.action.status !== 'snoozed') fail('Server snooze did not persist.');
  const future = await snoozeCanonicalAction(env.DB, 'local-user', 'sa-x-follow-99', { until: '2099-01-01T00:00:00.000Z' });
  if (future.status !== 400) fail('Future-poisoned snooze was accepted.');
  env.DB._actions.get('local-user::sa-x-follow-99').status = 'completed';
  const completed = await snoozeCanonicalAction(env.DB, 'local-user', 'sa-x-follow-99', {});
  if (completed.status !== 409 || completed.body.code !== 'COMPLETED') fail('Completed action was snoozed.');
}

{
  const env = envBase();
  seedAction(env.DB, { status: 'executing' });
  const dismissed = await dismissCanonicalAction(env.DB, 'local-user', 'sa-x-follow-99');
  if (dismissed.status !== 409) fail('Executing action was dismissed.');
  env.DB._actions.get('local-user::sa-x-follow-99').status = 'ready';
  const ok = await dismissCanonicalAction(env.DB, 'local-user', 'sa-x-follow-99');
  if (ok.status !== 200 || ok.body.action.status !== 'dismissed') fail('Server dismiss did not persist.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  const handoff = await prepareSocialAction(env, 'local-user', { candidateId: 'cand-1', type: 'follow', username: 'bob' });
  if (handoff.body.executionMode !== 'handoff' || handoff.body.action != null) fail('Username-only follow became a write target.');
}

{
  const env = envBase();
  const mismatch = await prepareSocialAction(env, 'local-user', {
    candidateId: 'cand-1',
    type: 'like',
    engagementUrl: 'https://x.com/bob/status/111',
    tweetId: '222',
  });
  if (mismatch.status !== 400 || mismatch.body.code !== 'BINDING_MISMATCH') fail('Client-tampered tweet ID altered the like target.');
}

{
  const igFollow = resolveWriteTarget({
    id: 'a', userId: 'local-user', platform: 'instagram', candidateId: 'c', type: 'follow',
    status: 'ready', executionMode: 'handoff', source: 'manual', createdAt: '', updatedAt: '', identityConflict: false, retryable: true,
  }, null);
  if (!('ok' in igFollow) || igFollow.ok !== false || igFollow.code !== 'HANDOFF_NOT_EXECUTABLE') fail('Instagram follow HANDOFF was executable.');
}

function withXMe(run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/2/users/me')) {
      return { ok: true, status: 200, json: async () => ({ data: { id: '1', username: 'me' } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return Promise.resolve().then(run).finally(() => { globalThis.fetch = originalFetch; });
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.X_FOLLOW_WRITE_USD = '0.02';
  seedAction(env.DB);
  const writes = [];
  await withXMe(async () => {
    const result = await executeSocialAction(env, 'local-user', 'sa-x-follow-99', {
      executionId: 'exec-follow-1',
      draft: '',
      tweetId: 'should-be-ignored',
    }, {
      followXUser: async (input) => {
        writes.push(input);
        return { certainty: 'success', externalResultId: '99', metadata: { pendingFollow: true, relationship: 'pending_follow' } };
      },
      xGrantedScopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access', 'follows.write'],
      getXAccessToken: async () => 'tok',
    });
    if (result.status !== 200 || result.body.certainty !== 'success') fail(`Follow execute failed: ${JSON.stringify(result.body)}`);
    if (writes.length !== 1 || writes[0].targetUserId !== '99') fail('Follow write used a non-canonical target.');
    if (result.body.pendingFollow !== true) fail('Pending follow metadata was dropped.');
  });
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.X_FOLLOW_WRITE_USD = '0.02';
  seedAction(env.DB);
  const writes = [];
  const denied = await executeSocialAction(env, 'local-user', 'sa-x-follow-99', { executionId: 'exec-follow-cap', draft: '' }, {
    followXUser: async (input) => { writes.push(input); return { certainty: 'success', externalResultId: '99' }; },
    xGrantedScopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access'],
    getXAccessToken: async () => 'tok',
  });
  if (denied.body.code !== 'CAPABILITY_DENIED' && denied.body.code !== 'WRITE_DISABLED') fail('Follow without follows.write still wrote.');
  if (writes.length !== 0) fail('Default OAuth follow reached the provider.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.X_LIKE_WRITE_USD = '0.01';
  seedAction(env.DB, {
    id: 'sa-x-like-555',
    action_type: 'like',
    source: 'x_like',
    external_event_id: '555',
    platform_user_id: '99',
  });
  const likes = [];
  await withXMe(async () => {
    const liked = await executeSocialAction(env, 'local-user', 'sa-x-like-555', { executionId: 'exec-like-1', draft: '', tweetId: '999' }, {
      likeXTweet: async (input) => { likes.push(input); return { certainty: 'success', externalResultId: '555' }; },
      xGrantedScopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access', 'like.write'],
      getXAccessToken: async () => 'tok',
    });
    if (liked.body.certainty !== 'success' || likes[0].tweetId !== '555') fail('Like execute did not use the canonical tweet ID.');
  });
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.X_DM_WRITE_USD = '0.01';
  seedAction(env.DB, {
    id: 'sa-x-dm-1',
    action_type: 'dm_reply',
    source: 'x_dm',
    external_event_id: 'evt1',
    conversation_id: 'convo-1',
    platform_user_id: '99',
  });
  env.DB._events.set('local-user::x::dm::evt1', {
    id: 'ev-1', user_id: 'local-user', platform: 'x', event_type: 'dm',
    external_event_id: 'evt1', external_user_id: '99',
    payload_json: JSON.stringify({ conversationId: 'convo-1', text: 'hi' }),
    occurred_at: '2026-08-30T12:00:00.000Z', received_at: '2026-08-30T12:00:00.000Z',
  });
  const dms = [];
  await withXMe(async () => {
    const sent = await executeSocialAction(env, 'local-user', 'sa-x-dm-1', { executionId: 'exec-dm-1', draft: 'thanks', conversationId: 'tampered' }, {
      sendXDm: async (input) => { dms.push(input); return { certainty: 'success', externalResultId: 'evt-out' }; },
      xGrantedScopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access', 'dm.read', 'dm.write'],
      getXAccessToken: async () => 'tok',
    });
    if (sent.body.certainty !== 'success' || dms[0].conversationId !== 'convo-1') fail(`DM execute used a client conversation ID: ${JSON.stringify(sent.body)}`);
  });
}

{
  const env = envBase();
  seedAction(env.DB);
  env.DB._executions.set('local-user::exec-unknown-1', {
    id: 'ex-1', user_id: 'local-user', action_id: 'sa-x-follow-99', platform: 'x',
    operation: 'x_follow_write', idempotency_key: 'exec-unknown-1', external_result_id: null,
    status: 'pending', error_code: 'UNKNOWN_RESULT', created_at: '2026-08-30T12:00:00.000Z', completed_at: null,
    reservation_id: 'res-1',
  });
  env.DB._ledger.push({ id: 'res-1', user_id: 'local-user', provider: 'x', operation: 'x_follow_write', cost_usd: 0.02 });
  let posts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init?.method && init.method !== 'GET') posts += 1;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  try {
    const first = await reconcileExecution(env, 'local-user', 'exec-unknown-1');
    const second = await reconcileExecution(env, 'local-user', 'exec-unknown-1');
    if (first.body.certainty === 'success' && posts > 0) fail('Reconciliation sent a write.');
    if (second.body.idempotent !== true && second.body.certainty !== first.body.certainty) fail('Duplicate reconcile was not stable.');
    if (env.DB._ledger.some((row) => row.id === 'res-1') === false && first.body.certainty === 'unknown') {
      fail('Unknown reconcile released the reservation.');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.X_FOLLOW_WRITE_USD = '0.05';
  seedAction(env.DB);
  const writes = [];
  await withXMe(async () => {
    const failed = await executeSocialAction(env, 'local-user', 'sa-x-follow-99', { executionId: 'exec-fail-1', draft: '' }, {
      followXUser: async (input) => {
        writes.push(input);
        return { certainty: 'failure', retryable: false, errorCode: 'INVALID_ACTION', reason: 'protected' };
      },
      xGrantedScopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access', 'follows.write'],
      getXAccessToken: async () => 'tok',
    });
    if (failed.body.certainty !== 'failure') fail('Confirmed follow failure was not failure.');
    if (env.DB._ledger.length !== 0) fail('Confirmed no-write failure kept the reservation.');
  });
}

{
  if (knownWriteCost({}, 'x_follow_write') != null) fail('Unknown follow price was treated as free.');
  const igCaps = liveInstagramCapabilities({});
  if (igCaps.follow || igCaps.like || igCaps.sendCommentReply) fail('Missing Instagram probe still advertised writes.');
  const xCaps = liveXCapabilities({}, ['tweet.read', 'users.read', 'follows.read', 'offline.access']);
  if (xCaps.follow || xCaps.like || xCaps.sendDm) fail('Default X scopes advertised write capabilities.');
}

{
  const denied = await handleInstagramWebhookVerification(new Request('https://example.com/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc'), {});
  if (denied.status !== 403) fail('Webhook verification succeeded without a token.');
}

console.log('Cloud-complete runtime OK: snooze/dismiss, prepare canonicalization, follow/like/DM execute, unknown reconcile, budget void, HANDOFF, webhook verification.');
