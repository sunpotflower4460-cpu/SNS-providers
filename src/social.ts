import type { Candidate } from './types';

export function openCandidate(candidate: Candidate) {
  if (candidate.platform === 'x' && candidate.recommendedAction === 'follow') {
    const intent = new URL('https://twitter.com/intent/follow');
    intent.searchParams.set('screen_name', candidate.username);
    window.open(intent.toString(), '_blank', 'noopener,noreferrer');
    return;
  }

  if (candidate.recommendedAction === 'reply' && candidate.engagementUrl) {
    window.open(candidate.engagementUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  // A reply without a concrete post/conversation URL must not silently become a
  // new unrelated X post. Open the profile so the user can choose the real
  // conversation context in the official social surface.
  window.open(candidate.profileUrl, '_blank', 'noopener,noreferrer');
}

export async function copyDraft(text: string) {
  await navigator.clipboard.writeText(text);
}

export function platformLabel(platform: Candidate['platform']) {
  return platform === 'x' ? 'X' : 'Instagram';
}
