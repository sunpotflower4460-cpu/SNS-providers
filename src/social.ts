import type { Candidate } from './types';

export function openCandidate(candidate: Candidate) {
  const engagementUrl = safeEngagementUrl(candidate.platform, candidate.engagementUrl);
  if ((candidate.recommendedAction === 'reply' || candidate.recommendedAction === 'like') && engagementUrl) {
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
  if (!value || value.length > 2000) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);

    if (platform === 'x') {
      if (host !== 'x.com' && host !== 'twitter.com') return '';
      const [username, statusSegment, postId] = parts;
      if (parts.length < 3
        || !/^[A-Za-z0-9_]{1,15}$/.test(username || '')
        || statusSegment !== 'status'
        || !/^\d{1,30}$/.test(postId || '')) return '';
      return `https://x.com/${username}/status/${postId}`;
    }

    if (host !== 'instagram.com') return '';
    const [kind, shortcode] = parts;
    if (!['p', 'reel', 'reels', 'tv'].includes((kind || '').toLowerCase())
      || !/^[A-Za-z0-9_-]{1,100}$/.test(shortcode || '')) return '';
    return `https://www.instagram.com/${kind.toLowerCase()}/${shortcode}/`;
  } catch {
    return '';
  }
}
