import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const cli = fileURLToPath(new URL('./index.mjs', import.meta.url));

test('Muse reads saved data and sends no POST when approval is absent or stale', async (t) => {
  const fixtureToken = 'muse-test-token';
  const action = { id: 'sa-example', platform: 'x', type: 'reply_inbound', status: 'ready', externalEventId: '123' };
  const draft = { ...action, draft: '最初の下書き' };
  const review = {
    ready: true,
    binding: 'a'.repeat(64),
    recipient: { id: '456', username: 'example' },
    target: { operation: 'x_reply_write', externalEventId: '123' },
    costUsd: 0.015,
    maxDraftLength: 2400,
  };
  const replies = {
    '/api/preflight': { ok: true, fixture: fixtureToken },
    '/api/budget': { usedUsd: 1.25, limitUsd: 3, ledgerAvailable: true },
    '/api/settings/runtime': { effectiveLimitUsd: 2 },
    '/api/social/actions': { ok: true, actions: [action, { ...action, id: 'old', status: 'completed' }] },
    '/api/social/actions/sa-example/preview': { ok: true, action, review, lastExecution: null },
    '/api/sync/state': {
      found: true,
      state: {
        socialActions: [draft],
        candidates: [{ id: 'x-example', platform: 'x', username: 'example', recommendedAction: 'follow' }],
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, auth: request.headers.authorization });
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
  const read = async (...args) => JSON.parse((await run(...args)).stdout);

  assert.equal((await read('preflight')).fixture, '[REDACTED]');
  assert.equal((await read('budget')).remainingUsd, 0.75);
  const today = await read('today');
  assert.deepEqual(today.actions.map(({ id }) => id), [action.id]);
  assert.equal(today.actions[0].hasSavedDraft, true);
  assert.equal(today.candidates[0].id, 'candidate:x-example');
  assert.equal((await read('show', action.id)).draft, draft.draft);
  assert.equal((await read('show', 'candidate:x-example')).mode, 'handoff');

  const preview = await read('execute', action.id);
  assert.equal(preview.draft, draft.draft);
  assert.equal(preview.costUsd, 0.015);
  assert.match(preview.confirmation, /^[a-f0-9]{64}$/);
  draft.draft = '変更後の下書き';
  await assert.rejects(run('execute', action.id, '--confirm', preview.confirmation), /preview changed/);
  await assert.rejects(run('execute', action.id, 'old'), /Usage:/);
  await assert.rejects(run('execute', 'candidate:x-example'), /official app/);
  assert.ok(requests.every(({ method, auth }) => method === 'GET' && auth === `Bearer ${fixtureToken}`));
});
