import { fetchWithTimeout } from '../../fetchWithTimeout';
import { X_TWEET_ID, X_USER_ID } from '../ids';

export interface XUserLookup {
  id: string;
  username: string;
  name?: string;
  protected?: boolean;
}

export interface XTweetLookup {
  id: string;
  authorId?: string;
  conversationId?: string;
  text?: string;
  createdAt?: string;
}

export async function lookupXUserByUsername(accessToken: string, username: string): Promise<XUserLookup | null> {
  const handle = username.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || !accessToken.trim()) return null;
  const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=id,username,name,protected`;
  const payload = await xGet<{ data?: { id?: unknown; username?: unknown; name?: unknown; protected?: unknown } }>(url, accessToken, 'X user lookup');
  return mapUser(payload?.data);
}

export async function lookupXUserById(accessToken: string, userId: string): Promise<XUserLookup | null> {
  if (!X_USER_ID.test(userId) || !accessToken.trim()) return null;
  const url = `https://api.x.com/2/users/${encodeURIComponent(userId)}?user.fields=id,username,name,protected`;
  const payload = await xGet<{ data?: { id?: unknown; username?: unknown; name?: unknown; protected?: unknown } }>(url, accessToken, 'X user id lookup');
  return mapUser(payload?.data);
}

export async function lookupXAuthenticatedUser(accessToken: string): Promise<XUserLookup | null> {
  if (!accessToken.trim()) return null;
  const payload = await xGet<{ data?: { id?: unknown; username?: unknown; name?: unknown } }>(
    'https://api.x.com/2/users/me?user.fields=id,username,name',
    accessToken,
    'X users/me',
  );
  return mapUser(payload?.data);
}

export async function lookupXTweet(accessToken: string, tweetId: string): Promise<XTweetLookup | null> {
  if (!X_TWEET_ID.test(tweetId) || !accessToken.trim()) return null;
  const url = `https://api.x.com/2/tweets/${encodeURIComponent(tweetId)}?tweet.fields=id,author_id,conversation_id,created_at,text`;
  const payload = await xGet<{ data?: { id?: unknown; author_id?: unknown; conversation_id?: unknown; created_at?: unknown; text?: unknown } }>(
    url,
    accessToken,
    'X tweet lookup',
  );
  const data = payload?.data;
  if (!data || typeof data.id !== 'string' || !X_TWEET_ID.test(data.id)) return null;
  return {
    id: data.id,
    authorId: typeof data.author_id === 'string' && X_USER_ID.test(data.author_id) ? data.author_id : undefined,
    conversationId: typeof data.conversation_id === 'string' && X_TWEET_ID.test(data.conversation_id) ? data.conversation_id : undefined,
    createdAt: typeof data.created_at === 'string' ? data.created_at : undefined,
    text: typeof data.text === 'string' ? data.text : undefined,
  };
}

function mapUser(data: { id?: unknown; username?: unknown; name?: unknown; protected?: unknown } | undefined): XUserLookup | null {
  if (!data || typeof data.id !== 'string' || !X_USER_ID.test(data.id)) return null;
  if (typeof data.username !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(data.username)) return null;
  return {
    id: data.id,
    username: data.username,
    name: typeof data.name === 'string' ? data.name : undefined,
    protected: data.protected === true,
  };
}

async function xGet<T>(url: string, accessToken: string, label: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
  }, 20_000, label);
  const body = await response.json().catch(() => null) as T | { detail?: string } | null;
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body && body.detail ? `: ${String(body.detail).slice(0, 180)}` : '';
    throw new Error(`${label} returned ${response.status}${detail}`);
  }
  if (!body || typeof body !== 'object') throw new Error(`${label} returned invalid JSON`);
  return body as T;
}
