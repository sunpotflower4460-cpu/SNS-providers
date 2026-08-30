import api from './index';
import { discoverSocialProfiles } from './discovery';
import { syncInstagramEngagers, type InstagramOwnedSyncRequest } from './instagramOwned';
import { executeSocialAction } from './social/execute';
import { liveSocialCapabilities } from './social/capabilities';
import { syncXInboundMentions } from './social/x/sync';
import { reserveSyncLease, releaseSyncLease } from './syncLease';
import { completeXOAuth, disconnectXOAuth, startXOAuth, xOAuthStatus } from './xOAuth';
import { syncOwnedXData, type XOwnedSyncRequest } from './xOwned';

interface Env {
  DB: D1Database;
  TAVILY_API_KEY?: string;
  TAVILY_BILLING_MODE?: 'free' | 'paid';
  SYNC_TOKEN_SHA256?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_OAUTH_CALLBACK_URL?: string;
  PWA_RETURN_URL?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY_B64?: string;
  X_USER_READ_USD?: string;
  X_OWNED_READ_USD?: string;
  X_OWNED_READ_ELIGIBLE?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_API_VERSION?: string;
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  INSTAGRAM_COMMENT_REPLY_ENABLED?: string;
  X_REPLY_WRITE_USD?: string;
  X_FOLLOW_WRITE_USD?: string;
  X_DM_WRITE_USD?: string;
  INSTAGRAM_COMMENT_REPLY_USD?: string;
  X_INBOUND_SYNC_ENABLED?: string;
  X_INBOUND_READ_USD?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
  ALLOWED_ORIGIN?: string;
  [key: string]: unknown;
}

interface DiscoverRequest {
  userId?: string;
  mission: string;
  maxPerPlatform?: number;
  automatic?: boolean;
}

interface StateSyncRequest {
  userId?: string;
  state: unknown;
  expectedUpdatedAt?: string | null;
}

const MAX_ROUTED_BODY_BYTES = 2_100_000;
const AUTO_DISCOVERY_COOLDOWN_MS = 20 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const ROUTER_CORS_PATHS = new Set([
  '/api/budget',
  '/api/ai/rank',
  '/api/x/enrich',
  '/api/discover/social',
  '/api/sync/state',
  '/api/x/oauth/start',
  '/api/x/oauth/status',
  '/api/x/oauth/disconnect',
  '/api/x/owned/sync',
  '/api/instagram/engagers/sync',
  '/api/social/capabilities',
  '/api/x/inbound/sync',
]);

const PROVIDER_COST_PATHS = new Set([
  '/api/budget',
  '/api/ai/rank',
  '/api/x/enrich',
  '/api/discover/social',
]);

function isSocialExecutePath(pathname: string) {
  return /^\/api\/social\/actions\/[^/]+\/execute$/.test(pathname);
}

