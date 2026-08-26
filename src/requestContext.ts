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

export function selfRequestKey(profileText: string, recentPostsText: string) {
  return JSON.stringify([
    profileText.trim().slice(0, 10_000),
    recentPostsText.trim().slice(0, 20_000),
  ]);
}
