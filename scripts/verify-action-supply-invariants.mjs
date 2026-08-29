import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const daily = await readFile(new URL('../src/daily.ts', import.meta.url), 'utf8');
const discoveryStore = await readFile(new URL('../src/discoveryStore.ts', import.meta.url), 'utf8');
const requestContext = await readFile(new URL('../src/requestContext.ts', import.meta.url), 'utf8');
const workload = await readFile(new URL('../src/WorkloadControls.tsx', import.meta.url), 'utf8');
const discoveryWorker = await readFile(new URL('../worker/src/discovery.ts', import.meta.url), 'utf8');
const router = await readFile(new URL('../worker/src/router.ts', import.meta.url), 'utf8');
const workerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const localAction = await readFile(new URL('../src/localAction.ts', import.meta.url), 'utf8');
const firstQueue = await readFile(new URL('../src/firstQueue.ts', import.meta.url), 'utf8');

function requireAll(source, fragments, message) {
  if (!fragments.every((fragment) => source.includes(fragment))) throw new Error(message);
}

requireAll(store, [
  'dailyQueueLimit: 30',
  'dailyConnectionLimit: 20',
  'dailyConversationLimit: 8',
  'dailyLightEngagementLimit: 8',
  'monthlyLimitUsd: 3',
  'hold-review',
  '古い推薦のままTodayには出しません',
], 'Default daily workload targets or the $3 default budget changed without updating supply assumptions.');

requireAll(api, [
  'maxPerPlatform: 20',
  'result.profiles.length > 40',
], 'Fresh discovery can no longer supply up to 40 bounded candidates for the default 30-action queue.');

requireAll(discoveryWorker, [
  'targetPerPlatform',
  'fan listener supporter music community profile',
  'artist creator musician songwriter collaboration profile',
  "profile.platform === 'x').slice(0, targetPerPlatform)",
  "profile.platform === 'instagram').slice(0, targetPerPlatform)",
], 'Discovery lost diversified X/Instagram candidate supply or its per-platform cap.');

requireAll(discoveryStore, [
  'canonicalEngagementUrl(profile.platform, profile.sourceUrl)',
  'id: `web-${profile.platform}-${normalizedUsername}`',
  "'concrete-post'",
  "segment !== 'status'",
  "['p', 'reel', 'reels', 'tv'].includes",
], 'Discovery can no longer preserve stable candidate identity or a concrete post/media target for later like/reply recommendations.');

requireAll(api, [
  "candidate.reason.startsWith('無料Web検索から候補')",
  'Free-only ranking found no untouched web-discovery candidates to evaluate.',
  'currentMatch: candidate.match',
  'followedAt: candidate.followedAt',
  'followBack: candidate.followBack',
  'lastInteractionAt: candidate.lastInteractionAt',
  'profileSyncedAt: candidate.profileSyncedAt',
  "item.recommendedAction === 'like' || item.recommendedAction === 'reply'",
  'const missingExactTarget = exactTargetRequired && !candidate.engagementUrl;',
  "recommendedAction: missingExactTarget ? 'review' : item.recommendedAction",
], 'Free-only ranking can revisit an already-reviewed candidate, lose timing/follow context, or emit targetless like/reply actions.');

requireAll(requestContext, [
  'candidate.match',
  'candidate.engagementUrl || null',
  'candidate.followedAt || null',
  'candidate.followBack ?? null',
  'candidate.lastInteractionAt || null',
  'candidate.profileSyncedAt || null',
], 'AI request fingerprints can ignore current match or relationship timing/follow state and accept stale recommendations.');

requireAll(localAction, [
  'export function queueAction',
  "candidate.recommendedAction === 'like' || candidate.recommendedAction === 'reply'",
  '!candidate.engagementUrl',
  '!candidate.followedAt',
  "tags.includes('identity-conflict')",
  "tags.includes('hold-review')",
  '古い推薦のままTodayには出しません',
], 'Local queue actions can again require a paid rank, invent people, force a post choice without a concrete target, or revive withdrawn follow advice.');

