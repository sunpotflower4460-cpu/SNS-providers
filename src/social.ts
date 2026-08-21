import type { Candidate } from './types';

export function openCandidate(candidate: Candidate) {
  const engagementUrl = safeEngagementUrl(candidate.platform, candidate.engagementUrl);
  if (candidate.recommendedAction === 'reply' && engagementUrl) {
    window.open(engagementUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  const profileUrl = canonicalProfileUrl(candidate.platform, candidate.username);
  if (!profileUrl) return;

  // Keep final follow/like/reply/DM/unfollow decisions on the official profile or
  // conversation surface. Stored profile URLs are never trusted directly.
  window.open(profileUrl, '_blank', 'noopener,noreferrer');
}

export async function copyDraft(text: string) {
  await navigator.clipboard.writeText(text);
}

export function platformLabel(platform: Candidate['platform']) {
  return platform === 'x' ? 'X' : 'Instagram';
}

function canonicalProfileUrl(platform: Candidate['platform'], rawUsername: string) {
  const username = rawUsername.trim().replace(/^@/, '');
  if (platform === 'x') {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return '';
    return `https://x.com/${username}`;
  }
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return '';
  return `https://www.instagram.com/${username}/`;
}

function safeEngagementUrl(platform: Candidate['platform'], value?: string) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const allowed = platform === 'x' ? new Set(['x.com', 'twitter.com']) : new Set(['instagram.com']);
    return allowed.has(host) ? url.toString() : '';
  } catch {
    return '';
  }
}
