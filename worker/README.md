# Social Mission Worker

Server-side boundary for provider keys, ranking, free-first social discovery, personal state sync, read-only X OAuth/data sync, D1 usage accounting and the monthly HARD LIMIT.

## Why it exists

Provider keys and X OAuth tokens must never be shipped to the PWA bundle. The browser talks to this Worker; the Worker decides whether a free provider, paid fallback, paid X read or local scoring path is allowed.

## Routes

- `GET /api/health`
- `GET /api/budget?userId=local-user`
- `POST /api/discover/social`
- `POST /api/ai/rank`
- `POST /api/x/enrich`
- `POST /api/x/oauth/start` — personal-control Bearer token required
- `GET /api/x/oauth/callback` — X redirect, validated by one-time PKCE state
- `GET /api/x/oauth/status?userId=local-user`
- `DELETE /api/x/oauth/disconnect?userId=local-user` — personal-control Bearer token required
- `POST /api/x/owned/sync` — personal-control Bearer token required
- `GET /api/sync/state?userId=local-user` — personal-control Bearer token required
- `PUT /api/sync/state` — personal-control Bearer token required

## Personal control key and D1 state sync

Personal controls are disabled unless `SYNC_TOKEN_SHA256` contains the SHA-256 hex of a user-chosen secret. The raw secret is entered on the user's device at runtime and is sent only as a Bearer token to the Worker; it is not committed to the repository or included in the PWA backup JSON.

The same personal key protects:

- D1 state upload/download
- starting X OAuth
- disconnecting X OAuth
- reading the connected account's owned X data

Generate the Worker-side hash, for example:

```bash
printf '%s' 'replace-with-a-long-random-secret' | shasum -a 256
```

Store that 64-character hash as `SYNC_TOKEN_SHA256`. Enter the original unhashed secret in the PWA Settings screen.

`PUT /api/sync/state` stores one JSON snapshot per `userId` in D1 and `GET /api/sync/state` restores it. Snapshots are capped at 2 MB. This is access-controlled synchronization, **not application-level encryption of the state data at rest**.

## Read-only X OAuth

X OAuth uses Authorization Code with PKCE and the scopes are fixed in source code to:

- `tweet.read`
- `users.read`
- `follows.read`
- `offline.access`

No `tweet.write`, `follows.write`, DM-write or other social-action scope is requested.

Required Worker configuration:

- `X_CLIENT_ID`
- `X_CLIENT_SECRET`
- `X_OAUTH_CALLBACK_URL`
- `PWA_RETURN_URL`
- `OAUTH_TOKEN_ENCRYPTION_KEY_B64` — base64 of exactly 32 random bytes
- `SYNC_TOKEN_SHA256`

Access and refresh tokens are AES-GCM encrypted before D1 storage. Expired access tokens are refreshed server-side when a refresh token is available; X tokens are never returned to the PWA.

## Owned X data sync

`POST /api/x/owned/sync` can read the connected account's own profile, recent posts, followers and following lists and return them to the PWA for self-analysis and follow-back reconciliation.

The adapter is deliberately fail-closed. It runs only when all of the following are true:

- read-only X OAuth is connected
- `X_OWNED_READ_ELIGIBLE=true` is explicitly set after verifying that the connected account qualifies under X's current Owned Reads rules
- current positive `X_USER_READ_USD` and `X_OWNED_READ_USD` values are configured
- D1 budget accounting is healthy
- the pre-request reservation fits below both client and server HARD LIMITs

The PWA currently requests at most 100 followers, 100 following accounts and 20 recent posts per normal sync. The Worker automatically reduces that allocation when remaining budget is smaller. A 20-hour D1 cache is checked first so repeated sync taps do not re-read the same X resources.

Example body:

```json
{
  "userId": "local-user",
  "monthlyLimitUsd": 3,
  "maxFollowers": 100,
  "maxFollowing": 100,
  "maxPosts": 20
}
```

Follow-back reconciliation is conservative: a candidate found in the fetched follower set may be marked mutual, but a missing candidate is marked no-follow-back only when the follower coverage is complete. Partial pages never become false negatives.

## Free social discovery

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

The adapter currently runs one basic search for X and one for Instagram. Free-search usage is recorded in D1 with cost `$0` when the ledger is available.

## Mission ranking

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

## X public profile enrichment

The separate `POST /api/x/enrich` route batches up to 100 known usernames through the official X User Lookup endpoint when `X_BEARER_TOKEN` and a current positive `X_USER_READ_USD` are explicitly configured. It never scrapes X pages.

## Budget behavior

- Tavily discovery runs only when explicitly configured as `free`; paid discovery is disabled in the initial build.
- Groq marked `free` is preferred and recorded at $0.
- A paid LLM provider is not called unless positive input/output rates are explicitly configured.
- X public profile enrichment is disabled unless both `X_BEARER_TOKEN` and a positive `X_USER_READ_USD` are explicitly configured.
- Owned X sync requires explicit Owned Read eligibility plus current positive rates.
- Paid X/LLM work fails closed if D1 budget accounting is unavailable.
- Paid operations reserve a conservative worst-case amount before network work and reconcile actual cost afterward.
- When a paid X sync fails after network work may already have happened, the conservative reservation is intentionally kept rather than under-counting possible spend.
- When free providers are unavailable or a paid LLM call is blocked, ranking falls back to local heuristic scoring instead of breaking the product.
- `DEFAULT_MONTHLY_BUDGET_USD` is a server ceiling; a client may request a lower ceiling but cannot raise the server ceiling.

Provider prices, Owned Read eligibility and free-tier rules can change. Verify current official provider information before enabling paid billing; rates are configuration rather than hard-coded product truth.

## Local setup

1. Create a Cloudflare D1 database.
2. Put its database ID in `wrangler.jsonc`.
3. Apply `../db/schema.sql` to D1.
4. Copy `.dev.vars.example` to `.dev.vars` and add only the keys you want to use.
5. Configure the exact X callback URL in the X Developer Console if using OAuth.
6. Run:

```bash
npm install
npm run typecheck
npm run dev
```

For production, store secrets with Wrangler secret management rather than plaintext vars.
