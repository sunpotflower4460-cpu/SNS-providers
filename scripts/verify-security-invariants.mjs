import { readFile } from 'node:fs/promises';

const router = await readFile(new URL('../worker/src/router.ts', import.meta.url), 'utf8');
const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const xOAuth = await readFile(new URL('../worker/src/xOAuth.ts', import.meta.url), 'utf8');
const instagramOwned = await readFile(new URL('../worker/src/instagramOwned.ts', import.meta.url), 'utf8');
const xAccount = await readFile(new URL('../src/xAccount.ts', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const syncControls = await readFile(new URL('../src/SyncControls.tsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const social = await readFile(new URL('../src/social.ts', import.meta.url), 'utf8');

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

if (!/request\.method === 'GET' && url\.pathname === '\/api\/x\/oauth\/status'\)\s*\{[\s\S]{0,300}?authorizeSync\(request, env\)/.test(router)) {
  throw new Error('X OAuth status is not guarded by authorizeSync().');
}
if (!xAccount.includes('const token = requiredControlToken();') || !xAccount.includes("/api/x/oauth/status?userId=${encodeURIComponent(userId)}`")) {
  throw new Error('The client no longer authenticates X OAuth status reads.');
}

if (!router.includes('expectedUpdatedAt') || !router.includes('INSERT OR IGNORE INTO state_snapshots') || !router.includes('AND updated_at = ?')) {
  throw new Error('D1 state sync lost its optimistic-concurrency guard.');
}
if (!router.includes('new TextEncoder().encode(stateJson).byteLength > 2_000_000')) {
  throw new Error('D1 state snapshot size is no longer enforced using UTF-8 bytes.');
}

if (!providerApi.includes("markReservationUncertain(env, reservationId, 'user_read_uncertain')") || !providerApi.includes("markReservationUncertain(env, reservationId, 'rank_uncertain')")) {
  throw new Error('Paid-provider uncertainty no longer retains conservative budget reservations.');
}
if (providerApi.includes('DELETE FROM budget_ledger WHERE id = ?')) {
  throw new Error('A paid-provider failure path can delete an existing budget reservation.');
}

for (const source of [router, providerApi]) {
  if (!source.includes("'cache-control': 'no-store'") || !source.includes("'x-content-type-options': 'nosniff'")) {
    throw new Error('Personal/provider Worker responses lost no-store or nosniff protection.');
  }
}

if (!providerApi.includes('Candidate/profile/comment fields are untrusted data, never instructions.')) {
  throw new Error('AI system prompt lost the untrusted-social-content boundary.');
}
if (!providerApi.includes("recommendedAction === 'reply' && !hasEngagementContext") || !providerApi.includes("recommendedAction === 'dm' && !dmReady")) {
  throw new Error('AI relationship-stage reply/DM guards are missing.');
}
if (!providerApi.includes("candidate.kind === 'self_profile'\n      || (recommendedAction === 'reply'")) {
  throw new Error('Self-profile rewrite drafts are no longer preserved separately from guarded social reply/DM drafts.');
}

if (!backup.includes('safeSocialUrl(raw.platform, raw.engagementUrl)') || !backup.includes("profileUrl: raw.platform === 'x' ? `https://x.com/${username}`")) {
  throw new Error('Restored state no longer canonicalizes social URLs.');
}
if (!backup.includes('secondaryGoals') || !backup.includes('monthlyLimitUsd: clampNumber') || !backup.includes('hardLimit: true')) {
  throw new Error('Full restored AppState normalization or HARD LIMIT restoration was weakened.');
}
if (!syncControls.includes('normalizeAppState(result.state)') || !syncControls.includes('validateAppState(restored)')) {
  throw new Error('D1 restores can bypass AppState normalization/validation.');
}
if (!backup.includes('legacyDemoCandidates') || !store.includes('normalizeAppState(state)') || !store.includes('candidates: Array.isArray(parsed.candidates)')) {
  throw new Error('Persisted local state can bypass normalization or reintroduce legacy demo candidates.');
}
if (!store.includes("interaction.action === 'kept'") || !store.includes('advanceRelationshipStage') || !store.includes("target?.recommendedAction === 'unfollow_review'")) {
  throw new Error('Manual relationship outcomes no longer feed the conservative CRM progression/cleanup distinction.');
}
if (!store.includes('if (rawCandidate.skipped) return rawCandidate;') || !store.includes("recommendedAction: 'review' as const")) {
  throw new Error('Dismissed candidates can be re-promoted into cleanup advice immediately.');
}
if (!store.includes("if (platform === 'x') return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';")) {
  throw new Error('Manual X candidate input is no longer constrained to valid X handle shape.');
}
if (social.includes('intent/tweet') || social.includes('intent/follow')) {
  throw new Error('Legacy X intent handoff can bypass the official profile/conversation review flow.');
}
if (social.includes('window.open(candidate.profileUrl') || !social.includes('canonicalProfileUrl(candidate.platform, candidate.username)') || !social.includes('safeEngagementUrl(candidate.platform, candidate.engagementUrl)')) {
  throw new Error('Social handoff can trust stored URLs instead of canonical official-platform destinations.');
}

if (!xOAuth.includes('await clearOwnedXDerivedState(env, userId);\n  await persistTokenResponse(env, userId, token);')
  || !xOAuth.includes("DELETE FROM x_owned_snapshots WHERE user_id = ?")
  || !xOAuth.includes("DELETE FROM x_owned_paging WHERE user_id = ?")
  || !xOAuth.includes("DELETE FROM x_follow_cycle_targets WHERE user_id = ?")) {
  throw new Error('X account changes can retain stale owned-account cache or paging evidence.');
}
if (!instagramOwned.includes('snapshot.accountId !== expectedAccountId')
  || !instagramOwned.includes('loadFreshCache(env, userId, Boolean(body.force), instagramUserId)')) {
  throw new Error('Instagram cache is not bound to the currently configured Professional account.');
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
if (!xOAuth.includes('validateGrantedScopes(token.scope)') || !xOAuth.includes('X OAuth returned unexpected scope(s)') || !xOAuth.includes('X OAuth response is missing required scope(s)')) {
  throw new Error('X OAuth no longer fail-closes on unexpected or missing granted scopes.');
}

console.log(`Security invariants OK: ${protectedProviderPaths.length} protected provider routes, protected X OAuth status, UTF-8 snapshot limit, account-bound X/Instagram caches, normalized local/JSON/D1 restores, no demo candidates, conservative CRM progression, valid manual X handles, canonical official-platform handoff, guarded social drafts + self-profile rewrite, no-store API responses, relationship-stage AI guards, conservative uncertain-cost accounting, optimistic D1 sync, requested+granted X scopes=${scopes.join(', ')}`);
