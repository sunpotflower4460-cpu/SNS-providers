#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = '/tmp/sns-providers-manual-only-closure';
await mkdir(outDir, { recursive: true });

async function emit(destRel, sourceUrl) {
  const source = await readFile(sourceUrl, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
    },
    fileName: sourceUrl.pathname,
  });
  const rewritten = outputText.replace(/from ['"](\.{1,2}\/[^'"]+)['"]/g, (_, spec) => `from '${spec}.js'`);
  const dest = `${outDir}/${destRel}`;
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, rewritten);
}

const files = [
  ['fetchWithTimeout.js', '../worker/src/fetchWithTimeout.ts'],
  ['syncLease.js', '../worker/src/syncLease.ts'],
  ['budgetIntegrity.js', '../worker/src/budgetIntegrity.ts'],
  ['xOAuth.js', '../worker/src/xOAuth.ts'],
  ['social/query.js', '../worker/src/social/query.ts'],
  ['social/types.js', '../worker/src/social/types.ts'],
  ['social/budgetCeiling.js', '../worker/src/social/budgetCeiling.ts'],
  ['social/fingerprint.js', '../worker/src/social/fingerprint.ts'],
  ['social/syncCheckpoints.js', '../worker/src/social/syncCheckpoints.ts'],
  ['social/httpStatus.js', '../worker/src/social/httpStatus.ts'],
  ['social/ids.js', '../worker/src/social/ids.ts'],
  ['social/capabilities.js', '../worker/src/social/capabilities.ts'],
  ['social/repository.js', '../worker/src/social/repository.ts'],
  ['social/x/followReconcile.js', '../worker/src/social/x/followReconcile.ts'],
  ['social/x/likeReconcile.js', '../worker/src/social/x/likeReconcile.ts'],
  ['social/x/dm.js', '../worker/src/social/x/dm.ts'],
  ['social/x/inbound.js', '../worker/src/social/x/inbound.ts'],
  ['social/x/persist.js', '../worker/src/social/x/persist.ts'],
  ['social/x/persistDm.js', '../worker/src/social/x/persistDm.ts'],
  ['social/x/lookup.js', '../worker/src/social/x/lookup.ts'],
  ['social/x/sync.js', '../worker/src/social/x/sync.ts'],
  ['social/x/dmSync.js', '../worker/src/social/x/dmSync.ts'],
  ['social/instagram/inbound.js', '../worker/src/social/instagram/inbound.ts'],
  ['social/instagram/persist.js', '../worker/src/social/instagram/persist.ts'],
  ['social/instagram/persistDm.js', '../worker/src/social/instagram/persistDm.ts'],
  ['social/instagram/dm.js', '../worker/src/social/instagram/dm.ts'],
  ['social/instagram/probe.js', '../worker/src/social/instagram/probe.ts'],
  ['social/instagram/webhook.js', '../worker/src/social/instagram/webhook.ts'],
  ['social/instagram/commentSync.js', '../worker/src/social/instagram/commentSync.ts'],
  ['social/instagram/dmSync.js', '../worker/src/social/instagram/dmSync.ts'],
  ['social/inboxSync.js', '../worker/src/social/inboxSync.ts'],
];
for (const [dest, src] of files) {
  await emit(dest, new URL(src, import.meta.url));
}

const { hashNormalizedText, providerTextMatchesFingerprint, buildExecutionFingerprint, exactReconcileDecision } = await import(pathToFileURL(`${outDir}/social/fingerprint.js`).href);
const { xUserLookupUrl, xFollowingListUrl, interpretFollowRelationship } = await import(pathToFileURL(`${outDir}/social/x/followReconcile.js`).href);
const { likeReconciliationReady, interpretLikeState, xLikedTweetsUrl } = await import(pathToFileURL(`${outDir}/social/x/likeReconcile.js`).href);
const { xDmEventsUrl, normalizeXDmEvents, paginateXDmEvents } = await import(pathToFileURL(`${outDir}/social/x/dm.js`).href);
const { extractInstagramWebhookMessages, extractInstagramWebhookComments } = await import(pathToFileURL(`${outDir}/social/instagram/webhook.js`).href);
const { resolveEffectiveBudgetLimit } = await import(pathToFileURL(`${outDir}/social/budgetCeiling.js`).href);
const { xMentionsUrl, paginateXMentions } = await import(pathToFileURL(`${outDir}/social/x/sync.js`).href);
const { syncSocialInboxIsolated } = await import(pathToFileURL(`${outDir}/social/inboxSync.js`).href);
const { instagramCommentActionId, instagramCommentEventId, instagramDmActionId, instagramDmEventRowId } = await import(pathToFileURL(`${outDir}/social/ids.js`).href);
const { persistInstagramDmEvidence } = await import(pathToFileURL(`${outDir}/social/instagram/persistDm.js`).href);
const { persistInstagramCommentEvidence } = await import(pathToFileURL(`${outDir}/social/instagram/persist.js`).href);
const { instagramRecentMediaUrl, instagramMediaCommentsUrl } = await import(pathToFileURL(`${outDir}/social/instagram/commentSync.js`).href);
const { instagramConversationListUrl, instagramConversationMessagesUrl } = await import(pathToFileURL(`${outDir}/social/instagram/dmSync.js`).href);

