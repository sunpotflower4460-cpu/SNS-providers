import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const cli = fileURLToPath(new URL('./index.mjs', import.meta.url));

// The smoke fixture serves only GETs. Even a test failure cannot reach an SNS write.
test('Muse reads and formats the evening queue and previews only one exact X reply', async (t) => {
  const fixtureToken = 'muse-cli-fixture';
  const action = { id: 'sa-example', platform: 'x', type: 'reply_inbound', status: 'ready', externalEventId: '123' };
  const item = {
    ...action, recipientId: '456', username: 'example', inboundText: 'ゲームの操作について質問です。',
    draft: '最初の下書き', draftSource: 'ai', targetUrl: 'https://x.com/example/status/123',
  };
  const review = {
    ready: true, binding: 'a'.repeat(64), recipient: { id: '456', username: 'example' },
    target: { operation: 'x_reply_write', externalEventId: '123' }, costUsd: 0.015, maxDraftLength: 2400,
  };
  const candidate = {
    id: 'candidate:web-x-creator', username: 'creator', operation: 'like', mode: 'handoff', rank: 1, status: 'pending',
    draft: '街のドット絵、夕暮れの色合いが素敵でした。', profileSummary: 'インディーゲーム制作者',
    targetUrl: 'https://x.com/creator/status/987', reason: '創作ジャンルが近いため。',
  };
  const replies = {
    '/api/preflight': { ok: true, fixture: fixtureToken },
    '/api/budget': { usedUsd: 1.25, limitUsd: 3, ledgerAvailable: true },
    '/api/settings/runtime': { effectiveLimitUsd: 2 },
    '/api/muse/today': { ok: true, target: 30, candidateReserve: 1, actions: [item], candidates: [candidate] },
    '/api/muse/candidates': { ok: true, candidates: [candidate] },
    '/api/muse/candidates/candidate%3Aweb-x-creator': { ok: true, candidate },
    '/api/muse/replies/sa-example': { ok: true, action: item },
    '/api/social/actions/sa-example/preview': { ok: true, action, review, lastExecution: null },
  };
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, authenticated: request.headers.authorization === `Bearer ${fixtureToken}` });
    const body = replies[request.url];
    response.writeHead(request.method === 'GET' && body ? 200 : 400, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body || { ok: false }));
  }).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const run = (...args) => promisify(execFile)(process.execPath, [cli, ...args], {
    env: {
      ...process.env,
      SNSP_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      SNSP_SYNC_TOKEN: fixtureToken,
    },
  });
  const read = async (...args) => JSON.parse((await run(...args, '--json')).stdout);

  assert.equal((await read('preflight')).fixture, '[REDACTED]');
  assert.equal((await read('budget')).remainingUsd, 0.75);
  const today = await read('today');
  assert.deepEqual(today.actions, [item]);
  assert.deepEqual(today.candidates, [candidate]);
  assert.equal((await read('candidates')).candidates[0].id, candidate.id);
  assert.equal((await read('show', action.id)).draft, item.draft);
  assert.equal((await read('show', candidate.id)).candidate.mode, 'handoff');
  const human = (await run('today')).stdout;
  assert.match(human, /今夜の交流 2件/);
  assert.ok(human.includes(`\`\`\`\n${item.draft}\n\`\`\``));
  assert.match(human, /いいね · @creator/);

  const preview = await read('execute', action.id);
  assert.equal(preview.draft, item.draft);
  assert.equal(preview.costUsd, 0.015);
  assert.match(preview.confirmation, /^[a-f0-9]{64}$/);
  const edited = await read('execute', action.id, '--draft', '本人が直した本文です。');
  assert.notEqual(edited.confirmation, preview.confirmation);
  assert.equal((await read('execute', action.id, '--draft', 'https://example.com')).confirmation, null);
  item.draft = '変更後の下書き';
  await assert.rejects(run('execute', action.id, '--confirm', preview.confirmation), /preview changed/);
  await assert.rejects(run('execute', action.id, 'old'), /Usage:/);
  await assert.rejects(run('execute', candidate.id), /official app/);
  await assert.rejects(run('record', candidate.id), /Usage:/);
  assert.ok(requests.every(({ method, authenticated }) => method === 'GET' && authenticated));
});
