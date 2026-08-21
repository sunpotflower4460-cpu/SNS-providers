import { readFile } from 'node:fs/promises';

const router = await readFile(new URL('../worker/src/router.ts', import.meta.url), 'utf8');
const xOAuth = await readFile(new URL('../worker/src/xOAuth.ts', import.meta.url), 'utf8');

const protectedProviderPaths = [
  '/api/budget',
  '/api/ai/rank',
  '/api/x/enrich',
  '/api/discover/social',
];

for (const path of protectedProviderPaths) {
  if (!router.includes(`'${path}'`)) {
    throw new Error(`Missing protected provider path: ${path}`);
  }
}

if (!/if \(PROVIDER_COST_PATHS\.has\(url\.pathname\)\)\s*\{[\s\S]{0,300}?authorizeSync\(request, env\)/.test(router)) {
  throw new Error('Provider-cost routes are not guarded by authorizeSync().');
}

const scopeMatch = xOAuth.match(/const READ_ONLY_SCOPES\s*=\s*\[([^\]]+)\]/s);
if (!scopeMatch) throw new Error('READ_ONLY_SCOPES definition was not found.');

const scopes = [...scopeMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
const requiredReadScopes = ['tweet.read', 'users.read', 'follows.read', 'offline.access'];
for (const scope of requiredReadScopes) {
  if (!scopes.includes(scope)) throw new Error(`Required read-only X scope missing: ${scope}`);
}

const writeScopes = scopes.filter((scope) => scope.includes('.write') || scope === 'dm.write');
if (writeScopes.length) {
  throw new Error(`Write-capable X OAuth scope detected: ${writeScopes.join(', ')}`);
}

console.log(`Security invariants OK: ${protectedProviderPaths.length} protected provider routes, X scopes=${scopes.join(', ')}`);
