import api from './index';
import { discoverSocialProfiles } from './discovery';

interface Env {
  DB: D1Database;
  TAVILY_API_KEY?: string;
  TAVILY_BILLING_MODE?: 'free' | 'paid';
  ALLOWED_ORIGIN?: string;
  [key: string]: unknown;
}

interface DiscoverRequest {
  userId?: string;
  mission: string;
  maxPerPlatform?: number;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname === '/api/discover/social') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
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
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    vary: 'Origin',
  };
}
