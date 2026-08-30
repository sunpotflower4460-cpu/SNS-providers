import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = '/tmp/sns-providers-server-execute-tests';
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

await emit('budgetIntegrity.js', new URL('../worker/src/budgetIntegrity.ts', import.meta.url));
await emit('fetchWithTimeout.js', new URL('../worker/src/fetchWithTimeout.ts', import.meta.url));
await emit('social/types.js', new URL('../worker/src/social/types.ts', import.meta.url));
await emit('social/ids.js', new URL('../worker/src/social/ids.ts', import.meta.url));
await emit('social/capabilities.js', new URL('../worker/src/social/capabilities.ts', import.meta.url));
await emit('social/executeGuard.js', new URL('../worker/src/social/executeGuard.ts', import.meta.url));
await emit('social/repository.js', new URL('../worker/src/social/repository.ts', import.meta.url));
await emit('social/execute.js', new URL('../worker/src/social/execute.ts', import.meta.url));
await emit('social/instagram/inbound.js', new URL('../worker/src/social/instagram/inbound.ts', import.meta.url));
await emit('social/instagram/execute.js', new URL('../worker/src/social/instagram/execute.ts', import.meta.url));
await emit('social/instagram/persist.js', new URL('../worker/src/social/instagram/persist.ts', import.meta.url));
await emit('social/x/inbound.js', new URL('../worker/src/social/x/inbound.ts', import.meta.url));
await emit('social/x/persist.js', new URL('../worker/src/social/x/persist.ts', import.meta.url));
await emit('social/x/execute.js', new URL('../worker/src/social/x/execute.ts', import.meta.url));
await emit('syncLease.js', new URL('../worker/src/syncLease.ts', import.meta.url));
await emit('xOAuth.js', new URL('../worker/src/xOAuth.ts', import.meta.url));

