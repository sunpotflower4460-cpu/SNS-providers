import { readFile } from 'node:fs/promises';

const xOwned = await readFile(new URL('../worker/src/xOwned.ts', import.meta.url), 'utf8');
const instagramOwned = await readFile(new URL('../worker/src/instagramOwned.ts', import.meta.url), 'utf8');
const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const budgetIntegrity = await readFile(new URL('../worker/src/budgetIntegrity.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
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
  'safeCursor(nextToken) === null',
], 'Owned-X cache/raw-payload validation, eviction, or bounded UTC-month budget accounting regressed.');

const rawValidationIndex = xOwned.indexOf('Only now is it safe to shrink the conservative reservation');
const finalizeOwnedIndex = xOwned.indexOf('await finalizeReservation(env, reservationId, actualCost', rawValidationIndex);
if (rawValidationIndex < 0 || finalizeOwnedIndex < 0 || rawValidationIndex > finalizeOwnedIndex) {
  throw new Error('Owned-X can shrink the worst-case reservation before raw paid provider payload validation completes.');
}

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
], 'Instagram cache validation/eviction, deep snapshot integrity, or latest-comment target binding regressed.');

requireAll(instagramOwnedStore, [
  'const byStableId = new Map(',
  'const stableExisting = incomingStableId ? byStableId.get(incomingStableId) : undefined;',
  'const existing = stableExisting || usernameExisting;',
  'removedCandidateIds.add(usernameExisting.id);',
  'username: engager.username,',
  'profileUrl: engager.profileUrl,',
], 'Instagram handle renames can again duplicate one immutable commenter or transfer stale handle history.');

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
  'WITH current_usage AS (',
  'WHERE invalid_count = 0',
  "AND typeof(used) IN ('integer','real')",
  'AND used >= 0',
  'AND used + ? <= ?',
  'occurred_at >= ? AND occurred_at < ?',
  'new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))',
], 'Legacy D1 budget corruption can weaken the active-month HARD LIMIT or reservation atomicity.');

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

const unboundedMonthQuery = /budget_ledger[^\n]{0,220}occurred_at >= \?(?![^\n]{0,120}occurred_at < \?)/;
if (unboundedMonthQuery.test(budgetIntegrity)) {
  throw new Error('A paid-budget query appears to have a lower month bound without an upper month bound.');
}

console.log('Cache/ledger invariants OK: malformed X/Instagram snapshots are rejected and evicted, raw paid owned-X/X-enrichment payloads are validated before reservation shrink/finalize, vanished paid reservations fail closed and are conservatively reconstructed when possible, legacy negative/text budget rows disable paid work, reservations remain atomic inside the active UTC month, Instagram latest comment targets stay event-bound, Instagram handle renames follow immutable identity, and official X identity/profile changes cannot leave stale CRM advice actionable.');