function isRoutedApiPath(pathname: string) {
  return ROUTER_CORS_PATHS.has(pathname) || isSocialExecutePath(pathname);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && isRoutedApiPath(url.pathname)) {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (isRoutedApiPath(url.pathname)) {
      const userBoundary = await enforceSingleUserRequest(request, url);
      if (!userBoundary.ok) return json({ error: userBoundary.reason }, userBoundary.status, request, env);
    }

    if (PROVIDER_COST_PATHS.has(url.pathname)) {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason }, authorized.status, request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/x/oauth/start') {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason }, authorized.status, request, env);
      try {
        const authorizeUrl = await startXOAuth(env);
        return json({ authorizeUrl }, 200, request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'X OAuth start failed';
        return json({ error: message }, 503, request, env);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/x/oauth/callback') {
      try {
        const returnTo = await completeXOAuth(env, url);
        return redirect(returnTo);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'X OAuth callback failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/x/oauth/status') {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason }, authorized.status, request, env);
      try {
        const userId = sanitizeUserId(url.searchParams.get('userId') || 'local-user');
        return json(await xOAuthStatus(env, userId), 200, request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'X OAuth status failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (request.method === 'DELETE' && url.pathname === '/api/x/oauth/disconnect') {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason }, authorized.status, request, env);
      try {
        const userId = sanitizeUserId(url.searchParams.get('userId') || 'local-user');
        return json(await disconnectXOAuth(env, userId), 200, request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'X OAuth disconnect failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/x/owned/sync') {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason }, authorized.status, request, env);
      try {
        const body = (await request.json<XOwnedSyncRequest>()) || {};
        const userId = sanitizeUserId(body.userId || 'local-user');
        const leaseResult = await reserveSyncLease(env.DB, userId, 'x_owned_sync', 3 * 60 * 1000);
        if (!leaseResult.ok) {
          return json({ enabled: false, source: 'disabled', costUsd: 0, reason: leaseResult.reason }, 200, request, env);
        }
        try {
          const result = await syncOwnedXData(env, body);
          return json(result, 200, request, env);
        } finally {
          await releaseSyncLease(env.DB, leaseResult.lease);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Owned X sync failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/engagers/sync') {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason }, authorized.status, request, env);
      try {
        const body = (await request.json<InstagramOwnedSyncRequest>()) || {};
        const userId = sanitizeUserId(body.userId || 'local-user');
        const leaseResult = await reserveSyncLease(env.DB, userId, 'instagram_owned_sync', 5 * 60 * 1000);
        if (!leaseResult.ok) {
          return json({ enabled: false, source: 'disabled', externalCostUsd: 0, engagers: [], reason: leaseResult.reason }, 200, request, env);
        }
        try {
          const result = await syncInstagramEngagers(env, body);
          return json(result, 200, request, env);
        } finally {
          await releaseSyncLease(env.DB, leaseResult.lease);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Instagram engager sync failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/social/capabilities') {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason, code: 'UNAUTHENTICATED' }, authorized.status, request, env);
      try {
        const userId = sanitizeUserId(url.searchParams.get('userId') || 'local-user');
        const status = await xOAuthStatus(env, userId);
        return json(liveSocialCapabilities(env, status.scopes || []), 200, request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Social capability lookup failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/x/inbound/sync') {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason }, authorized.status, request, env);
      try {
        const body = await request.json<{ userId?: string; monthlyLimitUsd?: number; maxResults?: number }>();
        const userId = sanitizeUserId(body?.userId || 'local-user');
        const leaseResult = await reserveSyncLease(env.DB, userId, 'x_inbound_sync', 3 * 60 * 1000);
        if (!leaseResult.ok) {
          return json({ enabled: false, source: 'disabled', costUsd: 0, events: [], reason: leaseResult.reason }, 200, request, env);
        }
        try {
          return json(await syncXInboundMentions(env, body || {}), 200, request, env);
        } finally {
          await releaseSyncLease(env.DB, leaseResult.lease);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'X inbound sync failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (url.pathname === '/api/sync/state') {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason }, authorized.status, request, env);

      if (request.method === 'GET') {
        try {
          const userId = sanitizeUserId(url.searchParams.get('userId') || 'local-user');
          const row = await env.DB.prepare('SELECT state_json, updated_at FROM state_snapshots WHERE user_id = ?')
            .bind(userId)
            .first<{ state_json: string; updated_at: string }>();
          if (!row) return json({ found: false, state: null, updatedAt: null }, 200, request, env);
          if (!validPastishIso(row.updated_at)) throw new Error('Stored state version is invalid or too far in the future');
          return json({ found: true, state: JSON.parse(row.state_json), updatedAt: row.updated_at }, 200, request, env);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'State download failed';
          return json({ error: message }, 400, request, env);
        }
      }

      if (request.method === 'PUT') {
        try {
          const body = await request.json<StateSyncRequest>();
          const userId = sanitizeUserId(body.userId || 'local-user');
          if (!body || !body.state || typeof body.state !== 'object') return json({ error: 'state is required' }, 400, request, env);
          if (!Object.prototype.hasOwnProperty.call(body, 'expectedUpdatedAt')) {
            return json({ error: '同期前提バージョンがありません。先にD1から最新状態を確認してください。' }, 428, request, env);
          }
          if (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string') {
            return json({ error: 'expectedUpdatedAt must be a string or null' }, 400, request, env);
          }
          if (typeof body.expectedUpdatedAt === 'string' && !validPastishIso(body.expectedUpdatedAt)) {
            return json({ error: 'expectedUpdatedAt must be a valid ISO timestamp and not too far in the future' }, 400, request, env);
          }

          const stateJson = JSON.stringify(body.state);
          if (new TextEncoder().encode(stateJson).byteLength > 2_000_000) return json({ error: 'state snapshot is too large' }, 413, request, env);
          const updatedAt = nextSnapshotVersion(body.expectedUpdatedAt);

          if (body.expectedUpdatedAt === null) {
            const inserted = await env.DB.prepare(
              'INSERT OR IGNORE INTO state_snapshots (user_id, state_json, updated_at) VALUES (?, ?, ?)'
            ).bind(userId, stateJson, updatedAt).run();
            if (inserted.meta.changes === 0) {
              return json({ error: 'D1には既存データがあります。上書き事故を防ぐため、先に「D1 → この端末」で最新版を確認してください。' }, 409, request, env);
            }
          } else {
            const updated = await env.DB.prepare(
              'UPDATE state_snapshots SET state_json = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?'
            ).bind(stateJson, updatedAt, userId, body.expectedUpdatedAt).run();
            if (updated.meta.changes === 0) {
              return json({ error: '別端末でD1データが更新されています。上書き事故を防ぐため、先に「D1 → この端末」で最新版を確認してください。' }, 409, request, env);
            }
          }

          return json({ ok: true, updatedAt }, 200, request, env);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'State upload failed';
          return json({ error: message }, 400, request, env);
        }
      }

      return json({ error: 'Method not allowed' }, 405, request, env);
    }

    if (request.method === 'POST' && /\/api\/social\/actions\/(?:bulk|batch|execute-all)/.test(url.pathname)) {
      return json({ error: 'Bulk social writes are not permitted.', code: 'INVALID_ACTION' }, 400, request, env);
    }

    if (request.method === 'POST' && isSocialExecutePath(url.pathname)) {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason, code: 'UNAUTHENTICATED' }, authorized.status, request, env);
      try {
        const body = await request.json<unknown>();
        const actionId = decodeURIComponent(url.pathname.split('/')[4] || '').trim();
        if (!actionId) return json({ ok: false, code: 'INVALID_ACTION', reason: 'actionId is required.' }, 400, request, env);
        const userId = sanitizeUserId((isRecord(body) && typeof body.userId === 'string' ? body.userId : 'local-user') || 'local-user');
        const result = await executeSocialAction(env, userId, actionId, body);
        return json(result.body, result.status, request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Social action execute failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/discover/social') {
      let automaticGuardId: string | null = null;
      try {
        const body = await request.json<DiscoverRequest>();
        if (!body || typeof body.mission !== 'string' || !body.mission.trim()) {
          return json({ error: 'mission is required' }, 400, request, env);
        }
        if (body.mission.length > 4000) return json({ error: 'mission is too long' }, 400, request, env);
        if (body.automatic != null && typeof body.automatic !== 'boolean') {
          return json({ error: 'automatic must be boolean' }, 400, request, env);
        }
        const userId = sanitizeUserId(body.userId || 'local-user');
        if (body.automatic) {
          const guard = await reserveAutomaticDiscovery(env, userId);
          if (!guard.ok) {
            return json({
              enabled: false,
              provider: 'tavily',
              costUsd: 0,
              credits: 0,
              profiles: [],
              reason: guard.reason,
              ...(guard.retryAfterSeconds ? { retryAfterSeconds: guard.retryAfterSeconds } : {}),
            }, 200, request, env);
          }
          automaticGuardId = guard.id;
        }

        const maxPerPlatform = Math.max(1, Math.min(20, Number(body.maxPerPlatform || 12)));
        const result = await discoverSocialProfiles(body.mission, env, maxPerPlatform);
        if (!result.enabled && automaticGuardId) {
          await releaseAutomaticDiscovery(env, automaticGuardId);
          automaticGuardId = null;
        }
        if (result.enabled && result.credits > 0) {
          await recordFreeSearchUsage(env, userId, result.credits);
        }
        return json(result, 200, request, env);
      } catch (error) {
        if (automaticGuardId) await releaseAutomaticDiscovery(env, automaticGuardId);
        const message = error instanceof Error ? error.message : 'Discovery failed';
        return json({ error: message }, 400, request, env);
      }
    }

    return (api as { fetch(request: Request, env: unknown): Promise<Response> }).fetch(request, env);
  },
};

async function enforceSingleUserRequest(request: Request, url: URL) {
  const queryUserId = url.searchParams.get('userId');
  if (queryUserId !== null && queryUserId.trim() !== 'local-user') {
    return { ok: false as const, status: 400, reason: 'This deployment only supports userId=local-user.' };
  }

  if (request.method === 'POST' || request.method === 'PUT') {
    const declaredLength = Number(request.headers.get('content-length') || '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ROUTED_BODY_BYTES) {
      return { ok: false as const, status: 413, reason: 'Request body is too large.' };
    }

    let rawBody = '';
    try {
      rawBody = await request.clone().text();
    } catch {
      return { ok: false as const, status: 400, reason: 'Request body could not be read.' };
    }
    if (new TextEncoder().encode(rawBody).byteLength > MAX_ROUTED_BODY_BYTES) {
      return { ok: false as const, status: 413, reason: 'Request body is too large.' };
    }

    if (rawBody.trim()) {
      let body: { userId?: unknown };
      try {
        body = JSON.parse(rawBody) as { userId?: unknown };
      } catch {
        return { ok: false as const, status: 400, reason: 'Request body must be valid JSON.' };
      }
      if (Object.prototype.hasOwnProperty.call(body, 'userId') && body.userId != null) {
        if (typeof body.userId !== 'string' || body.userId.trim() !== 'local-user') {
          return { ok: false as const, status: 400, reason: 'This deployment only supports userId=local-user.' };
        }
      }
    }
  }

  return { ok: true as const, status: 200, reason: '' };
}

async function authorizeSync(request: Request, env: Env) {
  const expected = (env.SYNC_TOKEN_SHA256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return { ok: false as const, status: 503, reason: 'Personal control token is not configured.' };
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || token.length > 512) return { ok: false as const, status: 401, reason: 'Personal control authorization required.' };
  const actual = await sha256Hex(token);
  if (!constantTimeEqual(actual, expected)) return { ok: false as const, status: 401, reason: 'Invalid personal control authorization.' };
  return { ok: true as const, status: 200, reason: '' };
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function sanitizeUserId(value: string) {
  const userId = value.trim();
  if (userId !== 'local-user') throw new Error('unsupported userId');
  return userId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validPastishIso(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() + MAX_CLOCK_SKEW_MS;
}

function nextSnapshotVersion(previous: string | null | undefined) {
  const now = Date.now();
  const previousMs = previous ? new Date(previous).getTime() : Number.NaN;
  const nextMs = Number.isFinite(previousMs) ? Math.max(now, previousMs + 1) : now;
  return new Date(nextMs).toISOString();
}

async function reserveAutomaticDiscovery(env: Env, userId: string) {
  const id = crypto.randomUUID();
  const now = new Date();
  const cutoff = new Date(now.getTime() - AUTO_DISCOVERY_COOLDOWN_MS).toISOString();
  const futureLimit = new Date(now.getTime() + MAX_CLOCK_SKEW_MS).toISOString();
  try {
    const result = await env.DB.prepare(
      `INSERT INTO budget_ledger (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at)
       SELECT ?, ?, 'tavily', 'search_auto_guard', 0, 0, 0, 0, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM budget_ledger
         WHERE user_id = ?
           AND provider = 'tavily'
           AND operation = 'search_auto_guard'
           AND occurred_at >= ?
           AND occurred_at <= ?
       )`
    ).bind(id, userId, now.toISOString(), userId, cutoff, futureLimit).run();
    if (result.meta.changes > 0) return { ok: true as const, id };

    const latest = await env.DB.prepare(
      `SELECT occurred_at FROM budget_ledger
       WHERE user_id = ?
         AND provider = 'tavily'
         AND operation = 'search_auto_guard'
         AND occurred_at >= ?
         AND occurred_at <= ?
       ORDER BY occurred_at DESC LIMIT 1`
    ).bind(userId, cutoff, futureLimit).first<{ occurred_at: string }>();
    const latestMs = latest?.occurred_at ? new Date(latest.occurred_at).getTime() : Number.NaN;
    const remainingMs = Number.isFinite(latestMs)
      ? Math.max(1_000, latestMs + AUTO_DISCOVERY_COOLDOWN_MS - now.getTime())
      : AUTO_DISCOVERY_COOLDOWN_MS;
    return {
      ok: false as const,
      reason: '自動候補補充は直近20時間以内に実行済みです。必要ならDiscoverから手動探索できます。',
      retryAfterSeconds: Math.max(1, Math.min(86_400, Math.ceil(remainingMs / 1000))),
    };
  } catch {
    return {
      ok: false as const,
      reason: 'D1の自動補充ガードを確認できないため、自動探索だけ安全側で停止しました。手動探索は利用できます。',
    };
  }
}

async function releaseAutomaticDiscovery(env: Env, id: string) {
  try {
    await env.DB.prepare("DELETE FROM budget_ledger WHERE id = ? AND operation = 'search_auto_guard'").bind(id).run();
  } catch {
    // Keeping the zero-cost guard is safer than risking repeated automatic free-quota use.
  }
}

async function recordFreeSearchUsage(env: Env, userId: string, credits: number) {
  try {
    await env.DB.prepare(
      'INSERT INTO budget_ledger (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at) VALUES (?, ?, ?, ?, 0, ?, 0, 0, ?)'
    ).bind(crypto.randomUUID(), userId, 'tavily', 'search_free', credits, new Date().toISOString()).run();
  } catch {
    // Search remains usable in free mode before D1 is configured.
  }
}

function json(data: unknown, status: number, request: Request, env: Env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...corsHeaders(request, env),
    },
  });
}

function redirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('origin') || '*';
  const allowed = env.ALLOWED_ORIGIN || '*';
  return {
    'access-control-allow-origin': allowed === '*' ? '*' : allowed === origin ? origin : allowed,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    vary: 'Origin',
  };
}
