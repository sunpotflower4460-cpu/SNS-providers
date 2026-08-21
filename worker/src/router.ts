import api from './index';
import { discoverSocialProfiles } from './discovery';
import { syncInstagramEngagers, type InstagramOwnedSyncRequest } from './instagramOwned';
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
  DEFAULT_MONTHLY_BUDGET_USD?: string;
  ALLOWED_ORIGIN?: string;
  [key: string]: unknown;
}

interface DiscoverRequest {
  userId?: string;
  mission: string;
  maxPerPlatform?: number;
}

interface StateSyncRequest {
  userId?: string;
  state: unknown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && [
      '/api/discover/social',
      '/api/sync/state',
      '/api/x/oauth/start',
      '/api/x/oauth/status',
      '/api/x/oauth/disconnect',
      '/api/x/owned/sync',
      '/api/instagram/engagers/sync',
    ].includes(url.pathname)) {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
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
        return Response.redirect(returnTo, 302);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'X OAuth callback failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/x/oauth/status') {
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
        const body = await request.json<XOwnedSyncRequest>();
        const result = await syncOwnedXData(env, body || {});
        return json(result, 200, request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Owned X sync failed';
        return json({ error: message }, 400, request, env);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/instagram/engagers/sync') {
      const authorized = await authorizeSync(request, env);
      if (!authorized.ok) return json({ error: authorized.reason }, authorized.status, request, env);
      try {
        const body = await request.json<InstagramOwnedSyncRequest>();
        const result = await syncInstagramEngagers(env, body || {});
        return json(result, 200, request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Instagram engager sync failed';
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
          const stateJson = JSON.stringify(body.state);
          if (stateJson.length > 2_000_000) return json({ error: 'state snapshot is too large' }, 413, request, env);
          const updatedAt = new Date().toISOString();
          await env.DB.prepare(
            `INSERT INTO state_snapshots (user_id, state_json, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
          ).bind(userId, stateJson, updatedAt).run();
          return json({ ok: true, updatedAt }, 200, request, env);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'State upload failed';
          return json({ error: message }, 400, request, env);
        }
      }

      return json({ error: 'Method not allowed' }, 405, request, env);
    }

    if (request.method === 'POST' && url.pathname === '/api/discover/social') {
      try {
        const body = await request.json<DiscoverRequest>();
        if (!body || typeof body.mission !== 'string' || !body.mission.trim()) {
          return json({ error: 'mission is required' }, 400, request, env);
        }
        if (body.mission.length > 4000) return json({ error: 'mission is too long' }, 400, request, env);
        const maxPerPlatform = Math.max(1, Math.min(20, Number(body.maxPerPlatform || 12)));
        const result = await discoverSocialProfiles(body.mission, env, maxPerPlatform);
        if (result.enabled && result.credits > 0) {
          await recordFreeSearchUsage(env, body.userId || 'local-user', result.credits);
        }
        return json(result, 200, request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Discovery failed';
        return json({ error: message }, 400, request, env);
      }
    }

    return (api as { fetch(request: Request, env: unknown): Promise<Response> }).fetch(request, env);
  },
};

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
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(userId)) throw new Error('invalid userId');
  return userId;
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
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
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
