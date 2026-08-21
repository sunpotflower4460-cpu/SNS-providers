# Social Mission / SNS-providers

Mission-driven, mobile-first PWA for growing meaningful social relationships without automating the final social action.

## Current v0.1 foundation

- installable mobile PWA shell
- 5-tab UX: Today / Discover / Relations / Me / Settings
- Mission + Communication DNA settings
- Mission Match candidate ranking and strategic next-action guidance
- local-first Daily Queue that mixes connection, conversation, light engagement, self-improvement and follow cleanup
- queue items automatically roll forward as today's interactions are recorded
- natural reply/DM draft suggestions when context is sufficient
- X Web Intent / official profile handoff
- Instagram official profile handoff
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
- inbound X followers can be reused as candidate seeds without another X request
- conservative automatic follow-back reconciliation; partial/rotated follower pages never create false negatives
- local relationship history and relationship stages
- configurable follow-back review window with Mission-aware keep/cleanup advice
- AI self-analysis from profile + recent post text, including Mission Score, diagnosis, strategy and profile rewrite suggestion
- X self-profile/recent-post sync automatically feeds the same Me analysis inputs
- JSON backup/restore for local-first Mission, candidate and relationship state
- optional token-gated D1 snapshot sync for moving state between personal devices
- personal control key also protects X OAuth start/disconnect and owned X reads
- configurable monthly API/LLM budget with a $3 default and always-on HARD LIMIT
- free-first AI provider routing with local fallback
- fail-closed paid usage when the D1 budget ledger, provider rates, or Owned Read eligibility cannot be trusted
- pre-request budget reservations for paid calls to reduce concurrent overspend risk
- D1 schema for candidates, interactions, Daily Queue, insights, budget ledger, OAuth tokens, pagination and personal state/X snapshots
- GitHub Pages PWA deployment workflow plus subpath-safe manifest / Service Worker
- CI for web, Worker and GitHub Pages base-path builds

## Product rule

The app may discover, rank, draft, remember and recommend. The final follow/like/reply/DM/unfollow action remains user-initiated in the official social experience. See `docs/ARCHITECTURE.md` for the safety and cost invariants.

## Run the PWA locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

`VITE_API_BASE_URL` is optional. Leave it empty for local-only mode. Point it at the deployed Worker to enable free discovery, live budget sync, AI ranking, self-analysis, personal D1 state sync and the optional X integrations.

Production validation:

```bash
npm run typecheck
npm run build
npm run preview
```

## Worker

The Worker lives in `worker/` and keeps provider keys and X OAuth tokens out of the browser.

```bash
cd worker
npm install
npm run typecheck
```

See `worker/README.md` for D1, personal-control-key hashing, X OAuth, Owned Read eligibility, secrets, provider-rate configuration and deployment.

Paid usage is fail-closed. If D1 budget accounting is unavailable, paid provider rates are missing, Owned Read eligibility is not explicitly confirmed, or a reservation would exceed the HARD LIMIT, paid LLM/X requests are blocked. Free Tavily discovery, free Groq or local scoring can continue when configured.

## Mobile flow

1. In Settings, define the Mission, Communication DNA and monthly budget.
2. Save the personal control key if using D1 sync or read-only X account connection.
3. Optionally connect X in read-only mode. The PWA never requests follow/post/DM write scopes.
4. Tap `Xデータを同期` to import the connected account's profile/recent posts and budget-permitted follower/following samples. Repeated taps within the cache window reuse D1 data at `$0` application-tracked cost.
5. Each non-cached sync is paced from remaining monthly budget and continues followers/following from stored pagination cursors, gradually widening coverage instead of repeatedly buying the first page.
6. Existing tracked candidates are reconciled with follower data; inbound followers can become new candidate seeds for later Mission ranking.
7. Open Discover and tap `Missionから無料で候補を探す` when Tavily free discovery is configured, or add a profile URL/handle manually.
8. For arbitrary X candidates, optionally run `X公式情報を補完` if an X bearer token and current User Read rate are explicitly configured.
9. Run `AIで候補を再評価` to score up to 50 active candidates against the Mission and generate strategy/drafts where justified.
10. Today automatically builds a Daily Queue from Mission Match, relationship state, recommended action, self-improvement items and cleanup reviews.
11. Open the recommended person in the official social experience; the user performs the actual social action there.
12. Return to the PWA and record the result; completed candidates drop out of today's queue and the next actions move up.
13. In Relations, review mutual/no-follow-back/unknown state. Cleanup advice never auto-unfollows.
14. In Me, run AI analysis on the synced or manually pasted profile/recent posts to get Mission-based account improvement guidance.

