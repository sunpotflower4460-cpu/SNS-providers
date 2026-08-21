# Social Mission Worker

Server-side boundary for provider keys, ranking, D1 usage accounting and the monthly HARD LIMIT.

## Why it exists

Provider keys and future social OAuth secrets must never be shipped to the PWA bundle. The browser talks to this Worker; the Worker decides whether a free provider, paid fallback or local scoring path is allowed.

## Routes

- `GET /api/health`
- `GET /api/budget?userId=local-user`
- `POST /api/ai/rank`

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

## Budget behavior

- Groq marked `free` is preferred and recorded at $0.
- A paid provider is not called unless positive input/output rates are explicitly configured.
- A conservative preflight estimate must fit within the remaining monthly budget.
- When free providers are unavailable or a paid call is blocked, ranking falls back to local heuristic scoring instead of breaking the product.
- `DEFAULT_MONTHLY_BUDGET_USD` is a server ceiling; a client may request a lower ceiling but cannot raise the server ceiling.

Provider pricing changes over time. Update the rate variables from the provider's current official pricing before enabling paid billing.

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
