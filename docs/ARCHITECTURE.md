# Social Mission architecture

## Product principle

The product is a mobile-first PWA that helps a user grow meaningful social relationships toward a stated Mission. It does not automate follows, likes, replies, DMs, or unfollows. The app discovers, ranks, drafts, remembers and advises; the user performs the final social action in the official X or Instagram experience.

## Core loop

1. Mission and Communication DNA define the goal and conversational style.
2. Candidate sources add public profiles to a reusable pool.
3. Duplicate filtering and cached state prevent needless provider reads.
4. The AI router ranks candidates against Mission and returns recommended action, rationale, strategy and limited drafts when context is sufficient.
5. A local-first Daily Queue mixes new connections, conversations, light engagement, self-improvement and follow cleanup so the day is not dominated by raw following volume.
6. The PWA hands off to the official social surface.
7. On return, the user records the result in one tap.
8. Completed candidates roll out of the current Daily Queue and relationship state feeds future advice.
9. The Me surface analyzes the user's own profile/recent posts against the same Mission.
10. Optional read-only X sync can refresh the user's own profile/posts/follow graph and seed inbound followers into the same candidate loop.

## Client

- React + TypeScript + Vite
- installable standalone PWA with safe-area-aware mobile UI
- local-first AppState for the initial single-user phase
- Service Worker for app-shell resilience
- GitHub Pages subpath-safe deployment
- X/Instagram official-surface handoff for final social actions
- clipboard/profile-URL candidate import for iPhone-friendly operation
- local Daily Queue generation without a mandatory daily LLM call
- JSON backup/restore
- optional manually triggered D1 snapshot push/pull
- read-only X connection/sync controls

Provider secrets and X OAuth tokens are never shipped in the browser bundle. The personal control key is entered by the user at runtime and stored separately from AppState, so it is not included in JSON backups.

## Server

Cloudflare Workers + D1 is the low-cost backend boundary.

Implemented server responsibilities:

- provider API keys
- free-first Tavily public-web profile discovery
- Mission ranking through free Groq when configured, optional paid Groq/DeepSeek fallback, and local fallback
- official X public-profile enrichment when explicitly enabled
- read-only X OAuth 2.0 Authorization Code + PKCE
- AES-GCM encryption of X access/refresh tokens in D1 and server-side token refresh
- budget-guarded owned-account X profile/post/follower/following reads
- 20-hour owned-X response cache
- rotating follower/following pagination cursors across syncs
- monthly-budget pacing for owned-X resource allocation
- budget ledger and HARD LIMIT enforcement
- pre-request budget reservations for paid calls
- token-gated state snapshots for personal multi-device transfer

Future server responsibilities:

- Instagram permitted-source adapters beyond public-web discovery
- scheduled notification delivery
- conflict-aware/offline-first state synchronization
- more sophisticated accumulated full-cycle follow-graph reconciliation

## Candidate discovery

Discovery is adapter-based. Current sources are:

- manually pasted profile URL or handle
- clipboard import
- Tavily public-web search when `TAVILY_BILLING_MODE=free`
- official X User Lookup for known usernames when a bearer token and explicit current read rate are configured
- read-only owned-X followers already returned by the user's connected account sync
- previously stored candidates and relationship history

The Tavily adapter searches only the public web, canonicalizes profile-shaped X/Instagram URLs, rejects obvious non-profile paths, and sends discovered profiles into the candidate pool for later Mission ranking. It is not a social-platform DOM crawler.

Owned-X inbound followers are candidate **seeds**, not automatic follow targets. They enter with a preliminary review state and should still be ranked against Mission before strategic outreach.

## Read-only X account boundary

The OAuth scopes are fixed to:

- `tweet.read`
- `users.read`
- `follows.read`
- `offline.access`

No `tweet.write`, `follows.write`, DM-write or equivalent social-action scope is requested.

The same personal control Bearer token used for optional D1 state sync gates X OAuth start/disconnect and owned-X reads. The Worker stores only the configured SHA-256 comparison value for that personal key. X OAuth access/refresh tokens use a separate 32-byte encryption key and are AES-GCM encrypted before D1 storage.

