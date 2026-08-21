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
- local relationship history and relationship stages
- AI self-analysis cards for profile/content/network improvement
- configurable monthly API/LLM budget with a $3 default and HARD LIMIT concept
- free-first AI provider routing policy
- D1-ready schema for candidates, interactions, Daily Queue, insights and budget ledger
- CI typecheck + production build

## Product rule

The app may discover, rank, draft, remember and recommend. The final follow/like/reply/DM/unfollow action remains user-initiated in the official social experience. See `docs/ARCHITECTURE.md` for the safety and cost invariants.

## Run locally

```bash
npm install
npm run dev
```

Production validation:

```bash
npm run typecheck
npm run build
npm run preview
```

## Low-cost strategy

The initial product is designed to remain useful at $0-$3/month:

1. reuse cached/persisted candidates instead of re-reading them
2. use local filters/embeddings for cheap ranking stages
3. consume configured free model capacity before paid providers
4. use paid social API reads only for the highest-value missing information
5. enforce the user's monthly HARD LIMIT before paid calls

Provider prices and free tiers change, so prices should be server configuration rather than hard-coded product assumptions.

## Architecture

The browser-first v0.1 stores state locally so the PWA is immediately usable. The target production backend is Cloudflare Workers + D1, with API keys and OAuth secrets kept server-side.

- `src/` — PWA UI, local store, social handoff and AI routing policy
- `public/` — manifest, icon and Service Worker
- `db/schema.sql` — target D1 data model
- `docs/ARCHITECTURE.md` — product/technical architecture and invariants

## Next implementation milestones

- Cloudflare Worker API boundary + D1 migrations
- real provider adapters (free-first AI router)
- X OAuth/read adapter with spend accounting
- Instagram permitted-source candidate ingestion
- candidate URL paste/import flow for iOS PWA
- scheduled Daily Queue generation
- real self-profile/post analysis
- install/push notification polish and accessibility checks
