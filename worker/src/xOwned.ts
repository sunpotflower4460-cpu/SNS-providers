import { readActiveMonthUsage, reserveActiveMonthBudget } from './budgetIntegrity';
import { fetchWithTimeout } from './fetchWithTimeout';
import {
  FollowEvidenceStorageUnavailableError,
  prepareFollowCycleTargets,
  updateFollowCycleEvidence,
  type TrackedXAccount,
} from './xFollowEvidence';
import { getValidXAccessToken, xOAuthStatus, type XOAuthEnv } from './xOAuth';

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
const MAX_PAGING_CYCLE = 1_000_000;

export async function syncOwnedXData(env: XOwnedEnv, body: XOwnedSyncRequest) {
  const userId = sanitizeUserId(body.userId || 'local-user');

  if ((env.X_OWNED_READ_ELIGIBLE || '').trim().toLowerCase() !== 'true') {
    return disabled('X owned-read sync is disabled until X_OWNED_READ_ELIGIBLE=true is explicitly configured.');
  }

  // Cached owned data still requires an existing OAuth connection, but serving it should
  // not depend on a live token-refresh network call. Actual X reads validate/refresh below.
  const oauthStatus = await xOAuthStatus(env, userId);
  if (!oauthStatus.connected) throw new Error('X account is not connected');
  const cached = await loadFreshCache(env, userId, Boolean(body.force));
  if (cached) return { ...cached, source: 'cache', costUsd: 0 };

  const userReadRate = parsePositiveNumber(env.X_USER_READ_USD);
  const ownedReadRate = parsePositiveNumber(env.X_OWNED_READ_USD);
  if (!userReadRate || !ownedReadRate) {
    return disabled('Current X_USER_READ_USD and X_OWNED_READ_USD rates must be configured before paid X sync is allowed.');
  }

  const budget = await budgetForRequest(env, userId, body.monthlyLimitUsd);
  if (!budget.ledgerAvailable) return disabled('Budget ledger is unavailable or invalid; paid X reads are disabled.');
  if (budget.remainingUsd < userReadRate) return disabled('HARD LIMIT leaves insufficient budget for the authenticated-user lookup.');

  // Capture the observation boundary before any X request starts. Negative evidence from
  // this sync/cache must never be applied later to a follow that the user began after this
  // point, because the fetched follower snapshot could not have observed that newer follow.
  const startedAt = new Date().toISOString();

  // Token lookup/refresh is not a paid owned-data read. Resolve it before reserving
  // budget so a missing/corrupt OAuth connection cannot consume the monthly cap.
  const accessToken = await getValidXAccessToken(env, userId);

  const requestedFollowers = clampInt(body.maxFollowers, 100, 0, 500);
  const requestedFollowing = clampInt(body.maxFollowing, 100, 0, 500);
  const requestedPosts = clampInt(body.maxPosts, 20, 0, 50);
  const pacedCapUsd = Math.min(budget.remainingUsd, Math.max(userReadRate, budget.remainingUsd / daysRemainingInUtcMonth()));
  const maxOwnedResourcesByBudget = Math.max(0, Math.floor(((pacedCapUsd - userReadRate) + 1e-9) / ownedReadRate));
  const allocation = allocateResources(maxOwnedResourcesByBudget, requestedFollowers, requestedFollowing, requestedPosts);
  const worstCaseCost = userReadRate + (allocation.followers + allocation.following + allocation.posts) * ownedReadRate;
  const paging = await loadPaging(env, userId);

  // A page that closes a cycle increments its counter. Refuse the practically unreachable
  // terminal value before a paid read because we cannot know in advance whether X will
  // return another cursor; letting it overflow would make the paid result unpersistable.
  if ((allocation.followers > 0 && paging.followersCycle >= MAX_PAGING_CYCLE)
    || (allocation.following > 0 && paging.followingCycle >= MAX_PAGING_CYCLE)) {
    return disabled('X paging cycle reached its safety limit. Reset the owned-X paging state before another paid sync.');
  }

  // Follow-cycle storage is local D1 work, not an X provider read. Prepare it before the
  // paid reservation/provider boundary so a missing/corrupt evidence table cannot consume
  // paid budget or make a successful /users/me lookup look cost-uncertain.
  if (allocation.followers > 0) {
    await prepareFollowCycleTargets(
      env.DB,
      userId,
      paging.followersCycle,
      paging.followersCursor,
      body.trackedAccounts,
    );
  }

  const reservationId = await reserveBudget(env, userId, worstCaseCost, budget.effectiveLimit);
  if (!reservationId) return disabled('HARD LIMIT or budget-ledger integrity changed before the X sync budget could be reserved.');

  let reservationFinalized = false;
  try {
    const profile = await fetchMe(accessToken);
    if (!profile) throw new Error('X /2/users/me returned no user');

    const [followersResult, followingResult, postsResult] = await Promise.all([
      allocation.followers > 0 ? fetchUsersPage(accessToken, profile.id, 'followers', allocation.followers, paging.followersCursor) : emptyList<XUser>(),
      allocation.following > 0 ? fetchUsersPage(accessToken, profile.id, 'following', allocation.following, paging.followingCursor) : emptyList<XUser>(),
      allocation.posts >= 5 ? fetchPostsPage(accessToken, profile.id, allocation.posts) : emptyList<XPost>(),
    ]);

    // The two lists are fetched concurrently. A handle rename or inconsistent upstream
    // snapshot can otherwise make the same immutable ID appear under two usernames (or
    // one username under two IDs) across endpoints even though each list is valid alone.
    // Fail before shrinking the conservative reservation so ambiguous identity data never
    // reaches CRM/cache and the paid attempt remains conservatively accounted.
    if (!coherentRawXUsersAcrossLists(followersResult.data, followingResult.data)) {
      throw new Error('X follower/following endpoints returned contradictory user identity data');
    }

    const followerCount = followersResult.data.length;
    const followingCount = followingResult.data.length;
    const postCount = postsResult.data.length;
    const actualCost = userReadRate + (followerCount + followingCount + postCount) * ownedReadRate;
    const ordinaryNextPaging = advancePaging(paging, allocation, followersResult.nextToken, followingResult.nextToken);
    const syncedAt = new Date().toISOString();

    // Validate the normalized paid provider payload and resume checkpoint before finalizing
    // the conservative reservation. After finalization, only best-effort local evidence and
    // redundant checkpoint writes remain, so a local D1 problem cannot make the caller
    // blindly re-read an already paid page.
    const validatedProviderResult = {
      enabled: true,
      source: 'x',
      costUsd: actualCost,
      startedAt,
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
          cycle: ordinaryNextPaging.followersCycle,
          rotated: paging.followersCursor !== null,
        },
        following: {
          fetched: followingCount,
          complete: allocation.following > 0 && paging.followingCursor === null && !followingResult.nextToken,
          cycle: ordinaryNextPaging.followingCycle,
          rotated: paging.followingCursor !== null,
        },
        posts: { fetched: postCount, complete: !postsResult.nextToken },
      },
      followEvidence: null,
      requested: allocation,
      resumePaging: ordinaryNextPaging,
      pacing: {
        daysRemaining: daysRemainingInUtcMonth(),
        pacedCapUsd,
        globalRemainingUsd: budget.remainingUsd,
      },
    };
    if (!validOwnedSnapshot(validatedProviderResult)) throw new Error('Owned X sync produced an invalid provider snapshot');

    // All raw/normalized paid X data is now validated. Only now shrink the reservation to
    // the known resource count. If this statement itself is uncertain, the outer catch keeps
    // or reconstructs the conservative reservation as before.
    await finalizeReservation(env, reservationId, actualCost, 1 + followerCount + followingCount + postCount);
    reservationFinalized = true;

    let followEvidence = null;
    let followEvidenceDegraded = false;
    if (allocation.followers > 0) {
      try {
        followEvidence = await updateFollowCycleEvidence(
          env.DB,
          userId,
          paging.followersCycle,
          followersResult.data.map((user) => ({ id: user.id, username: user.username })),
          followersResult.nextToken,
        );
      } catch (error) {
        if (!(error instanceof FollowEvidenceStorageUnavailableError)) throw error;
        // The provider read is already validated/finalized. Do not fail the whole request
        // and invite a duplicate paid read merely because local follow-evidence storage is
        // unavailable. Quarantine this evidence cycle and return the paid data without any
        // seen/unseen verdict from the contaminated rows.
        followEvidenceDegraded = true;
        followEvidence = null;
      }
    }
    if (followEvidence != null && !validFollowEvidence(followEvidence)) {
      followEvidenceDegraded = true;
      followEvidence = null;
    }

    const nextPaging = followEvidenceDegraded
      ? quarantineFollowerEvidencePaging(paging, ordinaryNextPaging, followersResult.nextToken)
      : ordinaryNextPaging;
    const result = {
      ...validatedProviderResult,
      coverage: {
        ...validatedProviderResult.coverage,
        followers: {
          ...validatedProviderResult.coverage.followers,
          cycle: nextPaging.followersCycle,
        },
      },
      followEvidence,
      resumePaging: nextPaging,
      ...(followEvidenceDegraded ? {
        followEvidenceDegraded: true,
        reason: 'X公式データは取得できましたが、フォローバック確認用の保存が不安定だったため、この周回の判定は破棄しました。取得済みページは進めたまま、次の安全な周回から確認を再開します。',
      } : {}),
    };
    if (!validOwnedSnapshot(result)) {
      // This should be unreachable because the provider payload was validated before
      // finalization and the only later mutation is a bounded paging/evidence downgrade.
      // Keep the finalized ledger accurate; never relabel a known paid cost as uncertain.
      throw new Error('Owned X post-finalization checkpoint became invalid');
    }

    // Paging and snapshot are redundant checkpoints. If the dedicated paging row fails,
    // the snapshot carries the exact next cursor/cycle and loadPaging() can recover it even
    // after the cache TTL expires. Only if both writes fail do we surface degraded durability
    // while still returning the already-paid, validated data instead of encouraging a blind retry.
    const pagingPersisted = await savePaging(env, userId, nextPaging, syncedAt);
    const cachePersisted = await saveCache(env, userId, result);
    if (!pagingPersisted && !cachePersisted) {
      return {
        ...result,
        persistenceDegraded: true,
        reason: 'X公式データは取得できましたが、次回位置をD1へ保存できませんでした。重複した有料読み取りを避けるため、D1の状態を確認するまで再更新しないでください。',
      };
    }
    return result;
  } catch (error) {
    // Before finalization, transport/JSON/validation/finalization failures do not prove the
    // provider did not bill the read, so retain/reconstruct the conservative reservation.
    // After finalization the exact paid cost is already durable; local post-processing must
    // never relabel that known cost as uncertain.
    if (!reservationFinalized) {
      await markReservationUncertain(env, reservationId, userId, worstCaseCost);
    }
    const message = error instanceof Error ? error.message : 'Owned X sync failed';
    throw new Error(message);
  }
}