function fail(message) {
  throw new Error(message);
}

const followLookup = xUserLookupUrl('99');
if (followLookup.method !== 'GET' || followLookup.path !== '/2/users/99' || !followLookup.query['user.fields'].includes('connection_status')) {
  fail(`Follow reconcile used unofficial lookup ${followLookup.path}`);
}
if (xFollowingListUrl('1').path !== '/2/users/1/following') fail('Following list fallback path drifted.');
if (followLookup.url.includes('/following/99')) fail('Non-existent GET /following/{target} was used.');

if (interpretFollowRelationship('follow', { following: true, followRequestSent: false, complete: true }) !== 'success') fail('Following was not success.');
if (interpretFollowRelationship('follow', { following: false, followRequestSent: true, complete: true }) !== 'success') fail('follow_request_sent was not success.');
if (interpretFollowRelationship('unfollow_review', { following: false, followRequestSent: false, complete: false }) !== 'unknown') {
  fail('Incomplete following pagination was treated as unfollow success.');
}
if (interpretFollowRelationship('unfollow_review', { following: false, followRequestSent: false, complete: true }) !== 'success') {
  fail('Completed not-following evidence was not unfollow success.');
}

if (likeReconciliationReady(['like.write'])) fail('like.write only was treated as reconciliation-ready.');
if (!likeReconciliationReady(['like.read', 'like.write'])) fail('like.read+like.write was not reconciliation-ready.');
if (interpretLikeState({ liked: true, complete: true }) !== 'success') fail('Verified liked state was not success.');
if (interpretLikeState({ liked: false, complete: false }) !== 'unknown') fail('Incomplete like pagination was not unknown.');
if (interpretLikeState({ liked: false, complete: true }) !== 'failure') fail('Exhausted not-liked evidence was not failure.');
const likedUrl = xLikedTweetsUrl('7');
if (likedUrl.method !== 'GET' || likedUrl.path !== '/2/users/7/liked_tweets') fail('Liked tweets path drifted.');

const hashA = await hashNormalizedText('Hello   world');
const hashB = await hashNormalizedText(' Hello   world ');
if (hashA !== hashB) fail('Normalized text hashes diverged.');
const fp = await buildExecutionFingerprint({ draft: 'Hello world', canonicalTargetId: 't1', conversationId: 'c1', operation: 'x_dm_write' });
if (!await providerTextMatchesFingerprint(fp, 'Hello   world')) fail('Exact hash match failed.');
if (await providerTextMatchesFingerprint(fp, 'Hello there')) fail('Different text was matched.');

const dmUrl = xDmEventsUrl();
if (dmUrl.path !== '/2/dm_events' || dmUrl.query.expansions !== 'sender_id' || !dmUrl.query['user.fields'].includes('username')) {
  fail('X DM read is missing official sender expansions.');
}
const dmEvents = normalizeXDmEvents([
  { id: 'e1', event_type: 'MessageCreate', sender_id: '2', dm_conversation_id: 'c1', text: 'hi', created_at: '2026-08-30T12:00:00.000Z' },
], '1', '2026-08-30T12:02:00.000Z', [{ id: '2', username: 'bob', name: 'Bob' }]);
if (dmEvents[0].username !== 'bob' || dmEvents[0].externalUserId !== '2') fail('X DM identity metadata was dropped.');

