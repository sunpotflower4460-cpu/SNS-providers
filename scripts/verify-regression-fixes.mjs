import { readFile } from 'node:fs/promises';

const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
const xOAuth = await readFile(new URL('../worker/src/xOAuth.ts', import.meta.url), 'utf8');
const xFollowEvidence = await readFile(new URL('../worker/src/xFollowEvidence.ts', import.meta.url), 'utf8');
const instagramOwned = await readFile(new URL('../worker/src/instagramOwned.ts', import.meta.url), 'utf8');
const router = await readFile(new URL('../worker/src/router.ts', import.meta.url), 'utf8');
const syncLease = await readFile(new URL('../worker/src/syncLease.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const daily = await readFile(new URL('../src/daily.ts', import.meta.url), 'utf8');
const dailyQueue = await readFile(new URL('../src/DailyQueue.tsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const social = await readFile(new URL('../src/social.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const xOwnedStore = await readFile(new URL('../src/xOwnedStore.ts', import.meta.url), 'utf8');
const sync = await readFile(new URL('../src/sync.ts', import.meta.url), 'utf8');
const syncControls = await readFile(new URL('../src/SyncControls.tsx', import.meta.url), 'utf8');
const workload = await readFile(new URL('../src/WorkloadControls.tsx', import.meta.url), 'utf8');
const statusPresentation = await readFile(new URL('../src/statusPresentation.ts', import.meta.url), 'utf8');
const resultResolution = await readFile(new URL('../src/resultResolution.ts', import.meta.url), 'utf8');
const instagramOwnedStore = await readFile(new URL('../src/instagramOwnedStore.ts', import.meta.url), 'utf8');

const expectedGroqModel = 'llama-3.3-70b-versatile';
if (!providerApi.includes(`env.GROQ_MODEL || '${expectedGroqModel}'`)
  || !wrangler.includes(`"GROQ_MODEL": "${expectedGroqModel}"`)
  || providerApi.includes('openai/gpt-oss-20b')
  || wrangler.includes('openai/gpt-oss-20b')) {
  throw new Error('Production and fallback Groq model defaults drifted apart or regressed to the retired default.');
}

if (!workload.includes("import type { AppState, AppStateUpdater, RelationshipPolicy } from './types';")
  || !workload.includes('onChange: AppStateUpdater;')
  || (workload.match(/onChange\(\(current\) =>/g) || []).length < 2) {
  throw new Error('Workload edits can again overwrite newer async state instead of applying to the latest state.');
}

if (!workload.includes('const observedConnect =')
  || !workload.includes('const connect = Math.min(60, Math.max(observedConnect, Math.min(20, total)));')) {
  throw new Error('Recommended workload can again zero all connection capacity and starve automatic candidate refill.');
}

if (!statusPresentation.includes("status.dataset.presentedStatus = presented")
  || !statusPresentation.includes("status.setAttribute('aria-label', presented)")
  || !statusPresentation.includes('content: attr(data-presented-status)')
  || statusPresentation.includes('status.textContent = presented')) {
  throw new Error('Human-readable status presentation can again mutate React-owned text nodes or lose accessible presentation.');
}

if (!app.includes("candidate.reason.startsWith('無料Web検索から候補')")
  || !app.includes('setState((current) => mergeDiscoveredProfiles(current, discovered.profiles));')
  || !app.includes('setAutoRetryTick((current) => current + 1);')
  || !app.includes('scheduleRetry(discovered.retryAfterSeconds * 1000)')
  || !app.includes('if (existingRankTargets.length)')
  || !app.includes('if (rankTargets.length > ranked.results.length) autoReplenishAttemptKeyRef.current = \'\';')) {
  throw new Error('Automatic refill can again lose successful discovery yield, ignore a cross-device cooldown, or strand a second free-ranking batch.');
}

if (!app.includes('const selfDone = state.selfProfile.analyzedAt')
  || !app.includes('return relationshipDone + selfDone;')
  || !app.includes('const selfLimit = clampInt(state.relationshipPolicy.dailySelfImproveLimit, 1, 0, 1);')
  || !app.includes('const plannedSelf = selfLimit > 0 && state.insights.length > 0 ? 1 : 0;')
  || !app.includes("return interaction.action !== 'review' && sameLocalDay(at, now);")
  || !daily.includes('self: clampInt(policy.dailySelfImproveLimit, 1, 0, 1)')
  || !dailyQueue.includes('const selfCompleted = state.selfProfile.analyzedAt')
  || !dailyQueue.includes("return interaction.action !== 'review'")) {
  throw new Error('Today self-work can again occupy multiple duplicate slots, disappear without progress, change relationship quota after completion, or count profile-only reviews as executable work.');
}

if (!workload.includes('dailySelfImproveLimit: clamp(next.self, 0, 1)')
  || !workload.includes('self: clamp(policy.dailySelfImproveLimit ?? 1, 0, 1)')
  || !workload.includes('value={values.self} min={0} max={1}')
  || !workload.includes('const self = state.insights.length > 0 ? 1 : 0;')) {
  throw new Error('Workload settings can again configure multiple duplicate self-analysis actions for the same day.');
}

if (!app.includes('const candidateOperationBusy = discovering || ranking || enrichingX;')
  || (app.match(/disabled=\{candidateOperationBusy\}/g) || []).length < 3
  || !app.includes("setApiNote('別の候補処理が終わってから再評価してください')")
  || !app.includes('|| enrichingX\n      || autoReplenishingRef.current')
  || !app.includes('[autoRetryTick, localDay, state, discovering, ranking, enrichingX]')) {
  throw new Error('Manual or automatic discovery/ranking and paid X enrichment can again overlap and discard paid results after concurrent candidate mutation.');
}

if (!api.includes('completeFreeOnlyRankingBatch(validated.results, selected)')
  || !api.includes("recommendedAction: 'review'")
  || !api.includes('無料評価でこの候補の確実な判定が返らなかったため、本人確認を優先します。')) {
  throw new Error('A partial free-provider ranking response can again leave omitted candidates untouched and trigger repeated automatic evaluation.');
}

if (!api.includes('retryAfterSeconds?: number;')
  || !api.includes('optionalBoundedInteger(result.retryAfterSeconds, 1, 86_400)')
  || !router.includes('const futureLimit = new Date(now.getTime() + MAX_CLOCK_SKEW_MS).toISOString();')
  || (router.match(/AND occurred_at <= \?/g) || []).length < 2
  || !router.includes('retryAfterSeconds: Math.max(1, Math.min(86_400, Math.ceil(remainingMs / 1000)))')) {
  throw new Error('Cross-device automatic-discovery throttling can again be poisoned by a future row or expose an invalid retry window.');
}

if (!syncLease.includes('ON CONFLICT(id) DO UPDATE SET')
  || !syncLease.includes('WHERE budget_ledger.occurred_at < ?')
  || !syncLease.includes('budget_ledger.occurred_at > ?')
  || !syncLease.includes('DELETE FROM budget_ledger WHERE id = ? AND operation = ?')
  || !syncLease.includes('crypto.randomUUID()')
  || !router.includes("reserveSyncLease(env.DB, userId, 'x_owned_sync', 3 * 60 * 1000)")
  || !router.includes("reserveSyncLease(env.DB, userId, 'instagram_owned_sync', 5 * 60 * 1000)")
  || (router.match(/releaseSyncLease\(env\.DB, leaseResult\.lease\)/g) || []).length < 2) {
  throw new Error('First-party X/Instagram sync can again overlap across devices, duplicate provider reads, keep a future-poisoned lease, or let an expired owner delete a newer lease.');
}

if (!backup.includes('monthlyLimitUsd: clampNumber(state?.budget?.monthlyLimitUsd, 0, 10, 3)')
  || !backup.includes('followBackReviewAfterDays: clampInteger(policy?.followBackReviewAfterDays, 7, 90')
  || !backup.includes('dailyQueueLimit: clampInteger(policy?.dailyQueueLimit, 1, 150')
  || !backup.includes('dailyConnectionLimit: clampInteger(policy?.dailyConnectionLimit, 0, 120')
  || !backup.includes('dailyConversationLimit: clampInteger(policy?.dailyConversationLimit, 0, 30')
  || !backup.includes('dailyLightEngagementLimit: clampInteger(policy?.dailyLightEngagementLimit, 0, 30')
  || !backup.includes('dailyCleanupLimit: clampInteger(policy?.dailyCleanupLimit, 0, 30')
  || !backup.includes('dailySelfImproveLimit: clampInteger(policy?.dailySelfImproveLimit, 0, 1')
  || !backup.includes('MAX_SNOOZE_FUTURE_MS = 7 * 86_400_000')
  || !backup.includes('snoozedUntil: validSnoozeOptionalIso(raw.snoozedUntil)')) {
  throw new Error('Restored settings can again exceed supported UI/runtime bounds or poison candidates with an unbounded future snooze.');
}

if (!backup.includes('xReservedPaths.has(lowered)')
  || !backup.includes('instagramReservedPaths.has(lowered)')
  || !api.includes('!xReservedPaths.has(lowered)')
  || !api.includes('!instagramReservedPaths.has(lowered)')
  || !social.includes('xReservedPaths.has(lowered)')
  || !social.includes('instagramReservedPaths.has(lowered)')) {
  throw new Error('Reserved X/Instagram route names can again enter through restore/provider data or be opened as fake profile identities.');
}

if (!sync.includes('MAX_REMOTE_CLOCK_SKEW_MS = 5 * 60 * 1000')
  || !sync.includes('validRemoteVersion(expectedUpdatedAt)')
  || !router.includes('MAX_CLOCK_SKEW_MS = 5 * 60 * 1000')
  || !router.includes('validPastishIso(row.updated_at)')
  || !router.includes('expectedUpdatedAt must be a valid ISO timestamp and not too far in the future')) {
  throw new Error('A corrupted far-future D1 snapshot version can again poison optimistic-lock state.');
}

if (!syncControls.includes('const latestStateRef = useRef(state);')
  || !syncControls.includes('latestStateRef.current = state;')
  || (syncControls.match(/const localFingerprintAtStart = stateFingerprint\(latestStateRef\.current\);/g) || []).length < 2
  || !syncControls.includes('if (stateFingerprint(latestStateRef.current) !== localFingerprintAtStart)')
  || !syncControls.includes('const versionCleared = clearRemoteStateVersion();')
  || !syncControls.includes('復元中にこの端末のデータが変更されたため、上書きせず停止しました')) {
  throw new Error('A slow D1 restore can again erase local work completed while the download was in flight.');
}

if (!xFollowEvidence.includes('if (target.platform_user_id) return followerIds.has(target.platform_user_id);')
  || xFollowEvidence.includes('if (target.platform_user_id && followerIds.has(target.platform_user_id)) return true;')) {
  throw new Error('X full-cycle follow evidence can again fall back to a recycled username after an immutable user-ID mismatch.');
}

if (!xOwnedStore.includes('const stableIdentityState = reconcileOwnedXStableIdentities(state, result);')
  || !xOwnedStore.includes('const identityChangedIds = ownedXIdentityChanges(stableIdentityState, result);')
  || !xOwnedStore.includes('const identitySafeState = resetOwnedXIdentityChanges(stableIdentityState, result, identityChangedIds);')
  || !xOwnedStore.includes('applyFullCycleFollowEvidence(synced, result, identityChangedIds)')
  || !xOwnedStore.includes('const legacyIdentityAliases = new Map<string, string>();')
  || !xOwnedStore.includes('existingByStableId.get(follower.id) || existingByUsername.get(username)')
  || !xOwnedStore.includes('interactions: state.interactions.filter((interaction) => !changedIds.has(interaction.candidateId))')
  || !xOwnedStore.includes('if (identityChangedIds.has(candidate.id)) return candidate;')) {
  throw new Error('Owned-X handle rename/reuse can again split one immutable identity, transfer old CRM history, or apply old-cycle follow evidence to a different account.');
}

if (!store.includes('const identityResetIds = new Set<string>();')
  || !store.includes('const identityChanged = Boolean(candidate.platformUserId && candidate.platformUserId !== profile.id);')
  || !store.includes('interactions: identityResetIds.size')
  || !store.includes('state.interactions.filter((interaction) => !identityResetIds.has(interaction.candidateId))')
  || !store.includes('Xの公式ユーザーIDが以前の記録と異なります')) {
  throw new Error('Normal paid X profile enrichment can again transfer old CRM history to a recycled handle.');
}

if (!store.includes("const recordedAction: Interaction['action'] = cleanupKeep ? 'unfollow_review' : action;")
  || !store.includes('if (cleanupKeep) {')
  || !store.includes("recommendedAction: 'review' as const")) {
  throw new Error('Cleanup keep can again collapse into profile-only review accounting or accidentally advance relationship engagement.');
}

if (!resultResolution.includes('const completedVisibleEngagement =')
  || !resultResolution.includes("engagementUrl: visibleCandidate.recommendedAction === 'like' || visibleCandidate.recommendedAction === 'reply'")
  || !resultResolution.includes("const recordedAction: Interaction['action'] = visibleReview && action === 'kept'")
  || !resultResolution.includes("? 'review'")) {
  throw new Error('Completed exact engagement can again replay later, or a profile-only review can incorrectly advance relationship engagement.');
}

if (!instagramOwned.includes('existing.latestMediaPermalink = item.permalink || null;')
  || instagramOwned.includes('existing.latestMediaPermalink = item.permalink || existing.latestMediaPermalink')
  || instagramOwned.includes('else if (!existing.latestMediaPermalink && item.permalink)')) {
  throw new Error('Instagram Worker can again pair the newest comment timestamp with an older post permalink.');
}

if (!instagramOwnedStore.includes('const newCommentSignal = existing ? isNewerCommentSignal(existing, engager.lastCommentAt)')
  || !instagramOwnedStore.includes('const newEngagementUrl = newCommentSignal ? engager.latestMediaPermalink || undefined : undefined;')
  || !instagramOwnedStore.includes("newCommentSignal\n        ? newEngagementUrl ? 'reply' : 'review'")
  || instagramOwnedStore.includes('engager.latestMediaPermalink || existing.engagementUrl')
  || !instagramOwnedStore.includes('return !Number.isFinite(handled) || incoming > handled;')) {
  throw new Error('Cached/targetless Instagram comments can again replay a handled action or reuse an older post as the target for a newer inbound signal.');
}

if (!instagramOwnedStore.includes('const identityResetIds = new Set<string>();')
  || !instagramOwnedStore.includes('const stableExisting = incomingStableId ? byStableId.get(incomingStableId) : undefined;')
  || !instagramOwnedStore.includes('const existing = stableExisting || usernameExisting;')
  || !instagramOwnedStore.includes('const identityChanged = Boolean(existingStableId && incomingStableId && existingStableId !== incomingStableId);')
  || !instagramOwnedStore.includes('const platformUserId = incomingStableId || existingStableId || engager.id || existing.platformUserId;')
  || !instagramOwnedStore.includes('const legacyIdentityAliases = new Map<string, string>();')
  || !instagramOwnedStore.includes('resolveIdentityAlias(interaction.candidateId, legacyIdentityAliases)')
  || !instagramOwnedStore.includes('if (existing.skipped && !freshContact) {')) {
  throw new Error('Instagram username reuse, handle renames, legacy same-ID duplicates, or fallback IDs can again transfer CRM history or overwrite a known immutable Graph ID.');
}

if (!xOAuth.includes('let refreshable = false;')
  || !xOAuth.includes('await decryptToken(env, row.refresh_token_enc);')
  || !xOAuth.includes('const usable = accessUsable || refreshable;')
  || !xOAuth.includes('refreshable: usable && refreshable')) {
  throw new Error('X OAuth status can again advertise a corrupt stored refresh token as a maintainable/usable connection.');
}

console.log('Regression fixes OK: provider defaults are aligned, manual and automatic candidate operations are serialized, Today completion ignores profile-only reviews and counts one aggregate self-analysis action, auto refill keeps self-work quota stable and continues multi-batch free ranking, automatic discovery guards reject future poison, slow cloud restores cannot erase newer local work, cross-device discovery retry and first-party sync leases are enforced, reserved social paths and future sync versions fail closed, X/Instagram immutable identity changes and handle renames cannot inherit or split old CRM/evidence, cleanup accounting stays distinct from profile review, exact engagement is consumed, Instagram binds the newest comment to its own concrete post target, repairs handle-renamed legacy duplicates without reactivating stale dismissals, and X OAuth validates refresh-token usability.');