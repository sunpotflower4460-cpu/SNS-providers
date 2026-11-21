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

interface Search {
  platform: 'x' | 'instagram';
  domain: string;
  query: string;
  recent?: boolean;
}

const instagramReserved = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer']);
const xReserved = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'i', 'settings', 'compose', 'intent']);

export async function discoverSocialProfiles(mission: string, env: DiscoveryEnv, maxPerPlatform = 20) {
  const targetPerPlatform = Math.max(1, Math.min(20, maxPerPlatform));
  const missionQuery = compactMission(mission);
  // Use two intent angles per platform so a single generic query does not leave the
  // Daily Queue with only a handful of people. Results are deduplicated and capped below.
  const searches = [
    { platform: 'x' as const, domain: 'x.com', query: `${missionQuery} fan listener supporter music community profile` },
    { platform: 'x' as const, domain: 'x.com', query: `${missionQuery} artist creator musician songwriter collaboration profile` },
    { platform: 'instagram' as const, domain: 'instagram.com', query: `${missionQuery} fan listener supporter music community profile` },
    { platform: 'instagram' as const, domain: 'instagram.com', query: `${missionQuery} artist creator musician collaboration profile` },
  ];

  const result = await searchProfiles(env, searches);
  const deduped = dedupeProfiles(result.profiles).sort((a, b) => b.score - a.score);
  const selected = [
    ...deduped.filter((profile) => profile.platform === 'x').slice(0, targetPerPlatform),
    ...deduped.filter((profile) => profile.platform === 'instagram').slice(0, targetPerPlatform),
  ].sort((a, b) => b.score - a.score);
  return {
    ...result, profiles: selected,
    // Keep the existing PWA automatic cooldown if configured provider searches fail.
    enabled: Boolean(env.TAVILY_API_KEY && env.TAVILY_BILLING_MODE === 'free'),
    reason: result.reason || (selected.length ? undefined : 'Search completed but no profile-shaped results were found.'),
  };
}

export async function discoverMuseXProfiles(mission: string, env: DiscoveryEnv, excludedHandles: Set<string>) {
  const topics = [
    '個人ゲーム開発 インディーゲーム indie game development',
    'ローファイ チル音楽 lo-fi chill music',
    'オリジナルキャラクター 創作 original character OC',
  ];
  const context = compactMission(mission).slice(0, 120);
  const searches: Search[] = topics.flatMap((topic) => [
    { platform: 'x', domain: 'x.com', query: `${topic} 制作 投稿 update ${context}`, recent: true },
    { platform: 'x', domain: 'x.com', query: `${topic} クリエイター プロフィール ${context}` },
  ]);
  const result = await searchProfiles(env, searches);
  const profileByHandle = new Map<string, DiscoveredProfile>();
  for (const profile of result.profiles) {
    if (!profile.snippet || xPostUrl(profile.sourceUrl, profile.username)) continue;
    const key = profile.username.toLowerCase();
    const prior = profileByHandle.get(key);
    if (!prior || profile.score > prior.score) profileByHandle.set(key, profile);
  }
  const profiles = result.profiles
    .filter((profile) => !excludedHandles.has(profile.username.toLowerCase()))
    .sort((a, b) => Number(Boolean(xPostUrl(b.sourceUrl, b.username)))
      - Number(Boolean(xPostUrl(a.sourceUrl, a.username))) || b.score - a.score);
  return {
    ...result,
    profiles: dedupeProfiles(profiles).slice(0, 60).map((profile) => ({
      ...profile, profileSummary: profileByHandle.get(profile.username.toLowerCase())?.snippet || profile.snippet,
    })),
  };
}

export function xPostUrl(raw: string, username: string, tweetId?: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !['x.com', 'twitter.com'].includes(host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const generic = parts.length === 4 && parts[0] === 'i' && parts[1] === 'web' && parts[2] === 'status';
    if (generic && tweetId && parts[3] === tweetId && /^\d{1,30}$/.test(tweetId)) return `https://x.com/i/web/status/${tweetId}`;
    const [handle, segment, id] = parts;
    if (parts.length !== 3 || !/^[\w]{1,15}$/.test(handle) || handle.toLowerCase() !== username.toLowerCase()
      || segment !== 'status' || !/^\d{1,30}$/.test(id) || (tweetId && id !== tweetId)) return null;
    return `https://x.com/${handle}/status/${id}`;
  } catch {
    return null;
  }
}

async function searchProfiles(env: DiscoveryEnv, searches: Search[]) {
  if (!env.TAVILY_API_KEY) {
    return { enabled: false, provider: 'tavily', costUsd: 0, credits: 0, profiles: [], reason: 'TAVILY_API_KEY is not configured.' };
  }
  if (env.TAVILY_BILLING_MODE !== 'free') {
    return { enabled: false, provider: 'tavily', costUsd: 0, credits: 0, profiles: [], reason: 'Only Tavily free-mode discovery is enabled in the initial $0-$3 build.' };
  }
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
        max_results: 20,
        topic: 'general',
        ...(search.recent ? { time_range: 'month' } : {}),
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
  let successfulQueries = 0;
  const profiles: DiscoveredProfile[] = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    successfulQueries += 1;
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

  return {
    enabled: successfulQueries > 0,
    provider: 'tavily',
    costUsd: 0,
    credits,
    profiles,
    reason: successfulQueries ? undefined : 'Tavily discovery did not return any successful search responses.',
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