function disabled(reason: string) {
  return { enabled: false, source: 'disabled', costUsd: 0, reason };
}

function quarantineFollowerEvidencePaging(paging: PagingState, ordinaryNext: PagingState, followersNext: string | null): PagingState {
  if (!followersNext) return ordinaryNext;
  // We cannot delete the contaminated current cycle, but we can make it unreachable. Keep
  // the already-paid next cursor so the same page is not re-read, while advancing to a new
  // cycle number. Because the new cycle starts mid-pagination, prepareFollowCycleTargets()
  // intentionally does not create targets; the remainder of this pass is data-only. When
  // it reaches the end, advancePaging() increments again and the next page-1 request starts
  // a clean evidence cycle.
  return {
    ...ordinaryNext,
    followersCycle: paging.followersCycle + 1,
  };
}

async function fetchMe(accessToken: string) {
  const params = new URLSearchParams({
    'user.fields': 'description,profile_image_url,public_metrics,verified',
  });
  const response = await xFetch<UserResponse>(`https://api.x.com/2/users/me?${params.toString()}`, accessToken);
  if (response.data == null) return null;
  if (!validRawXUser(response.data)) throw new Error('X /2/users/me returned malformed user data');
  return response.data;
}

async function fetchUsersPage(accessToken: string, userId: string, kind: 'followers' | 'following', maxResults: number, cursor: string | null) {
  const params = new URLSearchParams({
    max_results: String(Math.max(1, Math.min(500, maxResults))),
    'user.fields': 'description,profile_image_url,public_metrics,verified',
  });
  if (cursor) params.set('pagination_token', cursor);
  const response = await xFetch<ListResponse<XUser>>(`https://api.x.com/2/users/${encodeURIComponent(userId)}/${kind}?${params.toString()}`, accessToken);
  const data = response.data || [];
  if (response.data != null && (!Array.isArray(response.data)
    || response.data.length > maxResults
    || !response.data.every(validRawXUser)
    || !uniqueRawXUsers(response.data))) {
    throw new Error(`X ${kind} endpoint returned malformed user data`);
  }
  if (!validListMeta(response.meta, data.length, maxResults)) {
    throw new Error(`X ${kind} endpoint returned incoherent pagination metadata`);
  }
  const nextToken = response.meta?.next_token;
  if (nextToken != null && safeCursor(nextToken) === null) throw new Error(`X ${kind} endpoint returned an invalid pagination token`);
  return { data, nextToken: nextToken || null };
}

