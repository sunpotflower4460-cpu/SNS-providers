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
  X_BEARER_TOKEN?: string;
  X_USER_READ_USD?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
  ALLOWED_ORIGIN?: string;
}

interface CandidateInput {
  id: string;
  username: string;
  bio?: string;
  tags?: string[];
  kind?: string;
  platform?: string;
  publicMetrics?: {
    followers?: number;
    following?: number;
    posts?: number;
    listed?: number;
  };
}

interface RankRequest {
  userId?: string;
  mission: string;
  communicationDNA?: string;
  candidates: CandidateInput[];
  monthlyLimitUsd?: number;
}

interface XEnrichRequest {
  userId?: string;
  usernames: string[];
  monthlyLimitUsd?: number;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface RatePair {
  input: number;
  output: number;
}

interface XUser {
  id: string;
  name: string;
  username: string;
  description?: string;
  verified?: boolean;
  created_at?: string;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
  };
}

interface BudgetSnapshot {
  usedUsd: number;
  available: boolean;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const MAX_OUTPUT_TOKENS = 1800;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const ledger = await monthUsage(env, 'health-check');
        return json({ ok: true, service: 'social-mission-api', ledgerAvailable: ledger.available, time: new Date().toISOString() }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname === '/api/budget') {
        const userId = url.searchParams.get('userId') || 'local-user';
        const ledger = await monthUsage(env, userId);
        const limitUsd = configuredLimit(env);
        return json({
          usedUsd: ledger.usedUsd,
          limitUsd,
          remainingUsd: ledger.available ? Math.max(0, limitUsd - ledger.usedUsd) : 0,
          ledgerAvailable: ledger.available,
        }, 200, cors);
      }

      if (request.method === 'POST' && url.pathname === '/api/x/enrich') {
        const body = await request.json<XEnrichRequest>();
        const usernames = validateXEnrichRequest(body);
        const userId = body.userId || 'local-user';
        const budget = await budgetForRequest(env, userId, body.monthlyLimitUsd);
        const unitCost = parsePositiveNumber(env.X_USER_READ_USD);

        if (!env.X_BEARER_TOKEN) {
          return json({ enabled: false, costUsd: 0, profiles: [], reason: 'X_BEARER_TOKEN is not configured.' }, 200, cors);
        }
        if (!unitCost) {
          return json({ enabled: false, costUsd: 0, profiles: [], reason: 'X_USER_READ_USD is not configured; paid X reads fail closed.' }, 200, cors);
        }
        if (!budget.ledgerAvailable) {
          return json({ enabled: false, costUsd: 0, profiles: [], reason: 'Budget ledger is unavailable; paid X reads are disabled.' }, 200, cors);
        }

        const worstCaseCost = usernames.length * unitCost;
        if (worstCaseCost > budget.remainingUsd) {
          return json({ enabled: false, costUsd: 0, profiles: [], reason: `HARD LIMIT protected the budget. Need up to $${worstCaseCost.toFixed(4)}, remaining $${budget.remainingUsd.toFixed(4)}.` }, 200, cors);
        }

        const reservationId = await reserveBudget(env, userId, 'x', 'user_read_reservation', worstCaseCost, budget.effectiveLimit);
        if (!reservationId) {
          return json({ enabled: false, costUsd: 0, profiles: [], reason: 'HARD LIMIT changed before the X request could be reserved.' }, 200, cors);
        }

        try {
          const profiles = await fetchXProfiles(usernames, env.X_BEARER_TOKEN);
          const costUsd = profiles.length * unitCost;
          await finalizeReservation(env, reservationId, 'user_read', costUsd, { prompt_tokens: profiles.length });
          return json({ enabled: true, costUsd, profiles }, 200, cors);
        } catch (error) {
          await cancelReservation(env, reservationId);
          throw error;
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/ai/rank') {
        const body = await request.json<RankRequest>();
        validateRankRequest(body);
        const userId = body.userId || 'local-user';
        const budget = await budgetForRequest(env, userId, body.monthlyLimitUsd);

        if (env.GROQ_API_KEY) {
          const paid = env.GROQ_BILLING_MODE === 'paid';
          if (!paid) {
            try {
              const result = await rankWithProvider('groq', body, env);
              await recordFreeUsage(env, userId, 'groq', 'rank_free', result.usage);
              return json({ provider: 'groq', paid: false, costUsd: 0, results: result.results }, 200, cors);
            } catch {
              // Continue to the next provider or local scoring.
            }
          } else if (budget.ledgerAvailable) {
            const rates = parseRates(env.GROQ_INPUT_PER_MILLION, env.GROQ_OUTPUT_PER_MILLION);
            const preflight = rates ? estimateMaxCost(body, rates) : Number.POSITIVE_INFINITY;
            if (rates && preflight <= budget.remainingUsd) {
              const result = await runPaidRankingWithReservation('groq', body, env, userId, rates, preflight, budget.effectiveLimit);
              if (result) return json({ provider: 'groq', paid: true, costUsd: result.costUsd, results: result.results }, 200, cors);
            }
          }
        }

        if (env.DEEPSEEK_API_KEY && budget.ledgerAvailable && budget.remainingUsd > 0) {
          const rates = parseRates(env.DEEPSEEK_INPUT_PER_MILLION, env.DEEPSEEK_OUTPUT_PER_MILLION);
          const preflight = rates ? estimateMaxCost(body, rates) : Number.POSITIVE_INFINITY;
          if (rates && preflight <= budget.remainingUsd) {
            const result = await runPaidRankingWithReservation('deepseek', body, env, userId, rates, preflight, budget.effectiveLimit);
            if (result) return json({ provider: 'deepseek', paid: true, costUsd: result.costUsd, results: result.results }, 200, cors);
          }
        }

        const results = localRank(body.mission, body.candidates);
        const reason = budget.ledgerAvailable
          ? 'Free providers unavailable, paid rates are not configured, or HARD LIMIT protected the budget.'
          : 'Free providers unavailable and the budget ledger is unavailable, so all paid providers were blocked.';
        return json({ provider: 'local', paid: false, costUsd: 0, reason, results }, 200, cors);
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
    vary: 'Origin',
  };
}

function json(data: unknown, status: number, extra: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...extra } });
}

