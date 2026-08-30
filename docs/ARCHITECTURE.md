# Social Mission architecture

## Product principle

The product is a mobile-first PWA that helps a user grow meaningful social relationships toward a stated Mission. It does not automate follows, likes, replies, DMs, or unfollows. The loop is DISCOVER → RANK → DRAFT → APPROVE → EXECUTE. Only EXECUTE performs a social write, and only after one explicit user approval for one action. When an official platform API permits that action, SNS-providers may execute it. When it does not, the PWA uses an explicit HANDOFF. There is no auto-send and no bulk write.

## Core loop

1. Mission and Communication DNA define the goal and conversational style.
2. Candidate sources add reusable relationship signals and public profiles to the candidate pool.
3. Duplicate filtering, local prefiltering and cached state prevent needless provider/model reads.
4. The AI router ranks the strongest candidate subset against Mission and returns recommended action, rationale, strategy and limited drafts when context is sufficient.
5. A local-first Mission Inbox ranks SocialActions (concrete work) above Candidate-based Daily Queue fallback items so the day is not a social feed.
6. User-configured workload caps and a local workload advisor control how much work appears without treating any number as a platform safety threshold.
7. A candidate or SocialAction can be snoozed until the next local day without deleting relationship history.
8. The PWA either executes one user-approved write when the official API and connected capabilities allow it, or hands off to the official social surface.
9. On return or after an approved in-app execute, the user/result path records the outcome.
10. Completed SocialActions roll out of Mission Inbox, create Interaction rows, and conservatively update relationship state.
11. The Me surface analyzes the user's own profile/recent posts against the same Mission.
12. Optional read-only X sync can refresh the user's own profile/posts/follow graph and seed inbound followers into the same candidate loop.
13. Optional Instagram Professional sync can turn people who already commented on the user's own media into higher-signal relationship candidates.

## Client

- React + TypeScript + Vite
- installable standalone PWA with safe-area-aware mobile UI
- local-first AppState for the initial single-user phase
- Service Worker for app-shell resilience
- GitHub Pages subpath-safe deployment
- production CSP restricts network connections to the configured Worker origin; CI verifies the built binding
- X/Instagram official-surface HANDOFF when the connected capabilities do not allow an in-app write
- SocialAction cards with inbound context, editable drafts, snooze, dismiss and executionMode
- Instagram reply candidates may retain the original engagement-post permalink so the user returns to the real context
- clipboard/profile-URL candidate import for iPhone-friendly operation
- local Mission Inbox generation plus Daily Queue fallback without a mandatory daily LLM call
- Today progress and summary derived from the actual current Daily Queue
- user-configurable daily workload caps by action family
- deterministic local workload suggestion from candidate quality and budget state
- next-local-day candidate snoozing
- zero-cost lexical/relationship prefilter before LLM ranking
- JSON backup/restore
- optional manually triggered D1 snapshot push/pull with optimistic concurrency protection
- read-only X connection/sync controls
- Instagram Professional engager-sync controls

Provider secrets, Instagram access tokens and X OAuth tokens are never shipped in the browser bundle. The personal control key is entered by the user at runtime and stored separately from AppState, so it is not included in JSON backups.

When the Worker URL exists but the personal key is not yet configured, the PWA remains usable in local-only mode and does not repeatedly call protected provider routes.

## Server

Cloudflare Workers + D1 is the low-cost backend boundary.

Implemented server responsibilities:

