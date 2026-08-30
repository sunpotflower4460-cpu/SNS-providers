#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = '/tmp/sns-providers-provider-contracts';
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

await emit('fetchWithTimeout.js', new URL('../worker/src/fetchWithTimeout.ts', import.meta.url));
await emit('social/httpStatus.js', new URL('../worker/src/social/httpStatus.ts', import.meta.url));
await emit('social/ids.js', new URL('../worker/src/social/ids.ts', import.meta.url));
await emit('social/x/follow.js', new URL('../worker/src/social/x/follow.ts', import.meta.url));
await emit('social/x/like.js', new URL('../worker/src/social/x/like.ts', import.meta.url));
await emit('social/x/dm.js', new URL('../worker/src/social/x/dm.ts', import.meta.url));
await emit('social/instagram/dm.js', new URL('../worker/src/social/instagram/dm.ts', import.meta.url));

const { classifyProviderHttpStatus } = await import(pathToFileURL(`${outDir}/social/httpStatus.js`).href);
const { followXUser, unfollowXUser } = await import(pathToFileURL(`${outDir}/social/x/follow.js`).href);
const { likeXTweet, extractXTweetId } = await import(pathToFileURL(`${outDir}/social/x/like.js`).href);
const { sendXDm, normalizeXDmEvents } = await import(pathToFileURL(`${outDir}/social/x/dm.js`).href);
const { sendInstagramDm, instagramMessagingWindowOpen, normalizeInstagramDmMessages } = await import(pathToFileURL(`${outDir}/social/instagram/dm.js`).href);

function fail(message) {
  throw new Error(message);
}

if (classifyProviderHttpStatus(201) !== 'success') fail('2xx was not success.');
if (classifyProviderHttpStatus(400) !== 'failure') fail('400 was not confirmed failure.');
if (classifyProviderHttpStatus(401) !== 'failure' || classifyProviderHttpStatus(403) !== 'failure') fail('401/403 was not confirmed failure.');
if (classifyProviderHttpStatus(429) !== 'unknown') fail('429 was not unknown.');
if (classifyProviderHttpStatus(500) !== 'unknown' || classifyProviderHttpStatus(503) !== 'unknown') fail('5xx was not unknown.');
if (extractXTweetId('https://x.com/alice/status/1234567890123456789') !== '1234567890123456789') fail('Tweet URL extraction failed.');
if (extractXTweetId('not-a-url') !== '') fail('Malformed tweet URL was accepted.');

function jsonResponse(status, body, delay = 0) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return body;
    },
  };
}

const originalFetch = globalThis.fetch;
let fetchImpl = async () => jsonResponse(201, { data: { following: true } });
globalThis.fetch = (...args) => fetchImpl(...args);

