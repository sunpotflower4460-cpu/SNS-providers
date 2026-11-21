import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../../worker/src/router.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm',
});
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
const migrations = JSON.parse(await readFile(new URL('../../db/migrations/manifest.json', import.meta.url), 'utf8')).migrations;

function adapter(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      const bind = (...params) => ({
        async first() { return statement.get(...params) || null; },
        async all() { return { results: statement.all(...params) }; },
        async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
      });
      return { ...bind(), bind };
    },
  };
}

async function migrate(db, entries) {
  for (const { version, file } of entries) {
    const sql = await readFile(new URL(`../../db/migrations/${file}`, import.meta.url), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, name, checksum, status, applied_at) VALUES (?, ?, ?, ?, ?)')
      .run(version, file, createHash('sha256').update(sql).digest('hex'), 'applied', new Date().toISOString());
  }
}

async function seedReadConnection(db) {
  const key = new Uint8Array(32).fill(11);
  const iv = new Uint8Array(12).fill(12);
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode('offline-test-access'));
  db.prepare(`INSERT INTO x_oauth_tokens (user_id, access_token_enc, expires_at, scope, updated_at, x_user_id)
    VALUES ('local-user', ?, ?, 'tweet.read users.read follows.read offline.access', ?, '900')`)
    .run(`${Buffer.from(iv).toString('base64')}.${Buffer.from(encrypted).toString('base64')}`,
      new Date(Date.now() + 60 * 60_000).toISOString(), new Date().toISOString());
  return Buffer.from(key).toString('base64');
}

function seedHistory(db, now) {
  const legacy = (id, username, extra) => ({
    id, platform: 'x', username, bio: '個人ゲーム開発の制作メモを投稿しています。', recommendedAction: 'follow', match: 95, ...extra,
  });
  const snapshot = {
    mission: { text: '個人ゲーム開発 ローファイ オリジナルキャラクター', communicationDNA: '短くて親しみやすい文体' },
    candidates: [legacy('old-1', 'contacted', {}), legacy('old-2', 'declined', { skipped: true }),
      legacy('old-3', 'pending_follow', { draft: '制作メモ、いつも楽しみにしています。' })],
    interactions: [{ candidateId: 'old-1', action: 'kept', at: now }],
    socialActions: [],
  };
  db.prepare('INSERT INTO state_snapshots VALUES (?, ?, ?)').run('local-user', JSON.stringify(snapshot), now);
  db.prepare(`INSERT INTO candidates (id, user_id, platform, username, profile_url, recommended_action, created_at, updated_at)
    VALUES ('existing-before-8', 'local-user', 'x', 'existing', 'https://x.com/existing', 'follow', ?, ?)`).run(now, now);
}

