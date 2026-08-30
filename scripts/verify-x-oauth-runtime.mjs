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
  serializeRequestedScopesJson,
  parseRequestedScopesJson,
  validateGrantedScopes,
  startXOAuth,
} = await import(pathToFileURL(`${outDir}/xOAuth.js`).href);

function fail(message) {
  throw new Error(message);
}

const READ = ['tweet.read', 'users.read', 'follows.read', 'offline.access'];
const REPLY = [...READ, 'tweet.write'];

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
if (scopesForOAuthIntent('read').some((scope) => scope.includes('.write') || scope === 'dm.write' || scope === 'dm.read')) {
  fail('Default OAuth intent requested a write-capable scope.');
}
if (scopesForOAuthIntent('reply').join(' ') !== REPLY.join(' ')) fail('Reply upgrade did not request tweet.write plus the read set.');
if (scopesForOAuthIntent('reply').includes('follows.write') || scopesForOAuthIntent('reply').includes('dm.write') || scopesForOAuthIntent('reply').includes('like.write')) {
  fail('Reply upgrade requested follow, like, or DM scopes.');
}

if (parseOAuthIntent('relationship') !== 'relationship' || parseOAuthIntent('engagement') !== 'engagement' || parseOAuthIntent('dm') !== 'dm') {
  fail('Explicit relationship/engagement/DM OAuth intents were rejected.');
}
const RELATIONSHIP = [...READ, 'follows.write'];
const ENGAGEMENT = [...READ, 'like.write'];
const DM = [...READ, 'dm.read', 'dm.write'];
if (scopesForOAuthIntent('relationship').join(' ') !== RELATIONSHIP.join(' ')) fail('Relationship upgrade did not request follows.write only.');
if (scopesForOAuthIntent('engagement').join(' ') !== ENGAGEMENT.join(' ')) fail('Engagement upgrade did not request like.write only.');
if (scopesForOAuthIntent('dm').join(' ') !== DM.join(' ')) fail('DM upgrade did not request dm.read+dm.write only.');
if (scopesForOAuthIntent('relationship').includes('tweet.write') || scopesForOAuthIntent('relationship').includes('like.write')) {
  fail('Relationship upgrade requested extra write scopes.');
}