async function fetchPostsPage(accessToken: string, userId: string, maxResults: number) {
  const params = new URLSearchParams({
    max_results: String(Math.max(5, Math.min(50, maxResults))),
    'tweet.fields': 'created_at,public_metrics',
    exclude: 'retweets,replies',
  });
  const response = await xFetch<ListResponse<XPost>>(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`, accessToken);
  const data = response.data || [];
  if (response.data != null && (!Array.isArray(response.data)
    || response.data.length > maxResults
    || !response.data.every(validRawXPost)
    || !uniqueRawXPosts(response.data))) {
    throw new Error('X posts endpoint returned malformed post data');
  }
  if (!validListMeta(response.meta, data.length, maxResults)) {
    throw new Error('X posts endpoint returned incoherent pagination metadata');
  }
  const nextToken = response.meta?.next_token;
  if (nextToken != null && safeCursor(nextToken) === null) throw new Error('X posts endpoint returned an invalid pagination token');
  return { data, nextToken: nextToken || null };
}

async function xFetch<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${accessToken}` } }, 30_000, 'X API');
  if (!response.ok) throw new Error(`X API returned ${response.status}`);
  const body = await response.json().catch(() => null) as unknown;
  if (!isRecord(body)) throw new Error('X API returned an empty or invalid JSON response');
  return body as T;
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
  const empty = emptyPaging();
  let rowState: PagingState | null = null;
  let rowUpdatedMs = Number.NEGATIVE_INFINITY;

  // Treat the dedicated paging row and snapshot checkpoint as independent redundancy.
  // A corrupt/missing snapshot must never erase a valid cursor, and a broken paging table
  // must not prevent recovery from the successfully cached paid snapshot.
  try {
    const row = await env.DB.prepare(
      'SELECT followers_cursor, following_cursor, followers_cycle, following_cycle, updated_at FROM x_owned_paging WHERE user_id = ?'
    ).bind(userId).first<{
      followers_cursor: string | null;
      following_cursor: string | null;
      followers_cycle: number;
      following_cycle: number;
      updated_at: string;
    }>();
    if (row && validPastishIso(row.updated_at)) {
      rowState = pagingFromStoredRow(row);
      if (rowState) rowUpdatedMs = new Date(row.updated_at).getTime();
    }
  } catch {
    // The snapshot checkpoint below can still recover progress.
  }

  try {
    const snapshotRow = await env.DB.prepare('SELECT snapshot_json, synced_at FROM x_owned_snapshots WHERE user_id = ?')
      .bind(userId)
      .first<{ snapshot_json: string; synced_at: string }>();
    if (snapshotRow) {
      try {
        const snapshot = JSON.parse(snapshotRow.snapshot_json) as unknown;
        if (validOwnedSnapshot(snapshot)
          && isRecord(snapshot)
          && validPagingState(snapshot.resumePaging)
          && snapshot.syncedAt === snapshotRow.synced_at) {
          const snapshotMs = new Date(snapshot.syncedAt as string).getTime();
          if (Number.isFinite(snapshotMs) && snapshotMs >= rowUpdatedMs) {
            return pagingFromValue(snapshot.resumePaging);
          }
        } else {
          await deleteCache(env, userId);
        }
      } catch {
        // A malformed snapshot is not allowed to poison a valid dedicated paging row.
        await deleteCache(env, userId);
      }
    }
  } catch {
    // Keep a valid dedicated paging row if snapshot storage itself is unavailable.
  }

  return rowState || empty;
}

