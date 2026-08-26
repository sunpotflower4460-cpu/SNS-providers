import { readFile } from 'node:fs/promises';

const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const daily = await readFile(new URL('../src/daily.ts', import.meta.url), 'utf8');
const xAccount = await readFile(new URL('../src/xAccount.ts', import.meta.url), 'utf8');
const xOwnedStore = await readFile(new URL('../src/xOwnedStore.ts', import.meta.url), 'utf8');
const instagramOwnedStore = await readFile(new URL('../src/instagramOwnedStore.ts', import.meta.url), 'utf8');

const requiredRestoreGuards = [
  'const knownIdentities = new Set(group.map(stableCandidateIdentity).filter(Boolean));',
  'if (knownIdentities.size > 1) {',
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

console.log('Restore identity invariants OK: immutable-ID conflicts preserve CRM history, stay out of X follow evidence/Today actions, and resolve deterministically from official X/Instagram identity data.');