function configuredLimit(env: Env) {
  const parsed = Number(env.DEFAULT_MONTHLY_BUDGET_USD || '3');
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 3;
}

async function budgetForRequest(env: Env, userId: string, requestedLimitUsd?: number) {
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

function validateRankRequest(body: RankRequest) {
  if (!body || typeof body.mission !== 'string' || !body.mission.trim()) throw new Error('mission is required');
  if (body.mission.length > 4000) throw new Error('mission is too long');
  if ((body.communicationDNA || '').length > 4000) throw new Error('communicationDNA is too long');
  if (!Array.isArray(body.candidates) || body.candidates.length === 0) throw new Error('candidates are required');
  if (body.candidates.length > 50) throw new Error('rank accepts at most 50 candidates per batch');
  if (JSON.stringify(body).length > 60_000) throw new Error('rank request is too large');
}

function validateXEnrichRequest(body: XEnrichRequest) {
  if (!body || !Array.isArray(body.usernames) || body.usernames.length === 0) throw new Error('usernames are required');
  if (body.usernames.length > 100) throw new Error('X enrichment accepts at most 100 usernames per batch');
  const usernames = [...new Set(body.usernames.map(sanitizeXUsername).filter(Boolean))];
  if (!usernames.length) throw new Error('no valid usernames');
  return usernames;
}

function sanitizeXUsername(value: string) {
  return value.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15);
}

