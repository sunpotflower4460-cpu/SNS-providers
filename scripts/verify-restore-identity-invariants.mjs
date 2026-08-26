import { readFile } from 'node:fs/promises';

const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const backupControls = await readFile(new URL('../src/BackupControls.tsx', import.meta.url), 'utf8');
const daily = await readFile(new URL('../src/daily.ts', import.meta.url), 'utf8');
const instagramOwnedStore = await readFile(new URL('../src/instagramOwnedStore.ts', import.meta.url), 'utf8');
const restoreSafety = await readFile(new URL('../src/restoreSafety.ts', import.meta.url), 'utf8');
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8');
const syncControls = await readFile(new URL('../src/SyncControls.tsx', import.meta.url), 'utf8');
const xAccount = await readFile(new URL('../src/xAccount.ts', import.meta.url), 'utf8');
const xOwnedStore = await readFile(new URL('../src/xOwnedStore.ts', import.meta.url), 'utf8');

const requiredRestoreGuards = [
  'const stableMembership = group.map(stableCandidateIdentity);',
  'const knownIdentities = new Set(stableMembership.filter(Boolean));',
  'const hasUnboundIdentity = stableMembership.some((identity) => !identity);',
  'if (knownIdentities.size > 1 || (knownIdentities.size === 1 && hasUnboundIdentity)) {',
  'finalCandidates.push(...group.map(quarantineRestoredHandleConflict));',
  "recommendedAction: 'review'",
  'engagementUrl: undefined',
  'draft: undefined',
  'followBack: null',
  "'identity-conflict'",
  '.filter((interaction) => !deduped.invalidInteractionCandidateIds.has(interaction.candidateId))',
  'resolveCandidateAlias(interaction.candidateId, deduped.aliases)',
];

for (const fragment of requiredRestoreGuards) {
  if (!backup.includes(fragment)) {
    throw new Error(`Restore identity fail-closed guard is missing: ${fragment}`);
  }
}

if (!daily.includes("relationshipItems.filter((item) => item.action === 'like')")
  || daily.includes("relationshipItems.filter((item) => item.action === 'review')")) {
  throw new Error('Review-only identity conflicts can leak back into the actionable Today queue.');
}

if (!store.includes("if (candidate.tags.includes('identity-conflict')) {")
  || !store.includes("recommendedAction: 'review'")
  || !store.includes('engagementUrl: undefined')
  || !store.includes('followBack: null')) {
  throw new Error('Local ranking/manual relationship normalization can revive a quarantined identity conflict.');
}

if (!store.includes('const hasHistoricalIdentity = Boolean(')
  || !store.includes("[...new Set([...candidate.tags, 'identity-conflict'])]")
  || !store.includes('ハンドルだけでは過去と同じ人物だと確認できません')) {
  throw new Error('Manual re-add can again trust a mutable handle and reactivate old CRM history as the current person.');
}

if (!xAccount.includes("!candidate.tags.includes('identity-conflict')")) {
  throw new Error('Ambiguous restored X handles can re-enter follow-evidence tracking.');
}

const requiredOwnedSyncGuards = [
  'const identityResetState = resetOwnedXIdentityChanges(stableIdentityState, result, identityChangedIds);',
  'const identitySafeState = reconcileOwnedXStableIdentities(identityResetState, result);',
  'const byUsername = new Map<string, Candidate[]>();',
  'for (const conflicting of usernameExisting) {',
  "if (candidate.tags.includes('identity-conflict')) return candidate;",
  "const identityConflictResolved = stableExisting.tags.includes('identity-conflict');",
  "tags: stableExisting.tags.filter((tag) => tag !== 'identity-conflict')",
];
for (const fragment of requiredOwnedSyncGuards) {
  if (!xOwnedStore.includes(fragment)) {
    throw new Error(`Official X identity reconciliation can revive or retain a recycled-handle conflict: ${fragment}`);
  }
}

const requiredInstagramGuards = [
  'const byUsername = new Map<string, Candidate[]>();',
  'const knownUsernameIdentities = new Set(usernameGroup.map((candidate) => stableInstagramId(candidate.platformUserId)).filter(Boolean));',
  'for (const conflicting of usernameGroup) {',
  'else if (incomingStableId && knownUsernameIdentities.size > 1) {',
  "const identityConflictResolved = Boolean(stableExisting && existing.tags.includes('identity-conflict'));",
  "existing.tags.filter((tag) => tag !== 'identity-conflict')",
  'conflictingRemovedIds.add(conflicting.id);',
  'byUsername.set(username, [candidate]);',
];
for (const fragment of requiredInstagramGuards) {
  if (!instagramOwnedStore.includes(fragment)) {
    throw new Error(`Instagram identity reconciliation can reuse a recycled handle or revive stale reply routing: ${fragment}`);
  }
}

if (!restoreSafety.includes('export function detachExternalAccountSummaries')
  || !restoreSafety.includes('xAccount: {}')
  || !restoreSafety.includes('instagramAccount: undefined')) {
  throw new Error('External restore can retain SNS account summaries derived from an older connected identity.');
}
if (!backupControls.includes('detachExternalAccountSummaries(await readBackup(file))')) {
  throw new Error('JSON backup restore can reapply stale X/Instagram account summary identity.');
}
if (!syncControls.includes('detachExternalAccountSummaries(normalizeAppState(result.state))')) {
  throw new Error('D1 restore can reapply stale X/Instagram account summary identity.');
}

console.log('Restore identity invariants OK: conflicting or partially unbound same-handle records preserve CRM history without merging, stay review-only across local actions and follow evidence, resolve only from official X/Instagram identity data, and external restores discard stale SNS account summaries.');