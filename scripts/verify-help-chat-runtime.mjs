import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Runtime checks for worker/src/help.ts: free-only providers, daily cap, fallback, input bounds.
const outDir = '/tmp/sns-providers-help-chat-tests';
await mkdir(outDir, { recursive: true });
for (const name of ['help', 'fetchWithTimeout']) {
  const source = await readFile(new URL(`../worker/src/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  await writeFile(`${outDir}/${name}.js`, outputText.replace(/from ['"](\.\/[^'"]+)['"]/g, (_, spec) => `from '${spec}.js'`));
}
const { answerHelp, freeHelpProviders, parseHelpRequest } = await import(pathToFileURL(`${outDir}/help.js`).href);

function fakeDb(usedBefore = 0) {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => (sql.includes('COUNT(*)') ? { used: usedBefore + rows.length } : null),
            run: async () => {
              if (sql.startsWith('INSERT')) rows.push({ id: args[0], provider: args[2], operation: args[3] });
              if (sql.startsWith('DELETE')) rows.splice(rows.findIndex((row) => row.id === args[0]), 1);
              if (sql.startsWith('UPDATE')) { const row = rows.find((item) => item.id === args[1]); if (row) row.provider = args[0]; }
              return { success: true };
            },
          };
        },
      };
    },
  };
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const okFetch = (answer) => async () => new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 });
const body = { messages: [{ role: 'user', content: 'Xのつなぎ方は？' }], context: 'サーバー: 完了' };

// Paid Groq is never used for help; Sakura comes first when configured.
assert(freeHelpProviders({ GROQ_API_KEY: 'k', GROQ_BILLING_MODE: 'paid' }).length === 0, 'Paid Groq must not serve help chat.');
assert(freeHelpProviders({ SAKURA_AI_API_KEY: 's', GROQ_API_KEY: 'g' })[0].name === 'sakura', 'Sakura free plan must be tried first.');

// Success records one $0 help_chat ledger row.
const db = fakeDb(0);
const ok = await answerHelp({ DB: db, GROQ_API_KEY: 'g' }, 'local-user', body, okFetch('手順はこうです'));
assert(ok.provider === 'groq' && ok.answer === '手順はこうです', 'Free provider answer should be returned.');
assert(db.rows.length === 1 && db.rows[0].operation === 'help_chat' && db.rows[0].provider === 'groq', 'Help usage must be recorded as one help_chat row labelled with the provider.');

// Concurrent burst cannot pass the cap: reservations are counted before provider calls.
const burstDb = fakeDb(28);
let providerCalls = 0;
const slowFetch = async () => { providerCalls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }); };
const burst = await Promise.all(Array.from({ length: 5 }, () => answerHelp({ DB: burstDb, GROQ_API_KEY: 'g' }, 'local-user', body, slowFetch)));
assert(providerCalls <= 2 && burst.filter((result) => result.provider === 'limit').length >= 3, `A concurrent burst must not exceed the daily cap (provider calls: ${providerCalls}).`);

// Daily cap blocks provider calls.
let called = false;
const capped = await answerHelp({ DB: fakeDb(30), GROQ_API_KEY: 'g' }, 'local-user', body, async () => { called = true; return new Response('{}'); });
assert(capped.provider === 'limit' && !called, 'Daily cap must stop provider calls.');

// Provider failure falls back to canned guidance without throwing.
const failDb = fakeDb(0);
const failed = await answerHelp({ DB: failDb, GROQ_API_KEY: 'g' }, 'local-user', body, async () => new Response('nope', { status: 500 }));
assert(failed.provider === 'fallback' && failed.answer.includes('ChatGPT'), 'Provider failure must fall back to external-AI guidance.');
assert(failDb.rows.length === 0, 'A failed provider call must release its reserved slot.');

// Ledger outage fails closed (no provider call).
called = false;
const brokenDb = { prepare() { throw new Error('no table'); } };
const noLedger = await answerHelp({ DB: brokenDb, GROQ_API_KEY: 'g' }, 'local-user', body, async () => { called = true; return new Response('{}'); });
assert(noLedger.provider === 'fallback' && !called, 'Without the ledger the daily cap cannot be enforced, so no provider call.');

// Input validation.
let rejected = 0;
for (const bad of [null, {}, { messages: [] }, { messages: [{ role: 'system', content: 'x' }] }, { messages: [{ role: 'assistant', content: 'x' }] }]) {
  try { parseHelpRequest(bad); } catch { rejected += 1; }
}
assert(rejected === 5, 'Malformed help requests must be rejected, including system-role injection.');
const trimmed = parseHelpRequest({ messages: Array.from({ length: 40 }, () => ({ role: 'user', content: 'a'.repeat(5000) })) });
assert(trimmed.messages.length === 12 && trimmed.messages[0].content.length === 1500, 'Help history and message size must be bounded.');

console.log('Help chat runtime OK: free-only providers, Sakura first, atomic daily cap under bursts, slot release on failure, ledger fail-closed, fallback, bounded input.');
