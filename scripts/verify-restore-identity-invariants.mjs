import { readFile } from 'node:fs/promises';

const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const daily = await readFile(new URL('../src/daily.ts', import.meta.url), 'utf8');
const xAccount = await readFile(new URL('../src/xAccount.ts', import.meta.url), 'utf8');
const xOwnedStore = await readFile(new URL('../src/xOwnedStore.ts', import.meta.url), 'utf8');

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

const requiredFollowEvidenceGuards = [
  "!candidate.tags.includes('identity-conflict')",
];
for (const fragment of requiredFollowEvidenceGuards) {
  if (!xAccount.includes(fragment)) {
    throw new Error(`Ambiguous restored handles can re-enter follow-evidence tracking: ${fragment}`);
  }
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

console.log('Restore identity invariants OK: immutable-ID conflicts preserve CRM history, stay out of follow evidence/Today actions, and resolve deterministically when official X identity arrives.');
