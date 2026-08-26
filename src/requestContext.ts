import type { Candidate, Mission } from './types';

export function missionRequestKey(mission: Mission) {
  return JSON.stringify([
    mission.primaryGoal,
    mission.text,
    mission.secondaryGoals,
    mission.communicationDNA,
  ]);
}

export function candidateRequestKey(candidate: Candidate) {
  return JSON.stringify([
    candidate.id,
    candidate.platform,
    // A social handle is mutable and can be recycled. Bind every async candidate result to
    // the immutable official platform ID when known so a response created for person A can
    // never be accepted after the same logical candidate/handle has become person B.
    candidate.platformUserId || null,
    candidate.username,
    candidate.bio.slice(0, 1200),
    candidate.tags.slice(0, 20),
    candidate.kind,
    candidate.match,
    candidate.publicMetrics || null,
    candidate.stage,
    candidate.relationshipScore,
    candidate.reason.slice(0, 800),
    candidate.strategy?.slice(0, 1000) || null,
    candidate.engagementUrl || null,
    candidate.followedAt || null,
    candidate.followBack ?? null,
    candidate.lastInteractionAt || null,
    candidate.profileSyncedAt || null,
  ]);
}

// Paid X profile enrichment is narrower than AI ranking. Relationship progress may change
// while the network request is in flight without making the returned official profile stale,
// so bind only the local record identity and profile fields that the enrichment can replace.
// This still catches the important same-ID race: another owned-X sync can refresh bio/metrics
// before an older enrichment response arrives, and that older response must not roll them back.
export function xProfileRequestKey(candidate: Candidate) {
  return JSON.stringify([
    candidate.id,
    candidate.platform,
    candidate.platformUserId || null,
    candidate.username.toLowerCase(),
    candidate.displayName,
    candidate.bio,
    candidate.verified ?? null,
    candidate.publicMetrics || null,
    candidate.profileSyncedAt || null,
    candidate.profileSyncAttemptedAt || null,
  ]);
}

export function selfRequestKey(profileText: string, recentPostsText: string) {
  return JSON.stringify([
    profileText.trim().slice(0, 10_000),
    recentPostsText.trim().slice(0, 20_000),
  ]);
}