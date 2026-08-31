import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const outDir = '/tmp/sns-providers-social-action-tests';
await mkdir(outDir, { recursive: true });

async function emit(fileName, sourcePath) {
  const source = await readFile(sourcePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
    },
    fileName: typeof sourcePath === 'string' ? sourcePath : sourcePath.pathname,
  });
  const rewritten = outputText.replace(/from ['"]\.\/([^'"]+)['"]/g, "from './$1.js'");
  await writeFile(`${outDir}/${fileName}`, rewritten);
}

await emit('socialCapabilities.js', new URL('../src/socialCapabilities.ts', import.meta.url));
await emit('socialAction.js', new URL('../src/socialAction.ts', import.meta.url));
await emit('daily.js', new URL('../src/daily.ts', import.meta.url));
await emit('missionInbox.js', new URL('../src/missionInboxModel.ts', import.meta.url));
await emit('capabilities.js', new URL('../worker/src/social/capabilities.ts', import.meta.url));
await emit('executeGuard.js', new URL('../worker/src/social/executeGuard.ts', import.meta.url));
await emit('inbound.js', new URL('../worker/src/social/instagram/inbound.ts', import.meta.url));
await emit('xInbound.js', new URL('../worker/src/social/x/inbound.ts', import.meta.url));
await emit('xInboundStore.js', new URL('../src/xInboundStore.ts', import.meta.url));
await emit('backup.js', new URL('../src/backup.ts', import.meta.url));

const { completeSocialAction,
  dismissSocialAction,
  failSocialAction,
  normalizeSocialAction,
  normalizeSocialActions,
  remapSocialActionCandidateIds,
  scoreSocialAction,
  snoozeSocialAction,
  upsertSocialActions,
  instagramCommentActionId,
} = await import(pathToFileURL(`${outDir}/socialAction.js`).href);
const { buildMissionInbox, fallbackDailyQueue, hasDeferredSocialWork } = await import(pathToFileURL(`${outDir}/missionInbox.js`).href);
const { applyXInboundEvents } = await import(pathToFileURL(`${outDir}/xInboundStore.js`).href);
const { normalizeAppState, validateAppState, clampedEffectiveLimitUsd } = await import(pathToFileURL(`${outDir}/backup.js`).href);
const { INSTAGRAM_PROFESSIONAL_CAPABILITIES, xCapabilitiesFromScopes, DISABLED_SOCIAL_CAPABILITIES } = await import(pathToFileURL(`${outDir}/capabilities.js`).href);
const { instagramCommentEvent, sameLatestCommentEvent } = await import(pathToFileURL(`${outDir}/inbound.js`).href);
const { normalizeXInboundEvents } = await import(pathToFileURL(`${outDir}/xInbound.js`).href);
const { assertExecutable, parseExecuteBody } = await import(pathToFileURL(`${outDir}/executeGuard.js`).href);

function fail(message) {
  throw new Error(message);
}

const now = new Date('2026-08-30T12:00:00.000Z');
let nextId = 0;
const clock = {
  now: () => now,
  id: () => `sa-test-${++nextId}`,
};

const candidate = {
  id: 'ig-1',
  platform: 'instagram',
  username: 'alice',
  displayName: 'Alice',
  bio: '',
  profileUrl: 'https://www.instagram.com/alice/',
  engagementUrl: 'https://www.instagram.com/p/AbCdef12345/',
  kind: 'fan',
  match: 80,
  relationshipScore: 40,
  stage: 'engaged',
  reason: 'commented',
  tags: [],
  recommendedAction: 'reply',
};

const emptyState = {
  mission: { text: 'music', primaryGoal: 'fan', secondaryGoals: [], communicationDNA: 'warm' },
  candidates: [candidate],
  interactions: [],
  socialActions: [],
  budget: { monthlyLimitUsd: 3, hardLimit: true, usedUsd: 0, xUsd: 0, llmUsd: 0, searchUsd: 0, mode: 'balanced' },
  relationshipPolicy: { followBackReviewAfterDays: 30, preserveHighMatch: true },
  insights: [],
  selfProfile: { profileText: '', recentPostsText: '' },
  xAccount: {},
};

const restored = normalizeAppState({
  ...emptyState,
  socialActions: undefined,
});
if (!Array.isArray(restored.socialActions) || restored.socialActions.length !== 0) {
  fail('Old backup without socialActions did not restore to an empty array.');
}
validateAppState(restored);

