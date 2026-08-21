interface Env {
  DB: D1Database;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  GROQ_BILLING_MODE?: 'free' | 'paid';
  GROQ_INPUT_PER_MILLION?: string;
  GROQ_OUTPUT_PER_MILLION?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_INPUT_PER_MILLION?: string;
  DEEPSEEK_OUTPUT_PER_MILLION?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
  ALLOWED_ORIGIN?: string;
}

interface CandidateInput {
  id: string;
  username: string;
  bio?: string;
  tags?: string[];
  kind?: string;
}

interface RankRequest {
  userId?: string;
  mission: string;
  communicationDNA?: string;
  candidates: CandidateInput[];
  monthlyLimitUsd?: number;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json({ ok: true, service: 'social-mission-api', time: new Date().toISOString() }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname === '/api/budget') {
        const userId = url.searchParams.get('userId') || 'local-user';
        const usedUsd = await monthUsage(env, userId);
        const limitUsd = configuredLimit(env);
        return json({ usedUsd, limitUsd, remainingUsd: Math.max(0, limitUsd - usedUsd) }, 200, cors);
      }

      if (request.method === 'POST' && url.pathname === '/api/ai/rank') {
        const body = await request.json<RankRequest>();
        validateRankRequest(body);
        const userId = body.userId || 'local-user';
        const serverLimit = configuredLimit(env);
        const requestedLimit = Number.isFinite(body.monthlyLimitUsd) ? Math.max(0, body.monthlyLimitUsd!) : serverLimit;
        const effectiveLimit = Math.min(serverLimit, requestedLimit);
        const usedUsd = await monthUsage(env, userId);
        const remainingUsd = Math.max(0, effectiveLimit - usedUsd);

        if (env.GROQ_API_KEY) {
          const result = await rankWithProvider('groq', body, env);
          const costUsd = env.GROQ_BILLING_MODE === 'paid'
            ? calculateCost(result.usage, env.GROQ_INPUT_PER_MILLION, env.GROQ_OUTPUT_PER_MILLION)
            : 0;
          if (costUsd <= remainingUsd) {
            await recordUsage(env, userId, 'groq', 'rank', costUsd, result.usage);
            return json({ provider: 'groq', paid: costUsd > 0, costUsd, results: result.results }, 200, cors);
          }
        }

        if (env.DEEPSEEK_API_KEY && remainingUsd > 0) {
          const estimatedUsd = 0.02;
          if (estimatedUsd <= remainingUsd) {
            const result = await rankWithProvider('deepseek', body, env);
            const costUsd = calculateCost(result.usage, env.DEEPSEEK_INPUT_PER_MILLION, env.DEEPSEEK_OUTPUT_PER_MILLION);
            if (costUsd <= remainingUsd) {
              await recordUsage(env, userId, 'deepseek', 'rank', costUsd, result.usage);
              return json({ provider: 'deepseek', paid: costUsd > 0, costUsd, results: result.results }, 200, cors);
            }
          }
        }

        const results = localRank(body.mission, body.candidates);
        return json({ provider: 'local', paid: false, costUsd: 0, reason: 'Free providers unavailable or HARD LIMIT protected the budget.', results }, 200, cors);
      }

      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return json({ error: message }, 400, cors);
    }
  },
};

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('origin') || '*';
  const allowed = env.ALLOWED_ORIGIN || '*';
  return {
    'access-control-allow-origin': allowed === '*' ? '*' : allowed === origin ? origin : allowed,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'vary': 'Origin',
  };
}

function json(data: unknown, status: number, extra: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...extra } });
}

function configuredLimit(env: Env) {
  const parsed = Number(env.DEFAULT_MONTHLY_BUDGET_USD || '3');
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 3;
}

