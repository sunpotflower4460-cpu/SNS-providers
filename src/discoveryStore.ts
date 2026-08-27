import type { DiscoveredProfileResult } from './api';
import { missionRequestKey } from './requestContext';
import type { AppState, Candidate } from './types';
import './discovery.css';

export function mergeDiscoveredProfiles(state: AppState, profiles: DiscoveredProfileResult[]): AppState {
  const currentMissionKey = missionRequestKey(state.mission);
  const existing = new Set(state.candidates.map((candidate) => `${candidate.platform}:${candidate.username.toLowerCase()}`));
  const additions: Candidate[] = [];

  for (const profile of profiles) {
    // Discovery is mission-dependent. If the user changed Mission while the network
    // request was in flight, silently discard the stale suggestions instead of mixing
    // candidates from the previous strategy into the current pool.
    if (profile.requestMissionKey && profile.requestMissionKey !== currentMissionKey) continue;
    const normalizedUsername = profile.username.toLowerCase();
    const key = `${profile.platform}:${normalizedUsername}`;
    if (existing.has(key)) continue;
    existing.add(key);
    const engagementUrl = canonicalEngagementUrl(profile.platform, profile.sourceUrl);
    additions.push({
      // Web discovery is merged once before ranking and again into the latest state after
      // the network result returns. A stable identity keeps the ranking result attached to
      // the same person across both merges instead of generating a second random UUID.
      id: `web-${profile.platform}-${normalizedUsername}`,
      platform: profile.platform,
      username: profile.username,
      displayName: profile.title || profile.username,
      bio: profile.snippet || '',
      profileUrl: profile.profileUrl,
      engagementUrl: engagementUrl || undefined,
      kind: 'other',
      match: Math.max(45, Math.min(70, Math.round(45 + profile.score * 25))),
      relationshipScore: 0,
      stage: 'discovered',
      reason: engagementUrl
        ? '無料Web検索から候補と具体的な投稿接点を発見しました。Missionへの本評価後、投稿単位の交流候補にできます。'
        : '無料Web検索から候補として発見しました。Missionへの本評価はAI再評価または本人確認で行います。',
      strategy: engagementUrl
        ? '具体的な投稿URLを保持しています。AI再評価でMissionとの一致と、いいね・返信のどちらが自然かを判断します。'
        : 'まずプロフィール内容を確認し、関連性が十分なら交流候補として残します。',
      tags: engagementUrl ? ['web-discovered', 'concrete-post'] : ['web-discovered'],
      recommendedAction: 'review',
    });
  }

  return additions.length ? { ...state, candidates: [...additions, ...state.candidates] } : state;
}

function canonicalEngagementUrl(platform: Candidate['platform'], value: string) {
  if (!value || value.length > 2000) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);

    if (platform === 'x') {
      const [username, segment, postId] = parts;
      if ((host !== 'x.com' && host !== 'twitter.com')
        || segment !== 'status'
        || !/^[A-Za-z0-9_]{1,15}$/.test(username || '')
        || !/^\d{1,30}$/.test(postId || '')) return '';
      return `https://x.com/${username}/status/${postId}`;
    }

    const [kind, shortcode] = parts;
    if (host !== 'instagram.com'
      || !['p', 'reel', 'reels', 'tv'].includes((kind || '').toLowerCase())
      || !/^[A-Za-z0-9_-]{1,100}$/.test(shortcode || '')) return '';
    return `https://www.instagram.com/${kind.toLowerCase()}/${shortcode}/`;
  } catch {
    return '';
  }
}
