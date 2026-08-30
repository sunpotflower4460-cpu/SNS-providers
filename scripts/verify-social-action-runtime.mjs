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
await emit('missionInbox.js', new URL('../src/missionInbox.ts', import.meta.url));
await emit('capabilities.js', new URL('../worker/src/social/capabilities.ts', import.meta.url));
await emit('executeGuard.js', new URL('../worker/src/social/executeGuard.ts', import.meta.url));
await emit('execute.js', new URL('../worker/src/social/execute.ts', import.meta.url));
await emit('inbound.js', new URL('../worker/src/social/instagram/inbound.ts', import.meta.url));
await emit('xInbound.js', new URL('../worker/src/social/x/inbound.ts', import.meta.url));
await emit('backup.js', new URL('../src/backup.ts', import.meta.url));

const {
  completeSocialAction,
  dismissSocialAction,
  failSocialAction,
  normalizeSocialAction,
  normalizeSocialActions,
  remapSocialActionCandidateIds,
  scoreSocialAction,
  snoozeSocialAction,
  upsertSocialActions,
} = await import(pathToFileURL(`${outDir}/socialAction.js`).href);
const { buildMissionInbox } = await import(pathToFileURL(`${outDir}/missionInbox.js`).href);
const { executionBindingsConflict } = await import(pathToFileURL(`${outDir}/execute.js`).href);
const { normalizeAppState, validateAppState } = await import(pathToFileURL(`${outDir}/backup.js`).href);
const { assertExecutable, assertSingleActionExecute } = await import(pathToFileURL(`${outDir}/executeGuard.js`).href);
const { INSTAGRAM_PROFESSIONAL_CAPABILITIES, xCapabilitiesFromScopes } = await import(pathToFileURL(`${outDir}/capabilities.js`).href);
const { instagramCommentEvent, sameLatestCommentEvent } = await import(pathToFileURL(`${outDir}/inbound.js`).href);
const { normalizeXInboundEvents } = await import(pathToFileURL(`${outDir}/xInbound.js`).href);

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

const executeBody = {
  executionId: 'exec-abc-1',
  draft: 'ありがとう',
  action: {
    id: 'sa-1',
    platform: 'instagram',
    candidateId: 'ig-1',
    type: 'comment_reply',
    status: 'ready',
    executionMode: 'in_app',
    source: 'instagram_comment',
    externalEventId: '111',
    parentContentId: 'media-1',
  },
  candidate: { id: 'ig-1', platform: 'instagram', username: 'alice', tags: [] },
};
const parsed = assertSingleActionExecute(executeBody);
if ('ok' in parsed && parsed.ok === false) fail(parsed.reason);
const blockedCompleted = assertExecutable({ ...parsed, action: { ...parsed.action, status: 'completed' } }, INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedCompleted.ok || blockedCompleted.code !== 'COMPLETED') fail('Completed action was executable.');
const blockedExpired = assertExecutable({ ...parsed, action: { ...parsed.action, status: 'expired' } }, INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedExpired.ok || blockedExpired.code !== 'EXPIRED') fail('Expired action was executable.');
const blockedSnoozed = assertExecutable({ ...parsed, action: { ...parsed.action, status: 'snoozed' } }, INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedSnoozed.ok || blockedSnoozed.code !== 'INVALID_ACTION') fail('Snoozed action was executable.');
const blockedExecuting = assertExecutable({ ...parsed, action: { ...parsed.action, status: 'executing' } }, INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedExecuting.ok || blockedExecuting.code !== 'ALREADY_EXECUTED') fail('Executing action was executable.');
const garbageStatus = assertSingleActionExecute({
  ...executeBody,
  action: { ...executeBody.action, status: 'not-a-status' },
});
if (!('ok' in garbageStatus) || garbageStatus.ok !== false) fail('Unknown action status was accepted.');
const blockedHandoff = assertExecutable({ ...parsed, action: { ...parsed.action, executionMode: 'handoff' } }, INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedHandoff.ok || blockedHandoff.code !== 'HANDOFF_NOT_EXECUTABLE') fail('HANDOFF action called provider write.');
const blockedIdentity = assertExecutable(parsed, INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
const identityParsed = assertSingleActionExecute({
  ...executeBody,
  candidate: { id: 'ig-1', platform: 'instagram', username: 'alice', tags: ['identity-conflict'] },
});
const blockedConflict = assertExecutable(identityParsed, INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: true });
if (blockedConflict.ok || blockedConflict.code !== 'IDENTITY_CONFLICT') fail('Identity conflict did not block execution.');
const wrongCandidate = assertSingleActionExecute({
  ...executeBody,
  candidate: { id: 'other', platform: 'instagram', username: 'alice', tags: [] },
});
if (!('ok' in wrongCandidate) || wrongCandidate.ok !== false || wrongCandidate.code !== 'BINDING_MISMATCH') {
  fail('Wrong candidate binding was accepted.');
}
const disabled = assertExecutable(parsed, INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: false, writeCostKnown: true });
if (disabled.ok || disabled.code !== 'WRITE_DISABLED') fail('Writes were not fail-closed when disabled.');
const unknownCost = assertExecutable(parsed, INSTAGRAM_PROFESSIONAL_CAPABILITIES, { writesEnabled: true, writeCostKnown: false });
if (unknownCost.ok || unknownCost.code !== 'WRITE_COST_UNKNOWN') fail('Unknown write cost was not fail-closed.');
const xReadOnly = xCapabilitiesFromScopes(['tweet.read', 'users.read', 'follows.read', 'offline.access']);
if (xReadOnly.sendReply || xReadOnly.follow || xReadOnly.sendDm) fail('Read-only X scopes silently enabled writes.');
const bulk = assertSingleActionExecute({ executionId: 'exec-abc-1', actions: [executeBody.action], candidate: executeBody.candidate });
if (!('ok' in bulk) || bulk.ok !== false) fail('Bulk execute body was accepted.');

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

if (!executionBindingsConflict(
  { actionId: 'sa-1', platform: 'instagram', operation: 'instagram_comment_reply' },
  { ...parsed, action: { ...parsed.action, id: 'sa-other' } },
)) fail('Reused executionId across different actions was treated as idempotent success.');
if (executionBindingsConflict(
  { actionId: 'sa-1', platform: 'instagram', operation: 'instagram_comment_reply' },
  parsed,
)) fail('Matching execution recovery was treated as a binding mismatch.');

console.log('SocialAction runtime invariants OK: restore defaults, malformed rejection, dedupe, reopen, snooze, complete-once, ranking math, execute guards, Instagram same-event binding, X inbound normalization, identity remap, history cap, fallback suppression, execution binding.');
