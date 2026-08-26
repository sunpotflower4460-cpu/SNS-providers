import { readFile } from 'node:fs/promises';

const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
const xOAuth = await readFile(new URL('../worker/src/xOAuth.ts', import.meta.url), 'utf8');
const router = await readFile(new URL('../worker/src/router.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const social = await readFile(new URL('../src/social.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const sync = await readFile(new URL('../src/sync.ts', import.meta.url), 'utf8');
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

if (!app.includes('const selfAnalyzedToday = state.selfProfile.analyzedAt')
  || !app.includes('const plannedSelf = !selfAnalyzedToday')
  || !app.includes("return interaction.action !== 'review' && sameLocalDay(at, now);")
  || !app.includes("interaction.action !== 'review'\n        && at.getFullYear()")) {
  throw new Error('Automatic refill/Today progress can again reserve already-completed self work or count profile-only reviews as executable work.');
}

if (!app.includes('const candidateOperationBusy = discovering || ranking || enrichingX;')
  || (app.match(/disabled=\{candidateOperationBusy\}/g) || []).length < 3
  || !app.includes("setApiNote('別の候補処理が終わってから再評価してください')")) {
  throw new Error('Manual discovery, paid X enrichment and AI ranking can again overlap and discard paid results after concurrent candidate mutation.');
}

if (!api.includes('completeFreeOnlyRankingBatch(validated.results, selected)')
  || !api.includes("recommendedAction: 'review'")
  || !api.includes('無料評価でこの候補の確実な判定が返らなかったため、本人確認を優先します。')) {
  throw new Error('A partial free-provider ranking response can again leave omitted candidates untouched and trigger repeated automatic evaluation.');
}

if (!api.includes('retryAfterSeconds?: number;')
  || !api.includes('optionalBoundedInteger(result.retryAfterSeconds, 1, 86_400)')
  || !router.includes('retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000))')) {
  throw new Error('Cross-device automatic-discovery throttling can again block a local day without exposing when retry becomes safe.');
}

if (!backup.includes('monthlyLimitUsd: clampNumber(state?.budget?.monthlyLimitUsd, 0, 10, 3)')
  || !backup.includes('followBackReviewAfterDays: clampInteger(policy?.followBackReviewAfterDays, 7, 90')
  || !backup.includes('dailyQueueLimit: clampInteger(policy?.dailyQueueLimit, 1, 150')
  || !backup.includes('dailyConnectionLimit: clampInteger(policy?.dailyConnectionLimit, 0, 120')
  || !backup.includes('dailyConversationLimit: clampInteger(policy?.dailyConversationLimit, 0, 30')
  || !backup.includes('dailyLightEngagementLimit: clampInteger(policy?.dailyLightEngagementLimit, 0, 30')
  || !backup.includes('dailyCleanupLimit: clampInteger(policy?.dailyCleanupLimit, 0, 30')
  || !backup.includes('dailySelfImproveLimit: clampInteger(policy?.dailySelfImproveLimit, 0, 5')
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
  || !router.includes('expectedUpdatedAt must be a current valid ISO timestamp')) {
  throw new Error('A corrupted far-future D1 snapshot version can again poison optimistic-lock state.');
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

if (!instagramOwnedStore.includes('const newCommentSignal = existing ? isNewerCommentSignal(existing, engager.lastCommentAt)')
  || !instagramOwnedStore.includes('const engagementUrl = newCommentSignal')
  || !instagramOwnedStore.includes("const recommendedAction: Candidate['recommendedAction'] = newCommentSignal && engagementUrl")
  || !instagramOwnedStore.includes('return !Number.isFinite(handled) || incoming > handled;')) {
  throw new Error('Cached Instagram comments can again recreate already-completed reply actions without a newer inbound signal.');
}

if (!xOAuth.includes('let refreshable = false;')
  || !xOAuth.includes('await decryptToken(env, row.refresh_token_enc);')
  || !xOAuth.includes('const usable = accessUsable || refreshable;')
  || !xOAuth.includes('refreshable: usable && refreshable')) {
  throw new Error('X OAuth status can again advertise a corrupt stored refresh token as a maintainable/usable connection.');
}

console.log('Regression fixes OK: provider defaults are aligned, candidate operations are serialized, auto refill matches Today and continues multi-batch free ranking, cross-device cooldown retry is scheduled, reserved social paths and future sync versions fail closed, cleanup accounting stays distinct from profile review, exact engagement is consumed, cached Instagram comments do not replay handled actions, and X OAuth validates refresh-token usability.');