async function savePaging(env: XOwnedEnv, userId: string, paging: PagingState, updatedAt: string) {
  try {
    const result = await env.DB.prepare(
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
      updatedAt,
    ).run();
    return result.meta.changes === 1;
  } catch {
    return false;
  }
}

async function loadFreshCache(env: XOwnedEnv, userId: string, force: boolean) {
  if (force) return null;
  try {
    const row = await env.DB.prepare('SELECT snapshot_json, synced_at FROM x_owned_snapshots WHERE user_id = ?')
      .bind(userId)
      .first<{ snapshot_json: string; synced_at: string }>();
    if (!row) return null;
    const snapshot = JSON.parse(row.snapshot_json) as unknown;
    if (!validOwnedSnapshot(snapshot) || !isRecord(snapshot) || snapshot.syncedAt !== row.synced_at) {
      await deleteCache(env, userId);
      return null;
    }
    const syncedAtMs = new Date(snapshot.syncedAt as string).getTime();
    if (!Number.isFinite(syncedAtMs) || syncedAtMs > Date.now() + 60_000 || Date.now() - syncedAtMs > CACHE_TTL_MS) return null;
    return snapshot;
  } catch {
    return null;
  }
}

async function deleteCache(env: XOwnedEnv, userId: string) {
  try {
    await env.DB.prepare('DELETE FROM x_owned_snapshots WHERE user_id = ?').bind(userId).run();
  } catch {
    // Invalid cache is ignored even if cleanup cannot be persisted.
  }
}