- provider API keys and Instagram server-side credentials
- personal-control authentication for provider/quota-bearing routes
- free-first Tavily public-web profile discovery
- Mission ranking through free Groq when configured, optional paid Groq/DeepSeek fallback, and local fallback
- official X public-profile enrichment when explicitly enabled
- read-only X OAuth 2.0 Authorization Code + PKCE
- AES-GCM encryption of X access/refresh tokens in D1 and server-side token refresh
- budget-guarded owned-account X profile/post/follower/following reads
- 20-hour owned-X response cache
- rotating follower/following pagination cursors across syncs
- accumulated full-cycle follower evidence for the tracked followed-account set
- monthly-budget pacing for owned-X resource allocation
- official Instagram Professional owned-media/comment engager reads
- 12-hour Instagram engager response cache
- budget ledger and HARD LIMIT enforcement
- pre-request budget reservations for paid calls
- token-gated state snapshots for personal multi-device transfer
- optimistic state-snapshot concurrency checks to prevent stale-device overwrites
- user-approved social execute boundary with D1 idempotency; live provider writes stay disabled

Future server responsibilities:

- Instagram comment webhooks to replace most manual polling in a larger deployment
- other explicitly permitted first-party Instagram signals (for example mentions) where they improve relationship relevance
- scheduled notification delivery
- optional automatic merge-oriented/offline-first synchronization beyond the current conflict-safe manual push/pull

## Candidate discovery

Discovery is adapter-based. Current sources are:

- manually pasted profile URL or handle
- clipboard import
- Tavily public-web search when `TAVILY_BILLING_MODE=free`
- official X User Lookup for known usernames when a bearer token and explicit current read rate are configured
- read-only owned-X followers already returned by the user's connected account sync
- Instagram Professional commenters on media owned by the configured account
- previously stored candidates and relationship history

The Tavily adapter searches only the public web, canonicalizes profile-shaped X/Instagram URLs, rejects obvious non-profile paths, and sends discovered profiles into the candidate pool for later Mission ranking. It is not a social-platform DOM crawler.

Owned-X inbound followers are candidate **seeds**, not automatic follow targets. They enter with a preliminary review state and should still be ranked against Mission before strategic outreach.

Instagram commenters are different from cold discovery: they have already chosen to interact with the user's content. They may enter at an `engaged` relationship stage with higher preliminary relationship value. The PWA preserves the related post URL when available so the recommended next action can return the user to the real conversation rather than inventing context.

## Read-only X account boundary

The OAuth scopes requested by the default connect flow are fixed to:

- `tweet.read`
- `users.read`
- `follows.read`
- `offline.access`

`tweet.write`, `follows.write`, `dm.read` and `dm.write` exist as a separate optional write set. They are not requested by the default connection. Grant validation compares the token to the requested set, so extra write scopes cannot silently appear. The PWA shows which capabilities are connected. Token encryption, refresh handling, identity leasing and derived-state cleanup stay unchanged.

A CI security invariant parses the default read-only list and fails when a write-capable X scope is added there, and also fails if the default authorize URL starts requesting the optional write set.

Owned-X reads fail closed unless eligibility and current rates are explicitly configured. The Worker reserves budget before the network request and never uses a missing price as zero.

## Owned-X pacing, pagination and full-cycle evidence

Owned-X sync is designed to spread useful reads across the month rather than exhaust the full monthly HARD LIMIT early.

- First check the 20-hour D1 cache; a cache hit does not issue another X data request.
- Compute the actual remaining global monthly budget from D1.
- Divide remaining budget by the remaining UTC billing-month days to produce a conservative per-sync pace cap.
- Fit profile + post/follower/following resource allocation inside that pace cap.
- Preserve followers/following `next_token` values in D1 and continue from them on the next non-cached sync.
- When a list reaches its end, clear its cursor and increment its cycle counter so the next later sync begins another pass.

A missing user in a partial follower page is **never** treated as proof of no follow-back.

For stronger evidence across rotated pages, the client sends only the currently tracked X candidates that the user has actually marked as followed, capped at 500. At the beginning of a follower cycle, the Worker snapshots that tracked set into D1. Each fetched follower page marks matching targets as seen by platform user ID or username. Only when the cycle reaches its final page does the Worker return completed `seenKeys` and `unseenKeys`.

The client may then set `followBack=true/false` for that frozen tracked set. A negative result still does not trigger an unfollow: the existing review window, Mission Match and relationship-value rules determine whether the candidate is merely surfaced for manual cleanup review.