requireAll(firstQueue, [
  'queueAction(candidate)',
  'Todayにフォロー / いいね / 返信が並ぶ',
], 'First-use path can again require a paid AI rank before Today shows follow/like/reply work.');

requireAll(daily, [
  'effectiveAction(candidate)',
  'queueAction(candidate)',
  'export function countFollowOverflow',
  'isCoolingDown(candidate, lastHandledAt.get(candidate.id), now)',
  'freshnessBoost(candidate, action, now)',
  'staleConversationBoost(candidate, action, staleDays)',
  'signalMs > handledMs + 60_000',
  "light: relationshipItems.filter((item) => item.action === 'like')",
  'Keep those\n    // candidates in Discover instead of putting a human decision back into Today.',
  "case 'reply': return `${name} のこの投稿へ返信する`;",
], 'Daily Queue can again require post selection, surface review-only decisions, ignore fresh timing signals, or repeatedly surface the same handled people.');

requireAll(workload, [
  'function actionableSupply(state: AppState)',
  '実行先まで決まっている候補',
  'reviewだけの候補は実行可能数に含めていません',
  'autoReplenishEnabled !== false',
  '無料Tavily探索＋無料/ローカル評価',
  "action === 'like' && Boolean(candidate.engagementUrl)",
  "action === 'reply' && Boolean(candidate.engagementUrl)",
], 'Workload advisor can again inflate supply or hide/lose the automatic free-only replenishment control.');

requireAll(app, [
  'autoReplenishDemand(state)',
  'demand.current >= demand.lowWater',
  'Math.ceil(remainingTarget * 0.7)',
  "discoverSocialCandidates(snapshot.mission, 'local-user', true)",
  "rankCandidates(merged.mission, rankTargets, merged.budget.monthlyLimitUsd, 'local-user', false)",
  "candidate.recommendedAction !== 'review'",
  'relationshipTarget - completedToday',
  'countFollowOverflow(state, queue)',
], 'Automatic replenishment can again overfill completed work, run without a low-water threshold, or use a paid ranking path.');

requireAll(api, [
  'automatic = false',
  'paidAllowed = true',
  'paidAllowed,',
  "if (!paidAllowed && (validated.paid || validated.costUsd !== 0))",
], 'Frontend API contract can no longer distinguish automatic discovery or enforce free-only automatic ranking responses.');

requireAll(workerApi, [
  'paidAllowed?: boolean;',
  'const paidAllowed = body.paidAllowed !== false;',
  'paidAllowed && budget.ledgerAvailable',
  'paidAllowed && env.DEEPSEEK_API_KEY',
  "if (body.paidAllowed != null && typeof body.paidAllowed !== 'boolean')",
  'currentMatch?: number;',
  'followReady ? \'follow\' : \'review\'',
], 'Worker can again enter a paid provider during free-only auto ranking or lose safe local follow fallback.');

requireAll(router, [
  'automatic?: boolean;',
  'AUTO_DISCOVERY_COOLDOWN_MS = 20 * 60 * 60 * 1000',
  'reserveAutomaticDiscovery(env, userId)',
  "operation = 'search_auto_guard'",
  'D1の自動補充ガードを確認できないため、自動探索だけ安全側で停止しました',
  'releaseAutomaticDiscovery(env, automaticGuardId)',
], 'Cross-device automatic discovery throttling or fail-closed D1 guarding regressed.');

requireAll(backup, [
  'autoReplenishEnabled: true',
  "typeof policy?.autoReplenishEnabled === 'boolean'",
], 'Backup/D1 restore can lose the automatic replenishment preference.');

console.log('Action/supply invariants OK: discovery can feed the default queue, stable discovery IDs keep auto ranking attached, automatic refill is free-only and cross-device throttled, only untouched web discoveries are auto-ranked, completed work is not overfilled, concrete engagement targets are preserved, timing/follow context is request-bound, review-only decisions stay out of Today, recent people cool down unless a fresh inbound signal arrives, and workload supply counts only actionable candidates.');