Owned-X reads fail closed unless eligibility and current rates are explicitly configured. The Worker reserves budget before the network request and never uses a missing price as zero.

## Owned-X pacing and pagination

Owned-X sync is designed to spread useful reads across the month rather than exhaust the full monthly HARD LIMIT early.

- First check the 20-hour D1 cache; a cache hit does not issue another X data request.
- Compute the actual remaining global monthly budget from D1.
- Divide remaining budget by the remaining UTC billing-month days to produce a conservative per-sync pace cap.
- Fit profile + post/follower/following resource allocation inside that pace cap.
- Preserve followers/following `next_token` values in D1 and continue from them on the next non-cached sync.
- When a list reaches its end, clear its cursor and increment its cycle counter so the next later sync begins another pass.

A missing user in a partial follower page is **never** treated as proof of no follow-back. Automatic `followBack=false` is allowed only when a single first page proves complete coverage. Broader full-cycle negative reconciliation remains future work because a rotating partial page is not sufficient evidence by itself.

## AI router

Current order of preference for ranking/self-analysis:

1. configured free Groq route
2. budget-reserved paid Groq when explicitly configured with rates
3. budget-reserved DeepSeek fallback when explicitly configured with rates
4. deterministic local heuristic scoring

The app combines candidate score, recommended action, strategic rationale and a limited number of individualized reply/DM drafts in one pass to reduce token use. The Daily Queue itself is generated locally from stored state.

Provider availability, prices and free tiers change. Free/paid mode and paid rates are server configuration rather than hard-coded product truth.

## Budget invariant

- Server ceiling defaults to `$3` but may be configured lower or higher.
- Client may request a lower ceiling but cannot raise the server ceiling.
- Paid providers fail closed when current rates are not explicitly configured.
- Paid X/LLM work fails closed when the D1 ledger cannot be trusted.
- Every paid call reserves a conservative estimated amount before the network request and reconciles it afterward.
- If a network failure happens after paid X work may already have occurred, the conservative reservation may be retained rather than risk under-counting spend.
- Free-provider usage may be logged with cost `$0`.
- Core UI, local candidates, Daily Queue, relationship management and manual handoff continue to work with all paid providers disabled.

The product should degrade acquisition volume, refresh frequency and model depth before degrading core features.

## Relationship and follow cleanup

Relationship stages:

`discovered -> interested -> following -> engaged -> recognized -> conversation -> relationship`

Follow-back status is recorded as `mutual / no follow-back / unknown`. The cleanup advisor waits for the user-configured review period and does not equate no follow-back with automatic removal. High Mission Match or meaningful engagement can preserve a one-way follow.

Unfollow remains a user review action in the official social surface.

## Self-analysis

The Me surface accepts the user's current profile and recent post text and evaluates them against the same Mission used for candidate discovery. Read-only X sync can populate those inputs automatically; the actual AI analysis remains an explicit user action so model usage is not silently spent.

A free/paid AI route may return:

- Mission alignment score
- grounded diagnosis
- highest-leverage strategy
- profile rewrite suggestion without invented achievements or facts

A local fallback remains available when no model provider is usable.

## State and synchronization

Primary state remains local-first so the PWA works before any backend setup.

Two portability options exist:

1. **JSON backup** — manual export/import; no provider keys, social passwords, OAuth tokens or personal control key are included.
2. **D1 snapshot sync** — optional manual push/pull gated by a user-chosen token whose SHA-256 hash is configured on the Worker.

D1 state snapshot sync provides access control but **does not application-encrypt the state JSON at rest**. This is separate from X OAuth token storage, which is application-encrypted with AES-GCM.

## Social safety invariant

- No DOM automation of X/Instagram.
- No hidden WebView follow/like/unfollow automation.
- No collection of social-account passwords.
- No automatic bulk follow/unfollow behavior.
- No follower-churn recommendation logic.
- No write scope in the X OAuth connection used for account analysis.
- Final follow/like/reply/DM/unfollow action is user-initiated in the official social experience.
- Discovery/ranking may optimize relevance and relationship value, not evasion of platform enforcement.
