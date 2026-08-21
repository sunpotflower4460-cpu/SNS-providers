# Social Mission / SNS-providers

Mission-driven, mobile-first PWA for growing meaningful social relationships without automating the final social action.

## Current v0.1 foundation

- installable mobile PWA shell
- 5-tab UX: Today / Discover / Relations / Me / Settings
- Mission + Communication DNA settings
- Mission Match candidate ranking and strategic next-action guidance
- local-first Daily Queue that mixes connection, conversation, light engagement, self-improvement and follow cleanup
- user-configurable daily workload caps for total queue / new connections / conversations / light engagement / cleanup / self-improvement
- local workload advisor that proposes a practical daily action volume from candidate quality and remaining budget; this is not a platform safety limit
- Today progress and summary cards are derived from the actual current Daily Queue instead of the raw candidate pool
- queue items automatically roll forward as today's interactions are recorded
- `明日へ` snooze temporarily removes a candidate from Today/Discover until the next local day without deleting relationship history
- zero-cost local candidate prefilter before LLM ranking, reducing the normal ranking batch from up to 50 candidates to the strongest 30
- natural reply/DM draft suggestions when context is sufficient
- X Web Intent / official profile handoff
- Instagram official profile or real engagement-post handoff
- one-tap outcome capture after returning to the PWA
- iPhone-friendly candidate import by profile URL / handle / clipboard
- free-first Tavily discovery for public X/Instagram profile candidates when explicitly configured in free mode
- official X public-profile enrichment in batches of up to 100 usernames when explicitly enabled
- read-only X OAuth 2.0 PKCE using only `tweet.read`, `users.read`, `follows.read`, `offline.access`
- AES-GCM encrypted X access/refresh token storage in D1 with server-side refresh
- budget-guarded owned X sync for the user's profile, recent posts, followers and following when explicitly eligible/configured
- 20-hour D1 cache for owned X sync to avoid needless repeated reads
- monthly X sync pacing based on remaining budget / remaining billing-month days
- rotating followers/following pagination so later syncs progress beyond the first page
- accumulated full-cycle follower evidence for tracked X accounts; partial pages never create negative follow-back evidence, while a completed cycle can safely classify tracked accounts as seen/unseen
- inbound X followers can be reused as candidate seeds without another X request
- optional Instagram Professional comment-engager sync using only the official API on the user's own media
- Instagram commenters can become high-signal `engaged` candidates and retain the related post as the next conversation surface
- 12-hour D1 cache for Instagram engager sync
- local relationship history and relationship stages
- configurable follow-back review window with Mission-aware keep/cleanup advice
- AI self-analysis from profile + recent post text, including Mission Score, diagnosis, strategy and profile rewrite suggestion
- X self-profile/recent-post sync automatically feeds the same Me analysis inputs
- JSON backup/restore for local-first Mission, candidate and relationship state
- optional token-gated D1 snapshot sync for moving state between personal devices
- optimistic D1 concurrency protection prevents a stale/unknown device from silently overwriting a newer remote snapshot
- personal control key protects D1 state sync, X OAuth management/owned reads, Instagram Professional engager sync, budget reads, AI ranking, Tavily discovery and optional X enrichment
- configurable monthly API/LLM budget with a $3 default and always-on HARD LIMIT
- free-first AI provider routing with local fallback
- fail-closed paid usage when the D1 budget ledger, provider rates, or Owned Read eligibility cannot be trusted
- pre-request budget reservations for paid calls to reduce concurrent overspend risk
- production CSP restricts PWA API traffic to the configured Worker origin; CI verifies the generated binding
- CI security invariant check fails if cost-bearing provider routes lose the personal-control gate, X OAuth gains a write scope, or optimistic D1 sync protection disappears
- D1 schema for candidates, interactions, Daily Queue, insights, budget ledger, OAuth tokens, pagination, full-cycle follow evidence and personal X/Instagram snapshots
- GitHub Pages PWA deployment workflow plus subpath-safe manifest / Service Worker
- CI for web, Worker, security invariants and GitHub Pages/CSP builds

## Product rule

