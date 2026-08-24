import { readFile } from 'node:fs/promises';

const xOwned = await readFile(new URL('../worker/src/xOwned.ts', import.meta.url), 'utf8');
const instagramOwned = await readFile(new URL('../worker/src/instagramOwned.ts', import.meta.url), 'utf8');
const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');

function requireAll(source, fragments, message) {
  if (!fragments.every((fragment) => source.includes(fragment))) throw new Error(message);
}

requireAll(xOwned, [
  'validOwnedSnapshot(result)',
  'validOwnedSnapshot(snapshot)',
  'DELETE FROM x_owned_snapshots WHERE user_id = ?',
  'const { start, end } = utcMonthWindow();',
  'occurred_at >= ? AND occurred_at < ?',
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

requireAll(instagramOwned, [
  'validInstagramSnapshot(result, instagramUserId)',
  'validInstagramSnapshot(snapshot, expectedAccountId)',
  'DELETE FROM instagram_engager_snapshots WHERE user_id = ?',
  'uniqueEngagers(value.engagers)',
  'validInstagramMediaUrl(value.latestMediaPermalink)',
], 'Instagram cache validation/eviction or deep snapshot integrity checks regressed.');

requireAll(providerApi, [
  'const { start, end } = utcMonthWindow();',
  'occurred_at >= ? AND occurred_at < ?',
  'new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))',
  'if (!validRawXProfile(raw))',
  'if (!requested.has(username))',
  'seenIds.has(raw.id) || seenUsernames.has(username)',
  'rawProfiles.length > usernames.length',
], 'General provider budget accounting or raw paid X-enrichment response validation regressed.');

const enrichFetchIndex = providerApi.indexOf('const profiles = await fetchXProfiles(usernames, env.X_BEARER_TOKEN);');
const enrichFinalizeIndex = providerApi.indexOf("await finalizeReservation(env, reservationId, 'user_read'", enrichFetchIndex);
if (enrichFetchIndex < 0 || enrichFinalizeIndex < 0 || enrichFetchIndex > enrichFinalizeIndex) {
  throw new Error('Paid X profile enrichment can finalize a reduced cost before its requested-set validation returns successfully.');
}

requireAll(store, [
  'const profileContextChanged = candidate.bio !== profile.description',
  'const staleFollowAdvice = profileContextChanged',
  "candidate.recommendedAction === 'follow'",
  "recommendedAction: staleFollowAdvice ? 'review' as const : candidate.recommendedAction",
  '古い推薦のままTodayには出しません。',
], 'A materially changed official X profile can leave an obsolete follow recommendation actionable in Today.');

const unboundedMonthQuery = /budget_ledger[^\n]{0,220}occurred_at >= \?(?![^\n]{0,120}occurred_at < \?)/;
if (unboundedMonthQuery.test(xOwned) || unboundedMonthQuery.test(providerApi)) {
  throw new Error('A paid-budget query appears to have a lower month bound without an upper month bound.');
}

console.log('Cache/ledger invariants OK: malformed X/Instagram snapshots are rejected and evicted, raw paid owned-X/X-enrichment payloads are validated before reservation shrink/finalize, newly produced snapshots are validated before caching, paid budget totals/reservations are bounded to the active UTC month, and materially changed official X profiles invalidate stale follow advice before it can remain in Today.');
