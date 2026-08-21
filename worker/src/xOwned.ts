import { prepareFollowCycleTargets, updateFollowCycleEvidence, type TrackedXAccount } from './xFollowEvidence';
import { getValidXAccessToken, type XOAuthEnv } from './xOAuth';

export interface XOwnedEnv extends XOAuthEnv {
  DEFAULT_MONTHLY_BUDGET_USD?: string;
  X_USER_READ_USD?: string;
  X_OWNED_READ_USD?: string;
  X_OWNED_READ_ELIGIBLE?: string;
}

export interface XOwnedSyncRequest {
  userId?: string;
  monthlyLimitUsd?: number;
  maxFollowers?: number;
  maxFollowing?: number;
  maxPosts?: number;
  trackedAccounts?: TrackedXAccount[];
  force?: boolean;
}

interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  verified?: boolean;
  profile_image_url?: string;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
  };
}

interface XPost {
  id: string;
  text: string;
  created_at?: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    repost_count?: number;
    quote_count?: number;
  };
}

interface ListResponse<T> {
  data?: T[];
  meta?: { next_token?: string; result_count?: number };
}

interface UserResponse {
  data?: XUser;
}

interface BudgetSnapshot {
  usedUsd: number;
  available: boolean;
}

interface PagingState {
  followersCursor: string | null;
  followingCursor: string | null;
  followersCycle: number;
  followingCycle: number;
}

const CACHE_TTL_MS = 20 * 60 * 60 * 1000;

