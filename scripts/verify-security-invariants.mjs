import { readFile } from 'node:fs/promises';

const router = await readFile(new URL('../worker/src/router.ts', import.meta.url), 'utf8');
const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const xOAuth = await readFile(new URL('../worker/src/xOAuth.ts', import.meta.url), 'utf8');
const xOwned = await readFile(new URL('../worker/src/xOwned.ts', import.meta.url), 'utf8');
const xFollowEvidence = await readFile(new URL('../worker/src/xFollowEvidence.ts', import.meta.url), 'utf8');
const instagramOwned = await readFile(new URL('../worker/src/instagramOwned.ts', import.meta.url), 'utf8');
const apiClient = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const controlToken = await readFile(new URL('../src/controlToken.ts', import.meta.url), 'utf8');
const xAccount = await readFile(new URL('../src/xAccount.ts', import.meta.url), 'utf8');
const xOwnedStore = await readFile(new URL('../src/xOwnedStore.ts', import.meta.url), 'utf8');
const instagramOwnedStore = await readFile(new URL('../src/instagramOwnedStore.ts', import.meta.url), 'utf8');
const instagramAccount = await readFile(new URL('../src/instagramAccount.ts', import.meta.url), 'utf8');
const xAccountControls = await readFile(new URL('../src/XAccountControls.tsx', import.meta.url), 'utf8');
const instagramAccountControls = await readFile(new URL('../src/InstagramAccountControls.tsx', import.meta.url), 'utf8');
const backupControls = await readFile(new URL('../src/BackupControls.tsx', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const syncClient = await readFile(new URL('../src/sync.ts', import.meta.url), 'utf8');
const syncControls = await readFile(new URL('../src/SyncControls.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const social = await readFile(new URL('../src/social.ts', import.meta.url), 'utf8');
const dbSchema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');

const protectedProviderPaths = [
  '/api/budget',
  '/api/ai/rank',
  '/api/x/enrich',
  '/api/discover/social',
];

for (const path of protectedProviderPaths) {
  if (!router.includes(`'${path}'`)) throw new Error(`Missing protected provider path: ${path}`);
}

if (!/if \(PROVIDER_COST_PATHS\.has\(url\.pathname\)\)\s*\{[\s\S]{0,300}?authorizeSync\(request, env\)/.test(router)) {
  throw new Error('Provider-cost routes are not guarded by authorizeSync().');
}
if (!router.includes('enforceSingleUserRequest(request, url)')
  || !router.includes("queryUserId.trim() !== 'local-user'")
  || !router.includes("body.userId.trim() !== 'local-user'")
  || !router.includes("userId !== 'local-user'")) {
  throw new Error('The single-user deployment boundary can be bypassed by rotating userId namespaces.');
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
if (!router.includes('const updatedAt = nextSnapshotVersion(body.expectedUpdatedAt)')
  || !router.includes('Math.max(now, previousMs + 1)')
  || !router.includes('expectedUpdatedAt must be a valid ISO timestamp')) {
  throw new Error('D1 optimistic-concurrency versions are not strictly monotonic and validated.');
}
if (!syncClient.includes('validIso(result.updatedAt)') || !syncClient.includes('D1 download returned an incomplete state snapshot')) {
  throw new Error('The client can persist malformed D1 version/snapshot responses.');
}
if (!apiClient.includes('(tokenOverride ?? getSyncToken()).trim()')
  || !apiClient.includes("fetchBudget(userId = 'local-user', tokenOverride?: string)")
  || !syncControls.includes("fetchBudget('local-user', next)")
  || !syncControls.includes('変更は保存していません')) {
  throw new Error('Replacement control tokens can no longer be verified before persistence.');
}
const candidateVerifyIndex = syncControls.indexOf("fetchBudget('local-user', next)");
const candidatePersistIndex = syncControls.indexOf('const tokenPersisted = setSyncToken(next);', candidateVerifyIndex);
if (candidateVerifyIndex < 0 || candidatePersistIndex < 0 || candidateVerifyIndex > candidatePersistIndex) {
  throw new Error('A replacement control token can be persisted before the Worker validates it.');
}
if (!controlToken.includes('let memoryToken: string | null = null;')
  || !controlToken.includes('return persisted;')
  || !controlToken.includes('notifyControlTokenChanged();')) {
  throw new Error('Control-token storage failures no longer preserve session behavior or report persistence status.');
}
if (!syncClient.includes('let memoryRemoteVersion: string | null = null;')
  || !syncClient.includes('const versionPersisted = setRemoteStateVersion(result.updatedAt);')
  || !syncClient.includes('return { ...result, versionPersisted };')
  || !syncControls.includes('result.versionPersisted')) {
  throw new Error('A localStorage failure can discard the current-session D1 optimistic-lock version or be reported as fully persisted.');
}
if (!syncClient.includes('expectedUpdatedAt: string | null = getRemoteStateVersion()')
  || !syncControls.includes('expectedVersion = previous === next ? getRemoteStateVersion() : null')) {
  throw new Error('D1 upload no longer uses the last known optimistic-lock version for the active key.');
}

if (!providerApi.includes("markReservationUncertain(env, reservationId, 'user_read_uncertain')") || !providerApi.includes("markReservationUncertain(env, reservationId, 'rank_uncertain')")) {
  throw new Error('Paid-provider uncertainty no longer retains conservative budget reservations.');
}
if (providerApi.includes('DELETE FROM budget_ledger WHERE id = ?')) {
  throw new Error('A paid-provider failure path can delete an existing budget reservation.');
}
if (!dbSchema.includes('cost_usd REAL NOT NULL DEFAULT 0 CHECK(cost_usd >= 0)')
  || !dbSchema.includes('input_units INTEGER NOT NULL DEFAULT 0 CHECK(input_units >= 0)')
  || !dbSchema.includes('output_units INTEGER NOT NULL DEFAULT 0 CHECK(output_units >= 0)')
  || !dbSchema.includes('cache_hit INTEGER NOT NULL DEFAULT 0 CHECK(cache_hit IN (0,1))')
  || !dbSchema.includes('expires_at TEXT NOT NULL')
  || !dbSchema.includes('followers_cycle INTEGER NOT NULL DEFAULT 0 CHECK(followers_cycle >= 0)')
  || !dbSchema.includes('following_cycle INTEGER NOT NULL DEFAULT 0 CHECK(following_cycle >= 0)')) {
  throw new Error('D1 schema no longer enforces non-negative budget/paging values or required OAuth expiry.');
}

const ownedTokenIndex = xOwned.indexOf('const accessToken = await getValidXAccessToken(env, userId);');
const ownedReservationIndex = xOwned.indexOf('const reservationId = await reserveBudget(env, userId, worstCaseCost, budget.effectiveLimit);');
if (ownedTokenIndex < 0 || ownedReservationIndex < 0 || ownedTokenIndex > ownedReservationIndex) {
  throw new Error('Owned-X can reserve paid budget before local OAuth token resolution succeeds.');
}
if (!xOwned.includes('await markReservationUncertain(env, reservationId);') || !xOwned.includes("'owned_sync_uncertain'")) {
  throw new Error('Owned-X paid-read failures no longer retain an explicitly uncertain conservative reservation.');
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
if (!apiClient.includes('selectCandidatesForRanking(mission, candidates, 30)')) {
  throw new Error('AI ranking can pre-slice the candidate pool before local quality/relationship scoring.');
}
if (!apiClient.includes('Budget API returned an invalid success response')
  || !apiClient.includes('AI ranking API returned an invalid success response')
  || !apiClient.includes('Discovery API returned an invalid success response')
  || !apiClient.includes('X enrich API returned an invalid success response')
  || !xAccount.includes('X OAuth status returned an invalid success response')
  || !xAccount.includes('X owned sync returned an invalid success response')
  || !instagramAccount.includes('Instagram sync returned an invalid success response')) {
  throw new Error('Client provider integrations can accept malformed successful responses.');
}
if (!xAccount.includes('validCoverage(value.coverage)')
  || !xAccount.includes('validFollowEvidence(value.followEvidence)')
  || !xAccount.includes('validPacing(value.pacing)')) {
  throw new Error('Nested X owned-sync metadata can bypass client validation and crash UI consumers.');
}

if (!backup.includes('safeSocialUrl(raw.platform, raw.engagementUrl)') || !backup.includes("profileUrl: raw.platform === 'x' ? `https://x.com/${username}`")) {
  throw new Error('Restored state no longer canonicalizes social URLs.');
}
if (!backup.includes('secondaryGoals') || !backup.includes('monthlyLimitUsd: clampNumber') || !backup.includes('hardLimit: true')) {
  throw new Error('Full restored AppState normalization or HARD LIMIT restoration was weakened.');
}
if (!backup.includes('dedupeCandidates(normalizedCandidates)')
  || !backup.includes('dedupeById(normalizedInteractions.filter((interaction) => candidateIds.has(interaction.candidateId)))')
  || !backup.includes('dedupeById(normalizedInsights)')) {
  throw new Error('Restore normalization can retain duplicate candidates/history or discard a valid duplicate-id interaction in the wrong order.');
}
if (!syncControls.includes('normalizeAppState(result.state)') || !syncControls.includes('validateAppState(restored)')) {
  throw new Error('D1 restores can bypass AppState normalization/validation.');
}
if (!backup.includes('legacyDemoCandidates') || !store.includes('normalizeAppState(state)') || !store.includes('candidates: Array.isArray(parsed.candidates)')) {
  throw new Error('Persisted local state can bypass normalization or reintroduce legacy demo candidates.');
}
if (!app.includes('setMissionText(state.mission.text)')
  || !app.includes('setBudget(state.budget.monthlyLimitUsd)')
  || !app.includes('setFollowBackDays(state.relationshipPolicy.followBackReviewAfterDays)')) {
  throw new Error('Settings form state can remain stale after a JSON/D1 restore and overwrite restored values.');
}
if (!backupControls.includes('latestStateRef.current = state')
  || !backupControls.includes("typeof value === 'function' ? value(latestStateRef.current) : value")
  || !xAccountControls.includes('onChange((current) =>')
  || !instagramAccountControls.includes('onChange((current) => applyInstagramEngagers(current, result))')
  || !syncControls.includes('onRestore((current) => syncBudget(current, budget.usedUsd, budget.limitUsd))')) {
  throw new Error('Async settings/X/Instagram completions can overwrite newer local state with a stale request-time snapshot.');
}

if (!store.includes("interaction.action === 'kept'") || !store.includes('advanceRelationshipStage') || !store.includes("target.recommendedAction === 'unfollow_review'")) {
  throw new Error('Manual relationship outcomes no longer feed the conservative CRM progression/cleanup distinction.');
}
if (!store.includes('if (rawCandidate.skipped) return rawCandidate;') || !store.includes("recommendedAction: 'review' as const")) {
  throw new Error('Dismissed candidates can be re-promoted into cleanup advice immediately.');
}
if (!store.includes("const followedAt = !candidate.skipped && isFollowing ? candidate.followedAt ?? syncedAt : candidate.followedAt;")) {
  throw new Error('Official X following evidence does not establish a conservative first-observed follow timestamp.');
}
if (!store.includes("candidate.recommendedAction === 'follow' && candidate.followedAt")
  || !store.includes("candidate.recommendedAction === 'unfollow_review' && !candidate.followedAt")) {
  throw new Error('Local relationship normalization can surface impossible follow/unfollow actions.');
}
if (!store.includes("const cleanupRemove = action === 'skipped' && target.recommendedAction === 'unfollow_review';")
  || !store.includes('followedAt: cleanupRemove ? undefined : candidate.followedAt')
  || !store.includes('followBack: cleanupRemove ? null : candidate.followBack')) {
  throw new Error('Manual unfollow completion can leave stale followed/follow-back state behind.');
}
if (!store.includes('if (!existing.skipped) return state;') || !store.includes('以前に見送った候補を、手動操作で再び候補へ戻しました。')) {
  throw new Error('An explicit manual re-add cannot intentionally reactivate a previously dismissed candidate.');
}
if (!app.includes("!candidate.skipped && candidate.stage !== 'discovered'")) {
  throw new Error('Dismissed/unfollowed candidates can remain visible as actively tracked Relations.');
}
if (!store.includes("return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';")) {
  throw new Error('Manual X candidate input is no longer constrained to valid X handle shape.');
}
if (!xFollowEvidence.includes("return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';")) {
  throw new Error('Follower-cycle evidence can accept non-canonical X handles.');
}
if (!xOwnedStore.includes('if (existing) continue;') || xOwnedStore.includes('reactivated = new Set')) {
  throw new Error('A current X follower snapshot can be mistaken for a fresh event and revive dismissed candidates.');
}
if (!xOwnedStore.includes("if (candidate.skipped || candidate.platform !== 'x' || !candidate.followedAt) return candidate;")) {
  throw new Error('Full-cycle X evidence can mutate dismissed candidates.');
}
if (!instagramOwnedStore.includes('isFreshCommentAfterDismissal') || !instagramOwnedStore.includes('if (existing.skipped && !freshContact) continue;')) {
  throw new Error('Old/cached Instagram comments can revive explicitly dismissed candidates.');
}
if (!instagramOwnedStore.includes('latestIso(existing.lastInteractionAt, engager.lastCommentAt)')) {
  throw new Error('Instagram sync can regress a newer manual relationship interaction timestamp.');
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
if (!xAccountControls.includes("onChange((current) => ({ ...current, xAccount: {} }))")
  || !xAccountControls.includes('status.connected && state.xAccount.username')) {
  throw new Error('Disconnecting X can leave stale account-level identity/stat summaries visible in the client.');
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
if (writeScopes.length) throw new Error(`Write-capable X OAuth scope detected: ${writeScopes.join(', ')}`);
if (!xOAuth.includes('validateGrantedScopes(token.scope, existingGrantedScope)')
  || !xOAuth.includes('X OAuth response is missing granted scope metadata')
  || !xOAuth.includes('X OAuth returned unexpected scope(s)')
  || !xOAuth.includes('X OAuth response is missing required scope(s)')
  || !xOAuth.includes("token.token_type || '').trim().toLowerCase() !== 'bearer'")) {
  throw new Error('X OAuth no longer fail-closes on token type or requested/granted scope boundaries.');
}
if (!xOAuth.includes('persistTokenResponse(env, userId, refreshed, row.refresh_token_enc, row.scope)')) {
  throw new Error('X OAuth refresh can no longer reuse only the previously verified scope when scope metadata is omitted.');
}
if (!xOAuth.includes('validateGrantedScopes(row.scope)')
  || !xOAuth.includes('await decryptToken(env, row.access_token_enc)')
  || !xOAuth.includes('parseStoredExpiry(row.expires_at)')
  || !xOAuth.includes('token.expires_in <= 0')
  || !xOAuth.includes('sessionAgeMs < 0')
  || !xOAuth.includes('OAuth session expired or malformed')) {
  throw new Error('Stored/session X OAuth state can bypass scope, ciphertext, expiry, or session-age validation.');
}
if (!/DELETE FROM x_oauth_tokens[\s\S]{0,500}?try \{[\s\S]{0,250}?clearOwnedXDerivedState/.test(xOAuth)) {
  throw new Error('X disconnect can report failure after the authoritative token row was already deleted.');
}

console.log(`Security invariants OK: ${protectedProviderPaths.length} protected provider routes, single-user namespace enforcement, protected X OAuth status, UTF-8 + monotonic validated D1 snapshot versions, DB-level non-negative HARD LIMIT constraints, pre-validated/session-safe control-token changes, in-memory optimistic-lock fallback, account-bound X/Instagram caches, local-OAuth-before-paid-X reservation, fresh-event-only candidate revival, normalized+deduplicated local/JSON/D1 restores, restore-aware Settings, async latest-state merges, conservative CRM progression, first-observed X follows, explicit manual reactivation, cleared manual unfollows, valid X identifiers, canonical official-platform handoff, guarded social drafts + self-profile rewrite, validated provider/X success payloads, full-pool AI prefiltering, no-store API responses, relationship-stage AI guards, conservative uncertain-cost accounting, optimistic D1 sync, strict stored/session OAuth validation, requested+granted X scopes=${scopes.join(', ')}`);
