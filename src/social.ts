import type { Candidate } from './types';

export function openCandidate(candidate: Candidate) {
  if (candidate.recommendedAction === 'reply' && candidate.engagementUrl) {
    window.open(candidate.engagementUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  // Keep final follow/like/reply/DM/unfollow decisions on the official profile or
  // conversation surface. A reply without a concrete post URL must not silently
  // become a new unrelated X post.
  window.open(candidate.profileUrl, '_blank', 'noopener,noreferrer');
}

export async function copyDraft(text: string) {
  await navigator.clipboard.writeText(text);
}

export function platformLabel(platform: Candidate['platform']) {
  return platform === 'x' ? 'X' : 'Instagram';
}