if (clampedEffectiveLimitUsd(0, 10) !== 0) fail('Restored effective budget was not clamped to the user ceiling.');
{
  const poisoned = normalizeAppState({
    ...emptyState,
    budget: { monthlyLimitUsd: 0, effectiveLimitUsd: 10, hardLimit: true, usedUsd: 0, xUsd: 0, llmUsd: 0, searchUsd: 0, mode: 'balanced' },
  });
  if (poisoned.budget.monthlyLimitUsd !== 0) fail('Restored user ceiling of $0 was rewritten.');
  if (poisoned.budget.effectiveLimitUsd !== 0) fail('Restored effectiveLimitUsd=10 was not clamped to user ceiling $0.');
}

const malformed = normalizeSocialActions([
  { id: 'bad', platform: 'tiktok', candidateId: 'ig-1', type: 'comment_reply', source: 'instagram_comment' },
  { platform: 'instagram', type: 'comment_reply', source: 'instagram_comment' },
  null,
  12,
]);
if (malformed.length !== 0) fail('Malformed SocialActions were accepted.');

const first = upsertSocialActions(emptyState, [{
  platform: 'instagram',
  candidateId: 'ig-1',
  type: 'comment_reply',
  source: 'instagram_comment',
  externalEventId: '111',
  parentContentId: 'media-1',
  targetUrl: 'https://www.instagram.com/p/AbCdef12345/',
  inboundText: '好きです',
  observedAt: now.toISOString(),
  reason: 'new comment',
}], clock);
if (first.socialActions.length !== 1) fail('First inbound comment did not create a SocialAction.');

const duplicate = upsertSocialActions(first, [{
  platform: 'instagram',
  candidateId: 'ig-1',
  type: 'comment_reply',
  source: 'instagram_comment',
  externalEventId: '111',
  inboundText: '好きです！',
  observedAt: now.toISOString(),
  reason: 'same event newer text',
}], clock);
if (duplicate.socialActions.length !== 1) fail('Duplicate external event created another SocialAction.');
if (duplicate.socialActions[0].inboundText !== '好きです！') fail('Duplicate event did not refresh newer contextual text.');

const secondEvent = upsertSocialActions(duplicate, [{
  platform: 'instagram',
  candidateId: 'ig-1',
  type: 'comment_reply',
  source: 'instagram_comment',
  externalEventId: '222',
  inboundText: '新曲も良い',
  observedAt: now.toISOString(),
  reason: 'newer comment',
}], clock);
if (secondEvent.socialActions.length !== 2) fail('A new inbound signal did not create a separate SocialAction.');

const handled = completeSocialAction(secondEvent, secondEvent.socialActions[0].id, {}, clock);
const reopened = upsertSocialActions(handled, [{
  platform: 'instagram',
  candidateId: 'ig-1',
  type: 'comment_reply',
  source: 'instagram_comment',
  externalEventId: '333',
  inboundText: 'また来ました',
  observedAt: now.toISOString(),
  reason: 'reopen',
}], clock);
if (reopened.socialActions.filter((action) => action.status === 'ready' || action.status === 'pending').length < 2) {
  fail('A new inbound signal did not reopen work after a handled action.');
}

const snoozedUntil = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
const snoozed = snoozeSocialAction(first, first.socialActions[0].id, snoozedUntil, clock);
if (snoozed.socialActions[0].status !== 'snoozed') fail('Snooze did not hide the action.');
const returned = normalizeSocialAction({ ...snoozed.socialActions[0], snoozedUntil: new Date(now.getTime() - 1000).toISOString() }, now.getTime());
if (!returned || returned.status !== 'ready') fail('Expired snooze did not return the action.');

const dismissed = dismissSocialAction(first, first.socialActions[0].id, clock);
if (dismissed.socialActions[0].status !== 'dismissed') fail('Dismiss failed.');

const completed = completeSocialAction(first, first.socialActions[0].id, { executionId: 'exec-1' }, clock);
if (completed.socialActions[0].status !== 'completed') fail('Complete failed.');
if (completed.candidates[0].engagementUrl) fail('Completed reply did not consume the matching post target.');
if (completed.candidates[0].recommendedAction !== 'review') fail('Completed reply left the candidate recommending the same post.');
const completedAgain = completeSocialAction(completed, first.socialActions[0].id, { executionId: 'exec-2' }, clock);
if (completedAgain.interactions.length !== completed.interactions.length) fail('Completed action executed twice.');

