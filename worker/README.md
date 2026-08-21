# Social Mission Worker

Server-side boundary for provider keys, ranking, free-first social discovery, X public profile enrichment, D1 usage accounting and the monthly HARD LIMIT.

## Why it exists

Provider keys and future social OAuth secrets must never be shipped to the PWA bundle. The browser talks to this Worker; the Worker decides whether a free provider, paid fallback, paid X read or local scoring path is allowed.

## Routes

- `GET /api/health`
- `GET /api/budget?userId=local-user`
- `POST /api/discover/social`
- `POST /api/ai/rank`
- `POST /api/x/enrich`

### Free social discovery

`POST /api/discover/social` uses Tavily only when both `TAVILY_API_KEY` is configured and `TAVILY_BILLING_MODE=free`.

The initial build deliberately fails closed when Tavily is not explicitly marked free. It searches the public web for X/Instagram profile-shaped results, canonicalizes them to profile URLs, and returns candidates for later Mission ranking. It does not crawl or automate the X/Instagram DOM.

Example:

```json
{
  "userId": "local-user",
  "mission": "アーティスト活動を促進し、ファンや仲間との関係を増やす",
  "maxPerPlatform": 12
}
```

The adapter currently runs one basic search for X and one for Instagram, so a normal discovery pass consumes roughly two Tavily basic-search credits when both searches succeed. Free-search usage is recorded in D1 with cost `$0` when the ledger is available.

### Mission ranking

Example ranking body:

```json
{
  "userId": "local-user",
  "mission": "アーティスト活動を促進し、ファンや仲間との関係を増やす",
  "communicationDNA": "自然で営業臭のない会話",
  "monthlyLimitUsd": 3,
  "candidates": [
    {
      "id": "candidate-1",
      "username": "example",
      "bio": "indie music listener",
      "tags": ["music", "indie"],
      "kind": "fan"
    }
  ]
}
```

### X profile enrichment

Example X enrichment body:

```json
{
  "userId": "local-user",
  "monthlyLimitUsd": 3,
  "usernames": ["example1", "example2"]
}
```

The Worker batches up to 100 usernames through the official X User Lookup endpoint. It never scrapes X pages.

## Budget behavior

- Tavily discovery runs only when explicitly configured as `free`; paid discovery is disabled in the initial build.
- Groq marked `free` is preferred and recorded at $0.
- A paid LLM provider is not called unless positive input/output rates are explicitly configured.
- X public profile enrichment is disabled unless both `X_BEARER_TOKEN` and a positive `X_USER_READ_USD` are explicitly configured.
- X enrichment preflights the worst-case returned-resource cost against the remaining monthly budget before making the request.
- A conservative LLM preflight estimate must fit within the remaining monthly budget.
- If the D1 budget ledger is unavailable, paid LLM/X operations fail closed while free/local work can continue.
- When free providers are unavailable or a paid LLM call is blocked, ranking falls back to local heuristic scoring instead of breaking the product.
- `DEFAULT_MONTHLY_BUDGET_USD` is a server ceiling; a client may request a lower ceiling but cannot raise the server ceiling.

Provider pricing and free-tier rules change over time. Update all paid rate variables and billing-mode flags from current official provider information before enabling paid billing.

## Local setup

1. Create a Cloudflare D1 database.
2. Put its database ID in `wrangler.jsonc`.
3. Apply `../db/schema.sql` to D1.
4. Copy `.dev.vars.example` to `.dev.vars` and add only the keys you want to use.
5. Run:

```bash
npm install
npm run typecheck
npm run dev
```

For production, store secrets with Wrangler secret management rather than plaintext vars.