const messages = extractInstagramWebhookMessages({
  object: 'instagram',
  entry: [{
    id: 'ig-pro-1',
    messaging: [{
      sender: { id: 'igsid-9' },
      recipient: { id: 'ig-pro-1' },
      timestamp: Date.parse('2026-08-30T12:00:00.000Z'),
      message: { mid: 'm1', text: 'hello' },
    }],
  }],
});
if (messages[0].recipientProfessionalId !== 'ig-pro-1' || messages[0].senderIgsid !== 'igsid-9') fail('Webhook DM evidence dropped sender/recipient IDs.');
if (messages[0].conversationId) fail('Webhook treated recipient.id as conversation ID.');

const comments = extractInstagramWebhookComments({
  object: 'instagram',
  entry: [{
    id: 'ig-pro-1',
    time: Math.floor(Date.now() / 1000),
    changes: [{
      field: 'comments',
      value: {
        id: 'c99',
        from: { id: 'u1', username: 'alice' },
        text: 'nice',
        media: { id: 'm88' },
      },
    }],
  }],
});
if (comments[0].commentId !== 'c99' || comments[0].mediaId !== 'm88' || comments[0].username !== 'alice') {
  fail('Instagram comment webhook fields were not extracted.');
}

const fakeDb = {
  prepare() {
    return {
      bind() {
        return {
          async first() { return { monthly_budget_ceiling_usd: 1 }; },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
    };
  },
};
const budget = await resolveEffectiveBudgetLimit({ DB: fakeDb, DEFAULT_MONTHLY_BUDGET_USD: '3' }, 'local-user', 9);
if (budget.effectiveLimitUsd !== 1) fail(`User ceiling did not cap below HARD LIMIT and client request: ${budget.effectiveLimitUsd}`);
if (budget.hardLimitUsd !== 3) fail('Server HARD LIMIT was overwritten.');
const raised = await resolveEffectiveBudgetLimit({ DB: fakeDb, DEFAULT_MONTHLY_BUDGET_USD: '3' }, 'local-user', 99);
if (raised.effectiveLimitUsd !== 1) fail('User or client setting raised the server HARD LIMIT.');

if (exactReconcileDecision(0) !== 'unknown') fail('Zero matches were not UNKNOWN.');
if (exactReconcileDecision(1) !== 'success') fail('Exactly one match was not success.');
if (exactReconcileDecision(2) !== 'unknown') fail('Two identical possible results were treated as success.');

const mentionPage = xMentionsUrl('42', { maxResults: 100, sinceId: '100', paginationToken: undefined });
if (mentionPage.method !== 'GET' || mentionPage.path !== '/2/users/42/mentions' || mentionPage.query.since_id !== '100' || Number(mentionPage.query.max_results) !== 100) {
  fail(`X mentions URL drifted: ${mentionPage.url}`);
}
const mentionNext = xMentionsUrl('42', { maxResults: 100, paginationToken: 'page2' });
if (mentionNext.query.pagination_token !== 'page2' || mentionNext.query.since_id) fail('Continuation mention page mixed since_id with pagination_token.');

function mentionTweet(id, text) {
  return { id, text, author_id: '9', created_at: '2026-08-30T12:00:00.000Z', conversation_id: id };
}
const mentionPages = {
  'since_id=100': { data: [mentionTweet('103', 'p1')], includes: { users: [{ id: '9', username: 'bob', name: 'Bob' }] }, meta: { next_token: 'page2', newest_id: '103' } },
  'pagination_token=page2': { data: [mentionTweet('102', 'p2')], includes: { users: [{ id: '9', username: 'bob', name: 'Bob' }] }, meta: { next_token: 'page3' } },
  'pagination_token=page3': { data: [mentionTweet('101', 'p3')], includes: { users: [{ id: '9', username: 'bob', name: 'Bob' }] }, meta: {} },
};
function mentionGetJson(url) {
  const parsed = new URL(url);
  if (parsed.pathname !== '/2/users/42/mentions') throw new Error(`Unexpected mentions path ${parsed.pathname}`);
  const token = parsed.searchParams.get('pagination_token');
  const since = parsed.searchParams.get('since_id');
  const key = token ? `pagination_token=${token}` : `since_id=${since}`;
  const page = mentionPages[key];
  if (!page) throw new Error(`No mock mention page for ${key}`);
  return page;
}
const firstWalk = await paginateXMentions({
  accountId: '42',
  sinceId: '100',
  maxResults: 100,
  maxPages: 2,
  receivedAt: '2026-08-30T12:05:00.000Z',
  getJson: mentionGetJson,
});
if (firstWalk.complete) fail('Budget/cap stop advanced the mention checkpoint.');
if (firstWalk.continuation !== 'page3') fail('Crash after page2 did not keep the continuation cursor.');
if (!firstWalk.events.some((event) => event.externalEventId === '103') || !firstWalk.events.some((event) => event.externalEventId === '102')) {
  fail('Mention page1+page2 events were not persisted before the cap.');
}
const retryWalk = await paginateXMentions({
  accountId: '42',
  sinceId: '100',
  paginationToken: firstWalk.continuation,
  pendingNewestId: firstWalk.newestId,
  maxResults: 100,
  maxPages: 8,
  receivedAt: '2026-08-30T12:06:00.000Z',
  getJson: mentionGetJson,
});
if (!retryWalk.complete) fail('Retry did not finish remaining mention pages.');
if (!retryWalk.events.some((event) => event.externalEventId === '101')) fail('Retry dropped the backlog page.');
if (retryWalk.newestId !== '103') fail('Pending newest from page1 was erased by older backlog pages.');

const dmPages = {
  none: { data: [{ id: 'e3', event_type: 'MessageCreate', sender_id: '2', dm_conversation_id: 'c1', text: 'new', created_at: '2026-08-30T12:03:00.000Z' }], includes: { users: [{ id: '2', username: 'bob', name: 'Bob' }] }, meta: { next_token: 'd2' } },
  d2: { data: [{ id: 'e2', event_type: 'MessageCreate', sender_id: '2', dm_conversation_id: 'c1', text: 'mid', created_at: '2026-08-30T12:02:00.000Z' }], includes: { users: [{ id: '2', username: 'bob', name: 'Bob' }] }, meta: { next_token: 'd3' } },
  d3: { data: [{ id: 'e1', event_type: 'MessageCreate', sender_id: '1', dm_conversation_id: 'c1', text: 'own', created_at: '2026-08-30T12:01:00.000Z' }], includes: { users: [{ id: '1', username: 'me', name: 'Me' }] }, meta: {} },
};
const dmWalk = await paginateXDmEvents({
  ownUserId: '1',
  maxPages: 8,
  receivedAt: '2026-08-30T12:10:00.000Z',
  getJson: async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname !== '/2/dm_events') throw new Error(`Unexpected DM path ${parsed.pathname}`);
    if (parsed.searchParams.get('expansions') !== 'sender_id') fail('DM read omitted expansions=sender_id.');
    const token = parsed.searchParams.get('pagination_token') || 'none';
    return dmPages[token];
  },
});
if (!dmWalk.complete || dmWalk.events.length !== 3) fail('X DM pagination did not collect every page.');
if (dmWalk.events.filter((event) => event.ownMessage).length !== 1) fail('Own X DMs were turned into inbound actions.');