async function saveCache(env: XOwnedEnv, userId: string, snapshot: unknown) {
  try {
    if (!isRecord(snapshot) || typeof snapshot.syncedAt !== 'string' || !validPastishIso(snapshot.syncedAt)) return false;
    const result = await env.DB.prepare(
      `INSERT INTO x_owned_snapshots (user_id, snapshot_json, synced_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, synced_at = excluded.synced_at`
    ).bind(userId, JSON.stringify(snapshot), snapshot.syncedAt).run();
    return result.meta.changes === 1;
  } catch {
    return false;
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
  return readActiveMonthUsage(env.DB, userId);
}

async function reserveBudget(env: XOwnedEnv, userId: string, amountUsd: number, effectiveLimit: number) {
  const id = crypto.randomUUID();
  const reserved = await reserveActiveMonthBudget(env.DB, {
    id,
    userId,
    provider: 'x',
    operation: 'owned_sync_reservation',
    amountUsd,
    effectiveLimit,
    occurredAt: new Date().toISOString(),
  });
  return reserved ? id : null;
}

async function finalizeReservation(env: XOwnedEnv, reservationId: string, actualCostUsd: number, resources: number) {
  const result = await env.DB.prepare(
    'UPDATE budget_ledger SET operation = ?, cost_usd = ?, input_units = ? WHERE id = ?'
  ).bind('owned_sync', actualCostUsd, resources, reservationId).run();
  if (result.meta.changes !== 1) throw new Error('Owned-X budget reservation disappeared before finalization');
}

async function markReservationUncertain(env: XOwnedEnv, reservationId: string, userId: string, reservedUsd: number) {
  try {
    const updated = await env.DB.prepare('UPDATE budget_ledger SET operation = ? WHERE id = ?')
      .bind('owned_sync_uncertain', reservationId)
      .run();
    if (updated.meta.changes > 0) return;

    await env.DB.prepare(
      `INSERT OR IGNORE INTO budget_ledger
        (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at)
       VALUES (?, ?, 'x', 'owned_sync_uncertain', ?, 0, 0, 0, ?)`
    ).bind(reservationId, userId, Math.max(0, reservedUsd), new Date().toISOString()).run();
  } catch {
    // The caller still fails closed. If D1 itself is unavailable we cannot durably repair
    // the ledger, but we never report this paid sync as a normal finalized success.
  }
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

function validRawXUser(value: unknown): value is XUser {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !/^\d{1,30}$/.test(value.id)
    || typeof value.username !== 'string'
    || !/^[A-Za-z0-9_]{1,15}$/.test(value.username)
    || typeof value.name !== 'string'
    || value.name.length > 300
    || (value.description != null && (typeof value.description !== 'string' || value.description.length > 5000))
    || (value.verified != null && typeof value.verified !== 'boolean')
    || (value.profile_image_url != null && (typeof value.profile_image_url !== 'string' || !validHttpsUrl(value.profile_image_url)))) return false;
  if (value.public_metrics == null) return true;
  return isRecord(value.public_metrics)
    && optionalNonNegativeFinite(value.public_metrics.followers_count)
    && optionalNonNegativeFinite(value.public_metrics.following_count)
    && optionalNonNegativeFinite(value.public_metrics.tweet_count)
    && optionalNonNegativeFinite(value.public_metrics.listed_count);
}

function validRawXPost(value: unknown): value is XPost {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !/^\d{1,30}$/.test(value.id)
    || typeof value.text !== 'string'
    || value.text.length > 30_000
    || (value.created_at != null && (typeof value.created_at !== 'string' || !validPastishIso(value.created_at)))) return false;
  if (value.public_metrics == null) return true;
  return isRecord(value.public_metrics)
    && optionalNonNegativeFinite(value.public_metrics.like_count)
    && optionalNonNegativeFinite(value.public_metrics.reply_count)
    && optionalNonNegativeFinite(value.public_metrics.repost_count)
    && optionalNonNegativeFinite(value.public_metrics.quote_count);
}

