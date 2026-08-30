import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = '/tmp/sns-providers-x-oauth-tests';
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

await emit('fetchWithTimeout.js', new URL('../worker/src/fetchWithTimeout.ts', import.meta.url));
await emit('syncLease.js', new URL('../worker/src/syncLease.ts', import.meta.url));
await emit('xOAuth.js', new URL('../worker/src/xOAuth.ts', import.meta.url));

const {
  parseOAuthIntent,
  scopesForOAuthIntent,
  cumulativeScopesForIntent,
  serializeRequestedScopesJson,
  parseRequestedScopesJson,
  validateGrantedScopes,
  startXOAuth,
  completeXOAuth,
} = await import(pathToFileURL(`${outDir}/xOAuth.js`).href);

function fail(message) {
  throw new Error(message);
}

const READ = ['tweet.read', 'users.read', 'follows.read', 'offline.access'];
const REPLY = [...READ, 'tweet.write'];
const FOLLOW = [...READ, 'follows.write'];
const LIKE = [...READ, 'like.read', 'like.write'];
const DM = [...READ, 'dm.read', 'dm.write'];

if (parseOAuthIntent(undefined) !== 'read' || parseOAuthIntent('read') !== 'read' || parseOAuthIntent('reply') !== 'reply') {
  fail('OAuth intent parsing lost the default-read / explicit-reply split.');
}
try {
  parseOAuthIntent('follow');
  fail('Follow OAuth intent was accepted.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('Unsupported X OAuth intent')) fail(error);
}

if (scopesForOAuthIntent('read').join(' ') !== READ.join(' ')) fail('Default OAuth intent requested unexpected scopes.');
if (scopesForOAuthIntent('read').some((scope) => scope.includes('.write') || scope === 'dm.write' || scope === 'dm.read' || scope === 'like.read')) {
  fail('Default OAuth intent requested a write-capable scope.');
}
if (scopesForOAuthIntent('reply').join(' ') !== REPLY.join(' ')) fail('Reply upgrade from empty did not request tweet.write plus the read set.');
if (scopesForOAuthIntent('engagement').join(' ') !== LIKE.join(' ')) fail('Engagement upgrade must request like.read + like.write.');

const permutations = [
  { steps: ['reply'], expect: REPLY },
  { steps: ['relationship'], expect: FOLLOW },
  { steps: ['engagement'], expect: LIKE },
  { steps: ['dm'], expect: DM },
  { steps: ['reply', 'relationship'], expect: [...READ, 'tweet.write', 'follows.write'] },
  { steps: ['relationship', 'reply'], expect: [...READ, 'tweet.write', 'follows.write'] },
  { steps: ['reply', 'like', 'dm', 'relationship'], expect: [...READ, 'tweet.write', 'follows.write', 'like.read', 'like.write', 'dm.read', 'dm.write'] },
  { steps: ['dm', 'relationship', 'reply', 'engagement'], expect: [...READ, 'tweet.write', 'follows.write', 'like.read', 'like.write', 'dm.read', 'dm.write'] },
];
for (const permutation of permutations) {
  let current = [...READ];
  for (const step of permutation.steps) {
    const intent = step === 'like' ? 'engagement' : step;
    current = cumulativeScopesForIntent(intent, current);
  }
  const missing = permutation.expect.filter((scope) => !current.includes(scope));
  const extraLost = current.filter((scope) => !permutation.expect.includes(scope) && !READ.includes(scope));
  if (missing.length || extraLost.length) fail(`Permutation ${permutation.steps.join('→')} lost scopes: missing=${missing} extra=${extraLost} got=${current}`);
}

if (parseRequestedScopesJson(JSON.stringify([...READ, 'tweet.write', 'follows.write'])).includes('tweet.write') === false) {
  fail('Session JSON rejected a cumulative reply+follow set.');
}

try {
  validateGrantedScopes('tweet.read tweet.write', { requestedScopes: READ });
  fail('Default connect accepted an unrequested tweet.write grant.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('unexpected scope')) fail(error);
}

try {
  validateGrantedScopes([...REPLY, 'media.write'].join(' '), { requestedScopes: REPLY });
  fail('Extra provider-injected scope was accepted.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('unexpected scope')) fail(error);
}

function createSessionD1() {
  const sessions = new Map();
  const tokens = new Map();
  const snapshots = new Map();
  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM x_oauth_sessions WHERE state = ?')) return sessions.get(params[0]) || null;
              if (normalized.includes('FROM x_oauth_tokens WHERE user_id = ?')) return tokens.get(params[0]) || null;
              return null;
            },
            async run() {
              if (normalized.startsWith('INSERT INTO x_oauth_sessions')) {
                sessions.set(params[0], {
                  state: params[0],
                  code_verifier: params[1],
                  created_at: params[2],
                  requested_scopes_json: params[3],
                  intent: params[4] || 'read',
                  expected_x_user_id: params[5] || null,
                });
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('INSERT INTO x_oauth_tokens')) {
                tokens.set(params[0], {
                  user_id: params[0],
                  access_token_enc: params[1],
                  refresh_token_enc: params[2],
                  expires_at: params[3],
                  scope: params[4],
                  updated_at: params[5],
                  x_user_id: params[6] || null,
                });
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('DELETE FROM x_oauth_sessions')) {
                if (normalized.includes('created_at <')) {
                  for (const [key, row] of sessions) {
                    if (row.created_at < params[0]) sessions.delete(key);
                  }
                } else sessions.delete(params[0]);
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('DELETE FROM x_owned') || normalized.startsWith('DELETE FROM x_follow')) {
                snapshots.set(params[0], 'cleared');
                return { meta: { changes: 1 } };
              }
              if (normalized.includes('INSERT INTO budget_ledger') || normalized.startsWith('DELETE FROM budget_ledger')) {
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    _sessions: sessions,
    _tokens: tokens,
    _snapshots: snapshots,
  };
}

function oauthEnv() {
  const raw = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  return {
    DB: createSessionD1(),
    X_CLIENT_ID: 'test-client',
    X_CLIENT_SECRET: 'test-secret',
    X_OAUTH_CALLBACK_URL: 'http://localhost:8787/api/x/oauth/callback',
    PWA_RETURN_URL: 'http://localhost:5173/',
    OAUTH_TOKEN_ENCRYPTION_KEY_B64: raw,
  };
}

{
  const env = oauthEnv();
  const url = new URL(await startXOAuth(env, 'read'));
  if (url.hostname !== 'x.com' || url.pathname !== '/i/oauth2/authorize') fail('Default authorize URL was not the official X OAuth endpoint.');
  const scope = url.searchParams.get('scope') || '';
  if (scope !== READ.join(' ')) fail(`Default authorize URL requested ${scope}`);
}

{
  const env = oauthEnv();
  try {
    await startXOAuth(env, 'reply');
    fail('Reply upgrade without a connected account was allowed.');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('existing connected account')) fail(error);
  }
}

{
  const mixed = parseRequestedScopesJson(JSON.stringify([...READ, 'tweet.write', 'follows.write', 'like.read', 'like.write']));
  if (!mixed.includes('tweet.write') || !mixed.includes('like.read')) fail('Cumulative session JSON dropped granted scopes.');
}

{
  const env = oauthEnv();
  const originalFetch = globalThis.fetch;
  let meId = '42';
  let grantScope = READ.join(' ');
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/2/oauth2/token')) {
      const scopeSnapshot = grantScope;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            token_type: 'bearer',
            expires_in: 7200,
            access_token: `access-${meId}`,
            refresh_token: `refresh-${meId}`,
            scope: scopeSnapshot,
          };
        },
      };
    }
    if (href.includes('/2/users/me')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: { id: meId, username: 'alice', name: 'Alice' } };
        },
      };
    }
    fail(`Unexpected fetch during OAuth test: ${href}`);
  };
  try {
    const connectUrl = new URL(await startXOAuth(env, 'read'));
    const state = connectUrl.searchParams.get('state');
    const connected = await completeXOAuth(env, new URL(`http://localhost:8787/api/x/oauth/callback?code=abc&state=${state}`));
    if (!String(connected).includes('x_oauth=connected')) fail('Default connect did not succeed.');
    const originalToken = { ...env.DB._tokens.get('local-user') };
    env.DB._snapshots.set('local-user', 'owned');

    const replyUrl = new URL(await startXOAuth(env, 'reply'));
    if (replyUrl.searchParams.get('scope') !== REPLY.join(' ')) fail(`Reply upgrade dropped cumulative scopes: ${replyUrl.searchParams.get('scope')}`);
    const replySession = [...env.DB._sessions.values()].at(-1);
    if (replySession.expected_x_user_id !== '42' || replySession.intent !== 'reply') fail('Upgrade session did not lock the connected X user ID.');

    meId = '99';
    grantScope = REPLY.join(' ');
    const mismatch = await completeXOAuth(env, new URL(`http://localhost:8787/api/x/oauth/callback?code=def&state=${replyUrl.searchParams.get('state')}`));
    if (!String(mismatch).includes('x_oauth=account_mismatch')) fail('Different X account during upgrade was accepted.');
    if (env.DB._tokens.get('local-user').access_token_enc !== originalToken.access_token_enc) fail('Account mismatch stored a new token.');
    if (env.DB._tokens.get('local-user').scope !== originalToken.scope) fail('Account mismatch changed old permissions.');
    if (env.DB._snapshots.get('local-user') !== 'owned') fail('Account mismatch cleared owned X snapshots.');

    meId = '42';
    const replyUrl2 = new URL(await startXOAuth(env, 'reply'));
    grantScope = [...REPLY, 'media.write'].join(' ');
    let extraThrew = null;
    try {
      await completeXOAuth(env, new URL(`http://localhost:8787/api/x/oauth/callback?code=ghi&state=${replyUrl2.searchParams.get('state')}`));
    } catch (error) {
      extraThrew = error instanceof Error ? error.message : String(error);
    }
    if (!extraThrew || !extraThrew.includes('unexpected scope')) {
      fail(`Provider-injected extra scope was accepted (${extraThrew || 'no throw'}; stored=${env.DB._tokens.get('local-user').scope})`);
    }
    if (env.DB._tokens.get('local-user').access_token_enc !== originalToken.access_token_enc) fail('Extra-scope failure replaced the old token.');

    const replyUrl3 = new URL(await startXOAuth(env, 'reply'));
    grantScope = REPLY.join(' ');
    const upgraded = await completeXOAuth(env, new URL(`http://localhost:8787/api/x/oauth/callback?code=jkl&state=${replyUrl3.searchParams.get('state')}`));
    if (!String(upgraded).includes('x_oauth=upgraded')) fail('Same-account reply upgrade did not succeed.');
    if (!env.DB._tokens.get('local-user').scope.includes('tweet.write')) fail('Successful upgrade lost tweet.write.');
    if (env.DB._snapshots.get('local-user') !== 'owned') fail('Same-account upgrade cleared owned snapshots.');

    const followUrl = new URL(await startXOAuth(env, 'relationship'));
    if (!followUrl.searchParams.get('scope').includes('tweet.write') || !followUrl.searchParams.get('scope').includes('follows.write')) {
      fail('Follow upgrade after reply dropped tweet.write.');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('X OAuth runtime OK: default connect stays read-only, upgrades accumulate verified scopes including like.read, extra grants fail closed, mixed session sets are valid, and same-account upgrades reject a different X user without replacing the old token.');