try {
  fetchImpl = async () => jsonResponse(201, { data: { following: true, pending_follow: false } });
  const success = await followXUser({ sourceUserId: '1', targetUserId: '2', accessToken: 'tok' });
  if (success.certainty !== 'success' || success.metadata.pendingFollow) fail('Follow success was not following.');

  fetchImpl = async () => jsonResponse(201, { data: { following: false, pending_follow: true } });
  const pending = await followXUser({ sourceUserId: '1', targetUserId: '2', accessToken: 'tok' });
  if (pending.certainty !== 'success' || pending.metadata.relationship !== 'pending_follow') fail('Pending follow was not preserved.');

  fetchImpl = async () => jsonResponse(201, { data: {} });
  const malformed = await followXUser({ sourceUserId: '1', targetUserId: '2', accessToken: 'tok' });
  if (malformed.certainty !== 'unknown') fail('Malformed follow success was treated as confirmed.');

  fetchImpl = async () => jsonResponse(400, { detail: 'bad' });
  const bad = await followXUser({ sourceUserId: '1', targetUserId: '2', accessToken: 'tok' });
  if (bad.certainty !== 'failure') fail('400 follow was not confirmed failure.');

  fetchImpl = async () => jsonResponse(401, {});
  const unauth = await followXUser({ sourceUserId: '1', targetUserId: '2', accessToken: 'tok' });
  if (unauth.certainty !== 'failure') fail('401 follow was not confirmed failure.');

  fetchImpl = async () => jsonResponse(429, {});
  const limited = await followXUser({ sourceUserId: '1', targetUserId: '2', accessToken: 'tok' });
  if (limited.certainty !== 'unknown') fail('429 follow was not unknown.');

  fetchImpl = async () => jsonResponse(503, {});
  const down = await followXUser({ sourceUserId: '1', targetUserId: '2', accessToken: 'tok' });
  if (down.certainty !== 'unknown') fail('5xx follow was not unknown.');

  fetchImpl = async () => { throw new Error('timeout'); };
  const timeout = await followXUser({ sourceUserId: '1', targetUserId: '2', accessToken: 'tok' });
  if (timeout.certainty !== 'unknown') fail('Network timeout was not unknown.');

  fetchImpl = async () => jsonResponse(200, { data: { following: false } });
  const unfollowed = await unfollowXUser({ sourceUserId: '1', targetUserId: '2', accessToken: 'tok' });
  if (unfollowed.certainty !== 'success') fail('Unfollow success was not confirmed.');

  fetchImpl = async () => jsonResponse(201, { data: { liked: true } });
  const liked = await likeXTweet({ sourceUserId: '1', tweetId: '99', accessToken: 'tok' });
  if (liked.certainty !== 'success' || liked.externalResultId !== '99') fail('Like success missing tweet id.');

  fetchImpl = async () => jsonResponse(201, { data: {} });
  const missingLike = await likeXTweet({ sourceUserId: '1', tweetId: '99', accessToken: 'tok' });
  if (missingLike.certainty !== 'unknown') fail('Like without liked=true was confirmed.');

  fetchImpl = async () => jsonResponse(201, { data: { dm_conversation_id: 'c1', dm_event_id: 'e1' } });
  const dm = await sendXDm({ conversationId: 'c1', message: 'hello', accessToken: 'tok' });
  if (dm.certainty !== 'success' || dm.externalResultId !== 'e1') fail('DM success missing dm_event_id.');

  fetchImpl = async () => jsonResponse(201, { data: { dm_conversation_id: 'c1' } });
  const missingDm = await sendXDm({ conversationId: 'c1', message: 'hello', accessToken: 'tok' });
  if (missingDm.certainty !== 'unknown') fail('DM without event id was confirmed.');

  const own = normalizeXDmEvents([
    { id: 'e1', event_type: 'MessageCreate', sender_id: '1', dm_conversation_id: 'c1', text: 'hi', created_at: '2026-08-30T12:00:00.000Z' },
    { id: 'e2', event_type: 'MessageCreate', sender_id: '2', dm_conversation_id: 'c1', text: 'hey', created_at: '2026-08-30T12:01:00.000Z' },
  ], '1', '2026-08-30T12:02:00.000Z');
  if (own.filter((event) => event.ownMessage).length !== 1) fail('Own X DM messages were not marked.');
  if (own.filter((event) => !event.ownMessage).length !== 1) fail('Inbound X DM messages were dropped.');

  const nowIso = new Date().toISOString();
  fetchImpl = async () => jsonResponse(200, { recipient_id: '9', message_id: 'm1' });
  const ig = await sendInstagramDm({
    igUserId: '1',
    recipientId: '9',
    message: 'hello',
    accessToken: 'tok',
    apiVersion: 'v24.0',
    lastInboundAt: nowIso,
  });
  if (ig.certainty !== 'success' || ig.externalResultId !== 'm1') fail('Instagram DM success missing message_id.');

  fetchImpl = async () => jsonResponse(200, { recipient_id: '9' });
  const igMissing = await sendInstagramDm({
    igUserId: '1',
    recipientId: '9',
    message: 'hello',
    accessToken: 'tok',
    apiVersion: 'v24.0',
    lastInboundAt: nowIso,
  });
  if (igMissing.certainty !== 'unknown') fail('Instagram DM without message_id was confirmed.');

  const expired = await sendInstagramDm({
    igUserId: '1',
    recipientId: '9',
    message: 'hello',
    accessToken: 'tok',
    apiVersion: 'v24.0',
    lastInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
  });
  if (expired.certainty !== 'failure' || expired.errorCode !== 'EXPIRED') fail('Expired Instagram messaging window was writable.');
  if (instagramMessagingWindowOpen(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString())) fail('24h window was treated as open.');

  const igEvents = normalizeInstagramDmMessages('111111', [
    { id: 'm-own', from: { id: '1' }, message: 'mine', created_time: nowIso },
    { id: 'm-in', from: { id: '9' }, message: 'hello', created_time: nowIso },
  ], '1', nowIso);
  if (!igEvents.find((event) => event.ownMessage) || !igEvents.find((event) => !event.ownMessage)) fail('Instagram DM own/inbound split failed.');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Provider contract tests OK: success/400/401/403/429/5xx/timeout/malformed/missing IDs, pending follow, DM conversation binding, Instagram 24h window.');
