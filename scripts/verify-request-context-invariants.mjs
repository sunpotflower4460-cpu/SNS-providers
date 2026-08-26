import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const discoveryStore = await readFile(new URL('../src/discoveryStore.ts', import.meta.url), 'utf8');
const requestContext = await readFile(new URL('../src/requestContext.ts', import.meta.url), 'utf8');
const resultResolution = await readFile(new URL('../src/resultResolution.ts', import.meta.url), 'utf8');
const social = await readFile(new URL('../src/social.ts', import.meta.url), 'utf8');
const fetchTimeout = await readFile(new URL('../src/fetchWithTimeout.ts', import.meta.url), 'utf8');
const syncClient = await readFile(new URL('../src/sync.ts', import.meta.url), 'utf8');
const xAccount = await readFile(new URL('../src/xAccount.ts', import.meta.url), 'utf8');
const instagramAccount = await readFile(new URL('../src/instagramAccount.ts', import.meta.url), 'utf8');
const xAccountControls = await readFile(new URL('../src/XAccountControls.tsx', import.meta.url), 'utf8');
const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const router = await readFile(new URL('../worker/src/router.ts', import.meta.url), 'utf8');
const workerFetchTimeout = await readFile(new URL('../worker/src/fetchWithTimeout.ts', import.meta.url), 'utf8');
const discoveryWorker = await readFile(new URL('../worker/src/discovery.ts', import.meta.url), 'utf8');
const xOAuth = await readFile(new URL('../worker/src/xOAuth.ts', import.meta.url), 'utf8');
const xOwned = await readFile(new URL('../worker/src/xOwned.ts', import.meta.url), 'utf8');
const instagramOwned = await readFile(new URL('../worker/src/instagramOwned.ts', import.meta.url), 'utf8');

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

requireAll(api, [
  'Disabled X enrichment returned billable or profile data',
  'X enrichment returned an unrequested or duplicate profile',
  'returned.some((username) => !requested.has(username))',
  'new Set(returned).size !== returned.length',
], 'X enrichment success payloads can escape their requested handle set or disabled boundary.');

requireAll(fetchTimeout, [
  'const controller = new AbortController();',
  'let timedOut = false;',
  'controller.abort();',
  '通信状態を確認して再試行してください。',
  "upstreamSignal?.removeEventListener('abort', relayAbort)",
], 'Frontend network calls can become unbounded or leak abort listeners.');

requireAll(api, [
  'fetchWithTimeout',
  '30_000',
  '60_000',
  '120_000',
], 'Provider-facing frontend calls lost their bounded timeout tiers.');
requireAll(syncClient, ['fetchWithTimeout', '45_000', "'D1同期'"], 'D1 sync can wait indefinitely.');
requireAll(xAccount, ['fetchWithTimeout', '30_000', '90_000', "'X連携'"], 'X account operations can wait indefinitely.');
requireAll(instagramAccount, ['fetchWithTimeout', '90_000', "'Instagram同期'"], 'Instagram sync can wait indefinitely.');

requireAll(workerFetchTimeout, [
  'const controller = new AbortController();',
  'let timedOut = false;',
  'controller.abort();',
  'timed out after',
  "upstreamSignal?.removeEventListener('abort', relayAbort)",
], 'Worker upstream calls can become unbounded or leak abort listeners.');
requireAll(discoveryWorker, ['fetchWithTimeout', '45_000', "'Tavily search'"], 'Tavily Worker requests can wait indefinitely.');
requireAll(xOwned, ['fetchWithTimeout', '30_000', "'X API'"], 'Owned-X Worker reads can wait indefinitely.');
requireAll(xOAuth, ['fetchWithTimeout', '20_000', '`X OAuth ${operation}`'], 'X OAuth token exchange/refresh can wait indefinitely.');
requireAll(instagramOwned, ['fetchWithTimeout', '30_000', "'Instagram Graph API'"], 'Instagram Graph Worker reads can wait indefinitely.');
requireAll(providerApi, [
  'fetchWithTimeout',
  "30_000, 'X profile enrichment'",
  '75_000, `${provider} ranking`',
  "markReservationUncertain(env, reservationId, 'user_read_uncertain')",
  "markReservationUncertain(env, reservationId, 'rank_uncertain')",
], 'Paid X/LLM Worker calls can wait indefinitely or lose conservative timeout accounting.');

requireAll(router, [
  'const MAX_ROUTED_BODY_BYTES = 2_100_000;',
  "request.headers.get('content-length')",
  'new TextEncoder().encode(rawBody).byteLength > MAX_ROUTED_BODY_BYTES',
  "status: 413, reason: 'Request body is too large.'",
], 'Routed POST/PUT bodies can be read and parsed without an early byte cap.');

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

requireAll(resultResolution, [
  "visibleCandidate.recommendedAction === 'unfollow_review'",
  "current.recommendedAction === 'unfollow_review'",
  'const sameVisibleAction = current.recommendedAction === visibleCandidate.recommendedAction;',
  'const sameVisibleTarget =',
  "const recordedAction: Interaction['action'] = visibleReview && action === 'kept'",
  'recordInteraction(contextualState, current.id, recordedAction)',
], 'Result-sheet actions can be reinterpreted by a newer async candidate recommendation or profile-only review can inflate engagement.');
requireAll(app, [
  'resolveVisibleResult(current, pending, action)',
  '{pending && <ResultSheet candidate={pending}',
], 'The result sheet is no longer bound to the candidate context the user actually saw.');

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

requireAll(store, [
  'X_RESERVED_PATHS',
  'INSTAGRAM_RESERVED_PATHS',
  "platform === 'instagram' && (INSTAGRAM_RESERVED_PATHS.has(lowered) || parts.length !== 1)",
  'if (!target || target.skipped) return state;',
], 'Manual social references can create fake reserved-path profiles or orphan interactions.');

