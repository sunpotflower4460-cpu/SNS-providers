#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = '/tmp/sns-providers-final-manual-closure';
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
  ['fetchWithTimeout.js', '../worker/src/fetchWithTimeout.ts'],
  ['syncLease.js', '../worker/src/syncLease.ts'],
  ['budgetIntegrity.js', '../worker/src/budgetIntegrity.ts'],
  ['xOAuth.js', '../worker/src/xOAuth.ts'],
  ['social/query.js', '../worker/src/social/query.ts'],
  ['social/types.js', '../worker/src/social/types.ts'],
  ['social/budgetCeiling.js', '../worker/src/social/budgetCeiling.ts'],
  ['social/providerIds.js', '../worker/src/social/providerIds.ts'],
  ['social/fingerprint.js', '../worker/src/social/fingerprint.ts'],
  ['social/syncCheckpoints.js', '../worker/src/social/syncCheckpoints.ts'],
  ['social/httpStatus.js', '../worker/src/social/httpStatus.ts'],
  ['social/ids.js', '../worker/src/social/ids.ts'],
  ['social/capabilities.js', '../worker/src/social/capabilities.ts'],
  ['social/repository.js', '../worker/src/social/repository.ts'],
  ['social/executeGuard.js', '../worker/src/social/executeGuard.ts'],
  ['social/execute.js', '../worker/src/social/execute.ts'],
  ['social/reconcile.js', '../worker/src/social/reconcile.ts'],
  ['social/x/followReconcile.js', '../worker/src/social/x/followReconcile.ts'],
  ['social/x/likeReconcile.js', '../worker/src/social/x/likeReconcile.ts'],
  ['social/x/follow.js', '../worker/src/social/x/follow.ts'],
  ['social/x/like.js', '../worker/src/social/x/like.ts'],
  ['social/x/dm.js', '../worker/src/social/x/dm.ts'],
  ['social/x/execute.js', '../worker/src/social/x/execute.ts'],
  ['social/x/lookup.js', '../worker/src/social/x/lookup.ts'],
  ['social/x/inbound.js', '../worker/src/social/x/inbound.ts'],
  ['social/x/persist.js', '../worker/src/social/x/persist.ts'],
  ['social/x/persistDm.js', '../worker/src/social/x/persistDm.ts'],
  ['social/x/sync.js', '../worker/src/social/x/sync.ts'],
  ['social/x/dmSync.js', '../worker/src/social/x/dmSync.ts'],
  ['social/instagram/inbound.js', '../worker/src/social/instagram/inbound.ts'],
  ['social/instagram/persist.js', '../worker/src/social/instagram/persist.ts'],
  ['social/instagram/persistDm.js', '../worker/src/social/instagram/persistDm.ts'],
  ['social/instagram/dm.js', '../worker/src/social/instagram/dm.ts'],
  ['social/instagram/probe.js', '../worker/src/social/instagram/probe.ts'],
  ['social/instagram/execute.js', '../worker/src/social/instagram/execute.ts'],
  ['social/instagram/commentSync.js', '../worker/src/social/instagram/commentSync.ts'],
  ['social/instagram/dmSync.js', '../worker/src/social/instagram/dmSync.ts'],
  ['social/inboxSync.js', '../worker/src/social/inboxSync.ts'],
  ['budgetCeilingSave.js', '../src/budgetCeilingSave.ts'],
];
for (const [dest, src] of files) {
  await emit(dest, new URL(src, import.meta.url));
}

