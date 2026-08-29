import { queueAction } from './localAction';
import type { Candidate, Platform } from './types';

const xReservedPaths = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings', 'compose', 'intent']);
const instagramReservedPaths = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer']);

export function openCandidate(candidate: Candidate) {
  // Copy must start in the same user-gesture turn as window.open. Awaiting clipboard
  // before open can lose the popup/gesture on iOS/Android PWAs.
  const draft = candidate.draft?.trim();
  if (draft) void copyDraftText(draft);

  const engagementUrl = safeEngagementUrl(candidate.platform, candidate.engagementUrl);
  const action = queueAction(candidate);
  if ((action === 'reply' || action === 'like') && engagementUrl) {
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
  const button = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
  const originalLabel = button?.textContent || 'コピー';
  try {
    await copyDraftText(text);
    showCopyFeedback(button, originalLabel, 'コピーしました', 'success');
  } catch {
    showCopyFeedback(button, originalLabel, 'コピーできませんでした', 'error');
  }
}

async function copyDraftText(text: string) {
  await navigator.clipboard.writeText(text);
}

function showCopyFeedback(button: HTMLButtonElement | null, originalLabel: string, message: string, state: 'success' | 'error') {
  if (!button || !button.isConnected) return;
  const generation = String(Date.now());
  button.dataset.copyGeneration = generation;
  button.dataset.copyState = state;
  button.textContent = message;
  button.setAttribute('aria-live', 'polite');
  window.setTimeout(() => {
    if (!button.isConnected || button.dataset.copyGeneration !== generation) return;
    button.textContent = originalLabel;
    delete button.dataset.copyGeneration;
    delete button.dataset.copyState;
    button.removeAttribute('aria-live');
  }, 1_800);
}

export function platformLabel(platform: Candidate['platform']) {
  return platform === 'x' ? 'X' : 'Instagram';
}

export function safeEngagementUrl(platform: Candidate['platform'], value?: string) {
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

export function canonicalXStatusUrl(username: string, postId: string) {
  const handle = username.trim().replace(/^@/, '');
  if (xReservedPaths.has(handle.toLowerCase()) || !/^[A-Za-z0-9_]{1,15}$/.test(handle) || !/^\d{1,30}$/.test(postId)) return '';
  return `https://x.com/${handle}/status/${postId}`;
}

export function engagementSurfaceLabel(platform: Platform, engagementUrl?: string) {
  const url = safeEngagementUrl(platform, engagementUrl);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (platform === 'x') {
      return `@${parts[0]} の投稿`;
    }
    const kind = (parts[0] || 'p').toLowerCase();
    const kindLabel = kind === 'reel' || kind === 'reels' ? 'リール' : kind === 'tv' ? '動画' : '投稿';
    return `Instagramの${kindLabel}`;
  } catch {
    return platform === 'x' ? 'Xの投稿' : 'Instagramの投稿';
  }
}

export function daysSinceTimestamp(value: string | undefined, now = Date.now()) {
  if (!value) return null;
  const at = new Date(value).getTime();
  if (!Number.isFinite(at) || at > now + 5 * 60 * 1000) return null;
  return Math.max(0, Math.floor((now - at) / 86_400_000));
}

export function staleConversationCue(days: number | null) {
  if (days == null) return '';
  if (days <= 0) return 'この人とは今日接点あり';
  return `この人とは${days}日空いている`;
}

function canonicalProfileUrl(platform: Candidate['platform'], rawUsername: string) {
  const username = rawUsername.trim().replace(/^@/, '');
  const lowered = username.toLowerCase();
  if (platform === 'x') {
    if (xReservedPaths.has(lowered) || !/^[A-Za-z0-9_]{1,15}$/.test(username)) return '';
    return `https://x.com/${username}`;
  }
  if (instagramReservedPaths.has(lowered) || !/^[A-Za-z0-9._]{1,30}$/.test(username)) return '';
  return `https://www.instagram.com/${username}/`;
}
