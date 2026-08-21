# Social Mission Worker

Server-side boundary for provider keys, ranking, free-first social discovery, personal state sync, read-only X OAuth/data sync, Instagram Professional engager sync, D1 usage accounting and the monthly HARD LIMIT.

## Why it exists

Provider keys, Instagram access tokens and X OAuth tokens must never be shipped to the PWA bundle. The browser talks to this Worker; the Worker decides whether a free provider, paid fallback, paid X read or local scoring path is allowed.

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
- `POST /api/instagram/engagers/sync` — personal-control Bearer token required
- `GET /api/sync/state?userId=local-user` — personal-control Bearer token required
- `PUT /api/sync/state` — personal-control Bearer token required

## Personal control key and D1 state sync

Personal controls are disabled unless `SYNC_TOKEN_SHA256` contains the SHA-256 hex of a user-chosen secret. The raw secret is entered on the user's device at runtime and is sent only as a Bearer token to the Worker; it is not committed to the repository or included in the PWA backup JSON.

The same personal key protects:

- D1 state upload/download
- starting X OAuth
- disconnecting X OAuth
- reading the connected account's owned X data
- synchronizing Instagram Professional comment engagers

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

The PWA requests bounded follower/following/post samples. The Worker automatically reduces allocation to the remaining monthly budget, paces the available X budget across the days left in the UTC month, and stores pagination cursors so later syncs rotate through different follower/following pages. A 20-hour D1 cache is checked first so repeated sync taps do not re-read the same resources.

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

Follow-back reconciliation is conservative: a candidate found in a fetched follower page may be marked mutual, while a missing candidate is not treated as no-follow-back from partial coverage. Pagination can progressively widen coverage without turning partial pages into false negatives.

## Instagram Professional engager sync

`POST /api/instagram/engagers/sync` is an optional **official Instagram API** source for higher-signal candidates. It does not search or crawl arbitrary Instagram profiles.

The adapter is for an Instagram Professional account (Creator or Business). Configure:

- `INSTAGRAM_ACCESS_TOKEN` — keep server-side only
- `INSTAGRAM_USER_ID` — the connected Instagram Professional account ID
- `INSTAGRAM_API_VERSION` — explicitly set the currently supported Graph API version, such as `v24.0` only after verifying it is current
- `SYNC_TOKEN_SHA256` — protects the sync route

For Instagram Login, the Meta app/token must have the permissions required for the chosen setup, including basic Professional-account access and comment management (currently documented as permissions such as `instagram_business_basic` and `instagram_business_manage_comments`). Verify current Meta requirements before production use because permission names and review requirements can change.

The current sync deliberately reads only:

1. a bounded set of media owned by the configured account (default 8, maximum 12), then
2. a bounded set of comments on those media (default 25 per media, maximum 50).

From comment objects it uses commenter identity/username and comment text to build a reusable set of people who have **already chosen to interact with the user's content**. Those people can be promoted into the PWA candidate pool with higher relationship priority, and the related post permalink is retained so the user can return to the real conversation context.

The adapter:

- does not scrape Instagram HTML/DOM
- does not enumerate arbitrary consumer accounts
- does not follow, like, reply or DM automatically
- does not expose the Instagram access token to the browser
- uses a 12-hour D1 cache before re-reading Meta data
- records application-tracked external cost as `$0`; Meta rate limits still apply

For a larger production deployment, comment webhooks are preferable to frequent polling. This initial personal PWA keeps explicit manual sync and caching so the behavior remains easy to inspect.

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

Before the PWA calls the Worker, it can run a zero-cost local relevance prefilter so only the strongest subset of a candidate batch consumes LLM tokens. The server then returns Mission Match, action guidance, strategy and limited message drafts in one pass.

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
- Instagram Professional comment sync is treated as a `$0` application-cost source but remains bounded/cached for Meta rate-limit discipline.
- When free providers are unavailable or a paid LLM call is blocked, ranking falls back to local heuristic scoring instead of breaking the product.
- `DEFAULT_MONTHLY_BUDGET_USD` is a server ceiling; a client may request a lower ceiling but cannot raise the server ceiling.

Provider prices, Owned Read eligibility, Meta permission requirements and free-tier rules can change. Verify current official provider information before enabling integrations; rates and API versions are configuration rather than hard-coded product truth.

## Local setup

1. Create a Cloudflare D1 database.
2. Put its database ID in `wrangler.jsonc`.
3. Apply `../db/schema.sql` to D1 (re-apply after schema additions; statements are idempotent `CREATE TABLE IF NOT EXISTS`).
4. Copy `.dev.vars.example` to `.dev.vars` and add only the integrations you want to use.
5. Configure the exact X callback URL in the X Developer Console if using X OAuth.
6. Configure an Instagram Professional app/token and current API version if using comment-engager sync.
7. Run:

```bash
npm install
npm run typecheck
npm run dev
```

For production, store secrets with Wrangler secret management rather than plaintext vars.