export async function syncOwnedXData(env: XOwnedEnv, body: XOwnedSyncRequest) {
  const userId = sanitizeUserId(body.userId || 'local-user');
  const cached = await loadFreshCache(env, userId, Boolean(body.force));
  if (cached) return { ...cached, source: 'cache', costUsd: 0 };

  if ((env.X_OWNED_READ_ELIGIBLE || '').trim().toLowerCase() !== 'true') {
    return disabled('X owned-read sync is disabled until X_OWNED_READ_ELIGIBLE=true is explicitly configured.');
  }

  const userReadRate = parsePositiveNumber(env.X_USER_READ_USD);
  const ownedReadRate = parsePositiveNumber(env.X_OWNED_READ_USD);
  if (!userReadRate || !ownedReadRate) {
    return disabled('Current X_USER_READ_USD and X_OWNED_READ_USD rates must be configured before paid X sync is allowed.');
  }

  const budget = await budgetForRequest(env, userId, body.monthlyLimitUsd);
  if (!budget.ledgerAvailable) return disabled('Budget ledger is unavailable; paid X reads are disabled.');
  if (budget.remainingUsd < userReadRate) return disabled('HARD LIMIT leaves insufficient budget for the authenticated-user lookup.');

  const requestedFollowers = clampInt(body.maxFollowers, 100, 0, 500);
  const requestedFollowing = clampInt(body.maxFollowing, 100, 0, 500);
  const requestedPosts = clampInt(body.maxPosts, 20, 0, 50);
  const pacedCapUsd = Math.min(budget.remainingUsd, Math.max(userReadRate, budget.remainingUsd / daysRemainingInUtcMonth()));
  const maxOwnedResourcesByBudget = Math.max(0, Math.floor(((pacedCapUsd - userReadRate) + 1e-9) / ownedReadRate));
  const allocation = allocateResources(maxOwnedResourcesByBudget, requestedFollowers, requestedFollowing, requestedPosts);
  const worstCaseCost = userReadRate + (allocation.followers + allocation.following + allocation.posts) * ownedReadRate;
  const paging = await loadPaging(env, userId);

  const reservationId = await reserveBudget(env, userId, worstCaseCost, budget.effectiveLimit);
  if (!reservationId) return disabled('HARD LIMIT changed before the X sync budget could be reserved.');

  try {
    const accessToken = await getValidXAccessToken(env, userId);
    const profile = await fetchMe(accessToken);
    if (!profile) throw new Error('X /2/users/me returned no user');

    if (allocation.followers > 0) {
      await prepareFollowCycleTargets(
        env.DB,
        userId,
        paging.followersCycle,
        paging.followersCursor,
        body.trackedAccounts,
      );
    }

    const [followersResult, followingResult, postsResult] = await Promise.all([
      allocation.followers > 0 ? fetchUsersPage(accessToken, profile.id, 'followers', allocation.followers, paging.followersCursor) : emptyList<XUser>(),
      allocation.following > 0 ? fetchUsersPage(accessToken, profile.id, 'following', allocation.following, paging.followingCursor) : emptyList<XUser>(),
      allocation.posts >= 5 ? fetchPostsPage(accessToken, profile.id, allocation.posts) : emptyList<XPost>(),
    ]);

    const followerCount = followersResult.data.length;
    const followingCount = followingResult.data.length;
    const postCount = postsResult.data.length;
    const actualCost = userReadRate + (followerCount + followingCount + postCount) * ownedReadRate;
    await finalizeReservation(env, reservationId, actualCost, 1 + followerCount + followingCount + postCount);

    const followEvidence = allocation.followers > 0
      ? await updateFollowCycleEvidence(
        env.DB,
        userId,
        paging.followersCycle,
        followersResult.data.map((user) => ({ id: user.id, username: user.username })),
        followersResult.nextToken,
      )
      : null;

    const nextPaging = advancePaging(paging, allocation, followersResult.nextToken, followingResult.nextToken);
    await savePaging(env, userId, nextPaging);

    const syncedAt = new Date().toISOString();
    const result = {
      enabled: true,
      source: 'x',
      costUsd: actualCost,
      syncedAt,
      profile: normalizeUser(profile),
      followers: followersResult.data.map(normalizeUser),
      following: followingResult.data.map(normalizeUser),
      posts: postsResult.data.map((post) => ({
        id: post.id,
        text: post.text,
        createdAt: post.created_at || null,
        publicMetrics: {
          likes: post.public_metrics?.like_count || 0,
          replies: post.public_metrics?.reply_count || 0,
          reposts: post.public_metrics?.repost_count || 0,
          quotes: post.public_metrics?.quote_count || 0,
        },
      })),
      coverage: {
        followers: {
          fetched: followerCount,
          complete: allocation.followers > 0 && paging.followersCursor === null && !followersResult.nextToken,
          cycle: nextPaging.followersCycle,
          rotated: paging.followersCursor !== null,
        },
        following: {
          fetched: followingCount,
          complete: allocation.following > 0 && paging.followingCursor === null && !followingResult.nextToken,
          cycle: nextPaging.followingCycle,
          rotated: paging.followingCursor !== null,
        },
        posts: { fetched: postCount, complete: !postsResult.nextToken },
      },
      followEvidence,
      requested: allocation,
      pacing: {
        daysRemaining: daysRemainingInUtcMonth(),
        pacedCapUsd,
        globalRemainingUsd: budget.remainingUsd,
      },
    };
    await saveCache(env, userId, result);
    return result;
  } catch (error) {
    // Keep the conservative reservation on an uncertain network failure. X may have
    // already billed resources before the error surfaced, so over-counting is safer.
    const message = error instanceof Error ? error.message : 'Owned X sync failed';
    throw new Error(message);
  }
}

function disabled(reason: string) {
  return { enabled: false, source: 'disabled', costUsd: 0, reason };
}

async function fetchMe(accessToken: string) {
  const params = new URLSearchParams({
    'user.fields': 'description,profile_image_url,public_metrics,verified',
  });
  const response = await xFetch<UserResponse>(`https://api.x.com/2/users/me?${params.toString()}`, accessToken);
  return response.data || null;
}

async function fetchUsersPage(accessToken: string, userId: string, kind: 'followers' | 'following', maxResults: number, cursor: string | null) {
  const params = new URLSearchParams({
    max_results: String(Math.max(1, Math.min(500, maxResults))),
    'user.fields': 'description,profile_image_url,public_metrics,verified',
  });
  if (cursor) params.set('pagination_token', cursor);
  const response = await xFetch<ListResponse<XUser>>(`https://api.x.com/2/users/${encodeURIComponent(userId)}/${kind}?${params.toString()}`, accessToken);
  return { data: response.data || [], nextToken: response.meta?.next_token || null };
}