Any failure to persist or read cycle evidence disables negative inference rather than manufacturing a no-follow-back result.

## Instagram Professional boundary

The Instagram owned-engager adapter is intentionally narrow.

- It requires a configured Instagram Professional account (Creator or Business), server-side access token, account ID and explicit current Graph API version.
- It reads a bounded set of media owned by that account and a bounded set of comments on those media through the official API.
- It extracts commenter identity/username, latest comment ID, comment text, media ID and the related media permalink for the same latest comment event.
- It does not crawl arbitrary Instagram profiles or enumerate consumer accounts.
- It does not request or perform follow/like/DM automation.
- The personal control key protects the sync route.
- The access token stays Worker-side and is never returned to the PWA or backup JSON.
- A 12-hour D1 cache is checked before another Meta read.

The Meta app/token must hold the permissions required by the selected current Instagram Login setup. Permission names and review requirements can change, so the implementation keeps token/version configuration outside source code and the deployment checklist must verify Meta's current requirements before enabling production use.

## AI router and zero-cost prefilter

Current order of preference for ranking/self-analysis:

1. zero-cost client prefilter chooses the strongest candidate subset from the current batch
2. configured free Groq route
3. budget-reserved paid Groq when explicitly configured with rates
4. budget-reserved DeepSeek fallback when explicitly configured with rates
5. deterministic local heuristic scoring

The client prefilter uses Mission lexical overlap, existing Mission Match, available candidate context, relationship stage and action value. It is not a replacement for semantic model ranking; it reduces obvious low-value token spend before the model is called.

The app combines candidate score, recommended action, strategic rationale and a limited number of individualized reply/DM drafts in one AI pass to reduce token use. The Daily Queue and workload suggestion are generated locally from stored state.

Draft generation is user-configurable (`relationshipPolicy.autoDraftReplies`, default on) and enforced on both sides: the client passes `draftsEnabled` on `/api/ai/rank`, the Worker prompt omits the draft instruction when it is off, and `normalizeProviderResults` discards any draft the model returns anyway unless `draftsEnabled` is true. Drafts shown in the PWA are editable before use; editing only replaces the local `draft` field and never touches `aiDraft` (the original AI suggestion, kept so the user can revert), and both are cleared/replaced together on the next re-rank. This does not change the approval boundary — a draft is never sent without one explicit user approval for that one action.

Provider availability, prices and free tiers change. Free/paid mode and paid rates are server configuration rather than hard-coded product truth.

## Provider route authentication

The Worker URL may be public, so knowing the URL must not be enough to consume the user's quota or budget.

The personal control key gates:

- budget status
- AI ranking and self-analysis
- Tavily discovery
- optional X public-profile enrichment
- D1 state sync
- X OAuth management and owned-account sync
- Instagram Professional engager sync

The Worker stores only `SYNC_TOKEN_SHA256`; the raw key remains on the user's device. A CI security invariant verifies that the provider/quota-bearing route set continues to pass through `authorizeSync()`.

## Workload and snooze invariant

The user may set local caps for:

- total Daily Queue actions
- new-connection candidates
- conversation candidates
- light-engagement candidates
- follow-cleanup reviews
- self-improvement tasks

These values are **productivity and quality controls only**. They are not presented as X/Instagram safe-action thresholds, they do not automate the action, and they are not used to evade platform enforcement. The local advisor can propose a smaller/larger workload from candidate quality and remaining app budget, but each social write still requires one explicit user approval.

A candidate may be moved to `snoozedUntil` the next local midnight. Snoozing removes the candidate from the active Discover/Today queue temporarily without deleting candidate data or relationship history.

## Budget invariant

