import { readFile } from 'node:fs/promises';

const router = await readFile(new URL('../worker/src/router.ts', import.meta.url), 'utf8');
const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
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

if (!router.includes('expectedUpdatedAt') || !router.includes('INSERT OR IGNORE INTO state_snapshots') || !router.includes('AND updated_at = ?')) {
  throw new Error('D1 state sync lost its optimistic-concurrency guard.');
}

if (!providerApi.includes("markReservationUncertain(env, reservationId, 'user_read_uncertain')") || !providerApi.includes("markReservationUncertain(env, reservationId, 'rank_uncertain')")) {
  throw new Error('Paid-provider uncertainty no longer retains conservative budget reservations.');
}
if (providerApi.includes('DELETE FROM budget_ledger WHERE id = ?')) {
  throw new Error('A paid-provider failure path can delete an existing budget reservation.');
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

console.log(`Security invariants OK: ${protectedProviderPaths.length} protected provider routes, conservative uncertain-cost accounting, optimistic D1 sync, X scopes=${scopes.join(', ')}`);