function validateRankRequest(body: RankRequest) {
  if (!body || typeof body.mission !== 'string' || !body.mission.trim()) throw new Error('mission is required');
  if (!Array.isArray(body.candidates) || body.candidates.length === 0) throw new Error('candidates are required');
  if (body.candidates.length > 50) throw new Error('rank accepts at most 50 candidates per batch');
}

async function monthUsage(env: Env, userId: string) {
  try {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const row = await env.DB.prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) AS used FROM budget_ledger WHERE user_id = ? AND occurred_at >= ?'
    ).bind(userId, start.toISOString()).first<{ used: number }>();
    return Number(row?.used || 0);
  } catch {
    return 0;
  }
}

async function recordUsage(env: Env, userId: string, provider: string, operation: string, costUsd: number, usage?: Usage) {
  try {
    await env.DB.prepare(
      'INSERT INTO budget_ledger (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
    ).bind(
      crypto.randomUUID(), userId, provider, operation, costUsd,
      usage?.prompt_tokens || 0, usage?.completion_tokens || 0, new Date().toISOString()
    ).run();
  } catch {
    // The PWA remains usable before D1 migrations are applied; deployment diagnostics should surface this separately.
  }
}

function calculateCost(usage: Usage | undefined, inputRate?: string, outputRate?: string) {
  if (!usage) return 0;
  const input = Number(inputRate || 0);
  const output = Number(outputRate || 0);
  return ((usage.prompt_tokens || 0) / 1_000_000) * input + ((usage.completion_tokens || 0) / 1_000_000) * output;
}

async function rankWithProvider(provider: 'groq' | 'deepseek', body: RankRequest, env: Env) {
  const isGroq = provider === 'groq';
  const baseUrl = isGroq ? 'https://api.groq.com/openai/v1' : (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
  const apiKey = isGroq ? env.GROQ_API_KEY! : env.DEEPSEEK_API_KEY!;
  const model = isGroq ? (env.GROQ_MODEL || 'openai/gpt-oss-20b') : (env.DEEPSEEK_MODEL || 'deepseek-chat');
  const prompt = {
    mission: body.mission,
    communication_dna: body.communicationDNA || '',
    candidates: body.candidates,
    instruction: 'Rank candidates for genuine long-term relationship value. Avoid follower-churn logic. Return concise Japanese reasons.',
  };

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a social relationship strategist. Output JSON only: {"results":[{"id":string,"match":0-100,"kind":string,"recommendedAction":string,"reason":string}]}. Never recommend automated social actions.' },
        { role: 'user', content: JSON.stringify(prompt) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`${provider} returned ${response.status}`);
  const data = await response.json<{ choices?: Array<{ message?: { content?: string } }>; usage?: Usage }>();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider} returned no content`);
  const parsed = JSON.parse(content) as { results?: unknown[] };
  if (!Array.isArray(parsed.results)) throw new Error(`${provider} returned invalid ranking JSON`);
  return { results: parsed.results, usage: data.usage };
}

function localRank(mission: string, candidates: CandidateInput[]) {
  const missionTerms = tokenize(mission);
  return candidates.map((candidate) => {
    const text = `${candidate.bio || ''} ${(candidate.tags || []).join(' ')} ${candidate.kind || ''}`;
    const terms = tokenize(text);
    const overlap = terms.filter((term) => missionTerms.includes(term)).length;
    const match = Math.min(82, 42 + overlap * 8 + Math.min((candidate.tags || []).length * 2, 8));
    return {
      id: candidate.id,
      match,
      kind: candidate.kind || 'other',
      recommendedAction: 'review',
      reason: overlap > 0 ? 'Missionと共通する語やテーマがあるため、確認候補として残しました。' : '無料ローカル判定では確信度が低いため、人間の確認を優先します。',
    };
  }).sort((a, b) => b.match - a.match);
}

function tokenize(value: string) {
  return [...new Set(value.toLowerCase().split(/[\s、。,.!！?？/|#:_-]+/).map((part) => part.trim()).filter((part) => part.length >= 2))];
}
