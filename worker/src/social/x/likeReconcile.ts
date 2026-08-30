import { fetchWithTimeout } from '../../fetchWithTimeout';
import { X_TWEET_ID, X_USER_ID } from '../ids';
import { queryRecord } from '../query';

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export function xLikedTweetsUrl(userId: string, paginationToken?: string) {
  const params = new URLSearchParams({
    max_results: String(PAGE_SIZE),
    'tweet.fields': 'id',
  });
  if (paginationToken) params.set('pagination_token', paginationToken);
  return {
    method: 'GET',
    path: `/2/users/${userId}/liked_tweets`,
    url: `https://api.x.com/2/users/${encodeURIComponent(userId)}/liked_tweets?${params.toString()}`,
    query: queryRecord(params),
  };
}

export function likeReconciliationReady(scopes: readonly string[]) {
  return scopes.includes('like.read') && scopes.includes('like.write');
}

export async function lookupXLikedState(input: {
  sourceUserId: string;
  tweetId: string;
  accessToken: string;
}): Promise<{ liked: boolean; complete: boolean; request: { method: string; path: string; query?: Record<string, string> } } | null> {
  if (!X_USER_ID.test(input.sourceUserId) || !X_TWEET_ID.test(input.tweetId) || !input.accessToken.trim()) {
    return null;
  }
  let paginationToken: string | undefined;
  let pages = 0;
  let lastRequest = xLikedTweetsUrl(input.sourceUserId);
  while (pages < MAX_PAGES) {
    const page = xLikedTweetsUrl(input.sourceUserId, paginationToken);
    lastRequest = page;
    const payload = await xGet<{
      data?: Array<{ id?: string }>;
      meta?: { next_token?: string };
    }>(page.url, input.accessToken, 'X liked tweets');
    pages += 1;
    if ((payload.data || []).some((row) => row.id === input.tweetId)) {
      return {
        liked: true,
        complete: true,
        request: { method: page.method, path: page.path, query: page.query },
      };
    }
    const next = typeof payload.meta?.next_token === 'string' ? payload.meta.next_token : '';
    if (!next) {
      return {
        liked: false,
        complete: true,
        request: { method: page.method, path: page.path, query: page.query },
      };
    }
    paginationToken = next;
  }
  return {
    liked: false,
    complete: false,
    request: { method: lastRequest.method, path: lastRequest.path, query: lastRequest.query },
  };
}

export function interpretLikeState(state: { liked: boolean; complete: boolean } | null): 'success' | 'failure' | 'unknown' {
  if (!state) return 'unknown';
  if (state.liked) return 'success';
  if (!state.complete) return 'unknown';
  return 'failure';
}

async function xGet<T>(url: string, accessToken: string, label: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  }, 20_000, label);
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body || typeof body !== 'object') throw new Error(`${label} returned ${response.status}`);
  return body;
}
