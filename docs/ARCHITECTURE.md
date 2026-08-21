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

Provider secrets are never shipped in the browser bundle. The optional personal D1 sync token is entered by the user at runtime and stored separately from AppState, so it is not included in JSON backups.

## Server

Cloudflare Workers + D1 is the low-cost backend boundary.

Implemented server responsibilities:

- provider API keys
- free-first Tavily public-web profile discovery
- Mission ranking through free Groq when configured, optional paid Groq/DeepSeek fallback, and local fallback
- official X public-profile enrichment when explicitly enabled
- budget ledger and HARD LIMIT enforcement
- pre-request budget reservations for paid calls
- optional token-gated state snapshots for personal multi-device transfer

Future server responsibilities:

- owned-account X OAuth/read adapters
- Instagram permitted-source adapters beyond public-web discovery
- scheduled notification delivery
- conflict-aware/offline-first state synchronization
- encrypted/secure OAuth token storage when OAuth is added

## Candidate discovery

Discovery is adapter-based. Current sources are:

- manually pasted profile URL or handle
- clipboard import
- Tavily public-web search when `TAVILY_BILLING_MODE=free`
- official X User Lookup for known usernames when a bearer token and explicit current read rate are configured
- previously stored candidates

The Tavily adapter searches only the public web, canonicalizes profile-shaped X/Instagram URLs, rejects obvious non-profile paths, and sends discovered profiles into the candidate pool for later Mission ranking. It is not a social-platform DOM crawler.

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
- Every paid call reserves a conservative estimated amount before the network request and reconciles/cancels that reservation afterward.
- Free-provider usage may be logged with cost `$0`.
- Core UI, local candidates, Daily Queue, relationship management and manual handoff continue to work with all paid providers disabled.

The product should degrade acquisition volume, refresh frequency and model depth before degrading core features.

## Relationship and follow cleanup

Relationship stages:

`discovered -> interested -> following -> engaged -> recognized -> conversation -> relationship`

Follow-back status is recorded as `mutual / no follow-back / unknown`. The cleanup advisor waits for the user-configured review period and does not equate no follow-back with automatic removal. High Mission Match or meaningful engagement can preserve a one-way follow.

Unfollow remains a user review action in the official social surface.

## Self-analysis

The Me surface accepts the user's current profile and recent post text and evaluates them against the same Mission used for candidate discovery. A free/paid AI route may return:

- Mission alignment score
- grounded diagnosis
- highest-leverage strategy
- profile rewrite suggestion without invented achievements or facts

A local fallback remains available when no model provider is usable.

## State and synchronization

Primary state remains local-first so the PWA works before any backend setup.

Two portability options exist:

1. **JSON backup** — manual export/import; no provider keys, social passwords or D1 sync token are included.
2. **D1 snapshot sync** — optional manual push/pull gated by a user-chosen token whose SHA-256 hash is configured on the Worker.

D1 snapshot sync provides access control but **does not application-encrypt the state JSON at rest**. It is intentionally a simple personal-device bridge, not yet conflict-aware automatic sync.

## Social safety invariant

- No DOM automation of X/Instagram.
- No hidden WebView follow/like/unfollow automation.
- No collection of social-account passwords.
- No automatic bulk follow/unfollow behavior.
- No follower-churn recommendation logic.
- Final follow/like/reply/DM/unfollow action is user-initiated in the official social experience.
- Discovery/ranking may optimize relevance and relationship value, not evasion of platform enforcement.
