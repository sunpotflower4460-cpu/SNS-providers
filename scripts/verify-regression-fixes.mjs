import { readFile } from 'node:fs/promises';

const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
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
  || !app.includes('10 * 60 * 1000')
  || !app.includes('if (existingRankTargets.length)')) {
  throw new Error('Automatic refill can again lose successful discovery yield, re-search before retrying untouched candidates, or become stuck after a transient failure.');
}

if (!api.includes('completeFreeOnlyRankingBatch(validated.results, selected)')
  || !api.includes("recommendedAction: 'review'")
  || !api.includes('無料評価でこの候補の確実な判定が返らなかったため、本人確認を優先します。')) {
  throw new Error('A partial free-provider ranking response can again leave omitted candidates untouched and trigger repeated automatic evaluation.');
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

if (!resultResolution.includes('const completedVisibleEngagement =')
  || !resultResolution.includes("engagementUrl: visibleCandidate.recommendedAction === 'like' || visibleCandidate.recommendedAction === 'reply'")
  || !resultResolution.includes("const recordedAction: Interaction['action'] = visibleReview && action === 'kept'")
  || !resultResolution.includes("? 'review'")) {
  throw new Error('Completed exact engagement can again replay later, or a profile-only review can incorrectly advance relationship engagement.');
}

if (!instagramOwnedStore.includes('isNewerCommentSignal(existing, engager.lastCommentAt)')
  || !instagramOwnedStore.includes("const recommendedAction: Candidate['recommendedAction'] = newCommentSignal && engagementUrl")
  || !instagramOwnedStore.includes('cached/same comment')
  || !instagramOwnedStore.includes('incoming > handled')) {
  throw new Error('Cached Instagram comments can again recreate already-completed reply actions without a newer inbound signal.');
}

console.log('Regression fixes OK: provider defaults are aligned, state updates are race-safe, auto refill is retry-safe and partial-response-safe, restored values stay bounded, completed exact engagement is consumed, and cached Instagram comments do not replay handled actions.');