requireAll(social, [
  "statusSegment !== 'status'",
  "!/^\\d{1,30}$/.test(postId || '')",
  "['p', 'reel', 'reels', 'tv'].includes",
  'return `https://x.com/${username}/status/${postId}`;',
  'return `https://www.instagram.com/${kind.toLowerCase()}/${shortcode}/`;',
], 'Reply handoff can open arbitrary same-domain social paths instead of canonical post/media URLs.');

requireAll(app, [
  'candidate.profileSyncAttemptedAt || candidate.profileSyncedAt',
  'const futureSkewLimit = now + 5 * 60 * 1000;',
  'lastAttemptMs > futureSkewLimit',
  'const attemptedUsernames = targets.map((candidate) => candidate.username);',
  'applyXProfiles(current, result.profiles, attemptedUsernames, result.costUsd)',
], 'X enrichment misses can be retried immediately or suppressed indefinitely by a future timestamp.');

requireAll(store, [
  'profileSyncAttemptedAt: attemptedAt',
  "candidate.platform !== 'x' || candidate.skipped",
  'if (!attempted.has(username)) return candidate;',
], 'X profile attempt timestamps can mutate dismissed/unrequested candidates or fail to back off misses.');

requireAll(backup, [
  'profileSyncAttemptedAt: validPastishOptionalIso(raw.profileSyncAttemptedAt)',
  'followedAt: validPastishOptionalIso(raw.followedAt)',
  'lastInteractionAt: validPastishOptionalIso(raw.lastInteractionAt)',
  'analyzedAt: validPastishOptionalIso(state?.selfProfile?.analyzedAt)',
  "statusSegment !== 'status'",
  'return `https://x.com/${username}/status/${postId}`;',
  'return `https://www.instagram.com/${kind.toLowerCase()}/${shortcode}/`;',
], 'Restored action URLs or event timestamps can poison reply eligibility and relationship clocks.');

requireAll(store, [
  'localStorage.setItem(KEY, JSON.stringify(state));',
  "error.name === 'QuotaExceededError'",
  'ローカル保存容量がいっぱいです。',
], 'Browser persistence failures can become uncaught/silent again.');

requireAll(app, [
  "const [persistenceError, setPersistenceError] = useState('');",
  "setPersistenceError(saved.ok ? '' : saved.reason);",
  'const statusNote = persistenceError || apiNote;',
], 'Local persistence failures can be hidden by ordinary API status messages.');

requireAll(xAccountControls, [
  'let requestGeneration = 0;',
  'const generation = ++requestGeneration;',
  'generation !== requestGeneration',
  'generation === requestGeneration',
], 'An older X OAuth status request can overwrite a newer control-token status result.');

requireAll(xAccount, [
  'value.followers.length > 500',
  'value.following.length > 500',
  'value.posts.length > 50',
  'uniqueUsers(value.followers)',
  'uniqueIds(value.posts)',
  'followersCoverage.fetched !== value.followers.length',
  '(requested.followers as number) < value.followers.length',
  'validPastishIso(value.syncedAt)',
  'if (!value.complete) return value.seenKeys.length === 0 && value.unseenKeys.length === 0;',
  'allKeys.length === value.targetCount',
  "value.source === 'cache' && value.costUsd !== 0",
], 'Owned-X client validation can accept duplicate, oversized, temporally invalid or coverage-inconsistent payloads.');

requireAll(instagramAccount, [
  'value.engagers.length > 80',
  'uniqueEngagers(value.engagers as InstagramEngager[])',
  'validPastishIso(value.syncedAt)',
  'nullablePastishIso(value.lastCommentAt)',
  'engager.mediaCount > mediaScanned',
  'countedExternalComments > commentEvents',
  'value.externalCostUsd === 0',
  'parts.length === 1',
  'validInstagramMediaUrl',
  'boundedNonNegativeInteger(value.commentEvents, 600)',
], 'Instagram client validation can accept duplicate, future-dated, count-inconsistent, oversized or non-media payloads.');

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

requireAll(xOwned, [
  'const syncedAtMs = new Date(row.synced_at).getTime();',
  '!Number.isFinite(syncedAtMs)',
  'syncedAtMs > Date.now() + 60_000',
  'validOwnedSnapshot(snapshot)',
  'DELETE FROM x_owned_snapshots WHERE user_id = ?',
  'safeCursor(row?.followers_cursor)',
  'safeCycle(row?.followers_cycle)',
  'X API returned an empty or invalid JSON response',
], 'Owned-X can trust malformed/future cache state, corrupted paging state, or invalid successful JSON.');

requireAll(instagramOwned, [
  'const syncedAtMs = new Date(row.synced_at).getTime();',
  '!Number.isFinite(syncedAtMs)',
  'syncedAtMs > Date.now() + 60_000',
  'snapshot.accountId !== expectedAccountId',
  "return /^[A-Za-z0-9._]{1,30}$/.test(username) ? username : '';",
  'Instagram Graph API returned an empty or invalid JSON response',
], 'Instagram owned sync can trust malformed/future cache state, mutate invalid usernames, or accept invalid successful JSON.');

console.log('Request-context invariants OK: stale async results are discarded, visible result-sheet semantics are preserved, profile-only reviews do not inflate engagement, routed bodies and frontend/Worker timeouts are bounded, social handoff and restore URLs stay canonical, X/Instagram payload identity/count/time coherence fails closed, restored relationship clocks reject future poison, X enrichment uses future-safe backoff, persistence failures stay visible, and paid LLM preflight remains byte-conservative.');