## Low-cost strategy

The initial product is designed to remain useful at $0-$3/month:

1. reuse locally stored candidates instead of re-reading them
2. use free public-web discovery before paid social reads when configured
3. use X Owned Reads only when the connected account is explicitly confirmed eligible
4. cache owned X snapshots for 20 hours
5. pace each non-cached owned-X sync from the actual remaining monthly budget divided by the remaining billing-month days
6. rotate follower/following pages instead of repeatedly purchasing the same first-page coverage
7. refresh arbitrary X profile metadata no more than needed
8. batch X user lookup and AI candidate ranking
9. consume configured free model capacity before paid providers
10. combine ranking, recommended action, strategic rationale and limited message drafting into one AI pass
11. build the Daily Queue locally from stored state instead of paying an LLM every morning
12. reserve budget before any paid provider call and fail closed when accounting cannot be trusted
13. keep the product useful when every paid integration is disabled

Provider prices, eligibility rules and free tiers change, so paid rates and billing-mode flags are server configuration rather than hard-coded product assumptions.

## GitHub Pages PWA

`.github/workflows/deploy-pages.yml` builds the frontend with `VITE_BASE_PATH=/SNS-providers/` and deploys `dist/` to GitHub Pages whenever `main` changes.

GitHub requires custom Pages workflows to be enabled for the repository before the first deployment. Once enabled, merging to `main` triggers the deployment. If the Worker has been deployed, add a repository Actions variable named `VITE_API_BASE_URL` containing the Worker origin; otherwise the deployed PWA runs in local-only mode.

## Personal control key / D1 sync

`SYNC_TOKEN_SHA256` stores only a SHA-256 comparison value on the Worker. The original secret stays on the user's device and protects personal D1 state sync plus X OAuth start/disconnect and owned X data reads.

The state snapshot is access-controlled but is not application-level encrypted at rest. X OAuth access/refresh tokens are different: they are AES-GCM encrypted before D1 storage and are never included in AppState or JSON backups.

## Architecture

The browser-first v0.1 remains local-first so the PWA is useful before backend setup. Cloudflare Workers + D1 provide the server boundary for provider keys, encrypted OAuth tokens, budget accounting, public discovery and optional personal state/X snapshots.

- `src/` — PWA UI, local store, Daily Queue, backup/restore, D1 sync, X account controls, social handoff, discovery, ranking and self-analysis integration
- `public/` — portable manifest, icon and Service Worker
- `worker/` — Worker API, free-first provider routing, personal control gate, X OAuth/owned sync, pagination/pacing, budget safeguards and caching
- `db/schema.sql` — D1 data model
- `docs/ARCHITECTURE.md` — product/technical architecture and invariants

## Next implementation milestones

- safe accumulated full-cycle follow-graph evidence for stronger no-follow-back reconciliation across multiple rotated pages
- conflict-aware automatic/offline-first D1 sync instead of manual snapshots
- Instagram permitted-source ingestion beyond public-web candidate discovery
- scheduled Daily Queue refresh plus push notification delivery
- stronger local embedding/filter stage before LLM ranking
- accessibility, install-flow and empty/error-state polish