async function fetchPostsPage(accessToken: string, userId: string, maxResults: number) {
  const params = new URLSearchParams({
    max_results: String(Math.max(5, Math.min(50, maxResults))),
    'tweet.fields': 'created_at,public_metrics',
    exclude: 'retweets,replies',
  });
  const response = await xFetch<ListResponse<XPost>>(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`, accessToken);
  return { data: response.data || [], nextToken: response.meta?.next_token || null };
}

async function xFetch<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`X API returned ${response.status}`);
  return response.json<T>();
}

function normalizeUser(user: XUser) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    description: user.description || '',
    verified: Boolean(user.verified),
    profileImageUrl: user.profile_image_url || null,
    publicMetrics: {
      followers: user.public_metrics?.followers_count || 0,
      following: user.public_metrics?.following_count || 0,
      posts: user.public_metrics?.tweet_count || 0,
      listed: user.public_metrics?.listed_count || 0,
    },
  };
}

function emptyList<T>() {
  return Promise.resolve({ data: [] as T[], nextToken: null as string | null });
}

function allocateResources(total: number, followers: number, following: number, posts: number) {
  if (total <= 0) return { followers: 0, following: 0, posts: 0 };
  let remaining = total;
  const postTarget = posts >= 5 && remaining >= 5 ? Math.min(posts, Math.max(5, Math.floor(total * 0.15))) : 0;
  const allocatedPosts = Math.min(postTarget, remaining);
  remaining -= allocatedPosts;

  let allocatedFollowers = Math.min(followers, Math.ceil(remaining / 2));
  let allocatedFollowing = Math.min(following, remaining - allocatedFollowers);
  let leftover = remaining - allocatedFollowers - allocatedFollowing;
  if (leftover > 0) {
    const followerRoom = Math.max(0, followers - allocatedFollowers);
    const extraFollowers = Math.min(leftover, followerRoom);
    allocatedFollowers += extraFollowers;
    leftover -= extraFollowers;
  }
  if (leftover > 0) {
    allocatedFollowing += Math.min(leftover, Math.max(0, following - allocatedFollowing));
  }
  return { followers: allocatedFollowers, following: allocatedFollowing, posts: allocatedPosts };
}

function advancePaging(paging: PagingState, allocation: { followers: number; following: number }, followersNext: string | null, followingNext: string | null): PagingState {
  const followersRequested = allocation.followers > 0;
  const followingRequested = allocation.following > 0;
  return {
    followersCursor: followersRequested ? followersNext : paging.followersCursor,
    followingCursor: followingRequested ? followingNext : paging.followingCursor,
    followersCycle: paging.followersCycle + (followersRequested && !followersNext ? 1 : 0),
    followingCycle: paging.followingCycle + (followingRequested && !followingNext ? 1 : 0),
  };
}

async function loadPaging(env: XOwnedEnv, userId: string): Promise<PagingState> {
  try {
    const row = await env.DB.prepare(
      'SELECT followers_cursor, following_cursor, followers_cycle, following_cycle FROM x_owned_paging WHERE user_id = ?'
    ).bind(userId).first<{
      followers_cursor: string | null;
      following_cursor: string | null;
      followers_cycle: number;
      following_cycle: number;
    }>();
    return {
      followersCursor: row?.followers_cursor || null,
      followingCursor: row?.following_cursor || null,
      followersCycle: Number(row?.followers_cycle || 0),
      followingCycle: Number(row?.following_cycle || 0),
    };
  } catch {
    return { followersCursor: null, followingCursor: null, followersCycle: 0, followingCycle: 0 };
  }
}

async function savePaging(env: XOwnedEnv, userId: string, paging: PagingState) {
  try {
    await env.DB.prepare(
      `INSERT INTO x_owned_paging (user_id, followers_cursor, following_cursor, followers_cycle, following_cycle, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         followers_cursor = excluded.followers_cursor,
         following_cursor = excluded.following_cursor,
         followers_cycle = excluded.followers_cycle,
         following_cycle = excluded.following_cycle,
         updated_at = excluded.updated_at`
    ).bind(
      userId,
      paging.followersCursor,
      paging.followingCursor,
      paging.followersCycle,
      paging.followingCycle,
      new Date().toISOString(),
    ).run();
  } catch {
    // Paging persistence failure safely falls back to the first page next time.
  }
}

async function loadFreshCache(env: XOwnedEnv, userId: string, force: boolean) {
  if (force) return null;
  try {
    const row = await env.DB.prepare('SELECT snapshot_json, synced_at FROM x_owned_snapshots WHERE user_id = ?')
      .bind(userId)
      .first<{ snapshot_json: string; synced_at: string }>();
    if (!row) return null;
    if (Date.now() - new Date(row.synced_at).getTime() > CACHE_TTL_MS) return null;
    return JSON.parse(row.snapshot_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function saveCache(env: XOwnedEnv, userId: string, snapshot: unknown) {
  try {
    const syncedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO x_owned_snapshots (user_id, snapshot_json, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, synced_at = excluded.synced_at`
    ).bind(userId, JSON.stringify(snapshot), syncedAt).run();
  } catch {
    // A cache failure should not discard successfully fetched data.
  }
}

