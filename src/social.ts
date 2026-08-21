import type { Candidate } from './types';

export function openCandidate(candidate: Candidate) {
  if (candidate.platform === 'x' && candidate.recommendedAction === 'follow') {
    const intent = new URL('https://twitter.com/intent/follow');
    intent.searchParams.set('screen_name', candidate.username);
    window.open(intent.toString(), '_blank', 'noopener,noreferrer');
    return;
  }

  if (candidate.platform === 'x' && candidate.recommendedAction === 'reply' && candidate.draft) {
    const intent = new URL('https://twitter.com/intent/tweet');
    intent.searchParams.set('text', candidate.draft);
    window.open(intent.toString(), '_blank', 'noopener,noreferrer');
    return;
  }

  window.open(candidate.profileUrl, '_blank', 'noopener,noreferrer');
}

export async function copyDraft(text: string) {
  await navigator.clipboard.writeText(text);
}

export function platformLabel(platform: Candidate['platform']) {
  return platform === 'x' ? 'X' : 'Instagram';
}
