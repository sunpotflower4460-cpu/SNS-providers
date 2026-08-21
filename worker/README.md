# Social Mission Worker

Server-side boundary for provider keys, ranking, X public profile enrichment, D1 usage accounting and the monthly HARD LIMIT.

## Why it exists

Provider keys and future social OAuth secrets must never be shipped to the PWA bundle. The browser talks to this Worker; the Worker decides whether a free provider, paid fallback, paid X read or local scoring path is allowed.

## Routes

- `GET /api/health`
- `GET /api/budget?userId=local-user`
- `POST /api/ai/rank`
- `POST /api/x/enrich`

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

- Groq marked `free` is preferred and recorded at $0.
- A paid LLM provider is not called unless positive input/output rates are explicitly configured.
- X public profile enrichment is disabled unless both `X_BEARER_TOKEN` and a positive `X_USER_READ_USD` are explicitly configured.
- X enrichment preflights the worst-case returned-resource cost against the remaining monthly budget before making the request.
- A conservative LLM preflight estimate must fit within the remaining monthly budget.
- When free providers are unavailable or a paid LLM call is blocked, ranking falls back to local heuristic scoring instead of breaking the product.
- `DEFAULT_MONTHLY_BUDGET_USD` is a server ceiling; a client may request a lower ceiling but cannot raise the server ceiling.

Provider pricing changes over time. Update all paid rate variables from current official provider pricing before enabling paid billing.

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
