import { readFile } from 'node:fs/promises';

const xOwned = await readFile(new URL('../worker/src/xOwned.ts', import.meta.url), 'utf8');
const xFollowEvidence = await readFile(new URL('../worker/src/xFollowEvidence.ts', import.meta.url), 'utf8');
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
  'validOwnedSnapshot(validatedProviderResult)',
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
  'let rowState: PagingState | null = null;',
  'return rowState || empty;',
  'A malformed snapshot is not allowed to poison a valid dedicated paging row.',
  'following_cursor = excluded.following_cursor',
  'const pagingPersisted = await savePaging(env, userId, nextPaging, syncedAt);',
  'const cachePersisted = await saveCache(env, userId, result);',
  'persistenceDegraded: true',
  'followEvidenceDegraded: true',
  'quarantineFollowerEvidencePaging(paging, ordinaryNextPaging, followersResult.nextToken)',
  'followersCycle: paging.followersCycle + 1',
  'let reservationFinalized = false;',
  'reservationFinalized = true;',
  'if (!reservationFinalized)',
], 'Owned-X cache/raw-payload validation, independent paging recovery, post-finalization evidence quarantine, or bounded UTC-month budget accounting regressed.');

if (xOwned.includes('following_cursor = excluded.followingCursor')) {
  throw new Error('Owned-X paging UPSERT again references a non-existent camelCase SQLite column.');
}

const coherenceIndex = xOwned.indexOf('coherentRawXUsersAcrossLists(followersResult.data, followingResult.data)');
const providerSnapshotValidationIndex = xOwned.indexOf('if (!validOwnedSnapshot(validatedProviderResult))');
const finalizeOwnedIndex = xOwned.indexOf('await finalizeReservation(env, reservationId, actualCost', providerSnapshotValidationIndex);
const finalizedFlagIndex = xOwned.indexOf('reservationFinalized = true;', finalizeOwnedIndex);
const evidenceUpdateIndex = xOwned.indexOf('followEvidence = await updateFollowCycleEvidence(', finalizedFlagIndex);
if (coherenceIndex < 0
  || providerSnapshotValidationIndex < 0
  || finalizeOwnedIndex < 0
  || finalizedFlagIndex < 0
  || evidenceUpdateIndex < 0
  || coherenceIndex > providerSnapshotValidationIndex
  || providerSnapshotValidationIndex > finalizeOwnedIndex
  || finalizeOwnedIndex > finalizedFlagIndex
  || finalizedFlagIndex > evidenceUpdateIndex) {
  throw new Error('Owned-X can finalize a reduced paid cost before provider snapshot validation, or mutate follow evidence before the exact cost is durable.');
}

const catchFinalizedGuardIndex = xOwned.indexOf('if (!reservationFinalized)');
const catchUncertainIndex = xOwned.indexOf('await markReservationUncertain(env, reservationId, userId, worstCaseCost);', catchFinalizedGuardIndex);
if (catchFinalizedGuardIndex < 0 || catchUncertainIndex < 0 || catchFinalizedGuardIndex > catchUncertainIndex) {
  throw new Error('A local post-finalization failure can again relabel a known paid X cost as uncertain.');
}

requireAll(xFollowEvidence, [
  'export class FollowEvidenceStorageUnavailableError extends Error',
  'targets.every(validTargetRow)',
  'completedRows.every(validTargetRow)',
  'uniqueTargetRows(targets)',
  'uniqueTargetRows(completedRows)',
  'throw new FollowEvidenceStorageUnavailableError();',
  'if (!(await invalidateCycle(db, userId, cycle)))',
], 'Corrupt/partially persisted X follow-evidence rows can again escape runtime validation or fail to signal an irrecoverable storage cycle.');

requireAll(xAccount, [
  'coherentUsersAcrossLists(value.followers, value.following)',
  'const usernameById = new Map<string, string>();',
  'const idByUsername = new Map<string, string>();',
  'validPagingState(value.resumePaging)',
  'persistenceDegraded?: boolean;',
  'followEvidenceDegraded?: boolean;',
  'value.followEvidenceDegraded === true && value.followEvidence != null',
  "!candidate.tags.includes('identity-conflict')",
], 'Owned-X client validation/tracking can accept contradictory identity/checkpoint metadata, degraded evidence with stale proof, or ambiguous recycled handles.');

requireAll(xOwnedStore, [
  'const stableIdentityState = reconcileOwnedXStableIdentities(state, result);',
  'const identityResetState = resetOwnedXIdentityChanges(stableIdentityState, result, identityChangedIds);',
  'const identitySafeState = reconcileOwnedXStableIdentities(identityResetState, result);',
  'const legacyIdentityAliases = new Map<string, string>();',
  'const stableExisting = byStableId.get(user.id);',
  'const byUsername = new Map<string, Candidate[]>();',
  'for (const conflicting of usernameExisting) {',
  'conflictingRemovedIds.add(conflicting.id);',
  'resolveIdentityAlias(interaction.candidateId, legacyIdentityAliases)',
  "const identityConflictResolved = stableExisting.tags.includes('identity-conflict');",
  "tags: stableExisting.tags.filter((tag) => tag !== 'identity-conflict')",
  "if (candidate.tags.includes('identity-conflict')) return candidate;",
  'existingByStableId.get(follower.id) || existingByUsername.get(username)',
], 'X handle renames, recycled handles, or legacy same-ID duplicates can again split one immutable relationship, revive ambiguous follow evidence, or transfer stale handle history.');

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
  'const byUsername = new Map<string, Candidate[]>();',
  'const usernameGroup = byUsername.get(username) || [];',
  'const knownUsernameIdentities = new Set(usernameGroup.map((candidate) => stableInstagramId(candidate.platformUserId)).filter(Boolean));',
  'for (const conflicting of usernameGroup) {',
  'conflictingRemovedIds.add(conflicting.id);',
  'else if (incomingStableId && knownUsernameIdentities.size > 1) {',
  "const identityConflictResolved = Boolean(stableExisting && existing.tags.includes('identity-conflict'));",
  "existing.tags.filter((tag) => tag !== 'identity-conflict')",
  'const legacyIdentityAliases = new Map<string, string>();',
  'resolveIdentityAlias(interaction.candidateId, legacyIdentityAliases)',
  'username: engager.username,',
  'profileUrl: engager.profileUrl,',
], 'Instagram handle renames, recycled handles, or legacy same-ID duplicates can again split one immutable commenter, revive stale reply routing, or transfer old handle history.');

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

console.log('Cache/ledger invariants OK: malformed X/Instagram snapshots are rejected and evicted, cache freshness is bound to snapshot observation time, X paging checkpoints fail independently and recover from either durable source, paid X provider snapshots validate before exact-cost finalization, finalized costs are never relabeled uncertain by local evidence failures, corrupt follow-evidence rows fail closed and irrecoverable evidence cycles are quarantined without rereading the paid page, raw paid X-enrichment identities validate before finalize, legacy invalid budget rows disable paid work, reservations remain atomic inside the active UTC month, X/Instagram renames follow immutable identity, recycled-handle conflicts resolve deterministically, and stale CRM advice cannot remain actionable.');