- Server ceiling defaults to `$3` but may be configured lower or higher.
- Client may request a lower ceiling but cannot raise the server ceiling.
- Paid providers fail closed when current rates are not explicitly configured.
- Paid X/LLM work fails closed when the D1 ledger cannot be trusted.
- Every paid call reserves a conservative estimated amount before the network request and reconciles it afterward.
- If a network failure happens after paid X work may already have occurred, the conservative reservation may be retained rather than risk under-counting spend.
- Free-provider usage may be logged with cost `$0`.
- Instagram owned-comment sync is tracked as `$0` application cost but remains bounded/cached for rate-limit discipline.
- Core UI, local candidates, workload advisor, Daily Queue, relationship management and manual handoff continue to work with all paid providers disabled.

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

1. **JSON backup** — manual export/import; no provider keys, social passwords, OAuth tokens, Instagram access token or personal control key are included.
2. **D1 snapshot sync** — optional manual push/pull gated by a user-chosen token whose SHA-256 hash is configured on the Worker.

D1 snapshot uploads use optimistic concurrency. The client remembers the last remote `updatedAt` it observed and sends that value as `expectedUpdatedAt` on upload. The Worker updates only when the current D1 row still has that same timestamp. A client with no known remote version can create a new snapshot only when no snapshot already exists. Otherwise the upload receives a conflict response and the user must pull the newer state before deciding what to do.

Changing or forgetting the personal key clears the remembered remote version, so a different key/device cannot accidentally overwrite existing remote state without first reading it.

This protects against stale-device overwrite but is not yet a field-level automatic merge engine. D1 state snapshot sync provides access control but **does not application-encrypt the state JSON at rest**. This is separate from X OAuth token storage, which is application-encrypted with AES-GCM. Instagram access tokens remain Worker secrets rather than state fields.

A CI invariant checks that the optimistic-concurrency clauses remain present.

## Engineering invariants

CI currently verifies:

- frontend TypeScript
- Worker TypeScript
- production build
- GitHub Pages subpath build
- production CSP Worker-origin binding
- provider-route personal-control authentication
- default read-only X OAuth scope set, with optional writes kept as a separate unrequested set
- SocialAction restore/dedupe/execute-guard invariants
- optimistic D1 state-sync protection

The intent is to turn the most important cost/safety boundaries into build failures rather than documentation-only rules.

## SocialAction and Mission Inbox

Candidate remains the person/relationship record. SocialAction is a separate validated model for one piece of work (inbound reply, comment, DM, follow, cleanup, and so on). One Candidate may have many SocialActions. Inbound events dedupe on `platform + source + externalEventId`, never on message text.

Mission Inbox ranks SocialActions with deterministic application math:

`missionRelevance * 0.25 + relationshipValue * 0.20 + urgency * 0.30 + conversationOpportunity * 0.25 + authenticityRisk * -0.20`

plus bounded inbound boosts. Relationship value and urgency are derived from CRM/timestamps; the model may supply other component scores but not the sort order itself.

Execution mode comes from a capability matrix, not scattered `if (platform === ...)` UI branches. Instagram follow stays HANDOFF. Instagram comment reply is an in-app capability; live provider writes remain disabled until a later milestone enables one operation at a time through `POST /api/social/actions/:id/execute`.

That execute route requires personal-control auth, exact action/candidate/external binding, HANDOFF rejection, identity-conflict rejection, expiry/completion rejection, single-action bodies only, execution idempotency via `social_executions`, and fail-closed write costing. There is no bulk write route.

## Social safety invariant

- No DOM automation of X/Instagram.
- No hidden WebView follow/like/unfollow automation.
- No collection of social-account passwords.
- No automatic bulk follow/unfollow behavior.
- No follower-churn recommendation logic.
- No write scope in the default X OAuth connection used for account analysis; optional write scopes require an explicit reconnect.
- Instagram integration reads only explicitly configured, permitted first-party Professional-account surfaces.
- No social write without an explicit single-action user approval. HANDOFF actions cannot call a provider write. Completed, expired, identity-conflict, or mis-bound actions cannot write.
- Discovery/ranking may optimize relevance and relationship value, not evasion of platform enforcement.