const { executeSocialAction, executionBindingsConflict, knownWriteCost } = await import(pathToFileURL(`${outDir}/social/execute.js`).href);
const { assertExecutable, parseExecuteBody } = await import(pathToFileURL(`${outDir}/social/executeGuard.js`).href);
const { persistInstagramCommentEvidence } = await import(pathToFileURL(`${outDir}/social/instagram/persist.js`).href);
const { persistXInboundEvidence } = await import(pathToFileURL(`${outDir}/social/x/persist.js`).href);
const { normalizeXInboundEvents } = await import(pathToFileURL(`${outDir}/social/x/inbound.js`).href);
const { liveInstagramCapabilities, liveXCapabilities, INSTAGRAM_PROFESSIONAL_CAPABILITIES, DISABLED_SOCIAL_CAPABILITIES } = await import(pathToFileURL(`${outDir}/social/capabilities.js`).href);
const { replyToXTweet } = await import(pathToFileURL(`${outDir}/social/x/execute.js`).href);
const { instagramCommentEvent } = await import(pathToFileURL(`${outDir}/social/instagram/inbound.js`).href);

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
              if (normalized.includes('FROM current_usage') && normalized.includes('timestamp_integrity')) {
                return { used: 0, invalid_count: 0, unassignable_count: 0 };
              }
              return null;
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
                };
                const existing = actions.get(actionKey(row.user_id, row.id));
                if (existing && ['completed', 'executing', 'dismissed', 'expired'].includes(existing.status)) {
                  return { meta: { changes: 0 } };
                }
                actions.set(actionKey(row.user_id, row.id), { ...(existing || {}), ...row });
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('INSERT OR IGNORE INTO social_executions')) {
                const key = execKey(params[1], params[5]);
                if (executions.has(key)) return { meta: { changes: 0 } };
                executions.set(key, {
                  id: params[0], user_id: params[1], action_id: params[2], platform: params[3],
                  operation: params[4], idempotency_key: params[5], external_result_id: params[6],
                  status: params[7], error_code: params[8], created_at: params[9], completed_at: params[10],
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
              if (normalized.includes("SET status = 'executing'")) {
                const row = actions.get(actionKey(params[2], params[1]));
                if (!row) return { meta: { changes: 0 } };
                if (!['pending', 'ready', 'failed'].includes(row.status)) return { meta: { changes: 0 } };
                if (row.status === 'failed' && Number(row.retryable) === 0) return { meta: { changes: 0 } };
                row.status = 'executing';
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

const now = '2026-08-30T12:00:00.000Z';
const commentEvent = instagramCommentEvent({
  latestCommentId: '111',
  mediaId: '456',
  lastCommentText: '好きです',
  lastCommentAt: now,
  latestMediaPermalink: 'https://www.instagram.com/p/AbCdef12345/',
  engagerId: '789',
  username: 'alice',
}, now);

function canonicalAction(overrides = {}) {
  return {
    id: 'sa-ig-comment-111',
    userId: 'local-user',
    platform: 'instagram',
    candidateId: '789',
    type: 'comment_reply',
    status: 'ready',
    executionMode: 'in_app',
    source: 'instagram_comment',
    externalEventId: '111',
    parentContentId: '456',
    targetUrl: 'https://www.instagram.com/p/AbCdef12345/',
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    platformUserId: '789',
    username: 'alice',
    identityConflict: false,
    retryable: true,
    ...overrides,
  };
}

function contextFor(action, event, draft = 'ありがとう') {
  return {
    executionId: 'exec-abc-12',
    draft,
    action,
    candidate: {
      id: action.candidateId,
      platform: action.platform,
      platformUserId: action.platformUserId,
      username: action.username || '',
      identityConflict: action.identityConflict,
    },
    event,
  };
}

function eventRow(dbEvent = commentEvent) {
  return {
    id: dbEvent.id,
    userId: 'local-user',
    platform: 'instagram',
    type: 'comment',
    externalEventId: dbEvent.externalEventId,
    externalUserId: dbEvent.externalUserId,
    payload: {
      text: dbEvent.text,
      mediaId: dbEvent.parentContentId,
      permalink: dbEvent.permalink,
      lastCommentText: dbEvent.text,
      latestCommentId: dbEvent.externalEventId,
      latestMediaPermalink: dbEvent.permalink,
    },
    occurredAt: dbEvent.occurredAt,
    receivedAt: dbEvent.receivedAt,
  };
}

const parsed = parseExecuteBody({ executionId: 'exec-abc-12', draft: 'ありがとう' });
if ('ok' in parsed && parsed.ok === false) fail(parsed.reason);

const blockedCompleted = assertExecutable(contextFor(canonicalAction({ status: 'completed' }), eventRow()), INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedCompleted.ok || blockedCompleted.code !== 'COMPLETED') fail('Completed action was executable.');
const blockedExpired = assertExecutable(contextFor(canonicalAction({ status: 'expired' }), eventRow()), INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedExpired.ok || blockedExpired.code !== 'EXPIRED') fail('Expired action was executable.');
const blockedSnoozed = assertExecutable(contextFor(canonicalAction({ status: 'snoozed' }), eventRow()), INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedSnoozed.ok || blockedSnoozed.code !== 'INVALID_ACTION') fail('Snoozed action was executable.');
const blockedExecuting = assertExecutable(contextFor(canonicalAction({ status: 'executing' }), eventRow()), INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedExecuting.ok || blockedExecuting.code !== 'ALREADY_EXECUTED') fail('Executing action was executable.');
const blockedHandoff = assertExecutable(contextFor(canonicalAction({ executionMode: 'handoff' }), eventRow()), DISABLED_SOCIAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedHandoff.ok || blockedHandoff.code !== 'HANDOFF_NOT_EXECUTABLE') fail('HANDOFF action called provider write.');
const blockedConflict = assertExecutable(contextFor(canonicalAction({ identityConflict: true }), eventRow()), INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedConflict.ok || blockedConflict.code !== 'IDENTITY_CONFLICT') fail('Identity conflict did not block execution.');
const blockedRetry = assertExecutable(contextFor(canonicalAction({ status: 'failed', retryable: false }), eventRow()), INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedRetry.ok || blockedRetry.code !== 'RETRY_NOT_SAFE') fail('Non-retryable failure was executable.');
const missingComment = assertExecutable(contextFor(canonicalAction(), null), INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (missingComment.ok || missingComment.code !== 'BINDING_MISMATCH') fail('Missing comment evidence was executable.');
const bulk = parseExecuteBody({ executionId: 'exec-abc-12', actions: [{ id: 'x' }] });
if (!('ok' in bulk) || bulk.ok !== false) fail('Bulk execute body was accepted.');
const ignoredClientTarget = parseExecuteBody({
  executionId: 'exec-abc-12',
  draft: 'ありがとう',
  action: { platform: 'x', candidateId: 'evil', externalEventId: '999', type: 'follow' },
  candidate: { id: 'evil', platform: 'x' },
});
if ('ok' in ignoredClientTarget && ignoredClientTarget.ok === false) fail('Minimal execute body with extra client targeting fields was rejected.');
if (ignoredClientTarget.draft !== 'ありがとう') fail('User-approved draft was not kept.');

if (knownWriteCost({}, 'instagram_comment_reply') != null) fail('Missing Instagram reply price was treated as known.');
if (knownWriteCost({ INSTAGRAM_COMMENT_REPLY_USD: '0' }, 'instagram_comment_reply') !== 0) fail('Explicit zero Instagram reply price was not accepted as documented non-billable.');
if (knownWriteCost({ X_REPLY_WRITE_USD: '0' }, 'x_reply_write') != null) fail('Zero X reply price was treated as billable-known.');

const capsOff = liveInstagramCapabilities({
  INSTAGRAM_ACCESS_TOKEN: 'token',
  INSTAGRAM_USER_ID: '12345678',
  INSTAGRAM_API_VERSION: 'v24.0',
});
if (capsOff.sendCommentReply) fail('Instagram write capability was inferred from platform configuration alone.');
const capsOn = liveInstagramCapabilities({
  INSTAGRAM_ACCESS_TOKEN: 'token',
  INSTAGRAM_USER_ID: '12345678',
  INSTAGRAM_API_VERSION: 'v24.0',
  SOCIAL_WRITE_ENABLED: 'true',
  INSTAGRAM_COMMENT_REPLY_ENABLED: 'true',
});
if (!capsOn.sendCommentReply) fail('Enabled Instagram comment reply capability was not live.');

const xCapsOff = liveXCapabilities({ SOCIAL_WRITE_ENABLED: 'true' }, ['tweet.read', 'users.read', 'follows.read', 'offline.access', 'tweet.write']);
if (xCapsOff.sendReply) fail('X sendReply was inferred from tweet.write without X_REPLY_WRITE_ENABLED.');
const xCapsOn = liveXCapabilities({
  SOCIAL_WRITE_ENABLED: 'true',
  X_REPLY_WRITE_ENABLED: 'true',
}, ['tweet.read', 'users.read', 'follows.read', 'offline.access', 'tweet.write']);
if (!xCapsOn.sendReply) fail('Enabled X reply capability was not live.');
if (xCapsOn.follow || xCapsOn.sendDm || xCapsOn.unfollow) fail('Live X follow/DM writes were enabled.');
const xCapsNoScope = liveXCapabilities({
  SOCIAL_WRITE_ENABLED: 'true',
  X_REPLY_WRITE_ENABLED: 'true',
}, ['tweet.read', 'users.read', 'follows.read', 'offline.access']);
if (xCapsNoScope.sendReply) fail('X sendReply was enabled without tweet.write.');

async function seedInstagram(db) {
  await persistInstagramCommentEvidence(db, 'local-user', [{
    id: '789',
    username: 'alice',
    lastCommentText: '好きです',
    lastCommentAt: now,
    latestCommentId: '111',
    mediaId: '456',
    latestMediaPermalink: 'https://www.instagram.com/p/AbCdef12345/',
  }], now, 'in_app');
}

const providerCalls = [];
const fakeReply = async (input) => {
  providerCalls.push(input);
  return { certainty: 'success', externalResultId: 'reply-1', providerStatus: '200' };
};

const envBase = () => ({
  DB: createMemoryD1(),
  SOCIAL_WRITE_MODE: 'test',
  INSTAGRAM_COMMENT_REPLY_USD: '0',
  INSTAGRAM_ACCESS_TOKEN: 'token',
  INSTAGRAM_USER_ID: '12345678',
  INSTAGRAM_API_VERSION: 'v24.0',
});

{
  const env = envBase();
  await seedInstagram(env.DB);
  const tampered = {
    executionId: 'exec-same-01',
    draft: 'ありがとう',
    action: {
      id: 'sa-ig-comment-111',
      platform: 'x',
      candidateId: 'other-person',
      type: 'follow',
      externalEventId: '999',
      targetUrl: 'https://x.com/evil/status/1',
    },
    candidate: { id: 'other-person', platform: 'x' },
  };
  const result = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', tampered, { replyToInstagramComment: fakeReply });
  if (result.status !== 200 || result.body.status !== 'succeeded') fail(`Server-authoritative execute failed: ${JSON.stringify(result.body)}`);
  const replay = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', tampered, { replyToInstagramComment: fakeReply });
  if (!replay.body.idempotent || replay.body.externalResultId !== 'test-exec-same-01') fail('Idempotent recovery did not return the previous result.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.INSTAGRAM_COMMENT_REPLY_ENABLED = 'true';
  await seedInstagram(env.DB);
  providerCalls.length = 0;
  const result = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', {
    executionId: 'exec-live-01',
    draft: 'ありがとう',
    action: { platform: 'x', candidateId: 'evil', externalEventId: '999', targetUrl: 'https://x.com/evil' },
  }, { replyToInstagramComment: fakeReply });
  if (result.status !== 200 || result.body.certainty !== 'success') fail(`Live Instagram execute failed: ${JSON.stringify(result.body)}`);
  if (providerCalls.length !== 1 || providerCalls[0].commentId !== '111') fail('Provider write did not target the canonical comment id.');
  if (providerCalls[0].message !== 'ありがとう') fail('Provider write did not use the user-approved draft.');
  const retry = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', {
    executionId: 'exec-live-01',
    draft: '別の文',
  }, { replyToInstagramComment: fakeReply });
  if (providerCalls.length !== 1) fail('Network retry duplicated the provider write.');
  if (!retry.body.idempotent) fail('Retry with the same executionId was not recovered.');
}

{
  const env = envBase();
  await seedInstagram(env.DB);
  const unknown = await executeSocialAction(env, 'local-user', 'sa-missing', { executionId: 'exec-miss-01', draft: 'x' });
  if (unknown.status !== 404 || unknown.body.code !== 'NOT_FOUND') fail('Unknown actionId was executable.');
  const otherUser = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', { executionId: 'exec-other-01', draft: 'x' });
  // same deployment user namespace; simulate another identity by seeding under a different user
  await persistInstagramCommentEvidence(env.DB, 'other-user', [{
    id: '789', username: 'alice', lastCommentText: '好きです', lastCommentAt: now,
    latestCommentId: '222', mediaId: '456', latestMediaPermalink: 'https://www.instagram.com/p/AbCdef12345/',
  }], now, 'in_app');
  const stolen = await executeSocialAction(env, 'local-user', 'sa-ig-comment-222', { executionId: 'exec-steal-01', draft: 'x' });
  if (stolen.status !== 404) fail('Action belonging to another identity was executable.');
  if (otherUser.status === 404) fail('Canonical local-user action was not found.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.INSTAGRAM_COMMENT_REPLY_ENABLED = 'true';
  await seedInstagram(env.DB);
  providerCalls.length = 0;
  const first = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', { executionId: 'exec-bind-01', draft: 'one' }, { replyToInstagramComment: fakeReply });
  if (first.status !== 200) fail('First execute for binding test failed.');
  await persistInstagramCommentEvidence(env.DB, 'local-user', [{
    id: '789', username: 'alice', lastCommentText: '別', lastCommentAt: now,
    latestCommentId: '333', mediaId: '456', latestMediaPermalink: 'https://www.instagram.com/p/AbCdef12345/',
  }], now, 'in_app');
  const conflict = await executeSocialAction(env, 'local-user', 'sa-ig-comment-333', { executionId: 'exec-bind-01', draft: 'two' }, { replyToInstagramComment: fakeReply });
  if (conflict.status !== 409 || conflict.body.code !== 'BINDING_MISMATCH') fail('Reused executionId across actions was not a conflict.');
  if (providerCalls.length !== 1) fail('Binding conflict still invoked the provider.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.INSTAGRAM_COMMENT_REPLY_ENABLED = 'true';
  await seedInstagram(env.DB);
  let calls = 0;
  const countingReply = async (input) => {
    calls += 1;
    return fakeReply(input);
  };
  const a = executeSocialAction(env, 'local-user', 'sa-ig-comment-111', { executionId: 'exec-conc-01', draft: 'hi' }, { replyToInstagramComment: countingReply });
  const b = executeSocialAction(env, 'local-user', 'sa-ig-comment-111', { executionId: 'exec-conc-01', draft: 'hi' }, { replyToInstagramComment: countingReply });
  const results = await Promise.all([a, b]);
  if (calls > 1) fail('Concurrent duplicate requests created more than one provider operation.');
  if (!results.some((item) => item.body?.status === 'succeeded' || item.body?.idempotent || item.body?.code === 'ALREADY_EXECUTED')) {
    fail('Concurrent execute did not succeed or serialize.');
  }
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  delete env.INSTAGRAM_COMMENT_REPLY_ENABLED;
  await seedInstagram(env.DB);
  providerCalls.length = 0;
  const denied = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', { executionId: 'exec-cap-01', draft: 'x' }, { replyToInstagramComment: fakeReply });
  if (denied.body.code !== 'CAPABILITY_DENIED' && denied.body.code !== 'WRITE_DISABLED') fail('Capability false still wrote.');
  if (providerCalls.length !== 0) fail('Capability false reached the provider.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.INSTAGRAM_COMMENT_REPLY_ENABLED = 'true';
  delete env.INSTAGRAM_COMMENT_REPLY_USD;
  await seedInstagram(env.DB);
  providerCalls.length = 0;
  const unknownCost = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', { executionId: 'exec-cost-01', draft: 'x' }, { replyToInstagramComment: fakeReply });
  if (unknownCost.body.code !== 'WRITE_COST_UNKNOWN') fail('Unknown write price did not fail closed.');
  if (providerCalls.length !== 0) fail('Unknown write price reached the provider.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.INSTAGRAM_COMMENT_REPLY_ENABLED = 'true';
  await seedInstagram(env.DB);
  const failed = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', { executionId: 'exec-fail-01', draft: 'x' }, {
    replyToInstagramComment: async () => ({ certainty: 'failure', retryable: false, errorCode: 'INVALID_ACTION', reason: 'provider 400' }),
  });
  if (failed.body.certainty === 'success' || failed.status === 200) fail('Provider failure was finalized as success.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.INSTAGRAM_COMMENT_REPLY_ENABLED = 'true';
  await seedInstagram(env.DB);
  const unknown = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', { executionId: 'exec-unk-01', draft: 'x' }, {
    replyToInstagramComment: async () => ({ certainty: 'unknown', retryable: false, errorCode: 'UNKNOWN_RESULT', reason: 'lost' }),
  });
  if (unknown.body.code !== 'UNKNOWN_RESULT') fail(`Unknown provider result was not preserved: ${JSON.stringify(unknown.body)}`);
  const again = await executeSocialAction(env, 'local-user', 'sa-ig-comment-111', { executionId: 'exec-unk-01', draft: 'x' }, {
    replyToInstagramComment: async () => ({ certainty: 'success', externalResultId: 'should-not' }),
  });
  if (again.body.code !== 'UNKNOWN_RESULT') fail('Unknown result was blindly retried.');
  if (again.body.externalResultId === 'should-not') fail('Unknown result replay invoked a new provider success.');
}

{
  const events = normalizeXInboundEvents([
    { id: '101', text: 'same', author_id: '1', created_at: now },
    { id: '101', text: 'dup', author_id: '1', created_at: now },
    { id: '202', text: 'same', author_id: '1', created_at: now },
  ], [{ id: '1', username: 'bob' }], now);
  if (events.length !== 2) fail('Duplicate tweet IDs did not collapse, or same text with different IDs did not stay distinct.');
  const db = createMemoryD1();
  await persistXInboundEvidence(db, 'local-user', events, 'handoff');
  const first = await db.prepare('SELECT id, user_id, platform, event_type, external_event_id, external_user_id, payload_json, occurred_at, received_at FROM social_events WHERE user_id = ? AND platform = ? AND event_type = ? AND external_event_id = ?')
    .bind('local-user', 'x', 'mention', '101').first();
  const second = await db.prepare('SELECT id, user_id, platform, event_type, external_event_id, external_user_id, payload_json, occurred_at, received_at FROM social_events WHERE user_id = ? AND platform = ? AND event_type = ? AND external_event_id = ?')
    .bind('local-user', 'x', 'mention', '202').first();
  if (!first || !second) fail('X inbound events were not persisted by tweet id.');
  if (JSON.parse(first.payload_json).username !== 'bob') fail('X inbound did not bind the author username from the immutable user object.');
}

const xWriteScopes = ['tweet.read', 'users.read', 'follows.read', 'offline.access', 'tweet.write'];

async function seedX(db, executionMode = 'in_app') {
  const events = normalizeXInboundEvents([
    { id: '555', text: 'hello', author_id: '9', created_at: now },
  ], [{ id: '9', username: 'bob' }], now);
  await persistXInboundEvidence(db, 'local-user', events, executionMode);
}

{
  const badTarget = await replyToXTweet({ tweetId: 'not-a-tweet', message: 'hi', accessToken: 'token' });
  if (badTarget.errorCode !== 'BINDING_MISMATCH') fail('Malformed X tweet id was executable.');
  const missingText = await replyToXTweet({ tweetId: '555', message: '   ', accessToken: 'token' });
  if (missingText.errorCode !== 'INVALID_ACTION') fail('Empty X reply text was executable.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.X_REPLY_WRITE_ENABLED = 'true';
  env.X_REPLY_WRITE_USD = '0.01';
  env.DEFAULT_MONTHLY_BUDGET_USD = '3';
  await seedX(env.DB);
  const xCalls = [];
  const fakeX = async (input) => {
    xCalls.push(input);
    return { certainty: 'success', externalResultId: '888', providerStatus: '201' };
  };
  const result = await executeSocialAction(env, 'local-user', 'sa-x-mention-555', {
    executionId: 'exec-x-01',
    draft: 'ありがとう',
    action: { platform: 'instagram', candidateId: 'evil', externalEventId: '111', type: 'follow' },
  }, {
    replyToXTweet: fakeX,
    xGrantedScopes: xWriteScopes,
    getXAccessToken: async () => 'x-user-token',
  });
  if (result.status !== 200 || result.body.certainty !== 'success') fail(`Live X execute failed: ${JSON.stringify(result.body)}`);
  if (xCalls.length !== 1 || xCalls[0].tweetId !== '555') fail('X write did not target the canonical tweet id.');
  if (xCalls[0].message !== 'ありがとう' || xCalls[0].accessToken !== 'x-user-token') fail('X write did not use the user-approved draft or connected token.');
  const retry = await executeSocialAction(env, 'local-user', 'sa-x-mention-555', {
    executionId: 'exec-x-01',
    draft: '別の文',
  }, {
    replyToXTweet: fakeX,
    xGrantedScopes: xWriteScopes,
    getXAccessToken: async () => 'x-user-token',
  });
  if (xCalls.length !== 1) fail('X network retry duplicated the provider write.');
  if (!retry.body.idempotent) fail('X retry with the same executionId was not recovered.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.X_REPLY_WRITE_USD = '0.01';
  env.DEFAULT_MONTHLY_BUDGET_USD = '3';
  await seedX(env.DB);
  const xCalls = [];
  const denied = await executeSocialAction(env, 'local-user', 'sa-x-mention-555', { executionId: 'exec-x-cap-01', draft: 'x' }, {
    replyToXTweet: async (input) => { xCalls.push(input); return { certainty: 'success', externalResultId: 'nope' }; },
    xGrantedScopes: xWriteScopes,
    getXAccessToken: async () => 'x-user-token',
  });
  if (denied.body.code !== 'CAPABILITY_DENIED' && denied.body.code !== 'WRITE_DISABLED') fail('X write without X_REPLY_WRITE_ENABLED still wrote.');
  if (xCalls.length !== 0) fail('Disabled X reply reached the provider.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.X_REPLY_WRITE_ENABLED = 'true';
  env.X_REPLY_WRITE_USD = '0.01';
  env.DEFAULT_MONTHLY_BUDGET_USD = '3';
  await seedX(env.DB);
  const xCalls = [];
  const noScope = await executeSocialAction(env, 'local-user', 'sa-x-mention-555', { executionId: 'exec-x-scope-01', draft: 'x' }, {
    replyToXTweet: async (input) => { xCalls.push(input); return { certainty: 'success', externalResultId: 'nope' }; },
    xGrantedScopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access'],
    getXAccessToken: async () => 'x-user-token',
  });
  if (noScope.body.code !== 'CAPABILITY_DENIED') fail('X write without tweet.write still wrote.');
  if (xCalls.length !== 0) fail('Read-only X connection reached the reply adapter.');
}

{
  const env = envBase();
  env.SOCIAL_WRITE_MODE = '';
  env.SOCIAL_WRITE_ENABLED = 'true';
  env.X_REPLY_WRITE_ENABLED = 'true';
  delete env.X_REPLY_WRITE_USD;
  env.DEFAULT_MONTHLY_BUDGET_USD = '3';
  await seedX(env.DB);
  const xCalls = [];
  const unknownCost = await executeSocialAction(env, 'local-user', 'sa-x-mention-555', { executionId: 'exec-x-cost-01', draft: 'x' }, {
    replyToXTweet: async (input) => { xCalls.push(input); return { certainty: 'success', externalResultId: 'nope' }; },
    xGrantedScopes: xWriteScopes,
    getXAccessToken: async () => 'x-user-token',
  });
  if (unknownCost.body.code !== 'WRITE_COST_UNKNOWN') fail('Unknown X reply price did not fail closed.');
  if (xCalls.length !== 0) fail('Unknown X reply price reached the provider.');
}

if (!executionBindingsConflict(
  { actionId: 'sa-ig-comment-111', platform: 'instagram', operation: 'instagram_comment_reply' },
  canonicalAction({ id: 'sa-other' }),
  'instagram_comment_reply',
)) fail('Reused executionId across different actions was treated as idempotent success.');

console.log('Server-authoritative execute runtime OK: ignored client targeting, unknown/foreign actionId, idempotent recovery, concurrent single provider op, Instagram exact comment, capability/budget fail-closed, unknown result no blind retry, X inbound tweet-id dedupe, flag-gated X reply targeting canonical tweet id.');