const { compareNumericProviderIds, isNewerNumericProviderId, maxNumericProviderIdFrom } = await import(pathToFileURL(`${outDir}/social/providerIds.js`).href);
const { persistExecutionFingerprintOrThrow, buildExecutionFingerprint, parseExecutionFingerprint } = await import(pathToFileURL(`${outDir}/social/fingerprint.js`).href);
const { executeSocialAction } = await import(pathToFileURL(`${outDir}/social/execute.js`).href);
const { persistInstagramCommentEvidence } = await import(pathToFileURL(`${outDir}/social/instagram/persist.js`).href);
const { persistInstagramDmEvidence } = await import(pathToFileURL(`${outDir}/social/instagram/persistDm.js`).href);
const { loadSyncCheckpoint, saveSyncContinuation, commitSyncCheckpoint } = await import(pathToFileURL(`${outDir}/social/syncCheckpoints.js`).href);
const { walkInstagramConversationMessages, instagramDmMapsFromExtra, emptyInstagramDmThreadMaps, instagramDmThreadIsFullyProcessed } = await import(pathToFileURL(`${outDir}/social/instagram/dmSync.js`).href);
const { paginateInstagramMedia, paginateInstagramComments } = await import(pathToFileURL(`${outDir}/social/instagram/commentSync.js`).href);
const { paginateXMentions } = await import(pathToFileURL(`${outDir}/social/x/sync.js`).href);
const { persistServerBudgetCeiling, parseRuntimeBudgetResponse, BUDGET_SAVE_FAILED_MESSAGE } = await import(pathToFileURL(`${outDir}/budgetCeilingSave.js`).href);
const { reserveSyncLease, releaseSyncLease, runWithSourceLease } = await import(pathToFileURL(`${outDir}/syncLease.js`).href);
const { syncSocialInboxIsolated } = await import(pathToFileURL(`${outDir}/social/inboxSync.js`).href);
const { reconcileExecution } = await import(pathToFileURL(`${outDir}/social/reconcile.js`).href);

function fail(message) {
  throw new Error(message);
}

if (compareNumericProviderIds('99', '100') !== -1) fail('BigInt ID compare treated 99 as not less than 100.');
if ('99' > '100') {
  if (isNewerNumericProviderId('99', '100')) fail('Lexical 99>100 leaked into provider ID ordering.');
}
if (!isNewerNumericProviderId('100', '99')) fail('Numeric 100 was not newer than 99.');
if (maxNumericProviderIdFrom(['99', '100', '9']) !== '100') fail('maxNumericProviderIdFrom used lexical sort.');

