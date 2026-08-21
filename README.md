# Social Mission / SNS-providers

Mission-driven, mobile-first PWA for growing meaningful social relationships without automating the final social action.

## Current v0.1 foundation

- Installable mobile PWA shell
- 5-tab UX: Today / Discover / Relations / Me / Settings
- Mission + Communication DNA settings
- Mission Match candidate ranking UI
- X Web Intent / official profile handoff
- Instagram official profile handoff
- one-tap outcome capture after returning to the PWA
- iPhone-friendly candidate import by profile URL / handle / clipboard
- live PWA -> Cloudflare Worker budget sync and Mission ranking
- local relationship history and relationship stages
- AI self-analysis cards for profile/content/network improvement
- configurable monthly API/LLM budget with a $3 default and HARD LIMIT concept
- free-first AI provider routing with a local fallback
- D1-ready schema for candidates, interactions, Daily Queue, insights and budget ledger
- CI for both the web app and Worker

## Product rule

The app may discover, rank, draft, remember and recommend. The final follow/like/reply/DM/unfollow action remains user-initiated in the official social experience. See `docs/ARCHITECTURE.md` for the safety and cost invariants.

## Run the PWA locally

```bash
cp .env.example .env.local
npm install
npm run dev
```

`VITE_API_BASE_URL` is optional. Leave it empty for local-only mode. Point it at the deployed Worker to enable live budget sync and AI ranking.

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

See `worker/README.md` and `worker/wrangler.example.toml` for D1, secrets, provider-rate configuration and deployment.

The paid fallback is fail-closed: if paid provider rates are not explicitly configured, the Worker will not treat the request as free and silently spend money. If free providers are unavailable or the remaining HARD LIMIT budget is insufficient, ranking falls back to local scoring instead.

## Mobile flow

1. Copy an Instagram/X profile URL or handle.
2. Open Discover and add it from the clipboard.
3. Run `AIで候補を再評価` to score up to 50 active candidates against the Mission.
4. Open the recommended person in the official social experience.
5. Return to the PWA and record the result.
6. The local relationship history feeds the next recommendation cycle.

## Low-cost strategy

The initial product is designed to remain useful at $0-$3/month:

1. reuse cached/persisted candidates instead of re-reading them
2. use local filters/embeddings for cheap ranking stages
3. consume configured free model capacity before paid providers
4. use paid social API reads only for the highest-value missing information
5. enforce the user's monthly HARD LIMIT before paid calls
6. keep the app useful when every paid/provider integration is disabled

Provider prices and free tiers change, so prices should be server configuration rather than hard-coded product assumptions.

## Architecture

The browser-first v0.1 stores interaction state locally so the PWA is immediately usable. Cloudflare Workers + D1 provide the server boundary for provider keys, budget accounting and future account adapters.

- `src/` — PWA UI, local store, API client, social handoff and ranking integration
- `public/` — manifest, icon and Service Worker
- `worker/` — Worker API and free-first provider routing
- `db/schema.sql` — D1 data model
- `docs/ARCHITECTURE.md` — product/technical architecture and invariants

## Next implementation milestones

- persist PWA candidates/relations into D1 with offline-first sync
- X OAuth/read adapter with spend accounting
- Instagram permitted-source candidate ingestion
- scheduled Daily Queue generation
- live self-profile/post analysis
- message drafting endpoint with Communication DNA
- follow-back / relationship review assistant
- install/push notification polish and accessibility checks
