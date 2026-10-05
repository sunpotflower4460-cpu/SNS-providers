// Artist OS managed mode invariants. Bundles the real Worker router with esbuild and drives it with a
// recording D1 stub and a counting fetch stub. Standalone behavior must be unchanged; in managed mode
// My-SNS owns Instagram inbound events, so no Instagram reply may reach a provider or the execution
// ledger, the Meta webhook must not ingest, and Instagram sync must not copy events.
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outDir = join(tmpdir(), 'sns-providers-managed-mode-tests');
await mkdir(outDir, { recursive: true });
async function bundle(entry, name) {
  const outfile = join(outDir, name);
  await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

const { default: router } = await bundle('../worker/src/router.ts', 'router.mjs');
const mode = await bundle('../worker/src/artistOsMode.ts', 'mode.mjs');
const igReply = await bundle('../worker/src/social/instagram/execute.ts', 'ig-execute.mjs');
const igDm = await bundle('../worker/src/social/instagram/dm.ts', 'ig-dm.mjs');

function fail(message) { throw new Error(`check-managed-mode: ${message}`); }
function assert(cond, message) { if (!cond) fail(message); }

// 1. Mode resolution table (pure function).
const table = [
  [undefined, 'standalone', false, false],
  ['', 'standalone', false, false],
  ['   ', 'standalone', false, false],
  ['standalone', 'standalone', false, false],
  ['artist_os_managed', 'artist_os_managed', true, false],
  ['managed', 'artist_os_managed', true, true],
  ['Standalone', 'artist_os_managed', true, true],
  ['ARTIST_OS_MANAGED', 'artist_os_managed', true, true],
  ['off', 'artist_os_managed', true, true],
];
for (const [raw, runtimeMode, managed, modeInvalid] of table) {
  const r = mode.resolveArtistOsMode({ ARTIST_OS_MODE: raw });
  assert(r.runtimeMode === runtimeMode && r.managed === managed && r.modeInvalid === modeInvalid, `mode resolution wrong for ${JSON.stringify(raw)}: ${JSON.stringify(r)}`);
}
assert(mode.resolveArtistOsMode(undefined).runtimeMode === 'standalone', 'undefined env must be standalone');
assert(mode.isInstagramInboundReplyActionId('sa-ig-comment-1') && mode.isInstagramInboundReplyActionId('sa-ig-dm-m_1'), 'IG inbound predicate must match comment and dm ids');
assert(!mode.isInstagramInboundReplyActionId('sa-x-like-1') && !mode.isInstagramInboundReplyActionId('sa-x-mention-1'), 'IG inbound predicate must not match X ids');

// Harness: recording D1 + counting fetch.
function makeDb(rows = {}) {
  const calls = [];
  const writes = [];
  return {
    calls,
    writes,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params: [] });
      const entry = calls[calls.length - 1];
      const make = (params) => {
        entry.params = params;
        return {
          async first() {
            if (normalized.includes('FROM social_actions WHERE user_id = ? AND id = ?')) return rows.actions?.[params[1]] || null;
            if (normalized.includes('FROM social_events WHERE user_id = ?')) return rows.events?.[`${params[1]}:${params[2]}:${params[3]}`] || null;
            if (normalized.includes('current_usage') && normalized.includes('timestamp_integrity')) return { used: 0, invalid_count: 0, unassignable_count: 0 };
            return null;
          },
          async all() { return { results: [] }; },
          async run() {
            if (/^(INSERT|UPDATE|DELETE|WITH|REPLACE)/i.test(normalized)) writes.push({ sql: normalized, params });
            return { meta: { changes: 1 } };
          },
        };
      };
      return { bind: (...params) => make(params), ...make([]) };
    },
  };
}

let fetchCalls = [];
globalThis.fetch = async (...args) => { fetchCalls.push(String(args[0])); return new Response('{}', { status: 200 }); };