async function fetchXProfiles(usernames: string[], bearerToken: string) {
  const params = new URLSearchParams({
    usernames: usernames.join(','),
    'user.fields': 'created_at,description,public_metrics,verified',
  });
  const response = await fetch(`https://api.x.com/2/users/by?${params.toString()}`, {
    headers: { authorization: `Bearer ${bearerToken}` },
  });
  if (!response.ok) throw new Error(`X API returned ${response.status}`);
  const data = await response.json<{ data?: XUser[]; errors?: unknown[] }>();
  return (data.data || []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    username: profile.username,
    description: profile.description || '',
    verified: Boolean(profile.verified),
    createdAt: profile.created_at || null,
    publicMetrics: {
      followers: profile.public_metrics?.followers_count || 0,
      following: profile.public_metrics?.following_count || 0,
      posts: profile.public_metrics?.tweet_count || 0,
      listed: profile.public_metrics?.listed_count || 0,
    },
  }));
}

async function monthUsage(env: Env, userId: string): Promise<BudgetSnapshot> {
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

async function reserveBudget(env: Env, userId: string, provider: string, operation: string, amountUsd: number, effectiveLimit: number) {
  if (amountUsd <= 0) return null;
  const id = crypto.randomUUID();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const now = new Date().toISOString();
  try {
    const result = await env.DB.prepare(
      `INSERT INTO budget_ledger (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at)
       SELECT ?, ?, ?, ?, ?, 0, 0, 0, ?
       WHERE COALESCE((SELECT SUM(cost_usd) FROM budget_ledger WHERE user_id = ? AND occurred_at >= ?), 0) + ? <= ?`
    ).bind(id, userId, provider, operation, amountUsd, now, userId, start.toISOString(), amountUsd, effectiveLimit).run();
    return result.meta.changes > 0 ? id : null;
  } catch {
    return null;
  }
}

async function finalizeReservation(env: Env, reservationId: string, operation: string, actualCostUsd: number, usage?: Usage) {
  await env.DB.prepare(
    'UPDATE budget_ledger SET operation = ?, cost_usd = ?, input_units = ?, output_units = ? WHERE id = ?'
  ).bind(operation, actualCostUsd, usage?.prompt_tokens || 0, usage?.completion_tokens || 0, reservationId).run();
}

async function cancelReservation(env: Env, reservationId: string) {
  try {
    await env.DB.prepare('DELETE FROM budget_ledger WHERE id = ?').bind(reservationId).run();
  } catch {
    // Keeping an unfinalized reservation over-counts spend, which is safer than under-counting it.
  }
}

async function recordFreeUsage(env: Env, userId: string, provider: string, operation: string, usage?: Usage) {
  try {
    await env.DB.prepare(
      'INSERT INTO budget_ledger (id, user_id, provider, operation, cost_usd, input_units, output_units, cache_hit, occurred_at) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?)'
    ).bind(crypto.randomUUID(), userId, provider, operation, usage?.prompt_tokens || 0, usage?.completion_tokens || 0, new Date().toISOString()).run();
  } catch {
    // Free work remains available even before D1 is configured.
  }
}

function parsePositiveNumber(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseRates(inputRate?: string, outputRate?: string): RatePair | null {
  const input = Number(inputRate);
  const output = Number(outputRate);
  if (!Number.isFinite(input) || input <= 0 || !Number.isFinite(output) || output <= 0) return null;
  return { input, output };
}

function estimateMaxCost(body: RankRequest, rates: RatePair) {
  // Deliberately conservative. We prefer falling back to free/local work over risking the hard cap.
  const estimatedInputTokens = JSON.stringify(body).length * 2 + 1500;
  return (estimatedInputTokens / 1_000_000) * rates.input + (MAX_OUTPUT_TOKENS / 1_000_000) * rates.output;
}

function calculateCost(usage: Usage | undefined, rates: RatePair) {
  if (!usage) return estimateUnknownUsageCost(rates);
  return ((usage.prompt_tokens || 0) / 1_000_000) * rates.input + ((usage.completion_tokens || 0) / 1_000_000) * rates.output;
}

function estimateUnknownUsageCost(rates: RatePair) {
  return (5000 / 1_000_000) * rates.input + (MAX_OUTPUT_TOKENS / 1_000_000) * rates.output;
}

async function runPaidRankingWithReservation(
  provider: 'groq' | 'deepseek',
  body: RankRequest,
  env: Env,
  userId: string,
  rates: RatePair,
  preflightUsd: number,
  effectiveLimit: number,
) {
  const reservationId = await reserveBudget(env, userId, provider, 'rank_reservation', preflightUsd, effectiveLimit);
  if (!reservationId) return null;
  try {
    const result = await rankWithProvider(provider, body, env);
    const costUsd = calculateCost(result.usage, rates);
    await finalizeReservation(env, reservationId, 'rank', costUsd, result.usage);
    return { ...result, costUsd };
  } catch {
    await cancelReservation(env, reservationId);
    return null;
  }
}

async function rankWithProvider(provider: 'groq' | 'deepseek', body: RankRequest, env: Env) {
  const isGroq = provider === 'groq';
  const baseUrl = isGroq ? 'https://api.groq.com/openai/v1' : (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
  const apiKey = isGroq ? env.GROQ_API_KEY! : env.DEEPSEEK_API_KEY!;
  const model = isGroq ? (env.GROQ_MODEL || 'openai/gpt-oss-20b') : (env.DEEPSEEK_MODEL || 'deepseek-chat');
  const hasSelfProfile = body.candidates.some((candidate) => candidate.kind === 'self_profile');
  const prompt = {
    mission: body.mission,
    communication_dna: body.communicationDNA || '',
    candidates: body.candidates,
    instruction: hasSelfProfile
      ? [
          'The candidate with kind self_profile is the user own social account, not a networking target.',
          'Evaluate how well the supplied profile and recent posts support the Mission. match is a 0-100 Mission alignment score.',
          'reason is a concise Japanese diagnosis grounded only in supplied text.',
          'strategy is a practical Japanese improvement plan covering profile, content mix, audience/network, and the highest-leverage next change.',
          'draft is an improved profile/bio proposal in Japanese. Do not invent achievements, numbers, links, credentials, or facts.',
          'recommendedAction must be review.',
        ].join(' ')
      : [
          'Rank candidates for genuine long-term relationship value, not raw follow-back probability.',
          'Choose the best current action from follow, like, reply, dm, review, or unfollow_review.',
          'Explain the strategic reason briefly in Japanese.',
          'For at most the five highest-value candidates where reply or dm is genuinely appropriate, include a short natural Japanese draft that follows communication_dna.',
          'Never use generic template praise, never invent facts or post content that is not in the supplied data, and omit draft when context is insufficient.',
          'strategy should explain what relationship step to take now and why.',
          'Do not recommend automated final social actions.',
        ].join(' '),
  };

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: hasSelfProfile ? 0.25 : 0.35,
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a social relationship and account-growth strategist. Output JSON only: {"results":[{"id":string,"match":0-100,"kind":string,"recommendedAction":string,"reason":string,"strategy":string,"draft"?:string}]}. Use only supplied facts. Never recommend automated social actions, spam, or follow-churn tactics.'
        },
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
    const isSelf = candidate.kind === 'self_profile';
    return {
      id: candidate.id,
      match,
      kind: candidate.kind || 'other',
      recommendedAction: 'review',
      reason: isSelf
        ? '無料ローカル判定ではプロフィール内容の共通語のみを確認しました。深い改善提案には無料LLMの設定が推奨です。'
        : overlap > 0 ? 'Missionと共通する語やテーマがあるため、確認候補として残しました。' : '無料ローカル判定では確信度が低いため、人間の確認を優先します。',
      strategy: isSelf
        ? 'Missionが初見で伝わるか、作品への導線、最近の投稿テーマの偏りを本人が確認してください。'
        : 'プロフィールや投稿内容を本人が確認してから、自然な交流方法を決めます。',
    };
  }).sort((a, b) => b.match - a.match);
}

function tokenize(value: string) {
  return [...new Set(value.toLowerCase().split(/[\s、。,.!！?？/|#:_-]+/).map((part) => part.trim()).filter((part) => part.length >= 2))];
}