function executionDb(options = {}) {
  const executions = new Map();
  const actions = new Map();
  const events = new Map();
  const ledger = [];
  const probes = new Map();
  return {
    _executions: executions,
    _actions: actions,
    _events: events,
    _ledger: ledger,
    _probes: probes,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            async first() {
              if (options.failFingerprintRead && normalized.includes('SELECT fingerprint_json')) {
                throw new Error('D1 unavailable');
              }
              if (normalized.includes('FROM social_actions WHERE user_id = ? AND id = ?')) {
                return actions.get(`${params[0]}::${params[1]}`) || null;
              }
              if (normalized.includes('FROM social_events WHERE user_id = ? AND platform = ? AND event_type = ? AND external_event_id = ?')) {
                return events.get(`${params[0]}::${params[1]}::${params[2]}::${params[3]}`) || null;
              }
              if (normalized.includes('FROM instagram_permission_probes WHERE user_id = ?')) {
                return probes.get(params[0]) || null;
              }
              if (normalized.includes('FROM social_executions')) {
                return executions.get(`${params[0]}::${params[1]}`) || null;
              }
              if (normalized.includes('FROM current_usage')) return { used: 0, invalid_count: 0, unassignable_count: 0 };
              return null;
            },
            async run() {
              if (normalized.startsWith('INSERT OR IGNORE INTO social_executions')) {
                const key = `${params[1]}::${params[5]}`;
                if (executions.has(key)) return { meta: { changes: 0 } };
                executions.set(key, {
                  id: params[0], user_id: params[1], action_id: params[2], platform: params[3],
                  operation: params[4], idempotency_key: params[5], external_result_id: params[6],
                  status: params[7], error_code: params[8], created_at: params[9], completed_at: params[10],
                  fingerprint_json: '{}',
                });
                return { meta: { changes: 1 } };
              }
              if (normalized.includes("SET status = 'executing'")) {
                const row = actions.get(`${params[2]}::${params[1]}`);
                if (!row || !['pending', 'ready', 'failed'].includes(row.status)) return { meta: { changes: 0 } };
                row.status = 'executing';
                return { meta: { changes: 1 } };
              }
              if (normalized.includes("SET error_code = 'SENDING'")) {
                const row = executions.get(`${params[0]}::${params[1]}`);
                if (!row || row.status !== 'pending' || row.error_code != null) return { meta: { changes: 0 } };
                row.error_code = 'SENDING';
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('SET fingerprint_json')) {
                if (options.failFingerprintUpdate) throw new Error('D1 fingerprint write failed');
                if (options.fingerprintChanges === 0) return { meta: { changes: 0 } };
                const row = executions.get(`${params[1]}::${params[2]}`);
                if (!row || row.status !== 'pending') return { meta: { changes: 0 } };
                row.fingerprint_json = options.fingerprintMismatch ? '{"tampered":true}' : params[0];
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('UPDATE social_executions SET status = ?')) {
                const row = executions.get(`${params[4]}::${params[5]}`);
                if (!row) return { meta: { changes: 0 } };
                row.status = params[0];
                row.external_result_id = params[1];
                row.error_code = params[2];
                row.completed_at = params[3];
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('SET status = ?, retryable = ?, updated_at = ?')) {
                const row = actions.get(`${params[3]}::${params[4]}`);
                if (row) {
                  row.status = params[0];
                  row.retryable = params[1];
                }
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('SET status = ?, completed_at = ?, updated_at = ?, retryable = 0')) {
                const row = actions.get(`${params[3]}::${params[4]}`);
                if (row) {
                  row.status = params[0];
                  row.completed_at = params[1];
                }
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('INSERT INTO budget_ledger') || normalized.startsWith('WITH')) {
                ledger.push({ id: params[0] || params[3] });
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('DELETE FROM budget_ledger')) return { meta: { changes: 1 } };
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

async function seedIgComment(db) {
  const now = new Date().toISOString();
  db._probes.set('local-user', {
    user_id: 'local-user',
    checked_at: now,
    payload_json: JSON.stringify({
      configured: true,
      tokenValid: true,
      professionalAccount: true,
      readComments: true,
      sendCommentReply: true,
      readDm: false,
      sendDm: false,
      permissionsVerified: true,
      grantedPermissions: ['instagram_business_manage_comments'],
      checkedAt: now,
    }),
    permissions_verified: 1,
  });
  db._events.set('local-user::instagram::comment::111', {
    id: 'ig-comment-111', user_id: 'local-user', platform: 'instagram', event_type: 'comment',
    external_event_id: '111', external_user_id: 'u1',
    payload_json: JSON.stringify({ mediaId: '222', permalink: 'https://instagram.com/p/x', text: 'hi' }),
    occurred_at: now, received_at: now,
  });
  db._actions.set('local-user::sa-ig-comment-111', {
    id: 'sa-ig-comment-111', user_id: 'local-user', platform: 'instagram', candidate_id: 'u1',
    action_type: 'comment_reply', status: 'ready', execution_mode: 'in_app', source: 'instagram_comment',
    external_event_id: '111', conversation_id: null, parent_content_id: '222',
    target_url: 'https://instagram.com/p/x', observed_at: now, created_at: now, updated_at: now,
    completed_at: null, platform_user_id: 'u1', username: 'alice', identity_conflict: 0, retryable: 1,
  });
}

function liveIgEnv(db) {
  return {
    DB: db,
    SOCIAL_WRITE_MODE: '',
    SOCIAL_WRITE_ENABLED: 'true',
    INSTAGRAM_COMMENT_REPLY_ENABLED: 'true',
    INSTAGRAM_COMMENT_REPLY_USD: '0',
    INSTAGRAM_ACCESS_TOKEN: 'token',
    INSTAGRAM_USER_ID: '12345678',
    INSTAGRAM_API_VERSION: 'v24.0',
  };
}

{
  const db = executionDb({ failFingerprintUpdate: true });
  await seedIgComment(db);
  let calls = 0;
  const result = await executeSocialAction(liveIgEnv(db), 'local-user', 'sa-ig-comment-111', {
    executionId: 'exec-fp-fail-1',
    draft: 'thanks',
  }, { replyToInstagramComment: async () => { calls += 1; return { certainty: 'success', externalResultId: 'nope' }; } });
  if (calls !== 0) fail('Fingerprint UPDATE throw still called the provider adapter.');
  if (result.body.certainty === 'success') fail('Fingerprint persist failure was treated as a provider success.');
}

{
  const db = executionDb({ fingerprintChanges: 0 });
  await seedIgComment(db);
  let calls = 0;
  const result = await executeSocialAction(liveIgEnv(db), 'local-user', 'sa-ig-comment-111', {
    executionId: 'exec-fp-zero-1',
    draft: 'thanks',
  }, { replyToInstagramComment: async () => { calls += 1; return { certainty: 'success', externalResultId: 'nope' }; } });
  if (calls !== 0) fail('Fingerprint UPDATE changes=0 still called the provider.');
  if (result.status === 200 && result.body.ok) fail('changes=0 fingerprint persist was treated as saved.');
}

{
  const db = executionDb({ fingerprintMismatch: true });
  await seedIgComment(db);
  let calls = 0;
  await executeSocialAction(liveIgEnv(db), 'local-user', 'sa-ig-comment-111', {
    executionId: 'exec-fp-mismatch-1',
    draft: 'thanks',
  }, { replyToInstagramComment: async () => { calls += 1; return { certainty: 'success', externalResultId: 'nope' }; } });
  if (calls !== 0) fail('Fingerprint re-read mismatch still called the provider.');
}

{
  const db = executionDb({ failFingerprintRead: true });
  await seedIgComment(db);
  let calls = 0;
  await executeSocialAction(liveIgEnv(db), 'local-user', 'sa-ig-comment-111', {
    executionId: 'exec-fp-read-1',
    draft: 'thanks',
  }, { replyToInstagramComment: async () => { calls += 1; return { certainty: 'success', externalResultId: 'nope' }; } });
  if (calls !== 0) fail('D1 unavailable during fingerprint verify still called the provider.');
}

{
  const db = executionDb();
  await seedIgComment(db);
  let calls = 0;
  const result = await executeSocialAction(liveIgEnv(db), 'local-user', 'sa-ig-comment-111', {
    executionId: 'exec-fp-ok-1',
    draft: 'thanks',
  }, { replyToInstagramComment: async () => { calls += 1; return { certainty: 'success', externalResultId: 'r1' }; } });
  if (calls !== 1) fail(`Valid fingerprint must call the provider exactly once, got ${calls}.`);
  if (result.body.certainty !== 'success') fail('Valid fingerprint execute did not succeed.');
  const stored = db._executions.get('local-user::exec-fp-ok-1');
  const parsed = parseExecutionFingerprint(stored.fingerprint_json);
  if (!parsed || parsed.canonicalTargetId !== '111' || parsed.actorId !== '12345678') {
    fail('Durable fingerprint was not the authority stored in D1.');
  }
}

{
  const fp = await buildExecutionFingerprint({
    draft: 'hello',
    canonicalTargetId: '111',
    actorId: 'actor',
    operation: 'instagram_comment_reply',
  });
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async run() { return { meta: { changes: 1 } }; },
            async first() { return { fingerprint_json: JSON.stringify(fp) }; },
          };
        },
      };
    },
  };
  await persistExecutionFingerprintOrThrow(db, 'local-user', 'exec-1', fp);
}