function uniqueRawXUsers(users: XUser[]) {
  const ids = new Set<string>();
  const usernames = new Set<string>();
  for (const user of users) {
    const username = user.username.toLowerCase();
    if (ids.has(user.id) || usernames.has(username)) return false;
    ids.add(user.id);
    usernames.add(username);
  }
  return true;
}

function coherentRawXUsersAcrossLists(followers: XUser[], following: XUser[]) {
  const usernameById = new Map<string, string>();
  const idByUsername = new Map<string, string>();
  for (const user of [...followers, ...following]) {
    const username = user.username.toLowerCase();
    const knownUsername = usernameById.get(user.id);
    const knownId = idByUsername.get(username);
    if ((knownUsername && knownUsername !== username) || (knownId && knownId !== user.id)) return false;
    usernameById.set(user.id, username);
    idByUsername.set(username, user.id);
  }
  return true;
}

function uniqueRawXPosts(posts: XPost[]) {
  return new Set(posts.map((post) => post.id)).size === posts.length;
}

function validListMeta(meta: unknown, dataLength: number, maxResults: number) {
  if (meta == null) return true;
  if (!isRecord(meta)) return false;
  if (meta.result_count != null
    && (typeof meta.result_count !== 'number'
      || !Number.isInteger(meta.result_count)
      || meta.result_count < 0
      || meta.result_count > maxResults
      || meta.result_count !== dataLength)) return false;
  if (meta.next_token != null && safeCursor(meta.next_token) === null) return false;
  return true;
}

function optionalNonNegativeFinite(value: unknown) {
  return value == null || nonNegativeFinite(value);
}

function validOwnedSnapshot(value: unknown) {
  if (!isRecord(value)
    || value.enabled !== true
    || value.source !== 'x'
    || !nonNegativeFinite(value.costUsd)
    || typeof value.startedAt !== 'string'
    || !validPastishIso(value.startedAt)
    || typeof value.syncedAt !== 'string'
    || !validPastishIso(value.syncedAt)
    || new Date(value.startedAt).getTime() > new Date(value.syncedAt).getTime()
    || !validOwnedUser(value.profile)
    || !Array.isArray(value.followers)
    || value.followers.length > 500
    || !value.followers.every(validOwnedUser)
    || !uniqueUsers(value.followers)
    || !Array.isArray(value.following)
    || value.following.length > 500
    || !value.following.every(validOwnedUser)
    || !uniqueUsers(value.following)
    || !coherentOwnedUsersAcrossLists(value.followers, value.following)
    || !Array.isArray(value.posts)
    || value.posts.length > 50
    || !value.posts.every(validOwnedPost)
    || !uniqueIds(value.posts)
    || !validCoverage(value.coverage)
    || !validRequested(value.requested)
    || !validPagingState(value.resumePaging)
    || !validPacing(value.pacing)
    || (value.followEvidenceDegraded != null && typeof value.followEvidenceDegraded !== 'boolean')) return false;
  if (value.followEvidence != null && !validFollowEvidence(value.followEvidence)) return false;

  const coverage = value.coverage as Record<string, unknown>;
  const followersCoverage = coverage.followers as Record<string, unknown>;
  const followingCoverage = coverage.following as Record<string, unknown>;
  const postsCoverage = coverage.posts as Record<string, unknown>;
  const requested = value.requested as Record<string, unknown>;
  return followersCoverage.fetched === value.followers.length
    && followingCoverage.fetched === value.following.length
    && postsCoverage.fetched === value.posts.length
    && (requested.followers as number) >= value.followers.length
    && (requested.following as number) >= value.following.length
    && (requested.posts as number) >= value.posts.length;
}

