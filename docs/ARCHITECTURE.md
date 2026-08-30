# Social Mission architecture

## Product principle

The product is a mobile-first PWA that helps a user grow meaningful social relationships toward a stated Mission. It does not automate follows, likes, replies, DMs, or unfollows. The loop is DISCOVER → COLLECT → PRIORITIZE → DRAFT → HUMAN APPROVAL → EXECUTE → RECORD / RECONCILE. Only EXECUTE performs a social write, and only after one explicit user approval for one action. When an official platform API permits that action, SNS-providers may execute it. When it does not, the PWA uses an explicit HANDOFF. There is no auto-send and no bulk write.

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
- user-approved social execute boundary with D1 canonical SocialAction/SocialEvent resolution, execution fingerprints durably persisted and re-read before every provider write, and exact-match reconciliation that refuses to run without that fingerprint
- isolated inbox ingest for X mentions, X DM, Instagram comments, and Instagram DM with source-level leases and durable checkpoints (a page cap never commits newest-seen; checkpoint query failure is distinct from a missing row and fails closed). Instagram DM message details are limited by Meta to the 20 most recent messages per conversation; that is a provider limitation, not an unfinished catch-up.
- Instagram comment reply and Instagram Professional DM adapters behind explicit production write flags and runtime permission probes
- X reply, follow, unfollow, like, and DM adapters behind explicit OAuth upgrades and production write flags
- Instagram webhook verification/signature receiver as the realtime primary, plus bounded polling catch-up of paginated owned media; comment/live_comment and messaging webhooks persist events without treating recipient.id as a conversation id
- versioned D1 migrations (`db/migrations/`) and production preflight diagnostics that block writes when the fingerprint column, budget table, checkpoint table, or schema version is missing
- persisted user budget ceiling (`user_runtime_settings`) under the server HARD LIMIT; Settings treats a ceiling as saved only after the server returns monthlyBudgetCeilingUsd / serverHardLimitUsd / effectiveLimitUsd

Manual-only remaining work is listed in `docs/MANUAL_GO_LIVE_CHECKLIST.md`. Instagram follow and arbitrary like stay HANDOFF because the official Professional management API does not provide those writes.

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

`tweet.write`, `follows.write`, `like.read`, `like.write`, `dm.read` and `dm.write` exist as separate optional write sets. They are not requested by the default connection. Settings starts a second OAuth session per intent (`reply`, `relationship`, `engagement`, `dm`) that **adds** the matching scopes to currently verified grants on the same X account. The session stores `requested_scopes_json` and `expected_x_user_id`; the callback fail-closes on extra/missing scopes and does not replace tokens when the granted user id differs. Like write requires `like.write`; like reconciliation also requires `like.read`.

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
- It does not request or perform follow/like automation. Comment reply and Professional DM writes stay behind explicit flags and one user approval.
- The personal control key protects the sync route.
- The access token stays Worker-side and is never returned to the PWA or backup JSON.
- A 12-hour D1 cache is checked before another Meta read for the engager snapshot path. Production inbox comment catch-up always reads latest media and pages comments; it does not skip unread comments via that cache.

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
- runtime settings / user budget ceiling
- Tavily discovery
- optional X public-profile enrichment
- D1 state sync
- X OAuth management and owned-account sync
- Instagram Professional engager sync
- user-approved social execute, inbox sync, and live capability lookup

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

- Server HARD LIMIT defaults to `$3` (`DEFAULT_MONTHLY_BUDGET_USD`) and may be configured lower or higher by Worker vars.
- Settings persist a user ceiling in `user_runtime_settings`. Effective limit is `min(HARD LIMIT, user ceiling, requested)`. The client cannot raise the server HARD LIMIT.
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

Execution mode comes from a **live** capability matrix returned by the Worker, not from `platform === instagram` in the UI. Instagram follow and arbitrary like stay HANDOFF because the official Professional management API does not provide those writes. Instagram comment reply becomes in-app only when Instagram is configured, the write adapter is present, and `SOCIAL_WRITE_ENABLED` plus `INSTAGRAM_COMMENT_REPLY_ENABLED` are on. X reply/follow/unfollow/like/DM become in-app only when the connected token has the matching scopes, the write adapter is present, and the matching production write flags are on. The execute route loads canonical rows from `social_actions` and provider evidence from `social_events`. Client JSON cannot retarget the write.

That execute route requires personal-control auth, server-side action/candidate/event resolution, HANDOFF rejection, identity-conflict rejection, expiry/completion/snooze/executing rejection, single-action bodies only, execution idempotency via `social_executions`, and fail-closed write costing. There is no bulk write route. A lost provider response is `unknown`, not a guessed success, and retries must reuse the same `executionId`.

## Social safety invariant

- No DOM automation of X/Instagram.
- No hidden WebView follow/like/unfollow automation.
- No collection of social-account passwords.
- No automatic bulk follow/unfollow behavior.
- No follower-churn recommendation logic.
- No write scope in the default X OAuth connection used for account analysis; optional write scopes require an explicit same-account cumulative upgrade. The reply upgrade adds `tweet.write` without dropping previously granted optional scopes.
- Instagram integration reads only explicitly configured, permitted first-party Professional-account surfaces.
- No social write without an explicit single-action user approval. HANDOFF actions cannot call a provider write. Completed, expired, identity-conflict, or mis-bound actions cannot write.
- Discovery/ranking may optimize relevance and relationship value, not evasion of platform enforcement.