{
  const env = {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return {
                  id: 'ex', user_id: 'local-user', action_id: 'sa-ig-comment-111', platform: 'instagram',
                  operation: 'instagram_comment_reply', idempotency_key: 'exec-no-fp',
                  external_result_id: null, status: 'pending', error_code: 'UNKNOWN_RESULT',
                  created_at: '2026-08-30T12:00:00.000Z', completed_at: null, reservation_id: null,
                  result_metadata_json: JSON.stringify({ canonicalTargetId: '111', operation: 'instagram_comment_reply', preparedAt: '2026-08-30T12:00:00.000Z' }),
                  fingerprint_json: '{}',
                };
              },
            };
          },
        };
      },
    },
    SOCIAL_WRITE_MODE: '',
    SOCIAL_RECONCILE_READ_USD: '0',
    INSTAGRAM_ACCESS_TOKEN: 't',
    INSTAGRAM_USER_ID: '1',
    INSTAGRAM_API_VERSION: 'v24.0',
  };
  let providerReads = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    providerReads += 1;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  try {
    const result = await reconcileExecution(env, 'local-user', 'exec-no-fp');
    if (providerReads !== 0) fail('UNKNOWN reconciliation ran a provider read without a durable fingerprint.');
    if (result.body.code !== 'UNKNOWN_RESULT') fail('Missing fingerprint did not stay UNKNOWN.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const savedOk = parseRuntimeBudgetResponse({ monthlyBudgetCeilingUsd: 1, serverHardLimitUsd: 3, effectiveLimitUsd: 1 });
if (!savedOk.ok || savedOk.effectiveLimitUsd !== 1) fail('Valid budget PUT response was rejected.');
const raised = parseRuntimeBudgetResponse({ monthlyBudgetCeilingUsd: 5, serverHardLimitUsd: 3, effectiveLimitUsd: 3 });
if (!raised.ok || raised.effectiveLimitUsd !== 3) fail('HARD LIMIT clamp $5→$3 was not accepted.');
if (parseRuntimeBudgetResponse({ monthlyBudgetCeilingUsd: 5, serverHardLimitUsd: 3, effectiveLimitUsd: 5 }).ok) {
  fail('Server claiming effective $5 above HARD LIMIT $3 was accepted.');
}
if (parseRuntimeBudgetResponse(null).ok) fail('Malformed budget response was accepted.');
{
  const failed = await persistServerBudgetCeiling({
    requestedUsd: 1,
    putRuntimeSettings: async () => { throw new Error('PUT 500'); },
  });
  if (failed.ok) fail('PUT failure was treated as saved.');
  if (failed.reason !== BUDGET_SAVE_FAILED_MESSAGE) fail('PUT failure used a silent or generic success path.');
}
{
  const timedOut = await persistServerBudgetCeiling({
    requestedUsd: 1,
    putRuntimeSettings: async () => { throw new Error('timeout'); },
  });
  if (timedOut.ok) fail('Timeout was treated as budget saved.');
}
{
  const malformed = await persistServerBudgetCeiling({
    requestedUsd: 1,
    putRuntimeSettings: async () => ({ ok: true }),
  });
  if (malformed.ok) fail('Malformed success JSON was treated as budget saved.');
}
{
  const ok = await persistServerBudgetCeiling({
    requestedUsd: 1,
    putRuntimeSettings: async () => ({ monthlyBudgetCeilingUsd: 1, serverHardLimitUsd: 3, effectiveLimitUsd: 1 }),
  });
  if (!ok.ok || ok.effectiveLimitUsd !== 1) fail('Successful PUT was not accepted as saved.');
}

function messagePages() {
  const pages = {
    '': { data: [{ id: '106', created_time: '2026-08-30T12:06:00.000Z', from: { id: 'u9' }, message: 'p1' }], paging: { cursors: { after: 'c2' } } },
    c2: { data: [{ id: '105', created_time: '2026-08-30T12:05:00.000Z', from: { id: 'u9' }, message: 'p2' }], paging: { cursors: { after: 'c3' } } },
    c3: { data: [{ id: '104', created_time: '2026-08-30T12:04:00.000Z', from: { id: 'u9' }, message: 'p3' }], paging: { cursors: { after: 'c4' } } },
    c4: { data: [{ id: '103', created_time: '2026-08-30T12:03:00.000Z', from: { id: 'u9' }, message: 'p4' }], paging: { cursors: { after: 'c5' } } },
    c5: { data: [{ id: '102', created_time: '2026-08-30T12:02:00.000Z', from: { id: 'u9' }, message: 'p5' }], paging: { cursors: { after: 'c6' } } },
    c6: { data: [{ id: '101', created_time: '2026-08-30T12:01:00.000Z', from: { id: 'u9' }, message: 'p6' }], paging: { cursors: {} } },
  };
  return pages;
}

{
  const pages = messagePages();
  let maps = emptyInstagramDmThreadMaps();
  const run1 = await walkInstagramConversationMessages({
    conversationId: '888',
    updatedTime: '2026-08-30T12:06:00.000Z',
    maps,
    igUserId: '1',
    receivedAt: '2026-08-30T12:10:00.000Z',
    version: 'v24.0',
    maxMessagePages: 4,
    getJson: async (url) => {
      const after = new URL(url).searchParams.get('after') || '';
      return pages[after];
    },
  });
  if (run1.threadComplete) fail('6-page DM thread was marked complete after 4 pages.');
  if (!run1.continuationCursor) fail('Incomplete DM thread did not persist a message cursor.');
  if (instagramDmThreadIsFullyProcessed(run1.maps, '888', '2026-08-30T12:06:00.000Z')) {
    fail('Incomplete DM thread was marked fully processed.');
  }
  if (run1.maps.conversationUpdatedTime['888']) fail('Incomplete thread committed updated_time.');
  if (run1.maps.conversationNewestMessageId['888']) fail('Incomplete thread replaced the committed newest boundary.');
  maps = run1.maps;
  const run2 = await walkInstagramConversationMessages({
    conversationId: '888',
    updatedTime: '2026-08-30T12:06:00.000Z',
    maps,
    igUserId: '1',
    receivedAt: '2026-08-30T12:11:00.000Z',
    version: 'v24.0',
    maxMessagePages: 4,
    getJson: async (url) => {
      const after = new URL(url).searchParams.get('after') || '';
      if (!after) fail('Run2 restarted from newest instead of resuming the cursor.');
      return pages[after];
    },
  });
  if (!run2.threadComplete) fail('Run2 did not finish the remaining DM pages.');
  if (run2.maps.conversationMessageCursor['888']) fail('Completed thread kept a message cursor.');
  if (run2.maps.conversationNewestMessageId['888'] !== '106') fail('Completed thread did not commit pending newest.');
}

{
  const pages = messagePages();
  const crash = await walkInstagramConversationMessages({
    conversationId: '888',
    updatedTime: '2026-08-30T12:06:00.000Z',
    maps: emptyInstagramDmThreadMaps(),
    igUserId: '1',
    receivedAt: '2026-08-30T12:10:00.000Z',
    version: 'v24.0',
    maxMessagePages: 2,
    getJson: async (url) => pages[new URL(url).searchParams.get('after') || ''],
  });
  if (crash.threadComplete) fail('Crash after page2 marked the thread complete.');
  const resume = await walkInstagramConversationMessages({
    conversationId: '888',
    updatedTime: '2026-08-30T12:06:00.000Z',
    maps: crash.maps,
    igUserId: '1',
    receivedAt: '2026-08-30T12:12:00.000Z',
    version: 'v24.0',
    maxMessagePages: 8,
    getJson: async (url) => pages[new URL(url).searchParams.get('after') || ''],
  });
  if (!resume.threadComplete) fail('Crash recovery did not complete the DM backlog.');
}

{
  const maps = instagramDmMapsFromExtra({
    conversationMessageCursor: { '888': 'c4' },
    conversationPendingNewestId: { '888': '106' },
  });
  const during = await walkInstagramConversationMessages({
    conversationId: '888',
    updatedTime: '2026-08-30T12:07:00.000Z',
    maps,
    igUserId: '1',
    receivedAt: '2026-08-30T12:13:00.000Z',
    version: 'v24.0',
    maxMessagePages: 8,
    getJson: async (url) => messagePages()[new URL(url).searchParams.get('after') || ''],
  });
  if (during.maps.conversationUpdatedTime['888'] === '2026-08-30T12:07:00.000Z') {
    fail('New DM during backlog committed updated_time and would skip the new message.');
  }
  if (during.maps.conversationNewestMessageId['888'] && during.maps.conversationNewestMessageId['888'] !== '106') {
    fail('Backlog completion overwrote pending newest with an older page id.');
  }
}

{
  const ceiling = await walkInstagramConversationMessages({
    conversationId: '888',
    updatedTime: '2026-08-30T12:06:00.000Z',
    maps: emptyInstagramDmThreadMaps(),
    igUserId: '1',
    receivedAt: '2026-08-30T12:10:00.000Z',
    version: 'v24.0',
    maxMessagePages: 8,
    getJson: async (url) => {
      const after = new URL(url).searchParams.get('after') || '';
      if (after === 'c2') throw new Error('Instagram Graph API returned 400: This message has been deleted');
      return messagePages()[after];
    },
  });
  if (!ceiling.threadComplete) fail('Meta 20-message detail ceiling did not complete the readable window.');
  if (ceiling.continuationCursor) fail('Unavailable older DM details left a resume cursor that cannot succeed.');
  if (!ceiling.events.some((event) => event.externalEventId === '106')) fail('Readable newest DM was dropped at the provider detail ceiling.');
}

{
  const maps = emptyInstagramDmThreadMaps();
  maps.conversationUpdatedTime.a = 't1';
  maps.conversationNewestMessageId.a = '9';
  if (!instagramDmThreadIsFullyProcessed(maps, 'a', 't1')) fail('Completed conversation was not skippable.');
  maps.conversationMessageCursor.b = 'c1';
  maps.conversationNewestMessageId.b = '1';
  maps.conversationUpdatedTime.b = 't2';
  if (instagramDmThreadIsFullyProcessed(maps, 'b', 't2')) fail('Incomplete conversation among mixed threads was marked processed.');
}

{
  const mediaPages = {
    none: {
      data: Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1), timestamp: `2026-08-30T12:0${index}:00.000Z` })),
      paging: { cursors: { after: 'page2' } },
    },
    page2: {
      data: Array.from({ length: 8 }, (_, index) => ({ id: String(index + 9), timestamp: `2026-08-29T12:0${index}:00.000Z` })),
      paging: { cursors: {} },
    },
  };
  const walked = await paginateInstagramMedia({
    version: 'v24.0',
    igUserId: '1',
    token: 't',
    webhookConfigured: false,
    getJson: async (url) => {
      const after = new URL(url).searchParams.get('after') || 'none';
      return mediaPages[after];
    },
  });
  if (!walked.media.some((item) => item.id === '9')) fail('Comment poll did not process media page 2.');
  if (walked.media.length < 16) fail('Media pagination dropped page2 items.');
}

