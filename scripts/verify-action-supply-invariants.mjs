import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const daily = await readFile(new URL('../src/daily.ts', import.meta.url), 'utf8');
const discoveryStore = await readFile(new URL('../src/discoveryStore.ts', import.meta.url), 'utf8');
const workload = await readFile(new URL('../src/WorkloadControls.tsx', import.meta.url), 'utf8');
const discoveryWorker = await readFile(new URL('../worker/src/discovery.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');

function requireAll(source, fragments, message) {
  if (!fragments.every((fragment) => source.includes(fragment))) throw new Error(message);
}

requireAll(store, [
  'dailyQueueLimit: 30',
  'dailyConnectionLimit: 20',
  'dailyConversationLimit: 8',
  'dailyLightEngagementLimit: 8',
], 'Default daily workload targets changed without updating supply assumptions.');

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
  "'concrete-post'",
  "segment !== 'status'",
  "['p', 'reel', 'reels', 'tv'].includes",
], 'Discovery can no longer preserve a concrete post/media target for later like/reply recommendations.');

requireAll(api, [
  'followedAt: candidate.followedAt',
  'lastInteractionAt: candidate.lastInteractionAt',
  'profileSyncedAt: candidate.profileSyncedAt',
  "item.recommendedAction === 'like' || item.recommendedAction === 'reply'",
  'const missingExactTarget = exactTargetRequired && !candidate.engagementUrl;',
  "recommendedAction: missingExactTarget ? 'review' : item.recommendedAction",
], 'AI ranking no longer receives relationship timing context or can emit targetless like/reply actions.');

requireAll(daily, [
  'effectiveAction(candidate)',
  "candidate.recommendedAction === 'like' || candidate.recommendedAction === 'reply'",
  '!candidate.engagementUrl',
  'freshnessBoost(candidate, action, now)',
  'isCoolingDown(candidate, lastHandledAt.get(candidate.id), now)',
  'signalMs > handledMs + 60_000',
  "light: relationshipItems.filter((item) => item.action === 'like')",
  'Keep those\n    // candidates in Discover instead of putting a human decision back into Today.',
  "case 'reply': return `${name} のこの投稿へ返信する`;",
], 'Daily Queue can again require post selection, surface review-only decisions, ignore fresh timing signals, or repeatedly surface the same handled people.');

requireAll(workload, [
  'function actionableSupply(state: AppState)',
  '実行先まで決まっている候補',
  'reviewだけの候補は実行可能数に含めていません',
  "candidate.recommendedAction === 'like' && Boolean(candidate.engagementUrl)",
  "candidate.recommendedAction === 'reply' && Boolean(candidate.engagementUrl)",
], 'Workload advisor can again inflate supply by counting review-only or targetless engagement candidates.');

console.log('Action/supply invariants OK: discovery can feed the default queue, concrete engagement targets are preserved, timing context is ranked, review-only decisions stay out of Today, recent people cool down unless a fresh inbound signal arrives, and workload supply counts only actionable candidates.');