async function budgetForRequest(env: XOwnedEnv, userId: string, requestedLimitUsd?: number) {
  const serverLimit = configuredLimit(env);
  const requestedLimit = Number.isFinite(requestedLimitUsd) ? Math.max(0, requestedLimitUsd!) : serverLimit;
  const effectiveLimit = Math.min(serverLimit, requestedLimit);
  const ledger = await monthUsage(env, userId);
  return {
    usedUsd: ledger.usedUsd,
    effectiveLimit,
    ledgerAvailable: ledger.available,
    remainingUsd: ledger.available ? Math.max(0, effectiveLimit - ledger.usedUsd) : 0,
  };
}

async function monthUsage(env: XOwnedEnv, userId: string): Promise<BudgetSnapshot> {
  try {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const row = await env.DB.prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) AS used FROM budget_ledger WHERE user_id = ? AND occurred_at >= ?'
    ).bind(userId, start.toISOString()).first<{ used: number }>();
    return { usedUsd: Number(row?.used || 0), available: true };
  } catch {
    return { usedUsd: 0, available: false };
  }
}

async function reserveBudget(env: XOwnedEnv, userId: string, amountUsd: number, effectiveLimit: number) {
  const id = crypto.randomUUID();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const now = new Date().toISOString();
  try {
    const result = await env.DB.prepare(
      `INSERT INTO budget_ledger (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at)
       SELECT ?, ?, 'x', 'owned_sync_reservation', ?, 0, 0, 0, ?
       WHERE COALESCE((SELECT SUM(cost_usd) FROM budget_ledger WHERE user_id = ? AND occurred_at >= ?), 0) + ? <= ?`
    ).bind(id, userId, amountUsd, now, userId, start.toISOString(), amountUsd, effectiveLimit).run();
    return result.meta.changes > 0 ? id : null;
  } catch {
    return null;
  }
}

async function finalizeReservation(env: XOwnedEnv, reservationId: string, actualCostUsd: number, resources: number) {
  await env.DB.prepare(
    'UPDATE budget_ledger SET operation = ?, cost_usd = ?, input_units = ? WHERE id = ?'
  ).bind('owned_sync', actualCostUsd, resources, reservationId).run();
}

function configuredLimit(env: XOwnedEnv) {
  const parsed = Number(env.DEFAULT_MONTHLY_BUDGET_USD || '3');
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 3;
}

function daysRemainingInUtcMonth() {
  const now = new Date();
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.max(1, lastDay - now.getUTCDate() + 1);
}

function parsePositiveNumber(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? Math.floor(value!) : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sanitizeUserId(value: string) {
  const userId = value.trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(userId)) throw new Error('invalid userId');
  return userId;
}