const TOKEN = 'managed-mode-test-token';
const sha = createHash('sha256').update(TOKEN).digest('hex');
const now = new Date().toISOString();
const baseAction = {
  user_id: 'local-user', candidate_id: '789', status: 'ready', execution_mode: 'in_app', source: 'x',
  conversation_id: null, parent_content_id: null, target_url: null, observed_at: now, created_at: now, updated_at: now,
  completed_at: null, platform_user_id: '789', username: 'alice', identity_conflict: 0, retryable: 1, snoozed_until: null, result_metadata_json: '{}',
};
const rows = {
  actions: {
    'sa-ig-comment-111': { ...baseAction, id: 'sa-ig-comment-111', platform: 'instagram', action_type: 'comment_reply', source: 'instagram_comment', external_event_id: '111', parent_content_id: '456' },
    'sa-ig-dm-222': { ...baseAction, id: 'sa-ig-dm-222', platform: 'instagram', action_type: 'dm_reply', source: 'instagram_dm', external_event_id: '222', conversation_id: 'conv1' },
    'sa-x-like-333': { ...baseAction, id: 'sa-x-like-333', platform: 'x', action_type: 'like', external_event_id: '333' },
  },
  events: {
    'instagram:comment:111': { id: 'ig-comment-111', user_id: 'local-user', platform: 'instagram', event_type: 'comment', external_event_id: '111', external_user_id: '789', payload_json: JSON.stringify({ text: 'hi', mediaId: '456', latestCommentId: '111' }), occurred_at: now, received_at: now },
    'instagram:dm:222': { id: 'ig-dm-222', user_id: 'local-user', platform: 'instagram', event_type: 'dm', external_event_id: '222', external_user_id: '789', payload_json: JSON.stringify({ text: 'hi', conversationId: 'conv1' }), occurred_at: now, received_at: now },
  },
};