const score = scoreSocialAction({
  type: 'comment_reply',
  missionRelevance: 80,
  relationshipValue: 40,
  urgency: 90,
  conversationOpportunity: 70,
  authenticityRisk: 10,
});
const expected = Math.max(0, Math.min(100, Math.round(80 * 0.25 + 40 * 0.20 + 90 * 0.30 + 70 * 0.25 + 10 * -0.20 + 25)));
if (score !== expected) fail(`Priority math drifted: ${score} !== ${expected}`);

const parsed = parseExecuteBody({
  executionId: 'exec-abc-1',
  draft: 'ありがとう',
  action: { platform: 'x', candidateId: 'evil', externalEventId: '999' },
  candidate: { id: 'evil', platform: 'x' },
});
if ('ok' in parsed && parsed.ok === false) fail(parsed.reason);
if (parsed.draft !== 'ありがとう' || parsed.executionId !== 'exec-abc-1') fail('Minimal execute parse dropped the durable execution fields.');
const bulk = parseExecuteBody({ executionId: 'exec-abc-1', actions: [{ id: 'a' }] });
if (!('ok' in bulk) || bulk.ok !== false) fail('Bulk execute body was accepted.');
const xReadOnly = xCapabilitiesFromScopes(['tweet.read', 'users.read', 'follows.read', 'offline.access']);
if (xReadOnly.sendReply || xReadOnly.follow || xReadOnly.sendDm) fail('Read-only X scopes silently enabled writes.');
if (DISABLED_SOCIAL_CAPABILITIES.sendCommentReply) fail('Disabled Instagram capabilities enabled comment reply.');

const commentEvent = instagramCommentEvent({
  latestCommentId: '123',
  mediaId: '456',
  lastCommentText: 'hello',
  lastCommentAt: now.toISOString(),
  latestMediaPermalink: 'https://www.instagram.com/p/AbCdef12345/',
  engagerId: '789',
  username: 'alice',
}, now.toISOString());
if (!commentEvent || commentEvent.externalEventId !== '123' || commentEvent.parentContentId !== '456') {
  fail('Instagram comment event was not bound to the same latest comment/media.');
}
if (!sameLatestCommentEvent({
  latestCommentId: '123', mediaId: '456', lastCommentText: 'hello', lastCommentAt: now.toISOString(), latestMediaPermalink: null, engagerId: '789', username: 'alice',
})) fail('Same-event Instagram comment invariant failed.');
if (sameLatestCommentEvent({
  latestCommentId: '123', mediaId: null, lastCommentText: 'hello', lastCommentAt: now.toISOString(), latestMediaPermalink: null, engagerId: '789', username: 'alice',
})) fail('Split Instagram comment/media IDs were treated as the same event.');

const xEvents = normalizeXInboundEvents([
  { id: '999', text: 'hi', author_id: '1', created_at: now.toISOString() },
  { id: '999', text: 'dup', author_id: '1', created_at: now.toISOString() },
], [{ id: '1', username: 'bob' }], now.toISOString());
if (xEvents.length !== 1 || xEvents[0].permalink !== 'https://x.com/bob/status/999') fail('X inbound adapter mixed raw provider data or duplicated events.');

const failed = failSocialAction(first, first.socialActions[0].id, 'provider error', clock);
if (failed.socialActions[0].status !== 'failed') fail('failSocialAction did not record failure.');

const remapped = remapSocialActionCandidateIds(
  first.socialActions,
  new Map([['ig-1', 'ig-survivor']]),
  new Set(['ig-dead']),
);
if (remapped.length !== 1 || remapped[0].candidateId !== 'ig-survivor') fail('Identity merge did not remap SocialActions.');
const droppedOrphans = remapSocialActionCandidateIds(first.socialActions, new Map(), new Set(['ig-1']));
if (droppedOrphans.length !== 0) fail('Identity reset did not drop orphaned SocialActions.');

