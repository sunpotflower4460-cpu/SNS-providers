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
- 24-hour client-side X profile refresh guard to reduce redundant reads
- local relationship history and relationship stages
- configurable follow-back review window with Mission-aware keep/cleanup advice
- AI self-analysis from profile + recent post text, including Mission Score, diagnosis, strategy and profile rewrite suggestion
- JSON backup/restore for local-first Mission, candidate and relationship state
- configurable monthly API/LLM budget with a $3 default and always-on HARD LIMIT
- free-first AI provider routing with local fallback
- fail-closed paid usage when the D1 budget ledger or explicit current provider rates are unavailable
- pre-request budget reservations for paid calls to reduce concurrent overspend risk
- D1-ready schema for candidates, interactions, Daily Queue, insights and budget ledger
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

`VITE_API_BASE_URL` is optional. Leave it empty for local-only mode. Point it at the deployed Worker to enable free discovery, live budget sync, AI ranking, self-analysis and optionally budget-guarded X profile enrichment.

Production validation:

```bash
npm run typecheck
npm run build
npm run preview
```

## Worker

The Worker lives in `worker/` and keeps provider keys out of the browser.

```bash
cd worker
npm install
npm run typecheck
```

See `worker/README.md` for D1, secrets, free provider configuration, provider-rate configuration and deployment.

Paid usage is fail-closed. If D1 budget accounting is unavailable, paid provider rates are missing, or a reservation would exceed the HARD LIMIT, paid LLM/X requests are blocked. Free Tavily discovery, free Groq or local scoring can continue when their relevant free-mode configuration is available.

## Mobile flow

1. Open Discover and tap `Missionから無料で候補を探す` when Tavily free discovery is configured, or add a profile URL/handle manually.
2. Free discovery searches the public web for X/Instagram profile-shaped results and adds only new candidates to the local pool.
3. For X, optionally run `X公式情報を補完` if an X bearer token and current User Read rate are explicitly configured.
4. Run `AIで候補を再評価` to score up to 50 active candidates against the Mission and generate strategy/drafts where justified.
5. Today automatically builds a Daily Queue from current Mission Match, relationship state, recommended action, self-improvement items and cleanup reviews.
6. Open the recommended person in the official social experience.
7. Return to the PWA and record the result; completed candidates drop out of today's queue and the next actions move up.
8. In Relations, mark follow-back status as `相互 / フォロバなし / 未確認`.
9. After the configured waiting period, weak/no-follow-back relationships can appear as cleanup review candidates; high-Mission or meaningful relationships are preserved.
10. In Me, paste the current profile and several recent posts to get Mission-based account improvement guidance.
11. Settings can export/import a JSON backup while the app is still local-first.

## Low-cost strategy

The initial product is designed to remain useful at $0-$3/month:

1. reuse locally stored candidates instead of re-reading them
2. use free public-web discovery before paid social reads when configured
3. refresh X profile metadata no more than needed
4. batch X user lookup and AI candidate ranking
5. consume configured free model capacity before paid providers
6. combine ranking, recommended action, strategic rationale and limited message drafting into one AI pass
7. build the Daily Queue locally from stored state instead of paying an LLM every morning
8. reserve budget before any paid provider call
9. block paid calls if budget accounting cannot be trusted
10. keep the product useful when every paid integration is disabled

Provider prices and free tiers change, so paid rates and free/paid billing-mode flags are server configuration rather than hard-coded product assumptions.

## GitHub Pages PWA

`.github/workflows/deploy-pages.yml` builds the frontend with `VITE_BASE_PATH=/SNS-providers/` and deploys `dist/` to GitHub Pages whenever `main` changes.

GitHub requires custom Pages workflows to be enabled for the repository before the first deployment. Once enabled, merging to `main` triggers the deployment. If the Worker has been deployed, add a repository Actions variable named `VITE_API_BASE_URL` containing the Worker origin; otherwise the deployed PWA runs in local-only mode.

## Architecture

The browser-first v0.1 stores interaction state locally so the PWA is immediately usable. Cloudflare Workers + D1 provide the server boundary for provider keys and budget accounting.

- `src/` — PWA UI, local store, Daily Queue, backup/restore, API client, social handoff, discovery, ranking and self-analysis integration
- `public/` — portable manifest, icon and Service Worker
- `worker/` — Worker API, free-first discovery/provider routing, budget ledger safeguards and X profile enrichment
- `db/schema.sql` — D1 data model
- `docs/ARCHITECTURE.md` — product/technical architecture and invariants

## Next implementation milestones

- authenticated offline-first D1 sync for candidate/relationship history
- owned-account X OAuth adapter for followers/following/self-post analysis without browser secrets
- Instagram permitted-source ingestion beyond public-web candidate discovery
- scheduled Daily Queue refresh plus push notification delivery
- stronger local embedding/filter stage before LLM ranking
- accessibility, install-flow and empty/error-state polish