function envFor(modeValue, db, extra = {}) {
  const env = { DB: db, SYNC_TOKEN_SHA256: sha, SOCIAL_WRITE_MODE: 'test', INSTAGRAM_USER_ID: '1234567', INSTAGRAM_ACCESS_TOKEN: 'tok', INSTAGRAM_API_VERSION: 'v24.0', INSTAGRAM_APP_SECRET: 'app-secret', INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'verify-me', ...extra };
  if (modeValue !== undefined) env.ARTIST_OS_MODE = modeValue;
  return env;
}
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
async function call(env, method, path, body, headers = auth) {
  const request = new Request(`https://worker.test${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const response = await router.fetch(request, env);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* text body */ }
  return { status: response.status, text, json };
}
const execBody = (n) => ({ executionId: `exec-managed-${n}`, draft: 'ありがとう' });
const sentinelOps = (db) => db.writes.filter((w) => /social_executions|SET status = 'executing'|fingerprint_json|budget_ledger/.test(w.sql));

// 2. Managed (valid and invalid values): IG replies are refused with a handoff, zero provider/D1.
for (const managedValue of ['artist_os_managed', 'bogus-mode']) {
  for (const [actionId, label] of [['sa-ig-comment-111', 'comment'], ['sa-ig-dm-222', 'dm']]) {
    const db = makeDb(rows);
    fetchCalls = [];
    const res = await call(envFor(managedValue, db), 'POST', `/api/social/actions/${actionId}/execute`, execBody(label));
    assert(res.status === 409, `${managedValue} IG ${label}: expected 409, got ${res.status}`);
    assert(res.json && res.json.ok === false && res.json.executionMode === 'handoff' && res.json.ownerSystem === 'my-sns' && res.json.code === 'MANAGED_MODE_INBOUND_OWNER_MY_SNS' && typeof res.json.message === 'string' && res.json.message, `${managedValue} IG ${label}: wrong handoff body ${res.text}`);
    assert(fetchCalls.length === 0, `${managedValue} IG ${label}: provider fetch was called`);
    assert(db.calls.length === 0, `${managedValue} IG ${label}: D1 was touched (${db.calls.length} calls)`);
  }
}

// Even when the id predicate is bypassed (canonical row is IG reply but id is non-canonical), the platform/type guard blocks.
{
  const db = makeDb({ actions: { 'weird-id': { ...rows.actions['sa-ig-comment-111'], id: 'weird-id' } }, events: rows.events });
  fetchCalls = [];
  const res = await call(envFor('artist_os_managed', db), 'POST', '/api/social/actions/weird-id/execute', execBody('weird'));
  assert(res.status === 409 && res.json?.code === 'MANAGED_MODE_INBOUND_OWNER_MY_SNS', `type/platform guard failed: ${res.status} ${res.text}`);
  assert(fetchCalls.length === 0 && sentinelOps(db).length === 0, 'type/platform guard still wrote or called a provider');
}

// Defense in depth: adapters refuse in managed mode and never fetch.
fetchCalls = [];
const adapterReply = await igReply.replyToInstagramComment({ commentId: '111', message: 'hi', accessToken: 'tok', apiVersion: 'v24.0', artistOsMode: 'artist_os_managed' });
const adapterDm = await igDm.sendInstagramDm({ igUserId: '1234567', recipientId: '789', message: 'hi', accessToken: 'tok', apiVersion: 'v24.0', lastInboundAt: now, artistOsMode: 'artist_os_managed' });
assert(adapterReply.certainty === 'failure' && adapterDm.certainty === 'failure' && fetchCalls.length === 0, 'adapters did not refuse in managed mode');

// 3. Standalone (unset / empty / explicit): same inputs reach the existing path (claim + ledger writes).
for (const standaloneValue of [undefined, '', 'standalone']) {
  for (const [actionId, label] of [['sa-ig-comment-111', 'comment'], ['sa-ig-dm-222', 'dm']]) {
    const db = makeDb(rows);
    const res = await call(envFor(standaloneValue, db), 'POST', `/api/social/actions/${actionId}/execute`, execBody(`s-${label}`));
    assert(res.json?.code !== 'MANAGED_MODE_INBOUND_OWNER_MY_SNS', `standalone IG ${label} was blocked as managed`);
    assert(db.writes.some((w) => w.sql.includes("SET status = 'executing'")), `standalone IG ${label} did not reach the execution claim (status ${res.status}: ${res.text})`);
    assert(db.writes.some((w) => w.sql.includes('social_executions')), `standalone IG ${label} did not write the execution ledger`);
  }
}
// Standalone with flags off: the existing flag-gated refusal is unchanged.
{
  const db = makeDb(rows);
  const res = await call(envFor(undefined, db, { SOCIAL_WRITE_MODE: undefined }), 'POST', '/api/social/actions/sa-ig-comment-111/execute', execBody('flags-off'));
  assert(res.json?.code !== 'MANAGED_MODE_INBOUND_OWNER_MY_SNS' && res.status !== 200, `standalone flags-off outcome changed: ${res.status} ${res.text}`);
  assert(sentinelOps(db).length === 0, 'standalone flags-off reached the claim');
}

// X actions unaffected in managed mode (X like stays human-approved, existing flow).
{
  const db = makeDb(rows);
  const res = await call(envFor('artist_os_managed', db), 'POST', '/api/social/actions/sa-x-like-333/execute', execBody('x-like'));
  assert(res.json?.code !== 'MANAGED_MODE_INBOUND_OWNER_MY_SNS', 'managed mode blocked an X action');
  assert(db.writes.some((w) => w.sql.includes("SET status = 'executing'")), `managed X like did not reach the existing claim path (${res.status}: ${res.text})`);
}

// 4. Meta webhook.
for (const managedValue of ['artist_os_managed', 'bogus']) {
  const db = makeDb(rows);
  fetchCalls = [];
  const env = envFor(managedValue, db);
  const get = await call(env, 'GET', '/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc', undefined, {});
  assert(get.status === 403 && get.json?.code === 'MANAGED_MODE_NOT_CANONICAL_META_RECEIVER' && !get.text.includes('abc'), `managed webhook GET must 403: ${get.status} ${get.text}`);
  const payload = JSON.stringify({ object: 'instagram', entry: [{ id: '1234567', changes: [{ field: 'comments', value: { id: '999', text: 'x', from: { id: '5', username: 'bob' }, media: { id: '456' } } }] }] });
  const post = await call(env, 'POST', '/api/instagram/webhook', payload, { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' });
  assert(post.status === 200 && post.json?.ignored === true && typeof post.json.reason === 'string', `managed webhook POST must 200 ignored: ${post.status} ${post.text}`);
  assert(db.calls.length === 0 && fetchCalls.length === 0, 'managed webhook touched D1 or fetch');
}
{
  const db = makeDb(rows);
  const env = envFor(undefined, db);
  const get = await call(env, 'GET', '/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc', undefined, {});
  assert(get.status === 200 && get.text === 'abc', `standalone webhook verify must still echo the challenge: ${get.status} ${get.text}`);
  const post = await call(envFor(undefined, db, { INSTAGRAM_APP_SECRET: undefined }), 'POST', '/api/instagram/webhook', '{}', { 'content-type': 'application/json' });
  assert(post.status === 503 && post.json?.ignored !== true, `standalone webhook POST path changed: ${post.status} ${post.text}`);
}

// 5. Instagram sync routes do not ingest in managed mode.
{
  const db = makeDb(rows);
  fetchCalls = [];
  const env = envFor('artist_os_managed', db, { INSTAGRAM_DM_READ_ENABLED: 'true' });
  const dm = await call(env, 'POST', '/api/instagram/dm/sync', {});
  assert(dm.status === 200 && dm.json?.enabled === false && dm.json?.code === 'MANAGED_MODE_INBOUND_OWNER_MY_SNS', `managed IG DM sync must be skipped: ${dm.status} ${dm.text}`);
  const inbox = await call(env, 'POST', '/api/social/inbox/sync', {});
  assert(inbox.status === 200 && inbox.json?.instagramComments?.enabled === false && inbox.json?.instagramDm?.enabled === false, `managed inbox sync must skip IG: ${inbox.text}`);
  assert(inbox.json.instagramComments.code === 'MANAGED_MODE_INBOUND_OWNER_MY_SNS' && inbox.json.instagramDm.code === 'MANAGED_MODE_INBOUND_OWNER_MY_SNS', 'managed inbox IG sources must carry the managed code');
  assert(!fetchCalls.some((u) => u.includes('instagram.com')), 'managed IG sync called the Instagram API');
  assert(!db.writes.some((w) => w.sql.includes('social_events') || w.sql.includes('social_actions')), 'managed IG sync ingested events/actions');
  assert(!db.calls.some((c) => c.params.some((p) => typeof p === 'string' && p.startsWith('instagram_'))), 'managed IG sync touched IG leases/checkpoints');
}
{
  // The engager sync keeps relationship data but must not persist comment events.
  const src = await readFile(new URL('../worker/src/instagramOwned.ts', import.meta.url), 'utf8');
  const guard = src.indexOf('if (isManagedMode(env)) return;');
  const persist = src.indexOf('await persistInstagramCommentEvidence(', guard);
  assert(guard > 0 && persist > guard, 'instagramOwned must skip persistInstagramCommentEvidence in managed mode');
}

// 6. Health and capabilities fields.
const flagsOn = { SOCIAL_WRITE_MODE: undefined, SOCIAL_WRITE_ENABLED: 'true', INSTAGRAM_COMMENT_REPLY_ENABLED: 'true', INSTAGRAM_DM_WRITE_ENABLED: 'true', X_REPLY_WRITE_ENABLED: 'true' };
for (const [modeValue, expect] of [
  [undefined, { runtimeMode: 'standalone', modeInvalid: false, ig: true, hook: true }],
  ['standalone', { runtimeMode: 'standalone', modeInvalid: false, ig: true, hook: true }],
  ['artist_os_managed', { runtimeMode: 'artist_os_managed', modeInvalid: false, ig: false, hook: false }],
  ['nonsense', { runtimeMode: 'artist_os_managed', modeInvalid: true, ig: false, hook: false }],
]) {
  const health = await call(envFor(modeValue, makeDb(rows), flagsOn), 'GET', '/api/health', undefined, {});
  assert(health.status === 200 && health.json?.ok === true, `health broke: ${health.status} ${health.text}`);
  const caps = await call(envFor(modeValue, makeDb(rows), flagsOn), 'GET', '/api/social/capabilities');
  assert(caps.status === 200 && caps.json?.instagram && caps.json?.x, `capabilities existing shape broke: ${caps.text}`);
  for (const [name, body] of [['health', health.json], ['capabilities', caps.json]]) {
    assert(body.runtimeMode === expect.runtimeMode && body.modeInvalid === expect.modeInvalid, `${name} mode fields wrong for ${modeValue}: ${body.runtimeMode}/${body.modeInvalid}`);
    const o = body.ownership;
    assert(o && o.inboundReplyExecution.instagram === expect.ig && o.canonicalMetaWebhookReceiver === expect.hook && o.relationshipIntelligence === true && o.proactiveEngagement === true && o.inboundReplyExecution.x === true, `${name} ownership wrong for ${modeValue}: ${JSON.stringify(o)}`);
    assert(Array.isArray(body.capabilities), `${name} capabilities missing`);
    const igCaps = body.capabilities.filter((c) => c.startsWith('reply.instagram.'));
    if (expect.ig) assert(igCaps.includes('reply.instagram.comment.execute') && igCaps.includes('reply.instagram.dm.execute') && body.capabilities.includes('reply.x.mention.execute'), `${name} standalone capability strings wrong: ${body.capabilities}`);
    else assert(igCaps.length === 0, `${name} managed mode advertises IG reply capability: ${body.capabilities}`);
    assert(!/(secret|token|key)/i.test(JSON.stringify(body.ownership)) && !JSON.stringify(body).includes('app-secret'), `${name} leaked a secret`);
  }
}
// Standalone with write flags off reports instagram=false (current reality).
{
  const health = await call(envFor(undefined, makeDb(rows), { SOCIAL_WRITE_MODE: undefined }), 'GET', '/api/health', undefined, {});
  assert(health.json.ownership.inboundReplyExecution.instagram === false && !health.json.capabilities.some((c) => c.startsWith('reply.instagram.')), 'standalone with flags off must not claim IG reply execution');
}

console.log('Managed mode invariants passed.');
