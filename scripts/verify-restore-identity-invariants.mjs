import { readFile } from 'node:fs/promises';

const backup = await readFile(new URL('../src/backup.ts', import.meta.url), 'utf8');
const daily = await readFile(new URL('../src/daily.ts', import.meta.url), 'utf8');

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

console.log('Restore identity invariants OK: immutable-ID conflicts preserve CRM history but cannot reuse a recycled handle for direct Today actions.');
