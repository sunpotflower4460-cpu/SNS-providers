import { readActiveMonthUsage, reserveActiveMonthBudget } from '../budgetIntegrity';
import { executionModeForAction, liveXCapabilities } from './capabilities';
import { xFollowActionId, xLikeActionId, xUnfollowActionId, X_TWEET_ID, X_USER_ID } from './ids';
import { extractXTweetId } from './x/like';
import { lookupXAuthenticatedUser, lookupXTweet, lookupXUserById, lookupXUserByUsername } from './x/lookup';
import { upsertProviderSocialAction } from './repository';
import type { CanonicalSocialAction, SocialActionType } from './types';
import { getValidXAccessToken, xOAuthStatus, type XOAuthEnv } from '../xOAuth';

export interface PrepareEnv extends XOAuthEnv {
  SOCIAL_WRITE_MODE?: string;
  SOCIAL_WRITE_ENABLED?: string;
  X_REPLY_WRITE_ENABLED?: string;
  X_FOLLOW_WRITE_ENABLED?: string;
  X_UNFOLLOW_WRITE_ENABLED?: string;
  X_LIKE_WRITE_ENABLED?: string;
  X_DM_WRITE_ENABLED?: string;
  X_USER_READ_USD?: string;
  X_LOOKUP_READ_USD?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
}

const PREPARE_TYPES = new Set(['follow', 'like', 'unfollow_review']);

export async function prepareSocialAction(env: PrepareEnv, userId: string, body: unknown) {
  const intent = parsePrepareIntent(body);
  if (!intent.ok) return { status: 400, body: intent };

  if (intent.type === 'like' && intent.clientTweetId) {
    const extracted = extractXTweetId(intent.engagementUrl || '');
    if (extracted && intent.clientTweetId !== extracted) {
      return { status: 400, body: { ok: false as const, code: 'BINDING_MISMATCH', reason: 'Client-supplied tweet IDs cannot choose the like target.' } };
    }
  }
  if (intent.type !== 'like' && intent.username && !intent.platformUserId && env.SOCIAL_WRITE_MODE !== 'test' && lookupPrice(env) == null) {
    return {
      status: 200,
      body: {
        ok: true as const,
        executionMode: 'handoff' as const,
        reason: 'Username cannot become an X write target without official immutable ID lookup.',
        action: null,
      },
    };
  }

  if (intent.platform === 'instagram' && (intent.type === 'follow' || intent.type === 'like' || intent.type === 'unfollow_review')) {
    return {
      status: 200,
      body: {
        ok: true as const,
        executionMode: 'handoff' as const,
        reason: 'Instagram does not provide a safe official management API for this write. Use HANDOFF.',
        action: null,
      },
    };
  }

  if (env.SOCIAL_WRITE_MODE === 'test') {
    const action = await persistPrepared(env, syntheticPrepared(userId, intent));
    return { status: 200, body: { ok: true as const, executionMode: action.executionMode, action } };
  }

  const price = lookupPrice(env);
  if (price == null) {
    return {
      status: 200,
      body: {
        ok: true as const,
        executionMode: 'handoff' as const,
        reason: 'X lookup price is unset. Username/tweet canonicalization fail-closes to HANDOFF.',
        action: null,
      },
    };
  }

  const usage = await readActiveMonthUsage(env.DB, userId);
  if (!usage.available) {
    return { status: 403, body: { ok: false as const, code: 'WRITE_COST_UNKNOWN', reason: 'Budget ledger is unavailable.' } };
  }
  const limit = Number(env.DEFAULT_MONTHLY_BUDGET_USD);
  const reserved = price === 0 ? true : await reserveActiveMonthBudget(env.DB, {
    id: crypto.randomUUID(),
    userId,
    provider: 'x',
    operation: 'x_lookup_read',
    amountUsd: price,
    effectiveLimit: Number.isFinite(limit) && limit >= 0 ? limit : 0,
    occurredAt: new Date().toISOString(),
  });
  if (!reserved) {
    return { status: 403, body: { ok: false as const, code: 'WRITE_COST_UNKNOWN', reason: 'Lookup was blocked by the monthly HARD LIMIT.' } };
  }

  try {
    const accessToken = await getValidXAccessToken(env, userId);
    const oauth = await xOAuthStatus(env, userId);
    const capabilities = liveXCapabilities(env, oauth.scopes || [], oauth.connected);
    if (intent.type === 'like') {
      const tweetId = extractXTweetId(intent.engagementUrl || '');
      if (!tweetId) {
        return {
          status: 200,
          body: {
            ok: true as const,
            executionMode: 'handoff' as const,
            reason: 'A canonical X tweet ID could not be extracted from the official post URL.',
            action: null,
          },
        };
      }
      if (intent.clientTweetId && intent.clientTweetId !== tweetId) {
        return { status: 400, body: { ok: false as const, code: 'BINDING_MISMATCH', reason: 'Client-supplied tweet IDs cannot choose the like target.' } };
      }
      const tweet = await lookupXTweet(accessToken, tweetId);
      if (!tweet) {
        return {
          status: 200,
          body: {
            ok: true as const,
            executionMode: 'handoff' as const,
            reason: 'Official X tweet lookup failed. Like stays HANDOFF.',
            action: null,
          },
        };
      }
      const action = await persistPrepared(env, {
        id: xLikeActionId(tweet.id),
        userId,
        platform: 'x',
        candidateId: intent.candidateId,
        type: 'like',
        status: 'ready',
        executionMode: executionModeForAction('like', capabilities),
        source: 'x_like',
        externalEventId: tweet.id,
        parentContentId: tweet.id,
        targetUrl: intent.engagementUrl || `https://x.com/i/status/${tweet.id}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        platformUserId: tweet.authorId,
        username: intent.username || undefined,
        identityConflict: false,
        retryable: true,
      });
      return { status: 200, body: { ok: true as const, executionMode: action.executionMode, action } };
    }

    const me = await lookupXAuthenticatedUser(accessToken);
    if (!me) {
      return { status: 400, body: { ok: false as const, code: 'CAPABILITY_DENIED', reason: 'Authenticated X user ID could not be resolved from the server token.' } };
    }
    let target = intent.platformUserId && X_USER_ID.test(intent.platformUserId)
      ? await lookupXUserById(accessToken, intent.platformUserId)
      : null;
    if (!target && intent.username) {
      target = await lookupXUserByUsername(accessToken, intent.username);
    }
    if (!target) {
      return {
        status: 200,
        body: {
          ok: true as const,
          executionMode: 'handoff' as const,
          reason: 'Official X user lookup could not resolve an immutable user ID from the username. Follow stays HANDOFF.',
          action: null,
        },
      };
    }
    if (intent.platformUserId && intent.platformUserId !== target.id) {
      return { status: 400, body: { ok: false as const, code: 'BINDING_MISMATCH', reason: 'Client-supplied X user ID does not match official lookup.' } };
    }
    if (target.id === me.id) {
      return { status: 400, body: { ok: false as const, code: 'INVALID_ACTION', reason: 'Cannot target the authenticated account.' } };
    }
    const follow = intent.type === 'follow';
    const action = await persistPrepared(env, {
      id: follow ? xFollowActionId(target.id) : xUnfollowActionId(target.id),
      userId,
      platform: 'x',
      candidateId: intent.candidateId,
      type: intent.type,
      status: 'ready',
      executionMode: executionModeForAction(intent.type, capabilities),
      source: follow ? 'x_follow' : 'x_unfollow',
      externalEventId: target.id,
      targetUrl: `https://x.com/${target.username}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      platformUserId: target.id,
      username: target.username,
      identityConflict: false,
      retryable: true,
    });
    return { status: 200, body: { ok: true as const, executionMode: action.executionMode, action } };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prepare failed';
    return { status: 400, body: { ok: false as const, code: 'INVALID_ACTION', reason: message } };
  }
}

function parsePrepareIntent(body: unknown): {
  ok: true;
  candidateId: string;
  type: Extract<SocialActionType, 'follow' | 'like' | 'unfollow_review'>;
  platform: 'x' | 'instagram';
  username?: string;
  platformUserId?: string;
  engagementUrl?: string;
  clientTweetId?: string;
} | { ok: false; code: 'INVALID_ACTION'; reason: string } {
  if (!isRecord(body)) return { ok: false, code: 'INVALID_ACTION', reason: 'Prepare body must be a JSON object.' };
  if (Object.prototype.hasOwnProperty.call(body, 'actions') || Array.isArray(body.action)) {
    return { ok: false, code: 'INVALID_ACTION', reason: 'Bulk social writes are not permitted.' };
  }
  const candidateId = typeof body.candidateId === 'string' ? body.candidateId.trim() : '';
  if (!candidateId || candidateId.length > 180) return { ok: false, code: 'INVALID_ACTION', reason: 'candidateId is required.' };
  if (!PREPARE_TYPES.has(String(body.type))) {
    return { ok: false, code: 'INVALID_ACTION', reason: 'Only follow, like, and unfollow_review can be prepared.' };
  }
  const platform = body.platform === 'instagram' ? 'instagram' : 'x';
  const username = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '') : undefined;
  const platformUserId = typeof body.platformUserId === 'string' ? body.platformUserId.trim() : undefined;
  const engagementUrl = typeof body.engagementUrl === 'string' ? body.engagementUrl.trim() : undefined;
  const clientTweetId = typeof body.tweetId === 'string' ? body.tweetId.trim() : undefined;
  return {
    ok: true,
    candidateId,
    type: body.type as 'follow' | 'like' | 'unfollow_review',
    platform,
    username,
    platformUserId: platformUserId && X_USER_ID.test(platformUserId) ? platformUserId : undefined,
    engagementUrl,
    clientTweetId: clientTweetId && X_TWEET_ID.test(clientTweetId) ? clientTweetId : undefined,
  };
}

