import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const discoveryStore = await readFile(new URL('../src/discoveryStore.ts', import.meta.url), 'utf8');
const requestContext = await readFile(new URL('../src/requestContext.ts', import.meta.url), 'utf8');

if (!requestContext.includes('missionRequestKey')
  || !requestContext.includes('candidateRequestKey')
  || !requestContext.includes('selfRequestKey')) {
  throw new Error('Deterministic async request-context fingerprints are missing.');
}

if (!api.includes('requestMissionKey')
  || !api.includes('requestCandidateKey: candidateRequestKey(candidate)')
  || !api.includes('requestSelfKey: selfRequestKey(profileText, recentPostsText)')
  || !api.includes('AI ranking returned a result for an unrequested candidate')) {
  throw new Error('AI/discovery responses are no longer bound to the exact request context.');
}

if (!api.includes('value.results.length === 0')
  || !api.includes('uniqueResultIds(value.results)')
  || !api.includes('optionalString(value.reason, 2400)')
  || !api.includes('value.match >= 0')
  || !api.includes('value.match <= 100')) {
  throw new Error('AI HTTP-200 payload validation can accept empty, duplicate, mistyped or out-of-range results.');
}

if (!api.includes('validSocialUsername(value.platform, value.username)')
  || !api.includes('validOfficialSocialUrl(value.platform, value.profileUrl, true)')
  || !api.includes('validOfficialSocialUrl(value.platform, value.sourceUrl, false)')) {
  throw new Error('Discovery HTTP-200 validation can admit malformed social identities or URLs.');
}

if (!store.includes('result.requestMissionKey && result.requestMissionKey !== currentMissionKey')
  || !store.includes('result.requestCandidateKey && result.requestCandidateKey !== candidateRequestKey(candidate)')
  || !store.includes('usedUsd: Math.max(0, state.budget.usedUsd + Math.max(0, costUsd))')) {
  throw new Error('Stale AI recommendations can overwrite newer state or lose already-incurred cost accounting.');
}

if (!discoveryStore.includes('profile.requestMissionKey && profile.requestMissionKey !== currentMissionKey')) {
  throw new Error('Stale discovery results can leak candidates from a previous Mission into the current pool.');
}

if (!store.includes('bio: profile.description,')
  || !store.includes('bio: relatedProfile ? relatedProfile.description : candidate.bio')
  || !store.includes('const profileText = result.profile.description;')
  || !store.includes('const postsWereRead = (result.requested?.posts ?? 0) > 0;')
  || !store.includes('const recentPostsText = postsWereRead ? fetchedPostsText : state.selfProfile.recentPostsText;')) {
  throw new Error('Official X empty bio/zero-post semantics can regress to stale local profile text.');
}

console.log('Request-context invariants OK: stale async AI/discovery results are discarded, malformed success payloads fail closed, incurred cost remains accounted, and empty X profile data is authoritative.');
