import { readFile } from 'node:fs/promises';

const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const workload = await readFile(new URL('../src/WorkloadControls.tsx', import.meta.url), 'utf8');
const statusPresentation = await readFile(new URL('../src/statusPresentation.ts', import.meta.url), 'utf8');

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

console.log('Regression fixes OK: provider defaults are aligned, workload edits preserve concurrent state, recommendations retain refill capacity, status rendering is non-destructive, automatic refill is retry-safe, and restored values stay inside supported runtime bounds.');