The app may discover, rank, draft, remember and recommend. The final follow/like/reply/DM/unfollow action remains user-initiated in the official social experience. See `docs/ARCHITECTURE.md` for the safety and cost invariants.

## Run the PWA locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

`VITE_API_BASE_URL` is optional. Leave it empty for local-only mode. Point it at the deployed Worker to enable free discovery, live budget sync, AI ranking, self-analysis, personal D1 state sync and the optional X/Instagram integrations.

Production validation:

```bash
npm run typecheck
npm run security:check
npm run build
npm run preview
```

## Worker

The Worker lives in `worker/` and keeps provider keys, Instagram access tokens and X OAuth tokens out of the browser.

```bash
cd worker
npm install
npm run typecheck
```

See `worker/README.md` for D1, personal-control-key hashing, X OAuth, Owned Read eligibility, Instagram Professional comment sync, secrets, provider-rate configuration and deployment.

Paid usage is fail-closed. If D1 budget accounting is unavailable, paid provider rates are missing, Owned Read eligibility is not explicitly confirmed, or a reservation would exceed the HARD LIMIT, paid LLM/X requests are blocked. Free Tavily discovery, configured free Groq, local filtering/scoring and already-cached state can continue only through the authenticated personal Worker route where applicable.

## Mobile flow

1. In Settings, define the Mission, Communication DNA, monthly API budget and preferred daily workload.
2. Optionally tap the local workload recommendation; it uses candidate quality and remaining budget only as a productivity guide, not as an X/Instagram enforcement threshold.
3. Save the personal control key before using Worker-backed budget/provider/social sync features.
4. Optionally connect X in read-only mode. The PWA never requests follow/post/DM write scopes.
5. Tap `Xデータを同期` to import the connected account's profile/recent posts and budget-permitted follower/following samples. Repeated taps within the cache window reuse D1 data at `$0` application-tracked cost.
6. Each non-cached X sync is paced from remaining monthly budget and continues followers/following from stored pagination cursors, gradually widening coverage instead of repeatedly buying the first page.
7. For X candidates already marked as followed, the Worker snapshots the tracked set at the start of a follower cycle and records whether each one is seen across rotated pages. Only a completed cycle can create negative follow-back evidence.
8. Existing tracked candidates are reconciled with follower data; inbound X followers can become new candidate seeds for later Mission ranking.
9. If an Instagram Professional account is configured, tap `コメント反応者を同期`. The Worker reads a bounded set of the user's own media/comments through the official API and turns existing commenters into high-signal relationship candidates without crawling Instagram globally.
10. Open Discover and tap `Missionから無料で候補を探す` when Tavily free discovery is configured, or add a profile URL/handle manually.
11. For arbitrary X candidates, optionally run `X公式情報を補完` if an X bearer token and current User Read rate are explicitly configured.
12. Run `AIで候補を再評価`. A zero-cost local filter chooses the strongest subset first, then the AI pass generates Mission Match, strategy and drafts where justified.
13. Today automatically builds a Daily Queue from Mission Match, relationship state, recommended action, workload caps, self-improvement items and cleanup reviews. Its progress target and summary are based on that actual queue.
14. Use `明日へ` when a candidate is relevant but not worth handling now; the relationship record stays intact and the candidate returns the next local day.
15. Open the recommended person/post in the official social experience; the user performs the actual social action there.
16. Return to the PWA and record the result; completed candidates drop out of today's queue and the next actions move up.
17. In Relations, review mutual/no-follow-back/unknown state. Cleanup advice never auto-unfollows.
18. In Me, run AI analysis on the synced or manually pasted profile/recent posts to get Mission-based account improvement guidance.

## Low-cost strategy

The initial product is designed to remain useful at $0-$3/month:

1. reuse locally stored candidates instead of re-reading them
2. use free public-web discovery before paid social reads when configured
3. reuse inbound X followers and Instagram commenters as high-signal candidates instead of buying more cold discovery
4. use X Owned Reads only when the connected account is explicitly confirmed eligible
5. cache owned X snapshots for 20 hours and Instagram engager snapshots for 12 hours
6. pace each non-cached owned-X sync from the actual remaining monthly budget divided by the remaining billing-month days
7. rotate follower/following pages instead of repeatedly purchasing the same first-page coverage
8. accumulate follow evidence across a complete cycle instead of buying large follower reads solely for one-off follow-back checks
9. refresh arbitrary X profile metadata no more than needed
10. locally prefilter candidate batches before sending them to an LLM
11. batch X user lookup and AI candidate ranking
12. consume configured free model capacity before paid providers
13. combine ranking, recommended action, strategic rationale and limited message drafting into one AI pass
14. build the Daily Queue and workload recommendation locally instead of paying an LLM every morning
15. reserve budget before any paid provider call and fail closed when accounting cannot be trusted
16. require the personal control key on provider-spending/free-quota routes so an exposed Worker URL cannot be used by strangers to burn quota
17. keep the product useful when every paid integration is disabled

Provider prices, eligibility rules, Meta permissions/API versions and free tiers change, so paid rates, billing-mode flags and social API versions are server configuration rather than hard-coded product assumptions.

## GitHub Pages PWA

`.github/workflows/deploy-pages.yml` builds the frontend with `VITE_BASE_PATH=/SNS-providers/` and deploys `dist/` to GitHub Pages whenever `main` changes.

GitHub requires custom Pages workflows to be enabled for the repository before the first deployment. Once enabled, merging to `main` triggers the deployment. If the Worker has been deployed, add a repository Actions variable named `VITE_API_BASE_URL` containing the Worker origin; otherwise the deployed PWA runs in local-only mode. Production CSP generation uses this same Worker origin and CI verifies that it is bound into the built HTML.

## Personal control key / D1 sync

`SYNC_TOKEN_SHA256` stores only a SHA-256 comparison value on the Worker. The original secret stays on the user's device and protects personal D1 state sync plus protected social-account and provider routes.

The same key gates budget status, AI ranking/self-analysis, Tavily discovery, optional X public enrichment, X OAuth management/owned reads and Instagram Professional engager sync. This protects both personal data and the app's small provider/free-tier budget when the Worker URL is public.

D1 snapshot uploads carry the last remote `updatedAt` observed by that device. If another device changed the snapshot first, the Worker rejects the stale upload instead of silently overwriting newer data. A device that has never observed the remote version can create a snapshot only when none exists; otherwise it must pull first.

This is conflict-safe manual synchronization, not yet a field-level automatic merge engine. The state snapshot is access-controlled but is not application-level encrypted at rest. X OAuth access/refresh tokens are different: they are AES-GCM encrypted before D1 storage and are never included in AppState or JSON backups. Instagram access tokens are Worker-side secrets and are also never placed in AppState or the browser bundle.

## Architecture

The browser-first v0.1 remains local-first so the PWA is useful before backend setup. Cloudflare Workers + D1 provide the server boundary for provider keys, encrypted X OAuth tokens, Instagram server-side credentials, budget accounting, public discovery and optional personal state/social snapshots.

- `src/` — PWA UI, local store, workload advisor, zero-cost prefilter, Daily Queue, backup/restore, conflict-safe D1 sync, X/Instagram account controls, social handoff, discovery, ranking and self-analysis integration
- `public/` — portable manifest, icon and Service Worker
- `worker/` — Worker API, free-first provider routing, personal control gate, X OAuth/owned sync, full-cycle follow evidence, Instagram Professional comment-engager sync, pagination/pacing, budget safeguards and caching
- `db/schema.sql` — D1 data model
- `docs/ARCHITECTURE.md` — product/technical architecture and invariants
- `scripts/verify-security-invariants.mjs` — CI guard for provider-route authentication, optimistic state-sync protection and read-only X OAuth scopes

## Next implementation milestones

- optional automatic/field-level merge sync beyond the current conflict-safe manual D1 push/pull
- Instagram webhook ingestion for new comments plus other explicitly permitted first-party signals such as mentions where useful
- scheduled Daily Queue refresh plus push notification delivery
- optional local embedding/WebGPU stage beyond the current zero-cost lexical prefilter
- accessibility, install-flow and richer empty/error-state polish