try {
  parseRequestedScopesJson(JSON.stringify([...READ, 'tweet.write', 'follows.write']));
  fail('Session JSON accepted a mixed reply+follow upgrade set.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('unsupported scope set')) fail(error);
}
if (parseRequestedScopesJson(JSON.stringify(RELATIONSHIP)).join(' ') !== RELATIONSHIP.join(' ')) {
  fail('Session JSON rejected the relationship upgrade set.');
}

try {
  validateGrantedScopes('tweet.read tweet.write', { requestedScopes: READ });
  fail('Default connect accepted an unrequested tweet.write grant.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('unexpected scope')) fail(error);
}

const replyGrant = validateGrantedScopes(REPLY.join(' '), { requestedScopes: REPLY });
if (!replyGrant.includes('tweet.write')) fail('Reply-session grant dropped tweet.write.');

try {
  validateGrantedScopes(READ.join(' '), { requestedScopes: REPLY });
  fail('Reply session accepted a grant that omitted tweet.write.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('missing required scope')) fail(error);
}

try {
  validateGrantedScopes([...REPLY, 'follows.write'].join(' '), { requestedScopes: REPLY });
  fail('Reply session accepted an unrequested follows.write grant.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('unexpected scope')) fail(error);
}

const storedWrite = validateGrantedScopes(REPLY.join(' '), { allowStoredOptionalWrites: true });
if (!storedWrite.includes('tweet.write')) fail('Stored reply-upgraded token was rejected.');

const refreshedOmitted = validateGrantedScopes(undefined, {
  verifiedFallbackScope: REPLY.join(' '),
  allowRefreshOmission: true,
  allowStoredOptionalWrites: true,
});
if (!refreshedOmitted.includes('tweet.write')) fail('Refresh that omitted scope metadata dropped the verified tweet.write grant.');

const refreshedDowngrade = validateGrantedScopes(READ.join(' '), {
  verifiedFallbackScope: REPLY.join(' '),
  allowRefreshOmission: true,
  allowStoredOptionalWrites: true,
});
if (refreshedDowngrade.includes('tweet.write')) fail('Refresh that dropped tweet.write still claimed reply capability.');

try {
  validateGrantedScopes([...REPLY, 'follows.write'].join(' '), {
    verifiedFallbackScope: REPLY.join(' '),
    allowRefreshOmission: true,
    allowStoredOptionalWrites: true,
  });
  fail('Refresh was allowed to add an unrequested follows.write scope.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('unexpected scope')) fail(error);
}

if (parseRequestedScopesJson(serializeRequestedScopesJson(READ)).join(' ') !== READ.join(' ')) {
  fail('Session requested-scope JSON did not round-trip the read-only set.');
}
if (parseRequestedScopesJson(serializeRequestedScopesJson(REPLY)).join(' ') !== REPLY.join(' ')) {
  fail('Session requested-scope JSON did not round-trip the reply upgrade set.');
}
try {
  parseRequestedScopesJson(JSON.stringify([...READ, 'tweet.write', 'follows.write']));
  fail('Session JSON accepted a mixed reply+follow upgrade set.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('unsupported scope set')) fail(error);
}

function createSessionD1() {
  const sessions = new Map();
  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM x_oauth_sessions WHERE state = ?')) {
                return sessions.get(params[0]) || null;
              }
              return null;
            },
            async run() {
              if (normalized.startsWith('INSERT INTO x_oauth_sessions')) {
                sessions.set(params[0], {
                  state: params[0],
                  code_verifier: params[1],
                  created_at: params[2],
                  requested_scopes_json: params[3],
                });
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('DELETE FROM x_oauth_sessions')) {
                if (normalized.includes('created_at <')) {
                  for (const [key, row] of sessions) {
                    if (row.created_at < params[0]) sessions.delete(key);
                  }
                } else {
                  sessions.delete(params[0]);
                }
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    _sessions: sessions,
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
  if (scope.includes('tweet.write') || scope.includes('follows.write') || scope.includes('dm.write')) {
    fail('Default authorize URL requested write scopes.');
  }
  const session = [...env.DB._sessions.values()][0];
  if (!session || parseRequestedScopesJson(session.requested_scopes_json).join(' ') !== READ.join(' ')) {
    fail('Default OAuth session did not persist the read-only requested set.');
  }
}

{
  const env = oauthEnv();
  const url = new URL(await startXOAuth(env, 'reply'));
  const scope = url.searchParams.get('scope') || '';
  if (!scope.includes('tweet.write') || scope !== REPLY.join(' ')) fail(`Reply authorize URL requested ${scope}`);
  if (scope.includes('follows.write') || scope.includes('dm.write') || scope.includes('dm.read')) {
    fail('Reply authorize URL requested follow or DM scopes.');
  }
  const session = [...env.DB._sessions.values()][0];
  if (!session || parseRequestedScopesJson(session.requested_scopes_json).join(' ') !== REPLY.join(' ')) {
    fail('Reply OAuth session did not persist tweet.write in the requested set.');
  }
}

{
  const env = oauthEnv();
  const defaulted = new URL(await startXOAuth(env));
  if ((defaulted.searchParams.get('scope') || '') !== READ.join(' ')) fail('startXOAuth() without intent did not stay read-only.');
}

{
  const env = oauthEnv();
  const url = new URL(await startXOAuth(env, 'relationship'));
  const scope = url.searchParams.get('scope') || '';
  if (!scope.includes('follows.write') || scope.includes('tweet.write') || scope.includes('like.write') || scope.includes('dm.write')) {
    fail(`Relationship authorize URL requested ${scope}`);
  }
}

{
  const env = oauthEnv();
  const url = new URL(await startXOAuth(env, 'engagement'));
  const scope = url.searchParams.get('scope') || '';
  if (!scope.includes('like.write') || scope.includes('tweet.write') || scope.includes('follows.write') || scope.includes('dm.write')) {
    fail(`Engagement authorize URL requested ${scope}`);
  }
}

console.log('X OAuth runtime OK: default connect stays read-only, reply/relationship/engagement/DM upgrades request only their minimum scopes, session JSON binds requested scopes, callback/refresh grant validation fail-closes extras, and refresh can preserve tweet.write.');
