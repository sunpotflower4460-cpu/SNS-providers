import { readFile } from 'node:fs/promises';

const xOwned = await readFile(new URL('../worker/src/xOwned.ts', import.meta.url), 'utf8');
const instagramOwned = await readFile(new URL('../worker/src/instagramOwned.ts', import.meta.url), 'utf8');
const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const budgetIntegrity = await readFile(new URL('../worker/src/budgetIntegrity.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const xAccount = await readFile(new URL('../src/xAccount.ts', import.meta.url), 'utf8');
const xOwnedStore = await readFile(new URL('../src/xOwnedStore.ts', import.meta.url), 'utf8');
const instagramOwnedStore = await readFile(new URL('../src/instagramOwnedStore.ts', import.meta.url), 'utf8');

function requireAll(source, fragments, message) {
  if (!fragments.every((fragment) => source.includes(fragment))) throw new Error(message);
}

requireAll(xOwned, [
  'validOwnedSnapshot(result)',
  'validOwnedSnapshot(snapshot)',
  'DELETE FROM x_owned_snapshots WHERE user_id = ?',
  'readActiveMonthUsage(env.DB, userId)',
  'reserveActiveMonthBudget(env.DB',
  'validRawXUser(response.data)',
  'response.data.every(validRawXUser)',
  'response.data.every(validRawXPost)',
  'validListMeta(response.meta, data.length, maxResults)',
  'coherentRawXUsersAcrossLists(followersResult.data, followingResult.data)',
  'coherentOwnedUsersAcrossLists(value.followers, value.following)',
  'resumePaging: nextPaging',
  'validPagingState(value.resumePaging)',
  'snapshot.syncedAt === snapshotRow.synced_at',
  'snapshot.syncedAt !== row.synced_at',
  'const pagingPersisted = await savePaging(env, userId, nextPaging, syncedAt);',
  'const cachePersisted = await saveCache(env, userId, result);',
  'persistenceDegraded: true',
], 'Owned-X cache/raw-payload validation, paging recovery, cross-list identity coherence, or bounded UTC-month budget accounting regressed.');

const rawValidationIndex = xOwned.indexOf('safe to shrink the conservative reservation');
const coherenceIndex = xOwned.indexOf('coherentRawXUsersAcrossLists(followersResult.data, followingResult.data)');
const finalizeOwnedIndex = xOwned.indexOf('await finalizeReservation(env, reservationId, actualCost', coherenceIndex);
if (rawValidationIndex < 0 || coherenceIndex < 0 || finalizeOwnedIndex < 0 || coherenceIndex > finalizeOwnedIndex || rawValidationIndex > finalizeOwnedIndex) {
  throw new Error('Owned-X can shrink the worst-case reservation before raw/cross-list paid provider identity validation completes.');
}

requireAll(xAccount, [
  'coherentUsersAcrossLists(value.followers, value.following)',
  'const usernameById = new Map<string, string>();',
  'const idByUsername = new Map<string, string>();',
  'validPagingState(value.resumePaging)',
  'persistenceDegraded?: boolean;',
], 'Owned-X client validation can accept contradictory identity/checkpoint metadata or hide degraded persistence.');

requireAll(xOwnedStore, [
  'const stableIdentityState = reconcileOwnedXStableIdentities(state, result);',
  'const legacyIdentityAliases = new Map<string, string>();',
  'const stableExisting = byStableId.get(user.id);',
  'conflictingRemovedIds.add(usernameExisting.id);',
  'resolveIdentityAlias(interaction.candidateId, legacyIdentityAliases)',
  'existingByStableId.get(follower.id) || existingByUsername.get(username)',
], 'X handle renames or legacy same-ID duplicates can again split one immutable relationship or transfer stale handle history.');

requireAll(xOwned, [
  "if (result.meta.changes !== 1) throw new Error('Owned-X budget reservation disappeared before finalization')",
  'await markReservationUncertain(env, reservationId, userId, worstCaseCost);',
  "INSERT OR IGNORE INTO budget_ledger",
  "VALUES (?, ?, 'x', 'owned_sync_uncertain', ?, 0, 0, 0, ?)",
], 'Owned-X can again report paid work as finalized after its budget reservation row disappears.');

requireAll(instagramOwned, [
  'validInstagramSnapshot(result, instagramUserId)',
  'validInstagramSnapshot(snapshot, expectedAccountId)',
  'DELETE FROM instagram_engager_snapshots WHERE user_id = ?',
  'uniqueEngagers(value.engagers)',
  'validInstagramMediaUrl(value.latestMediaPermalink)',
  'existing.latestMediaPermalink = item.permalink || null;',
  'snapshot.syncedAt !== row.synced_at',
  'JSON.stringify(snapshot), snapshot.syncedAt',
], 'Instagram cache validation/eviction, observation-time binding, deep snapshot integrity, or latest-comment target binding regressed.');

requireAll(instagramOwnedStore, [
  'const byStableId = new Map<string, Candidate>();',
  'const stableExisting = incomingStableId ? byStableId.get(incomingStableId) : undefined;',
  'const existing = stableExisting || usernameExisting;',
  'conflictingRemovedIds.add(usernameExisting.id);',
  'const legacyIdentityAliases = new Map<string, string>();',
  'resolveIdentityAlias(interaction.candidateId, legacyIdentityAliases)',
  'username: engager.username,',
  'profileUrl: engager.profileUrl,',
], 'Instagram handle renames or legacy same-ID duplicates can again split one immutable commenter or transfer stale handle history.');

requireAll(providerApi, [
  'readActiveMonthUsage(env.DB, userId)',
  'reserveActiveMonthBudget(env.DB',
  'if (!validRawXProfile(raw))',
  'if (!requested.has(username))',
  'seenIds.has(raw.id) || seenUsernames.has(username)',
  'rawProfiles.length > usernames.length',
], 'General provider budget accounting or raw paid X-enrichment response validation regressed.');

requireAll(budgetIntegrity, [
  "typeof(cost_usd) NOT IN ('integer','real') OR cost_usd < 0",
  'Number.isFinite(usedUsd)',
  'invalidCount !== 0',
  'unassignableCount !== 0',
  'julianday(occurred_at) AS occurred_jd',
  'occurred_jd >= julianday(?) AND occurred_jd < julianday(?)',
  'timestamp_integrity AS (',
  'occurred_jd IS NULL',
  'WITH ledger_rows AS (',
  'WHERE invalid_count = 0',
  'AND unassignable_count = 0',
  "AND typeof(used) IN ('integer','real')",
  'AND used >= 0',
  'AND used + ? <= ?',
  'new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))',
], 'Legacy D1 budget corruption or non-canonical timestamps can weaken the active-UTC-month HARD LIMIT or reservation atomicity.');

const enrichFetchIndex = providerApi.indexOf('const profiles = await fetchXProfiles(usernames, env.X_BEARER_TOKEN);');
const enrichFinalizeIndex = providerApi.indexOf("await finalizeReservation(env, reservationId, 'user_read'", enrichFetchIndex);
if (enrichFetchIndex < 0 || enrichFinalizeIndex < 0 || enrichFetchIndex > enrichFinalizeIndex) {
  throw new Error('Paid X profile enrichment can finalize a reduced cost before its requested-set validation returns successfully.');
}

requireAll(providerApi, [
  "if (result.meta.changes !== 1) throw new Error('Paid budget reservation disappeared before finalization')",
  "await markReservationUncertain(env, reservationId, 'user_read_uncertain', userId, 'x', worstCaseCost);",
  "await markReservationUncertain(env, reservationId, 'rank_uncertain', userId, provider, preflightUsd);",
  'INSERT OR IGNORE INTO budget_ledger',
  'Math.max(0, reservedUsd)',
], 'Paid X/LLM accounting can again silently lose a reservation between provider success and ledger finalization.');

requireAll(store, [
  'const profileContextChanged = candidate.bio !== profile.description',
  'const staleFollowAdvice = profileContextChanged',
  "candidate.recommendedAction === 'follow'",
  "recommendedAction: staleFollowAdvice ? 'review' as const : candidate.recommendedAction",
  '古い推薦のままTodayには出しません。',
  'const identityResetIds = new Set<string>();',
  'state.interactions.filter((interaction) => !identityResetIds.has(interaction.candidateId))',
], 'Official X enrichment can leave obsolete follow advice actionable or transfer CRM history across immutable identity changes.');

if ((budgetIntegrity.match(/occurred_jd >= julianday\(\?\) AND occurred_jd < julianday\(\?\)/g) || []).length < 2) {
  throw new Error('A paid-budget read or reservation lost one side of the active UTC month boundary.');
}

console.log('Cache/ledger invariants OK: malformed X/Instagram snapshots are rejected and evicted, cache freshness is bound to the snapshot observation time, X paging can recover from the paid snapshot checkpoint, raw paid owned-X/X-enrichment payloads and cross-endpoint X identities are validated before reservation shrink/finalize, vanished paid reservations fail closed and are conservatively reconstructed when possible, legacy negative/text or unassignable-timestamp budget rows disable paid work, reservations remain atomic by actual instant inside the active UTC month, X/Instagram handle renames follow immutable identity and repair old duplicates, Instagram latest comment targets stay event-bound, and official X identity/profile changes cannot leave stale CRM advice actionable.');