{
  const resumed = await paginateInstagramMedia({
    version: 'v24.0',
    igUserId: '1',
    token: 't',
    mediaAfter: 'page2',
    webhookConfigured: false,
    getJson: async (url) => {
      const after = new URL(url).searchParams.get('after');
      if (after === 'page2') return { data: [{ id: '99' }], paging: { cursors: {} } };
      return { data: [{ id: '1' }], paging: { cursors: { after: 'page2' } } };
    },
  });
  if (!resumed.media.some((item) => item.id === '99')) fail('Media cursor resume dropped older media.');
}

{
  const comments = await paginateInstagramComments({
    version: 'v24.0',
    mediaId: '88',
    token: 't',
    knownCommentId: 'c1',
    permalink: null,
    receivedAt: '2026-08-30T12:00:00.000Z',
    getJson: async () => ({
      data: [
        { id: 'c2', from: { id: 'u1', username: 'a' }, text: 'new', timestamp: '2026-08-30T12:00:00.000Z' },
        { id: 'c1', from: { id: 'u1', username: 'a' }, text: 'old', timestamp: '2026-08-29T12:00:00.000Z' },
      ],
    }),
  });
  if (!comments.reachedKnown) fail('Old media comment catch-up did not stop at the known boundary.');
}

function checkpointDb(options = {}) {
  const rows = new Map();
  return {
    _rows: rows,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            async first() {
              if (options.failQuery) throw new Error('no such table: social_sync_checkpoints');
              if (normalized.includes('FROM social_sync_checkpoints')) {
                return rows.get(`${params[0]}::${params[1]}`) || null;
              }
              return null;
            },
            async run() {
              if (options.failWrite) throw new Error('D1 write failed');
              const key = `${params[0]}::${params[1]}`;
              rows.set(key, {
                user_id: params[0],
                source: params[1],
                newest_seen_id: params[2],
                continuation_cursor: params[3],
                extra_json: params[4],
                committed_at: params[5],
                updated_at: params[6],
              });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

{
  const db = checkpointDb();
  const loaded = await loadSyncCheckpoint(db, 'local-user', 'x_dm');
  if (!loaded.available || loaded.checkpoint !== null) fail('Missing checkpoint row was not treated as first sync.');
}

{
  const db = checkpointDb({ failQuery: true });
  const loaded = await loadSyncCheckpoint(db, 'local-user', 'x_dm');
  if (loaded.available) fail('Checkpoint table query error was treated as no checkpoint.');
}

{
  const db = checkpointDb({ failWrite: true });
  const saved = await saveSyncContinuation(db, 'local-user', 'instagram_dm', 'cursor-1', {});
  if (saved.ok) fail('Continuation save failure was claimed successful.');
}

{
  const db = checkpointDb({ failWrite: true });
  const committed = await commitSyncCheckpoint(db, 'local-user', 'instagram_comments_poll', '9', {});
  if (committed.ok) fail('Checkpoint persist failure claimed checkpointComplete.');
}

function leaseMemory() {
  const rows = new Map();
  return {
    _rows: rows,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            async run() {
              if (normalized.startsWith('INSERT INTO budget_ledger')) {
                const id = params[0];
                const owner = params[2];
                const now = params[3];
                const cutoff = params[4];
                const existing = rows.get(id);
                if (!existing) {
                  rows.set(id, { owner, occurred_at: now });
                  return { meta: { changes: 1 } };
                }
                if (existing.occurred_at < cutoff) {
                  rows.set(id, { owner, occurred_at: now });
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (normalized.startsWith('DELETE FROM budget_ledger')) {
                const existing = rows.get(params[0]);
                if (existing && existing.owner === params[1]) {
                  rows.delete(params[0]);
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

{
  const db = leaseMemory();
  let xDmRuns = 0;
  let igRuns = 0;
  const foreground = runWithSourceLease(db, 'local-user', 'x_dm_sync', 60_000, async () => {
    xDmRuns += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { status: 'success', events: [1] };
  });
  const cron = await runWithSourceLease(db, 'local-user', 'x_dm_sync', 60_000, async () => {
    xDmRuns += 1;
    return { status: 'success', events: [2] };
  });
  const comments = await runWithSourceLease(db, 'local-user', 'instagram_comments_sync', 60_000, async () => {
    igRuns += 1;
    return { status: 'success', events: [3] };
  });
  await foreground;
  if (xDmRuns !== 1) fail(`Foreground and cron x_dm both executed (${xDmRuns}).`);
  if (cron.skippedDueToLock !== true) fail('Second x_dm source lock did not skip.');
  if (igRuns !== 1 || comments.status !== 'success') fail('x_dm lock blocked Instagram comments.');
}

{
  const db = leaseMemory();
  let runs = 0;
  const unified = runWithSourceLease(db, 'local-user', 'x_dm_sync', 60_000, async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { status: 'success' };
  });
  const direct = await runWithSourceLease(db, 'local-user', 'x_dm_sync', 60_000, async () => {
    runs += 1;
    return { status: 'success' };
  });
  await unified;
  if (runs !== 1 || direct.skippedDueToLock !== true) fail('Direct x_dm and unified sync both executed.');
}

{
  const db = leaseMemory();
  const first = await reserveSyncLease(db, 'local-user', 'x_mentions_sync', 60_000);
  if (!first.ok) fail('First source lease was denied.');
  db._rows.get(first.lease.id).occurred_at = '2000-01-01T00:00:00.000Z';
  const takeover = await reserveSyncLease(db, 'local-user', 'x_mentions_sync', 60_000);
  if (!takeover.ok) fail('Stale lease could not be taken over.');
  await releaseSyncLease(db, first.lease);
  if (!db._rows.has(takeover.lease.id)) fail('Old owner deleted the new lease.');
}

{
  const db = leaseMemory();
  let mentions = 0;
  let dms = 0;
  await syncSocialInboxIsolated({ DB: db }, {}, {
    syncXInboundMentions: async () => { mentions += 1; return { status: 'success', events: [] }; },
    syncXDirectMessages: async () => { dms += 1; return { status: 'success', events: [] }; },
    syncInstagramComments: async () => ({ status: 'success', events: [] }),
    syncInstagramDirectMessages: async () => ({ status: 'success', events: [] }),
  });
  if (mentions !== 1 || dms !== 1) fail('Unified inbox did not run isolated sources under source leases.');
}

{
  const mentionTweet = (id) => ({ id, text: 'p', author_id: '9', created_at: '2026-08-30T12:00:00.000Z', conversation_id: id });
  const walked = await paginateXMentions({
    accountId: '42',
    maxResults: 100,
    maxPages: 2,
    receivedAt: '2026-08-30T12:00:00.000Z',
    getJson: async (url) => {
      const parsed = new URL(url);
      if (parsed.searchParams.get('pagination_token') === 'p2') {
        return { data: [mentionTweet('99')], includes: { users: [{ id: '9', username: 'bob' }] }, meta: {} };
      }
      return { data: [mentionTweet('100')], includes: { users: [{ id: '9', username: 'bob' }] }, meta: { next_token: 'p2' } };
    },
  });
  if (walked.newestId !== '100') fail(`Lexical ID bug survived: newestId=${walked.newestId}`);
}

console.log('Final manual-only closure tests OK: durable fingerprint, budget authority, Instagram DM/comment checkpoints, source locks, checkpoint fail-closed, numeric IDs.');
