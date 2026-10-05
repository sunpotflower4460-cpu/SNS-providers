// Artist OS managed-mode relationship enrichment invariants. Bundles the real Worker router and drives it
// with a recording D1 stub and a recording fetch stub (same harness style as check-managed-mode.mjs).
// Proves: route exists only in managed mode; read token is scoped to /api/service read routes; the
// enrichment path is GET-only against My-SNS with zero D1 writes; strict 1:1 mapping and join by
// (platform, platformUserId); privacy (nothing but the strict payload leaves); fail-closed on every
// upstream/state problem; strict artifact validation; health capability.
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outDir = join(tmpdir(), 'sns-providers-relationship-enrichment-tests');
await mkdir(outDir, { recursive: true });
async function bundle(entry, name) {
  const outfile = join(outDir, name);
  await build({ entryPoints: [new URL(entry, import.meta.url).pathname], outfile, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}
const { default: router } = await bundle('../worker/src/router.ts', 'router.mjs');
const enr = await bundle('../worker/src/relationshipEnrichment.ts', 'enrichment.mjs');

function fail(message) { throw new Error(`check-relationship-enrichment: ${message}`); }
function assert(cond, message) { if (!cond) fail(message); }

const sha = (v) => createHash('sha256').update(v).digest('hex');
const SYNC_TOKEN = 'sync-token-for-tests';
const READ_TOKEN = 'artist-os-read-token-for-tests';
const MY_SNS_TOKEN = 'my-sns-read-token-SECRET-VALUE';
const MY_SNS_URL = 'https://my-sns.test';
const INBOUND_URL = 'https://my-sns.test/api/service/v1/inbound-events';
const ROUTE = '/api/service/v1/relationship-enrichment';
const now = new Date().toISOString();

// ---- Harness ----
function makeDb({ snapshot, throwOnRead = false } = {}) {
  const calls = [];
  const writes = [];
  return {
    calls,
    writes,
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      const entry = { sql: normalized, params: [] };
      calls.push(entry);
      const make = (params) => {
        entry.params = params;
        return {
          async first() {
            if (throwOnRead) throw new Error('D1 down');
            if (normalized.includes('FROM state_snapshots WHERE user_id = ?')) return snapshot === undefined ? null : { state_json: typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot), updated_at: now };
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

let fetchLog = [];
let upstream = () => new Response('{}', { status: 200 });
globalThis.fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  fetchLog.push({ url: String(input instanceof Request ? input.url : input), method: String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(), redirect: init.redirect, hasAuth: headers.has('authorization'), bearer: headers.get('authorization') });
  return upstream(String(input));
};
const feedResponse = (events, over = {}) => () => new Response(JSON.stringify({ contractVersion: 1, service: 'my-sns', generatedAt: now, events, ...over }), { status: 200, headers: { 'content-type': 'application/json' } });
const ev = (n, over = {}) => ({ sourceSystem: 'my-sns', eventId: `evt-${n}`, platform: 'instagram', kind: 'comment', externalEventId: `ext${n}`, receivedAt: now, needsAction: true, replyState: 'none', ownerSystem: 'my-sns', ...over });

function envFor(modeValue, db, extra = {}) {
  const env = { DB: db, SYNC_TOKEN_SHA256: sha(SYNC_TOKEN), ARTIST_OS_READ_TOKEN_SHA256: sha(READ_TOKEN), MY_SNS_URL, MY_SNS_READ_TOKEN: MY_SNS_TOKEN, ...extra };
  if (modeValue !== undefined) env.ARTIST_OS_MODE = modeValue;
  return env;
}
async function call(env, method, path, token, body) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request(`https://worker.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await router.fetch(request, env);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* text */ }
  return { status: response.status, text, json, headers: response.headers };
}
const GET = (env, token) => call(env, 'GET', ROUTE, token);

// Relationship state (D1 snapshot blob). Handles/bios/drafts are present so privacy checks can detect echoes.
const state = {
  candidates: [
    { id: 'cand-ig-111', platform: 'instagram', platformUserId: '111', username: 'cand_username_secret', displayName: 'DISPLAY-SECRET', bio: 'BIO-SECRET', draft: 'DRAFT-SECRET', stage: 'engaged', match: 80, relationshipScore: 55, lastInteractionAt: now },
    { id: 'cand-x-111', platform: 'x', platformUserId: '111', username: 'x_same_id', stage: 'relationship', match: 20, relationshipScore: 90, lastInteractionAt: '2020-01-01T00:00:00.000Z' },
    { id: 'cand-ig-222', platform: 'instagram', platformUserId: '222', username: 'ig_two', stage: 'discovered', match: 10, relationshipScore: 5 },
    { id: 'cand-ig-handle', platform: 'instagram', platformUserId: 'username:handleonly', username: 'handleonly', stage: 'relationship', match: 99, relationshipScore: 99 },
    { id: 'cand-dup-a', platform: 'instagram', platformUserId: '777', username: 'dup_a', stage: 'engaged', match: 50, relationshipScore: 50 },
    { id: 'cand-dup-b', platform: 'instagram', platformUserId: '777', username: 'dup_b', stage: 'engaged', match: 50, relationshipScore: 50 },
    { id: 'cand-nostage', platform: 'instagram', platformUserId: '888', username: 'nostage', stage: 'bogus-stage', match: 50, relationshipScore: 50 },
  ],
  interactions: [
    { id: 'i1', candidateId: 'cand-ig-111', action: 'like', at: now },
    { id: 'i2', candidateId: 'cand-ig-111', action: 'reply', at: now },
    { id: 'i3', candidateId: 'cand-ig-111', action: 'kept', at: now },
    { id: 'i4', candidateId: 'cand-ig-111', action: 'skipped', at: now },
    { id: 'i5', candidateId: 'cand-x-111', action: 'followed', at: now },
  ],
};

const STRICT_PAYLOAD_KEYS = new Set(['subject', 'candidateRef', 'relationshipStage', 'relationshipValue', 'priority', 'recommendedHandling', 'reasonCodes', 'interactionCount', 'generatedAt', 'analyzer']);
const ENVELOPE_KEYS = ['schemaVersion', 'artifactId', 'kind', 'producer', 'createdAt', 'subjectRefs', 'payloadVersion', 'payload'].sort().join(',');

// ===== (a) standalone: the route does not exist; no outbound, no D1 =====
for (const standaloneValue of [undefined, '', 'standalone']) {
  for (const token of [READ_TOKEN, SYNC_TOKEN, null]) {
    const db = makeDb({ snapshot: state });
    fetchLog = [];
    const res = await GET(envFor(standaloneValue, db), token);
    assert(res.status === 404, `standalone(${JSON.stringify(standaloneValue)}) route must 404, got ${res.status}`);
    assert(fetchLog.length === 0 && db.calls.length === 0, 'standalone route touched fetch or D1');
    assert(!res.text.includes('artifacts'), 'standalone 404 leaked enrichment shape');
  }
}

// ===== (b) managed auth: 401 / 503, zero outbound, zero D1 =====
for (const managedValue of ['artist_os_managed', 'bogus-mode']) {
  const cases = [
    ['no token', null, {}],
    ['wrong token', 'wrong-token', {}],
    ['token is the My-SNS token', MY_SNS_TOKEN, {}],
    ['sha256 hash instead of token', sha(READ_TOKEN), {}],
    ['oversized token', 'x'.repeat(600), {}],
  ];
  for (const [label, token, extra] of cases) {
    const db = makeDb({ snapshot: state });
    fetchLog = [];
    const res = await GET(envFor(managedValue, db, extra), token);
    assert(res.status === 401, `${managedValue} ${label}: expected 401, got ${res.status}`);
    assert(fetchLog.length === 0 && db.calls.length === 0, `${managedValue} ${label}: touched fetch or D1`);
    assert(!res.text.includes(READ_TOKEN) && !res.text.includes(MY_SNS_TOKEN), `${managedValue} ${label}: leaked a token`);
  }
  // Non-Bearer scheme.
  {
    const db = makeDb({ snapshot: state });
    fetchLog = [];
    const response = await router.fetch(new Request(`https://worker.test${ROUTE}`, { headers: { authorization: `Basic ${READ_TOKEN}` } }), envFor(managedValue, db));
    assert(response.status === 401 && fetchLog.length === 0 && db.calls.length === 0, 'non-Bearer scheme must 401 with no I/O');
  }
  // Unconfigured: neither token configured, or an invalid hash format => 503 fail closed.
  for (const [label, extra] of [
    ['no hashes', { ARTIST_OS_READ_TOKEN_SHA256: undefined, SYNC_TOKEN_SHA256: undefined }],
    ['malformed hashes', { ARTIST_OS_READ_TOKEN_SHA256: 'not-a-hash', SYNC_TOKEN_SHA256: 'zz' }],
  ]) {
    const db = makeDb({ snapshot: state });
    fetchLog = [];
    const res = await GET(envFor(managedValue, db, extra), READ_TOKEN);
    assert(res.status === 503, `${managedValue} unconfigured (${label}): expected 503, got ${res.status}`);
    assert(fetchLog.length === 0 && db.calls.length === 0, `${managedValue} unconfigured (${label}): touched fetch or D1`);
  }
  // Non-GET methods are not allowed (and do no I/O).
  {
    const db = makeDb({ snapshot: state });
    fetchLog = [];
    const res = await call(envFor(managedValue, db), 'POST', ROUTE, READ_TOKEN, {});
    assert(res.status === 405 && fetchLog.length === 0 && db.calls.length === 0, `POST on enrichment route must 405 with no I/O, got ${res.status}`);
  }
}
// Read token unconfigured but sync token configured: a wrong token is 401, the sync token still reads.
{
  const env = envFor('artist_os_managed', makeDb({ snapshot: state }), { ARTIST_OS_READ_TOKEN_SHA256: undefined });
  upstream = feedResponse([ev(1)]);
  assert((await GET(env, 'nope')).status === 401, 'read token unconfigured + wrong token must 401');
  assert((await GET(env, SYNC_TOKEN)).status === 200, 'existing sync token must still read the service route');
}
// Read token configured, sync token unconfigured: read token works.
{
  upstream = feedResponse([ev(1)]);
  const res = await GET(envFor('artist_os_managed', makeDb({ snapshot: state }), { SYNC_TOKEN_SHA256: undefined }), READ_TOKEN);
  assert(res.status === 200, `read token alone must work, got ${res.status}`);
}

// ===== (c) read token is rejected on every other route; the sync token still works there =====
{
  const execBody = { executionId: 'exec-managed-rel-1', draft: 'x' };
  const routes = [
    ['POST', '/api/social/actions/sa-ig-comment-111/execute', execBody],
    ['POST', '/api/social/actions/sa-x-like-333/execute', execBody],
    ['POST', '/api/social/actions/prepare', {}],
    ['POST', '/api/social/actions/sa-x-like-333/snooze', {}],
    ['POST', '/api/social/actions/sa-x-like-333/dismiss', {}],
    ['POST', '/api/social/executions/exec-1/reconcile', {}],
    ['GET', '/api/social/actions', undefined],
    ['GET', '/api/social/capabilities', undefined],
    ['GET', '/api/sync/state', undefined],
    ['PUT', '/api/sync/state', { state: {}, expectedUpdatedAt: null }],
    ['POST', '/api/social/inbox/sync', {}],
    ['POST', '/api/instagram/dm/sync', {}],
    ['POST', '/api/instagram/engagers/sync', {}],
    ['POST', '/api/x/dm/sync', {}],
    ['POST', '/api/x/inbound/sync', {}],
    ['POST', '/api/x/owned/sync', {}],
    ['POST', '/api/x/oauth/start', {}],
    ['GET', '/api/x/oauth/status', undefined],
    ['DELETE', '/api/x/oauth/disconnect', undefined],
    ['POST', '/api/discover/social', { mission: 'm' }],
    ['POST', '/api/ai/rank', { mission: 'm', candidates: [] }],
    ['POST', '/api/x/enrich', { usernames: ['a'] }],
    ['GET', '/api/budget', undefined],
    ['GET', '/api/preflight', undefined],
    ['GET', '/api/settings/runtime', undefined],
    ['POST', '/api/help/chat', { message: 'hi' }],
  ];
  for (const managedValue of ['artist_os_managed', undefined]) {
    for (const [method, path, body] of routes) {
      const db = makeDb({ snapshot: state });
      fetchLog = [];
      const res = await call(envFor(managedValue, db), method, path, READ_TOKEN, body);
      assert(res.status === 401 || res.status === 404, `read token was NOT rejected on ${method} ${path} (${managedValue ?? 'standalone'}): ${res.status}`);
      assert(res.status === 401 || path === '/api/help/chat', `read token on ${method} ${path} should be 401, got ${res.status}`);
      assert(fetchLog.length === 0 && db.writes.length === 0, `read token on ${method} ${path} caused I/O`);
      // Control: the old sync token still authenticates on the same route.
      const control = await call(envFor(managedValue, makeDb({ snapshot: state })), method, path, SYNC_TOKEN, body).catch(() => ({ status: 0 }));
      assert(control.status !== 401, `sync token no longer works on ${method} ${path} (${managedValue ?? 'standalone'}): ${control.status}`);
    }
  }
  // Source-level scope: only the service-read authorizer and the health/config helpers know the read token.
  const routerSrc = await readFile(new URL('../worker/src/router.ts', import.meta.url), 'utf8');
  const syncStart = routerSrc.indexOf('async function authorizeSync(');
  const authSyncBody = routerSrc.slice(syncStart, routerSrc.indexOf('\n}\n', syncStart));
  assert(authSyncBody.includes('SYNC_TOKEN_SHA256') && !authSyncBody.includes('ARTIST_OS_READ_TOKEN_SHA256'), 'authorizeSync must never reference the read token');
  assert(routerSrc.split('authorizeServiceRead(request, env)').length === 2, 'authorizeServiceRead must have exactly one call site (the enrichment route)');
  const blockStart = routerSrc.indexOf('RELATIONSHIP_ENRICHMENT_PATH && isManagedMode(env)');
  assert(blockStart > 0 && routerSrc.slice(blockStart, blockStart + 700).includes('authorizeServiceRead(request, env)'), 'authorizeServiceRead must be called only inside the managed enrichment route block');
  for (const f of ['../worker/src/social/execute.ts', '../worker/src/social/prepare.ts', '../worker/src/social/lifecycle.ts', '../worker/src/social/reconcile.ts', '../worker/src/xOAuth.ts', '../worker/src/instagramOwned.ts']) {
    const src = await readFile(new URL(f, import.meta.url), 'utf8');
    assert(!src.includes('ARTIST_OS_READ_TOKEN') && !src.includes('MY_SNS_READ_TOKEN'), `${f} must not touch the read/My-SNS tokens`);
  }
}

// ===== (d) managed: no My-SNS-owned reply is sendable; the enrichment path is GET-only with zero writes =====
{
  const igRows = {
    actions: { 'sa-ig-comment-111': { id: 'sa-ig-comment-111', user_id: 'local-user', candidate_id: '789', platform: 'instagram', action_type: 'comment_reply', status: 'ready', execution_mode: 'in_app', source: 'instagram_comment', external_event_id: '111', parent_content_id: '456', observed_at: now, created_at: now, updated_at: now, platform_user_id: '789', username: 'alice', identity_conflict: 0, retryable: 1, result_metadata_json: '{}' } },
  };
  for (const id of ['sa-ig-comment-111', 'sa-ig-dm-222']) {
    fetchLog = [];
    const db = makeDb({ snapshot: state });
    const res = await call(envFor('artist_os_managed', db, { SOCIAL_WRITE_MODE: 'test', INSTAGRAM_ACCESS_TOKEN: 'tok', INSTAGRAM_USER_ID: '1' }), 'POST', `/api/social/actions/${id}/execute`, SYNC_TOKEN, { executionId: 'exec-managed-rel-d', draft: 'hi' });
    assert(res.status === 409 && res.json?.executionMode === 'handoff' && res.json?.ownerSystem === 'my-sns' && res.json?.code === 'MANAGED_MODE_INBOUND_OWNER_MY_SNS', `${id}: 409 handoff lost: ${res.status} ${res.text}`);
    assert(fetchLog.length === 0 && db.calls.length === 0, `${id}: handoff touched provider or D1`);
  }
  void igRows;

  fetchLog = [];
  const db = makeDb({ snapshot: state });
  upstream = feedResponse([ev(1, { contactRef: { platform: 'instagram', externalContactId: '111' } }), ev(2, { kind: 'dm', platform: 'x', externalEventId: 'xdm9' })]);
  const res = await GET(envFor('artist_os_managed', db), READ_TOKEN);
  assert(res.status === 200 && res.headers.get('cache-control') === 'no-store', `enrichment 200/no-store expected: ${res.status} ${res.headers.get('cache-control')}`);
  assert(fetchLog.length === 1, `enrichment must make exactly one outbound call, got ${fetchLog.length}`);
  for (const call1 of fetchLog) {
    assert(call1.method === 'GET' && call1.url === INBOUND_URL, `outbound call must be GET ${INBOUND_URL}, got ${call1.method} ${call1.url}`);
    assert(call1.redirect === 'error', 'My-SNS request must use redirect:error');
    assert(call1.bearer === `Bearer ${MY_SNS_TOKEN}`, 'My-SNS request must carry the My-SNS read token');
  }
  assert(!fetchLog.some((c) => /instagram|facebook|graph\.|twitter|x\.com|api\.x\./i.test(c.url)), 'a provider/Meta/X endpoint was called');
  assert(db.writes.length === 0, `enrichment performed D1 writes: ${JSON.stringify(db.writes)}`);
  assert(db.calls.length === 1 && /^SELECT state_json, updated_at FROM state_snapshots WHERE user_id = \?$/.test(db.calls[0].sql) && db.calls[0].params[0] === 'local-user', `enrichment D1 access must be exactly one snapshot SELECT: ${JSON.stringify(db.calls)}`);
  assert(res.json.contractVersion === 1 && res.json.service === 'sns-providers' && typeof res.json.generatedAt === 'string' && Array.isArray(res.json.artifacts), `bad report shape: ${res.text}`);
  assert(!res.text.includes(MY_SNS_TOKEN) && !res.text.includes(READ_TOKEN), 'response leaked a token');
  // Empty feed: no D1 read at all, empty artifacts.
  {
    const db2 = makeDb({ snapshot: state });
    upstream = feedResponse([]);
    const empty = await GET(envFor('artist_os_managed', db2), READ_TOKEN);
    assert(empty.status === 200 && empty.json.artifacts.length === 0 && db2.calls.length === 0, 'empty feed must return empty artifacts without reading D1');
  }
}

// ===== (e) mapping: 1:1 ids/platforms, join only by (platform, platformUserId) =====
{
  const events = [
    ev(1, { externalEventId: 'igA1', contactRef: { platform: 'instagram', externalContactId: '111' }, authorHandle: 'cand_username_secret' }),
    ev(2, { externalEventId: 'igA2', contactRef: { platform: 'instagram', externalContactId: '222' } }),
    ev(3, { externalEventId: 'xB1', platform: 'x', kind: 'mention', contactRef: { platform: 'x', externalContactId: '111' } }),
    ev(4, { externalEventId: 'igHandle', authorHandle: 'handleonly', contactRef: { platform: 'instagram', externalContactId: '999' } }), // handle matches a candidate; id does not
    ev(5, { externalEventId: 'igNoRef', authorHandle: 'handleonly' }), // no contactRef at all
    ev(6, { externalEventId: 'igXplat', contactRef: { platform: 'x', externalContactId: '111' } }), // contactRef platform != event platform
    ev(7, { externalEventId: 'igDup', contactRef: { platform: 'instagram', externalContactId: '777' } }), // two candidates share the id
    ev(8, { externalEventId: 'igBadStage', contactRef: { platform: 'instagram', externalContactId: '888' } }),
    ev(9, { externalEventId: 'yt-1', platform: 'youtube', contactRef: { platform: 'youtube', externalContactId: '111' } }), // platform with no candidates
    ev(10, { externalEventId: 'igDm', kind: 'dm', contactRef: { platform: 'instagram', externalContactId: '555' } }),
    ev(11, { externalEventId: 'igSent', replyState: 'sent', contactRef: { platform: 'instagram', externalContactId: '111' } }),
    ev(12, { externalEventId: 'igLow', contactRef: { platform: 'instagram', externalContactId: '222' }, needsAction: true }),
    ev(1, { externalEventId: 'igA1', contactRef: { platform: 'instagram', externalContactId: '222' } }), // duplicate key: first wins
  ];
  upstream = feedResponse(events);
  const res = await GET(envFor('artist_os_managed', makeDb({ snapshot: state })), READ_TOKEN);
  assert(res.status === 200, `mapping: ${res.status} ${res.text}`);
  const arts = res.json.artifacts;
  assert(arts.length === 12, `expected 12 distinct artifacts, got ${arts.length}`);
  const byId = new Map(arts.map((a) => [a.artifactId, a]));
  assert(byId.size === 12, 'artifactIds must be unique');
  for (const a of arts) {
    assert(Object.keys(a).sort().join(',') === ENVELOPE_KEYS, `envelope keys wrong: ${Object.keys(a)}`);
    assert(a.schemaVersion === 1 && a.kind === 'RelationshipEnrichmentArtifact' && a.producer === 'sns-providers' && a.payloadVersion === 1 && Array.isArray(a.subjectRefs) && a.subjectRefs.length === 0, 'envelope fields wrong');
    assert(a.artifactId === `rel_${a.payload.subject.platform}_${a.payload.subject.externalEventId}`, `artifactId not rel_<platform>_<externalEventId>: ${a.artifactId}`);
    assert(enr.validateEnrichmentEnvelope(a), `artifact failed the strict validator: ${JSON.stringify(a)}`);
    assert(Object.keys(a.payload).every((k) => STRICT_PAYLOAD_KEYS.has(k)), `extra payload keys: ${Object.keys(a.payload)}`);
    assert(a.payload.analyzer.name === 'sns-providers-relationship' && typeof a.payload.analyzer.version === 'string', 'analyzer wrong');
  }
  const get = (id) => { const a = byId.get(id); assert(a, `missing artifact ${id}`); return a.payload; };
  // 1:1 id/platform mapping, no cross-mixing.
  for (const [platform, id] of [['instagram', 'igA1'], ['instagram', 'igA2'], ['x', 'xB1'], ['instagram', 'igHandle'], ['instagram', 'igNoRef'], ['instagram', 'igXplat'], ['instagram', 'igDup'], ['instagram', 'igBadStage'], ['youtube', 'yt-1'], ['instagram', 'igDm'], ['instagram', 'igSent'], ['instagram', 'igLow']]) {
    const p = get(`rel_${platform}_${id}`);
    assert(p.subject.platform === platform && p.subject.externalEventId === id, `subject mix-up for ${platform}/${id}: ${JSON.stringify(p.subject)}`);
  }
  // Match by (platform, platformUserId): instagram 111 -> cand-ig-111; x 111 -> cand-x-111 (never each other).
  const a1 = get('rel_instagram_igA1');
  assert(a1.candidateRef === 'cand-ig-111' && a1.relationshipStage === 'engaged' && a1.relationshipValue === 0.55 && a1.interactionCount === 3, `igA1 wrong: ${JSON.stringify(a1)}`);
  assert(a1.reasonCodes.join() === 'repeat-interaction,high-match' && a1.priority === 'normal' && a1.recommendedHandling === 'reply', `igA1 rules wrong: ${JSON.stringify(a1)}`);
  const b1 = get('rel_x_xB1');
  assert(b1.candidateRef === 'cand-x-111' && b1.relationshipStage === 'relationship' && b1.relationshipValue === 0.9 && b1.interactionCount === 1 && b1.priority === 'high', `xB1 wrong: ${JSON.stringify(b1)}`);
  assert(b1.reasonCodes.includes('low-match') && b1.reasonCodes.includes('dormant') && !b1.reasonCodes.includes('repeat-interaction'), `xB1 reason codes wrong: ${b1.reasonCodes}`);
  const a2 = get('rel_instagram_igA2');
  assert(a2.candidateRef === 'cand-ig-222' && a2.relationshipStage === 'discovered' && a2.priority === 'low' && a2.recommendedHandling === 'reply_later' && a2.reasonCodes.includes('low-match') && a2.interactionCount === 0, `igA2 wrong: ${JSON.stringify(a2)}`);
  // Handle-only / no-ref / cross-platform / ambiguous => never matched.
  for (const id of ['igHandle', 'igNoRef', 'igXplat', 'igDup', 'igDm']) {
    const p = get(`rel_instagram_${id}`);
    assert(p.candidateRef === undefined && p.relationshipStage === 'unknown' && p.relationshipValue === null && p.priority === 'normal' && p.reasonCodes.includes('no-candidate-match') && p.interactionCount === undefined, `${id} must be unmatched: ${JSON.stringify(p)}`);
  }
  assert(get('rel_instagram_igHandle').reasonCodes.join() === 'no-candidate-match,new-contact' && get('rel_instagram_igHandle').recommendedHandling === 'reply', 'unmatched public contact => new-contact + reply');
  assert(get('rel_instagram_igNoRef').reasonCodes.join() === 'no-candidate-match,insufficient-data' && get('rel_instagram_igNoRef').recommendedHandling === 'human_review', 'no contactRef => insufficient-data + human_review');
  assert(get('rel_instagram_igDup').reasonCodes.includes('insufficient-data') && get('rel_instagram_igDup').recommendedHandling === 'human_review', 'ambiguous identity must be human_review');
  assert(get('rel_instagram_igDm').recommendedHandling === 'human_review', 'unmatched DM must be human_review');
  assert(get('rel_youtube_yt-1').relationshipStage === 'unknown' && get('rel_youtube_yt-1').candidateRef === undefined, 'youtube contact must not match a candidate on another platform');
  const bad = get('rel_instagram_igBadStage');
  assert(bad.relationshipStage === 'unknown' && bad.recommendedHandling === 'human_review' && bad.reasonCodes.includes('insufficient-data'), `invalid stored stage must not be invented: ${JSON.stringify(bad)}`);
  assert(get('rel_instagram_igSent').recommendedHandling === 'no_reply', 'replyState sent => no_reply');
  // Duplicate (platform, externalEventId): first occurrence (contact 111) wins.
  assert(get('rel_instagram_igA1').candidateRef === 'cand-ig-111', 'duplicate event must keep the first occurrence');
}

// 200-event cap.
{
  upstream = feedResponse(Array.from({ length: 250 }, (_, i) => ev(i + 1000)));
  const res = await GET(envFor('artist_os_managed', makeDb({ snapshot: state })), READ_TOKEN);
  assert(res.status === 200 && res.json.artifacts.length === 200, `cap: expected 200 artifacts, got ${res.json?.artifacts?.length}`);
}

// ===== (f) privacy: nothing from the upstream or the snapshot leaks beyond the strict payload =====
{
  const junk = {
    token: 'JUNK-TOKEN-VALUE', rawPayload: { secret: 'JUNK-RAW' }, signedUrl: 'https://signed.example/JUNK-SIGNED?sig=abc',
    dmText: 'SECRET-DM-TEXT', text: 'SECRET-DM-TEXT-2', fullHistory: [{ text: 'JUNK-HISTORY' }], authorHandle: 'secret_handle_xyz', textExcerpt: 'SECRET-EXCERPT-TEXT', seedRef: 'seed-secret-ref', accessToken: 'JUNK-ACCESS',
  };
  upstream = feedResponse([ev(1, { ...junk, contactRef: { platform: 'instagram', externalContactId: '111', handle: 'JUNK-CONTACT-HANDLE' } }), ev(2, { ...junk, kind: 'dm', contactRef: { platform: 'instagram', externalContactId: '555' } })], { token: 'JUNK-TOP-TOKEN', debug: { rawPayload: 'JUNK-DEBUG' } });
  const res = await GET(envFor('artist_os_managed', makeDb({ snapshot: state })), READ_TOKEN);
  assert(res.status === 200, `privacy: ${res.status} ${res.text}`);
  for (const needle of ['JUNK', 'SECRET-DM', 'SECRET-EXCERPT', 'secret_handle', 'seed-secret', 'signed.example', 'cand_username_secret', 'DISPLAY-SECRET', 'BIO-SECRET', 'DRAFT-SECRET', MY_SNS_TOKEN, READ_TOKEN, SYNC_TOKEN, 'x_same_id', 'handleonly']) {
    assert(!res.text.includes(needle), `response leaked ${needle}`);
  }
  for (const a of res.json.artifacts) assert(Object.keys(a.payload).every((k) => STRICT_PAYLOAD_KEYS.has(k)), 'payload has non-contract keys');
  assert(Object.keys(res.json).sort().join() === 'artifacts,contractVersion,generatedAt,service', `report has extra top-level keys: ${Object.keys(res.json)}`);
}

// ===== (g) fail closed on every upstream/state problem =====
const upstreamFailures = [
  ['unreachable', () => { throw new TypeError('connect ECONNREFUSED my-sns-secret-host'); }, 502, 'MY_SNS_UNREACHABLE'],
  ['timeout', () => { throw new Error('My-SNS inbound-events timed out after 8s'); }, 504, 'MY_SNS_TIMEOUT'],
  ['http 500', () => new Response('boom ' + MY_SNS_TOKEN, { status: 500 }), 502, 'MY_SNS_HTTP_ERROR'],
  ['http 401', () => new Response('{}', { status: 401 }), 502, 'MY_SNS_HTTP_ERROR'],
  ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }), 502, 'MY_SNS_HTTP_ERROR'],
  ['not json', () => new Response('<html>nope</html>', { status: 200 }), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['not an object', () => new Response('[]', { status: 200 }), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['wrong service', feedResponse([ev(1)], { service: 'sns-providers' }), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['wrong contractVersion', feedResponse([ev(1)], { contractVersion: 2 }), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['events not array', feedResponse(null, {}), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['bad generatedAt', feedResponse([ev(1)], { generatedAt: 'yesterday' }), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['bad platform', feedResponse([ev(1, { platform: 'myspace' })]), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['bad externalEventId', feedResponse([ev(1, { externalEventId: 'a:b c' })]), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['wrong owner', feedResponse([ev(1, { ownerSystem: 'sns-providers' })]), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['bad needsAction', feedResponse([ev(1, { needsAction: 'yes' })]), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['bad replyState', feedResponse([ev(1, { replyState: 'maybe' })]), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['bad contactRef', feedResponse([ev(1, { contactRef: { platform: 'instagram' } })]), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['one bad event poisons the feed', feedResponse([ev(1), { nonsense: true }]), 502, 'MY_SNS_RESPONSE_INVALID'],
  ['oversized (content-length)', () => new Response('x'.repeat(10), { status: 200, headers: { 'content-length': '5000000' } }), 502, 'MY_SNS_RESPONSE_TOO_LARGE'],
  ['oversized (streamed)', () => new Response(JSON.stringify({ contractVersion: 1, service: 'my-sns', generatedAt: now, events: [], pad: 'p'.repeat(1_200_000) }), { status: 200 }), 502, 'MY_SNS_RESPONSE_TOO_LARGE'],
];
for (const [label, producer, status, code] of upstreamFailures) {
  upstream = producer;
  const db = makeDb({ snapshot: state });
  fetchLog = [];
  const res = await GET(envFor('artist_os_managed', db), READ_TOKEN);
  assert(res.status === status && res.json?.ok === false && res.json?.code === code && typeof res.json?.reason === 'string' && res.json.reason, `upstream ${label}: expected ${status}/${code}, got ${res.status} ${res.text}`);
  assert(!('artifacts' in res.json), `upstream ${label}: fabricated artifacts`);
  assert(!res.text.includes(MY_SNS_TOKEN) && !res.text.includes(READ_TOKEN) && !res.text.includes('my-sns-secret-host') && !res.text.includes('evil.test'), `upstream ${label}: leaked upstream detail or token`);
  assert(db.writes.length === 0 && db.calls.length === 0, `upstream ${label}: D1 touched before a valid feed`);
  assert(fetchLog.every((c) => c.method === 'GET' && c.url === INBOUND_URL), `upstream ${label}: unexpected outbound call`);
}
// Config problems (managed, authorized): 503, no outbound.
for (const [label, extra] of [['no MY_SNS_URL', { MY_SNS_URL: undefined }], ['http MY_SNS_URL', { MY_SNS_URL: 'http://my-sns.test' }], ['credentials in URL', { MY_SNS_URL: 'https://u:p@my-sns.test' }], ['no token', { MY_SNS_READ_TOKEN: undefined }], ['blank token', { MY_SNS_READ_TOKEN: '  ' }]]) {
  const db = makeDb({ snapshot: state });
  fetchLog = [];
  const res = await GET(envFor('artist_os_managed', db, extra), READ_TOKEN);
  assert(res.status === 503 && res.json?.code === 'ENRICHMENT_NOT_CONFIGURED' && !('artifacts' in res.json) && fetchLog.length === 0 && db.calls.length === 0, `config ${label}: expected 503 with no I/O, got ${res.status} ${res.text}`);
}
// Snapshot problems: missing, unparsable, wrong shape, D1 error => 503, never an invented stage.
upstream = feedResponse([ev(1, { contactRef: { platform: 'instagram', externalContactId: '111' } })]);
for (const [label, dbOpts] of [['missing snapshot', {}], ['unparsable', { snapshot: '{not json' }], ['no candidates array', { snapshot: { candidates: 'x' } }], ['array root', { snapshot: [] }], ['D1 error', { throwOnRead: true, snapshot: state }]]) {
  const db = makeDb(dbOpts);
  const res = await GET(envFor('artist_os_managed', db), READ_TOKEN);
  assert(res.status === 503 && res.json?.code === 'RELATIONSHIP_STATE_UNAVAILABLE' && !('artifacts' in res.json), `snapshot ${label}: expected 503 fail closed, got ${res.status} ${res.text}`);
  assert(db.writes.length === 0, `snapshot ${label}: wrote to D1`);
}
// A snapshot without an interactions array: candidates still match, but interactionCount is omitted (not invented).
{
  upstream = feedResponse([ev(1, { contactRef: { platform: 'instagram', externalContactId: '111' } })]);
  const res = await GET(envFor('artist_os_managed', makeDb({ snapshot: { candidates: state.candidates } })), READ_TOKEN);
  assert(res.status === 200 && res.json.artifacts[0].payload.interactionCount === undefined && !res.json.artifacts[0].payload.reasonCodes.includes('repeat-interaction'), 'missing interactions must not invent interactionCount/repeat-interaction');
}

// ===== (h) strict payload schema =====
{
  const good = enr.scoreRelationship({ platform: 'instagram', kind: 'comment', externalEventId: 'e1', contactRef: { platform: 'instagram', externalContactId: '111' }, needsAction: true, replyState: 'none' }, enr.parseRelationshipState(JSON.stringify(state)), new Date());
  assert(enr.validateEnrichmentPayload(good), 'a valid payload must pass');
  const env0 = enr.buildEnrichmentEnvelope(good);
  assert(enr.validateEnrichmentEnvelope(env0), 'a valid envelope must pass');
  const mutations = [
    ['replyText key', { ...good, replyText: 'hello' }],
    ['draft key', { ...good, draft: 'x' }],
    ['handle key', { ...good, authorHandle: 'x' }],
    ['token key', { ...good, token: 't' }],
    ['subject extra key', { ...good, subject: { ...good.subject, handle: 'x' } }],
    ['analyzer extra key', { ...good, analyzer: { ...good.analyzer, note: 'x' } }],
    ['bad stage', { ...good, relationshipStage: 'vip' }],
    ['value > 1', { ...good, relationshipValue: 1.5 }],
    ['value < 0', { ...good, relationshipValue: -0.1 }],
    ['value undefined', { ...good, relationshipValue: undefined }],
    ['bad priority', { ...good, priority: 'urgent' }],
    ['bad handling', { ...good, recommendedHandling: 'send' }],
    ['bad reason code', { ...good, reasonCodes: ['because'] }],
    ['> 8 reason codes', { ...good, reasonCodes: Array(9).fill('dormant') }],
    ['fractional interactionCount', { ...good, interactionCount: 1.5 }],
    ['negative interactionCount', { ...good, interactionCount: -1 }],
    ['bad externalEventId', { ...good, subject: { ...good.subject, externalEventId: 'a:b' } }],
    ['bad platform', { ...good, subject: { ...good.subject, platform: 'myspace' } }],
    ['bad generatedAt', { ...good, generatedAt: 'now' }],
  ];
  for (const [label, p] of mutations) assert(!enr.validateEnrichmentPayload(p), `strict validator accepted: ${label}`);
  assert(!enr.validateEnrichmentEnvelope({ ...env0, extra: 1 }), 'envelope with an extra key accepted');
  assert(!enr.validateEnrichmentEnvelope({ ...env0, payload: { ...good, replyText: 'hi' } }), 'envelope with a replyText payload accepted');
  assert(!enr.validateEnrichmentEnvelope({ ...env0, producer: 'my-sns' }) && !enr.validateEnrichmentEnvelope({ ...env0, payloadVersion: 2 }), 'envelope producer/version not enforced');
  // The builder never emits an invalid artifact even for odd input.
  assert(enr.buildEnrichmentArtifacts([{ platform: 'instagram', kind: 'comment', externalEventId: 'a b', needsAction: true, replyState: 'none' }], { candidates: [], interactionCounts: null }, new Date()).length === 0, 'builder emitted an artifact with an invalid externalEventId');
}

// ===== Health capability =====
{
  const full = { ARTIST_OS_READ_TOKEN_SHA256: sha(READ_TOKEN), MY_SNS_URL, MY_SNS_READ_TOKEN: MY_SNS_TOKEN };
  const health = async (modeValue, extra) => (await call(envFor(modeValue, makeDb({ snapshot: state }), extra), 'GET', '/api/service/health', null)).json;
  for (const m of ['artist_os_managed']) {
    const h = await health(m, full);
    assert(h.status === 'healthy' && h.capabilities.includes('relationship.enrichment.read') && !h.degradedReason, `managed+configured must be healthy with the capability: ${JSON.stringify(h)}`);
    assert(!JSON.stringify(h).includes(MY_SNS_TOKEN) && !JSON.stringify(h).includes(sha(READ_TOKEN)), 'health leaked a secret');
    for (const [label, extra] of [['no read hash', { ARTIST_OS_READ_TOKEN_SHA256: undefined }], ['no url', { MY_SNS_URL: undefined }], ['no my-sns token', { MY_SNS_READ_TOKEN: undefined }]]) {
      const d = await health(m, { ...full, ...extra });
      assert(d.status === 'degraded' && typeof d.degradedReason === 'string' && d.degradedReason && !d.capabilities.includes('relationship.enrichment.read'), `managed ${label} must be degraded without the capability: ${JSON.stringify(d)}`);
    }
  }
  const bogus = await health('bogus', full);
  assert(bogus.status === 'degraded' && bogus.capabilities.includes('relationship.enrichment.read'), 'invalid mode is managed+degraded; capability follows usability');
  for (const standaloneValue of [undefined, '', 'standalone']) {
    const s = await health(standaloneValue, full);
    assert(s.status === 'healthy' && !s.capabilities.includes('relationship.enrichment.read') && !s.degradedReason, `standalone must not list the capability or degrade: ${JSON.stringify(s)}`);
  }
}

console.log('Relationship enrichment invariants passed.');