const completedFirst = completeSocialAction(secondEvent, secondEvent.socialActions[0].id, {}, clock);
const historical = Array.from({ length: 498 }, (_, index) => ({
  ...completedFirst.socialActions[0],
  id: `sa-hist-${index}`,
  externalEventId: `hist-${index}`,
  status: 'completed',
  observedAt: new Date(now.getTime() - (index + 2) * 60_000).toISOString(),
}));
const capped = upsertSocialActions({
  ...completedFirst,
  socialActions: [...historical, ...completedFirst.socialActions],
}, [{
  platform: 'instagram',
  candidateId: 'ig-1',
  type: 'comment_reply',
  source: 'instagram_comment',
  externalEventId: 'brand-new',
  inboundText: 'newest',
  observedAt: now.toISOString(),
  reason: 'cap test',
}], clock);
if (capped.socialActions.length > 500) fail('SocialAction cap exceeded MAX_ACTIONS.');
if (!capped.socialActions.some((action) => action.externalEventId === 'brand-new')) {
  fail('History cap discarded the newest inbound SocialAction.');
}

const snoozedInbox = snoozeSocialAction(first, first.socialActions[0].id, snoozedUntil, clock);
const inboxAfterSnooze = buildMissionInbox(snoozedInbox, now.getTime());
if (inboxAfterSnooze.some((item) => item.kind === 'social')) fail('Snoozed SocialAction stayed in Mission Inbox.');
if (inboxAfterSnooze.some((item) => item.kind === 'queue' && item.queueItem?.action === 'reply' && item.candidate?.id === 'ig-1')) {
  fail('Snoozed comment reappeared as Daily Queue fallback.');
}
if (fallbackDailyQueue(snoozedInbox, now.getTime()).some((item) => item.action === 'reply' && item.candidateId === 'ig-1')) {
  fail('Daily Queue UI fallback still showed the snoozed reply.');
}
if (!hasDeferredSocialWork(snoozedInbox, now.getTime())) fail('Snoozed inbox work was not treated as deferred.');

const laterPost = {
  ...emptyState,
  candidates: [{
    ...candidate,
    recommendedAction: 'reply',
    engagementUrl: 'https://www.instagram.com/p/NewPost12345/',
  }],
  socialActions: [{
    ...first.socialActions[0],
    status: 'completed',
    completedAt: now.toISOString(),
    targetUrl: 'https://www.instagram.com/p/AbCdef12345/',
  }],
};
const inboxLater = buildMissionInbox(laterPost, now.getTime());
if (!inboxLater.some((item) => item.kind === 'queue' && item.queueItem?.action === 'reply' && item.candidate?.id === 'ig-1')) {
  fail('A newer post reply was hidden by a completed comment on a different post.');
}

if (instagramCommentActionId('111') !== 'sa-ig-comment-111') fail('Canonical Instagram comment action ids drifted.');

const inboundState = applyXInboundEvents(emptyState, {
  enabled: true,
  source: 'x',
  costUsd: 0.01,
  syncedAt: now.toISOString(),
  events: [{
    id: 'x-mention-101',
    actionId: 'sa-x-mention-101',
    type: 'mention',
    externalEventId: '101',
    externalUserId: '111',
    username: 'bob',
    text: 'hello',
    occurredAt: now.toISOString(),
    permalink: 'https://x.com/bob/status/101',
  }],
});
if (!inboundState.candidates.some((item) => item.platform === 'x' && item.platformUserId === '111')) {
  fail('X inbound did not bind Candidate to the immutable author id.');
}
const recycled = applyXInboundEvents({
  ...emptyState,
  candidates: [{
    ...candidate,
    platform: 'x',
    id: 'old-bob',
    username: 'bob',
    platformUserId: '999',
    profileUrl: 'https://x.com/bob',
    tags: [],
  }],
}, {
  enabled: true,
  source: 'x',
  costUsd: 0.01,
  syncedAt: now.toISOString(),
  events: [{
    id: 'x-mention-202',
    actionId: 'sa-x-mention-202',
    type: 'reply',
    externalEventId: '202',
    externalUserId: '888',
    username: 'bob',
    text: 'recycled',
    occurredAt: now.toISOString(),
  }],
});
const recycledCandidate = recycled.candidates.find((item) => item.id === 'old-bob');
if (!recycledCandidate?.tags.includes('identity-conflict')) fail('Recycled X username stole or ignored history instead of identity-conflict.');
if (recycled.socialActions.some((action) => action.candidateId === 'old-bob' && action.executionMode === 'in_app')) {
  fail('Identity-conflict X inbound remained directly writable.');
}

console.log('SocialAction runtime invariants OK: restore defaults, malformed rejection, dedupe, reopen, snooze, complete-once, ranking math, execute guards, Instagram same-event binding, X inbound normalization, identity remap, history cap, fallback suppression, later-post reopen, engagement consume, canonical Instagram action ids, X immutable identity.');