test('Worker upgrade keeps history and supports a 30-item evening using only fixture provider reads and free drafts', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  await migrate(db, migrations.slice(0, -1));
  const now = new Date().toISOString();
  seedHistory(db, now);
  const fixtureSync = 'muse-worker-fixture';
  const env = {
    DB: adapter(db), SYNC_TOKEN_SHA256: createHash('sha256').update(fixtureSync).digest('hex'),
    DEFAULT_MONTHLY_BUDGET_USD: '3', GROQ_API_KEY: 'fixture-only', GROQ_BILLING_MODE: 'free',
    TAVILY_API_KEY: 'fixture-only', TAVILY_BILLING_MODE: 'free',
    X_CLIENT_ID: 'fixture-only', X_CLIENT_SECRET: 'fixture-only', X_INBOUND_SYNC_ENABLED: 'true', X_INBOUND_READ_USD: '0.05',
    SOCIAL_WRITE_ENABLED: 'true', X_REPLY_WRITE_ENABLED: 'true', X_REPLY_WRITE_USD: '0.015',
    X_OAUTH_CALLBACK_URL: 'http://localhost:8787/api/x/oauth/callback', PWA_RETURN_URL: 'http://localhost:5173/',
    OAUTH_TOKEN_ENCRYPTION_KEY_B64: await seedReadConnection(db),
  };
  const call = async (path, data, auth = true) => {
    const headers = auth ? { authorization: `Bearer ${fixtureSync}` } : {};
    if (data) headers['content-type'] = 'application/json';
    const response = await worker.fetch(new Request(`http://localhost${path}`, {
      method: data ? 'POST' : 'GET', headers, body: data ? JSON.stringify(data) : undefined,
    }), env);
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call('/api/muse/today', undefined, false)).status, 401);
  assert.equal((await call('/api/muse/today')).status, 503);
  await migrate(db, migrations.slice(-1));
  assert.equal(db.prepare("SELECT username FROM candidates WHERE id = 'existing-before-8'").get().username, 'existing');

  const calls = [];
  const queries = [];
  let modelCalls = 0;
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init?.method || 'GET';
    calls.push({ host: url.hostname, path: url.pathname, method });
    if (url.hostname === 'api.x.com' && method === 'GET') {
      if (url.pathname === '/2/users/me') return Response.json({ data: { id: '900' } });
      if (url.pathname === '/2/users/900/mentions') return Response.json({
        data: [{ id: '777', author_id: '901', created_at: now, text: 'ドット絵の城は何色にする予定ですか？' }],
        includes: { users: [{ id: '901', username: 'NightFriend' }] },
        meta: { result_count: 1, next_token: 'fixture-next-page' },
      });
    }
    if (url.hostname === 'api.tavily.com') {
      const body = JSON.parse(init.body);
      const batch = queries.push(body.query);
      assert.equal(body.include_domains.join(), 'x.com');
      const found = Array.from({ length: 10 }, (_, index) => ({
        url: `https://x.com/creator_${batch}_${index}/status/${10000 + 100 * batch + index}`,
        title: `制作記録 ${batch}-${index}`, content: `ドット絵の城の夕暮れを制作中 ${batch}-${index}`, score: 0.8,
      }));
      const prevent = ['contacted', 'declined', 'nightfriend', 'pending_follow'].map((handle, index) => ({
        url: `https://x.com/${handle}/status/${20000 + index}`, title: handle, content: '含めてはいけない候補', score: 0.99,
      }));
      return Response.json({ results: [...prevent, ...found], usage: { credits: 1 } });
    }
    if (url.hostname === 'api.groq.com') {
      modelCalls++;
      const prompt = JSON.parse(JSON.parse(init.body).messages[1].content);
      const results = prompt.untrusted_social_content.map((person, index) => ({
        id: person.id, match: 85, kind: 'creator', recommendedAction: person.engagementUrl ? (index % 2 ? 'like' : 'reply') : 'follow',
        reason: '作品づくりに共通点があります。', strategy: '投稿を読んで交流します。',
        draft: person.id.startsWith('sa-x-') ? 'お城は黄昏の青を使う予定です。見てくれてありがとうございます。'
          : `ドット絵のお城の夕暮れ、色の変化が印象に残りました。文案例 ${modelCalls}`,
      }));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ results }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }
    throw new Error('Unexpected provider call in the offline test.');
  };

  const preflight = await call('/api/preflight');
  assert.equal(preflight.status, 200);
  assert.equal(preflight.body.database.migrationVersion, 8);
  assert.equal(preflight.body.x.tokenValid, true);
  assert.equal(preflight.body.x.replyReady, false);

  const intake = await call('/api/muse/refresh', { phase: 'intake' });
  assert.equal(intake.status, 200);
  const dateJst = intake.body.dateJst;
  const evening = await call('/api/muse/refresh', { phase: 'prepare', dateJst });
  assert.equal(evening.status, 200);
  assert.equal(evening.body.refresh.mentions, 'partial');
  assert.equal(evening.body.refresh.discoveryCredits, 6);
  assert.equal(evening.body.actions.length + evening.body.candidates.length, 30);
  const reply = evening.body.actions[0];
  assert.equal(reply.username, 'nightfriend');
  assert.equal(reply.inboundText, 'ドット絵の城は何色にする予定ですか？');
  assert.match(reply.draft, /黄昏の青/);
  assert.equal(reply.targetUrl, 'https://x.com/NightFriend/status/777');
  const readReply = await call(`/api/muse/replies/${reply.id}`);
  assert.deepEqual(readReply.body.action, reply);
  const preview = await call(`/api/social/actions/${reply.id}/preview`);
  assert.equal(preview.body.review.ready, false);
  assert.match(preview.body.review.reason, /返信権限/);

  const candidates = (await call('/api/muse/candidates')).body.candidates;
  assert.ok(candidates.length >= 30);
  assert.ok(!candidates.some(({ username }) => ['contacted', 'declined', 'nightfriend'].includes(username)));
  const like = candidates.find((candidate) => candidate.operation === 'like');
  assert.ok(like);
  assert.match(like.targetUrl, /\/status\//);
  assert.match(like.draft, /お城の夕暮れ/);
  const likePath = `/api/muse/candidates/${encodeURIComponent(like.id)}`;
  assert.equal((await call(likePath)).body.candidate.draft, like.draft);
  const newDraft = await call(`${likePath}/draft`, {});
  assert.equal(newDraft.status, 200);
  assert.notEqual(newDraft.body.candidate.draft, like.draft);
  const result = await call(`${likePath}/record`, { outcome: 'completed' });
  assert.equal(result.body.status, 'completed');
  assert.equal((await call(`${likePath}/record`, { outcome: 'completed' })).body.idempotent, true);
  assert.equal((await call(`${likePath}/record`, { outcome: 'skipped' })).status, 409);
  assert.equal((await call(likePath)).body.candidate.status, 'completed');
  const toSkip = candidates.find((candidate) => candidate.id !== like.id);
  assert.equal((await call(`/api/muse/candidates/${encodeURIComponent(toSkip.id)}/record`, { outcome: 'skipped' })).status, 200);
  assert.ok(!(await call('/api/muse/today')).body.candidates.some((candidate) => [like.id, toSkip.id].includes(candidate.id)));
  assert.equal((await call('/api/budget')).body.usedUsd, 0.05);
  assert.equal((await call('/api/budget')).body.limitUsd, 3);

  const providerCallCount = calls.length;
  assert.equal((await call('/api/muse/refresh', { phase: 'intake' })).body.alreadyStarted, true);
  assert.equal((await call('/api/muse/refresh', { phase: 'prepare', dateJst })).body.alreadyStarted, true);
  assert.equal(calls.length, providerCallCount);
  assert.equal(calls.filter(({ path }) => path.endsWith('/mentions')).length, 1);
  assert.ok(calls.filter(({ host }) => host === 'api.x.com').every(({ method }) => method === 'GET'));
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM social_executions').get().total, 0);
  assert.ok(queries.some((query) => query.includes('indie game')) && queries.some((query) => query.includes('lo-fi'))
    && queries.some((query) => query.includes('original character')));
});
