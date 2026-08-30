import { fetchWithTimeout } from '../../fetchWithTimeout';
import { X_USER_ID } from '../ids';
import { queryRecord } from '../query';

export interface XFollowRelationship {
  following: boolean;
  followRequestSent: boolean;
  complete: boolean;
  source: 'connection_status' | 'following_list';
  request: { method: string; path: string; query?: Record<string, string> };
}

const FOLLOWING_PAGE_SIZE = 100;
const MAX_FOLLOWING_PAGES = 40;

export function xUserLookupUrl(userId: string) {
  const params = new URLSearchParams({ 'user.fields': 'connection_status,id,username' });
  return {
    method: 'GET',
    path: `/2/users/${userId}`,
    url: `https://api.x.com/2/users/${encodeURIComponent(userId)}?${params.toString()}`,
    query: { 'user.fields': 'connection_status,id,username' },
  };
}

export function xFollowingListUrl(sourceUserId: string, paginationToken?: string) {
  const params = new URLSearchParams({ max_results: String(FOLLOWING_PAGE_SIZE) });
  if (paginationToken) params.set('pagination_token', paginationToken);
  return {
    method: 'GET',
    path: `/2/users/${sourceUserId}/following`,
    url: `https://api.x.com/2/users/${encodeURIComponent(sourceUserId)}/following?${params.toString()}`,
    query: queryRecord(params),
  };
}

export async function lookupXFollowRelationship(input: {
  sourceUserId: string;
  targetUserId: string;
  accessToken: string;
}): Promise<XFollowRelationship | null> {
  if (!X_USER_ID.test(input.sourceUserId) || !X_USER_ID.test(input.targetUserId) || !input.accessToken.trim()) {
    return null;
  }
  const lookup = xUserLookupUrl(input.targetUserId);
  const payload = await xGet<{ data?: { id?: string; connection_status?: unknown } }>(
    lookup.url,
    input.accessToken,
    'X follow relationship lookup',
  );
  const statuses = Array.isArray(payload.data?.connection_status)
    ? payload.data!.connection_status.filter((item): item is string => typeof item === 'string')
    : null;
  if (statuses) {
    return {
      following: statuses.includes('following'),
      followRequestSent: statuses.includes('follow_request_sent'),
      complete: true,
      source: 'connection_status',
      request: { method: lookup.method, path: lookup.path, query: lookup.query },
    };
  }

  let paginationToken: string | undefined;
  let pages = 0;
  let found = false;
  let lastRequest = xFollowingListUrl(input.sourceUserId);
  while (pages < MAX_FOLLOWING_PAGES) {
    const page = xFollowingListUrl(input.sourceUserId, paginationToken);
    lastRequest = page;
    const following = await xGet<{
      data?: Array<{ id?: string }>;
      meta?: { next_token?: string; result_count?: number };
    }>(page.url, input.accessToken, 'X following list');
    pages += 1;
    if ((following.data || []).some((row) => row.id === input.targetUserId)) {
      found = true;
      break;
    }
    const next = typeof following.meta?.next_token === 'string' ? following.meta.next_token : '';
    if (!next) {
      return {
        following: found,
        followRequestSent: false,
        complete: true,
        source: 'following_list',
        request: { method: page.method, path: page.path, query: page.query },
      };
    }
    paginationToken = next;
  }
  return {
    following: found,
    followRequestSent: false,
    complete: found,
    source: 'following_list',
    request: { method: lastRequest.method, path: lastRequest.path, query: lastRequest.query },
  };
}

export function interpretFollowRelationship(
  actionType: 'follow' | 'unfollow_review',
  relationship: XFollowRelationship | null,
): 'success' | 'failure' | 'unknown' {
  if (!relationship) return 'unknown';
  if (actionType === 'follow') {
    if (relationship.following || relationship.followRequestSent) return 'success';
    return 'unknown';
  }
  if (!relationship.complete) return 'unknown';
  if (!relationship.following && !relationship.followRequestSent) return 'success';
  return 'unknown';
}

async function xGet<T>(url: string, accessToken: string, label: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  }, 20_000, label);
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body || typeof body !== 'object') throw new Error(`${label} returned ${response.status}`);
  return body;
}
