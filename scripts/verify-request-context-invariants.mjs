import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const discoveryStore = await readFile(new URL('../src/discoveryStore.ts', import.meta.url), 'utf8');
const requestContext = await readFile(new URL('../src/requestContext.ts', import.meta.url), 'utf8');
const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');

function requireAll(source, fragments, message) {
  if (!fragments.every((fragment) => source.includes(fragment))) throw new Error(message);
}

requireAll(requestContext, [
  'missionRequestKey',
  'candidateRequestKey',
  'selfRequestKey',
], 'Deterministic async request-context fingerprints are missing.');

requireAll(api, [
  'requestMissionKey',
  'requestCandidateKey: candidateRequestKey(candidate)',
  'requestSelfKey: selfRequestKey(profileText, recentPostsText)',
  'AI ranking returned a result for an unrequested candidate',
], 'AI/discovery responses are no longer bound to the exact request context.');

requireAll(api, [
  'value.results.length === 0',
  'uniqueResultIds(value.results)',
  'optionalString(value.reason, 2400)',
  'value.match >= 0',
  'value.match <= 100',
], 'AI HTTP-200 payload validation can accept empty, duplicate, mistyped or out-of-range results.');

requireAll(api, [
  'validSocialUsername(value.platform, value.username)',
  'validOfficialSocialUrl(value.platform, value.profileUrl, true)',
  'validOfficialSocialUrl(value.platform, value.sourceUrl, false)',
], 'Discovery HTTP-200 validation can admit malformed social identities or URLs.');

requireAll(store, [
  'result.requestMissionKey && result.requestMissionKey !== currentMissionKey',
  'result.requestCandidateKey && result.requestCandidateKey !== candidateRequestKey(candidate)',
  'result.requestSelfKey && result.requestSelfKey !== selfRequestKey(state.selfProfile.profileText, state.selfProfile.recentPostsText)',
  'usedUsd: Math.max(0, state.budget.usedUsd + Math.max(0, costUsd))',
], 'Stale AI recommendations can overwrite newer state or lose already-incurred cost accounting.');

if (!app.includes('setState((current) => applySelfAnalysis(current, result.results[0], result.costUsd))')
  || app.includes('applySelfAnalysis(updateSelfProfileInputs(current, profileText, recentPostsText)')) {
  throw new Error('Self-analysis completion can restore request-time profile text over newer state.');
}

requireAll(app, [
  'onChange((current) => addCandidateFromReference(current, platform, value))',
  'onChange((current) => ({',
  'setFollowBackStatus(current, candidate.id',
  'let next = updateMission(current',
], 'Clipboard/Discover/Relations/Settings UI updates can overwrite newer async state.');

requireAll(discoveryStore, [
  'profile.requestMissionKey && profile.requestMissionKey !== currentMissionKey',
], 'Stale discovery results can leak candidates from a previous Mission into the current pool.');

requireAll(store, [
  'bio: profile.description,',
  'bio: relatedProfile ? relatedProfile.description : candidate.bio',
  'const profileText = result.profile.description;',
  'const postsWereRead = (result.requested?.posts ?? 0) > 0;',
  'const recentPostsText = postsWereRead ? fetchedPostsText : state.selfProfile.recentPostsText;',
], 'Official X empty bio/zero-post semantics can regress to stale local profile text.');

requireAll(providerApi, [
  'new TextEncoder().encode(JSON.stringify(body)).byteLength',
  'const messages = buildProviderMessages(body);',
  'const inputBytes = new TextEncoder().encode(messages.system).byteLength',
  'PAID_INPUT_BYTE_TOKEN_MULTIPLIER = 2',
  'PAID_INPUT_FRAMING_TOKENS = 4096',
  'return reservedUsd;',
  'calculateCost(result.usage, rates, preflightUsd)',
], 'Paid LLM HARD LIMIT preflight can underestimate multibyte prompts or shrink an unknown-usage reservation.');

requireAll(providerApi, [
  "return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';",
], 'X enrichment can silently mutate an invalid handle into a different account name.');

console.log('Request-context invariants OK: stale async results are discarded, UI writes merge into current state, malformed success payloads fail closed, X empty values are authoritative, and paid LLM preflight remains byte-conservative with unknown-usage reservations preserved.');