function validOwnedUser(value: unknown) {
  return isRecord(value)
    && typeof value.id === 'string'
    && /^\d{1,30}$/.test(value.id)
    && typeof value.username === 'string'
    && /^[A-Za-z0-9_]{1,15}$/.test(value.username)
    && typeof value.name === 'string'
    && value.name.length <= 300
    && typeof value.description === 'string'
    && value.description.length <= 5000
    && typeof value.verified === 'boolean'
    && (value.profileImageUrl == null || (typeof value.profileImageUrl === 'string' && validHttpsUrl(value.profileImageUrl)))
    && validMetrics(value.publicMetrics);
}

function validOwnedPost(value: unknown) {
  return isRecord(value)
    && typeof value.id === 'string'
    && /^\d{1,30}$/.test(value.id)
    && typeof value.text === 'string'
    && value.text.length <= 30_000
    && (value.createdAt == null || (typeof value.createdAt === 'string' && validPastishIso(value.createdAt)))
    && isRecord(value.publicMetrics)
    && nonNegativeFinite(value.publicMetrics.likes)
    && nonNegativeFinite(value.publicMetrics.replies)
    && nonNegativeFinite(value.publicMetrics.reposts)
    && nonNegativeFinite(value.publicMetrics.quotes);
}

function validCoverage(value: unknown) {
  return isRecord(value)
    && validCoverageSlice(value.followers, 500)
    && validCoverageSlice(value.following, 500)
    && isRecord(value.posts)
    && boundedNonNegativeInteger(value.posts.fetched, 50)
    && typeof value.posts.complete === 'boolean';
}

function validCoverageSlice(value: unknown, maxFetched: number) {
  return isRecord(value)
    && boundedNonNegativeInteger(value.fetched, maxFetched)
    && typeof value.complete === 'boolean'
    && (value.cycle == null || boundedNonNegativeInteger(value.cycle, MAX_PAGING_CYCLE))
    && (value.rotated == null || typeof value.rotated === 'boolean');
}

function validRequested(value: unknown) {
  return isRecord(value)
    && boundedNonNegativeInteger(value.followers, 500)
    && boundedNonNegativeInteger(value.following, 500)
    && boundedNonNegativeInteger(value.posts, 50);
}

function validPagingState(value: unknown): value is PagingState {
  return isRecord(value)
    && (value.followersCursor === null || (typeof value.followersCursor === 'string' && safeCursor(value.followersCursor) !== null))
    && (value.followingCursor === null || (typeof value.followingCursor === 'string' && safeCursor(value.followingCursor) !== null))
    && boundedNonNegativeInteger(value.followersCycle, MAX_PAGING_CYCLE)
    && boundedNonNegativeInteger(value.followingCycle, MAX_PAGING_CYCLE);
}

function pagingFromValue(value: unknown): PagingState {
  if (!validPagingState(value)) return emptyPaging();
  return {
    followersCursor: value.followersCursor,
    followingCursor: value.followingCursor,
    followersCycle: value.followersCycle,
    followingCycle: value.followingCycle,
  };
}

function pagingFromStoredRow(row: {
  followers_cursor: string | null;
  following_cursor: string | null;
  followers_cycle: number;
  following_cycle: number;
}): PagingState | null {
  const value = {
    followersCursor: row.followers_cursor,
    followingCursor: row.following_cursor,
    followersCycle: row.followers_cycle,
    followingCycle: row.following_cycle,
  };
  return validPagingState(value) ? value : null;
}