const isolated = await syncSocialInboxIsolated({}, {}, {
  syncXInboundMentions: async () => ({ status: 'success', events: [{ id: 'm1' }] }),
  syncXDirectMessages: async () => { throw new Error('X API returned 503'); },
  syncInstagramComments: async () => ({ status: 'success', events: [{ id: 'c1' }] }),
  syncInstagramDirectMessages: async () => ({ status: 'success', events: [{ id: 'd1' }] }),
});
if (isolated.xMentions.status !== 'success' || isolated.instagramComments.status !== 'success' || isolated.instagramDm.status !== 'success') {
  fail('Unified sync dropped successful sources after a sibling failure.');
}
if (isolated.xDm.status !== 'error' || !String(isolated.xDm.reason).includes('503')) fail('X DM 503 was not isolated as an error source.');

function evidenceDb() {
  const events = new Map();
  const actions = new Map();
  return {
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      return {
        bind(...params) {
          return {
            async first() {
              if (normalized.includes('FROM social_events')) {
                return events.get(`${params[0]}::${params[1]}::${params[2]}::${params[3]}`) || null;
              }
              return null;
            },
            async run() {
              if (normalized.startsWith('INSERT INTO social_events')) {
                const key = `${params[1]}::${params[2]}::${params[3]}::${params[4]}`;
                const prev = events.get(key);
                let payload = params[6];
                if (prev && normalized.includes('payload_json')) payload = params[6];
                events.set(key, {
                  id: params[0], user_id: params[1], platform: params[2], event_type: params[3],
                  external_event_id: params[4], external_user_id: params[5], payload_json: payload,
                  occurred_at: params[7], received_at: params[8],
                });
                return { meta: { changes: 1 } };
              }
              if (normalized.startsWith('INSERT INTO social_actions')) {
                const existing = actions.get(params[0]);
                const conversationId = params[9] || existing?.conversation_id || null;
                actions.set(params[0], {
                  id: params[0],
                  conversation_id: conversationId,
                  execution_mode: params[9] ? params[6] : (existing?.execution_mode || params[6]),
                  source: params[7],
                  external_event_id: params[8],
                });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    _events: events,
    _actions: actions,
  };
}

const db = evidenceDb();
const webhookDm = {
  id: 'ig-dm-m1',
  platform: 'instagram',
  type: 'dm',
  externalEventId: 'm1',
  externalUserId: 'igsid-9',
  conversationUnresolved: true,
  text: 'hello',
  occurredAt: '2026-08-30T12:00:00.000Z',
  receivedAt: '2026-08-30T12:00:01.000Z',
  ownMessage: false,
};
await persistInstagramDmEvidence(db, 'local-user', [webhookDm], 'handoff');
await persistInstagramDmEvidence(db, 'local-user', [{ ...webhookDm, conversationId: '888', conversationUnresolved: false, username: 'alice' }], 'in_app');
if (db._events.size !== 1) fail('Webhook then poll created duplicate Instagram DM events.');
if (db._actions.size !== 1) fail('Webhook then poll created duplicate Instagram DM actions.');
const dmAction = [...db._actions.values()][0];
if (dmAction.id !== instagramDmActionId('m1') || dmAction.conversation_id !== '888') {
  fail('Polling did not converge webhook DM onto the canonical conversation.');
}
await persistInstagramDmEvidence(db, 'local-user', [webhookDm], 'handoff');
if ([...db._actions.values()][0].conversation_id !== '888') fail('Later unresolved webhook wiped the canonical conversation ID.');

const commentDb = evidenceDb();
await persistInstagramCommentEvidence(commentDb, 'local-user', [{
  id: 'u1', username: 'alice', lastCommentText: 'nice', lastCommentAt: '2026-08-30T12:00:00.000Z',
  latestCommentId: 'c99', mediaId: 'm88', latestMediaPermalink: null,
}], '2026-08-30T12:00:01.000Z', 'in_app');
await persistInstagramCommentEvidence(commentDb, 'local-user', [{
  id: 'u1', username: 'alice', lastCommentText: 'nice', lastCommentAt: '2026-08-30T12:00:00.000Z',
  latestCommentId: 'c99', mediaId: 'm88', latestMediaPermalink: null,
}], '2026-08-30T12:05:00.000Z', 'in_app');
if (commentDb._events.size !== 1 || commentDb._actions.size !== 1) fail('Comment webhook/poll created duplicates.');
if ([...commentDb._actions.keys()][0] !== instagramCommentActionId('c99')) fail('Comment action ID was not stable.');
if (instagramCommentEventId('c99') !== 'ig-comment-c99' || instagramDmEventRowId('m1') !== 'ig-dm-m1') {
  fail('Provider event IDs drifted from the canonical identity.');
}

const mediaUrl = instagramRecentMediaUrl('v24.0', '1');
if (!mediaUrl.includes('/1/media?') || mediaUrl.includes('after=')) fail('Comment polling skipped recent media via an after cursor.');
const commentsUrl = instagramMediaCommentsUrl('v24.0', '99', 'cur');
if (commentsUrl.method !== 'GET' || !commentsUrl.path.endsWith('/99/comments') || commentsUrl.query.after !== 'cur') {
  fail('Instagram comment paging is not using the official comments edge.');
}
const convoUrl = instagramConversationListUrl('v24.0', '1');
if (!convoUrl.url.includes('/1/conversations') || !convoUrl.url.includes('participants')) fail('Instagram conversation list dropped participant metadata.');
const msgUrl = instagramConversationMessagesUrl('v24.0', '888', 'c2');
if (msgUrl.path !== '/888/messages' || !msgUrl.url.includes('after=c2')) fail('Instagram DM messages did not use the official messages edge.');

console.log('Manual-only closure tests OK: cumulative like.read, official follow lookup, exact text fingerprint, DM expansions, webhook DM/comment evidence, user budget ceiling, pagination checkpoints, isolated sync, webhook/poll convergence.');
