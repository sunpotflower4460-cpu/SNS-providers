import { fetchWithTimeout } from './fetchWithTimeout';

export interface DiscoveryEnv {
  TAVILY_API_KEY?: string;
  TAVILY_BILLING_MODE?: 'free' | 'paid';
}

export interface DiscoveredProfile {
  platform: 'x' | 'instagram';
  username: string;
  profileUrl: string;
  title: string;
  snippet: string;
  sourceUrl: string;
  score: number;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
  usage?: { credits?: number };
}

const instagramReserved = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer']);
const xReserved = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings', 'compose', 'intent']);

export async function discoverSocialProfiles(mission: string, env: DiscoveryEnv, maxPerPlatform = 12) {
  if (!env.TAVILY_API_KEY) {
    return { enabled: false, provider: 'tavily', costUsd: 0, credits: 0, profiles: [], reason: 'TAVILY_API_KEY is not configured.' };
  }
  if (env.TAVILY_BILLING_MODE !== 'free') {
    return { enabled: false, provider: 'tavily', costUsd: 0, credits: 0, profiles: [], reason: 'Only Tavily free-mode discovery is enabled in the initial $0-$3 build.' };
  }

  const missionQuery = compactMission(mission);
  const searches = [
    { platform: 'x' as const, domain: 'x.com', query: `${missionQuery} creator artist listener community profile` },
    { platform: 'instagram' as const, domain: 'instagram.com', query: `${missionQuery} creator artist listener community profile` },
  ];

  const settled = await Promise.allSettled(searches.map(async (search) => {
    const response = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.TAVILY_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: search.query,
        search_depth: 'basic',
        max_results: Math.max(1, Math.min(20, maxPerPlatform)),
        topic: 'general',
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        include_domains: [search.domain],
        auto_parameters: false,
        safe_search: true,
        include_usage: true,
      }),
    }, 45_000, 'Tavily search');
    if (!response.ok) throw new Error(`Tavily returned ${response.status}`);
    const data = await response.json<TavilyResponse>();
    return { platform: search.platform, data };
  }));

  let credits = 0;
  const profiles: DiscoveredProfile[] = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    credits += Number(result.value.data.usage?.credits || 0);
    for (const item of result.value.data.results || []) {
      const parsed = parseSocialProfile(item.url || '', result.value.platform);
      if (!parsed) continue;
      profiles.push({
        ...parsed,
        title: cleanText(item.title || parsed.username, 160),
        snippet: cleanText(item.content || '', 500),
        sourceUrl: item.url || parsed.profileUrl,
        score: clamp(Number(item.score || 0), 0, 1),
      });
    }
  }

  const deduped = dedupeProfiles(profiles).sort((a, b) => b.score - a.score);
  return {
    enabled: true,
    provider: 'tavily',
    costUsd: 0,
    credits,
    profiles: deduped,
    reason: deduped.length ? undefined : 'Search completed but no profile-shaped results were found.',
  };
}

function parseSocialProfile(rawUrl: string, expectedPlatform: 'x' | 'instagram') {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    const first = parts[0] || '';
    if (!first) return null;

    if (expectedPlatform === 'x' && (host === 'x.com' || host === 'twitter.com')) {
      const username = first.replace(/^@/, '');
      if (!/^[A-Za-z0-9_]{1,15}$/.test(username) || xReserved.has(username.toLowerCase())) return null;
      return { platform: 'x' as const, username, profileUrl: `https://x.com/${username}` };
    }

    if (expectedPlatform === 'instagram' && host === 'instagram.com') {
      const username = first.replace(/^@/, '');
      if (!/^[A-Za-z0-9._]{1,30}$/.test(username) || instagramReserved.has(username.toLowerCase())) return null;
      return { platform: 'instagram' as const, username, profileUrl: `https://www.instagram.com/${username}/` };
    }
  } catch {
    return null;
  }
  return null;
}

function dedupeProfiles(profiles: DiscoveredProfile[]) {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    const key = `${profile.platform}:${profile.username.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactMission(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 600);
}

function cleanText(value: string, max: number) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