function emptyPaging(): PagingState {
  return { followersCursor: null, followingCursor: null, followersCycle: 0, followingCycle: 0 };
}

function validPacing(value: unknown) {
  return isRecord(value)
    && boundedPositiveInteger(value.daysRemaining, 31)
    && nonNegativeFinite(value.pacedCapUsd)
    && nonNegativeFinite(value.globalRemainingUsd);
}

function validFollowEvidence(value: unknown) {
  if (!isRecord(value)
    || typeof value.complete !== 'boolean'
    || !boundedNonNegativeInteger(value.cycle, MAX_PAGING_CYCLE)
    || !boundedNonNegativeInteger(value.targetCount, 500)
    || !Array.isArray(value.seenKeys)
    || !Array.isArray(value.unseenKeys)
    || !Array.isArray(value.targets)
    || value.seenKeys.length > 500
    || value.unseenKeys.length > 500
    || value.targets.length > 500
    || !value.seenKeys.every(validEvidenceKey)
    || !value.unseenKeys.every(validEvidenceKey)
    || !value.targets.every(validEvidenceTarget)) return false;
  if (!value.complete) return value.seenKeys.length === 0 && value.unseenKeys.length === 0 && value.targets.length === 0;
  const allKeys = [...value.seenKeys, ...value.unseenKeys];
  const targetKeys = value.targets.map((target) => (target as Record<string, unknown>).key as string);
  return allKeys.length === value.targetCount
    && value.targets.length === value.targetCount
    && new Set(allKeys).size === allKeys.length
    && new Set(targetKeys).size === targetKeys.length
    && targetKeys.every((key) => allKeys.includes(key));
}

function validEvidenceTarget(value: unknown) {
  return isRecord(value)
    && validEvidenceKey(value.key)
    && typeof value.username === 'string'
    && /^[A-Za-z0-9_]{1,15}$/.test(value.username)
    && (value.platformUserId === null || (typeof value.platformUserId === 'string' && /^\d{1,30}$/.test(value.platformUserId)));
}

function validEvidenceKey(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
}

function validMetrics(value: unknown) {
  return isRecord(value)
    && nonNegativeFinite(value.followers)
    && nonNegativeFinite(value.following)
    && nonNegativeFinite(value.posts)
    && (value.listed == null || nonNegativeFinite(value.listed));
}

function uniqueUsers(users: unknown[]) {
  const ids = new Set<string>();
  const usernames = new Set<string>();
  for (const user of users) {
    if (!isRecord(user) || typeof user.id !== 'string' || typeof user.username !== 'string') return false;
    const username = user.username.toLowerCase();
    if (ids.has(user.id) || usernames.has(username)) return false;
    ids.add(user.id);
    usernames.add(username);
  }
  return true;
}

function coherentOwnedUsersAcrossLists(followers: unknown[], following: unknown[]) {
  const usernameById = new Map<string, string>();
  const idByUsername = new Map<string, string>();
  for (const value of [...followers, ...following]) {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.username !== 'string') return false;
    const username = value.username.toLowerCase();
    const knownUsername = usernameById.get(value.id);
    const knownId = idByUsername.get(username);
    if ((knownUsername && knownUsername !== username) || (knownId && knownId !== value.id)) return false;
    usernameById.set(value.id, username);
    idByUsername.set(username, value.id);
  }
  return true;
}

function uniqueIds(items: unknown[]) {
  const ids = items.map((item) => isRecord(item) && typeof item.id === 'string' ? item.id : '');
  return ids.every(Boolean) && new Set(ids).size === ids.length;
}

function validHttpsUrl(value: string) {
  if (value.length > 2000) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validIso(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

function validPastishIso(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() + 5 * 60 * 1000;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function boundedNonNegativeInteger(value: unknown, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function boundedPositiveInteger(value: unknown, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;
}

function parsePositiveNumber(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? Math.floor(value!) : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeCursor(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 ? value : null;
}

function safeCycle(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_PAGING_CYCLE ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeUserId(value: string) {
  const userId = value.trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(userId)) throw new Error('invalid userId');
}