async function persistPrepared(env: PrepareEnv, action: CanonicalSocialAction) {
  await upsertProviderSocialAction(env.DB, action);
  return action;
}

function syntheticPrepared(userId: string, intent: Extract<ReturnType<typeof parsePrepareIntent>, { ok: true }>): CanonicalSocialAction {
  const targetId = intent.platformUserId || '123456789';
  const tweetId = extractXTweetId(intent.engagementUrl || '') || '1234567890123456789';
  if (intent.type === 'like') {
    return {
      id: xLikeActionId(tweetId),
      userId,
      platform: 'x',
      candidateId: intent.candidateId,
      type: 'like',
      status: 'ready',
      executionMode: 'in_app',
      source: 'x_like',
      externalEventId: tweetId,
      parentContentId: tweetId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      identityConflict: false,
      retryable: true,
    };
  }
  return {
    id: intent.type === 'follow' ? xFollowActionId(targetId) : xUnfollowActionId(targetId),
    userId,
    platform: 'x',
    candidateId: intent.candidateId,
    type: intent.type,
    status: 'ready',
    executionMode: 'in_app',
    source: intent.type === 'follow' ? 'x_follow' : 'x_unfollow',
    externalEventId: targetId,
    platformUserId: targetId,
    username: intent.username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    identityConflict: false,
    retryable: true,
  };
}

function lookupPrice(env: PrepareEnv) {
  const explicit = env.X_LOOKUP_READ_USD ?? env.X_USER_READ_USD;
  if (explicit == null || String(explicit).trim() === '') return null;
  const amount = Number(explicit);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
