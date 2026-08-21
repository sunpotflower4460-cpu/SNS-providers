# Social Mission architecture

## Product principle

The product is a mobile-first PWA that helps a user grow meaningful social relationships toward a stated Mission. It does not automate follows, likes, replies, or DMs. The app discovers, ranks, drafts, remembers and advises; the authenticated user performs the final social action in the official X or Instagram experience.

## Core loop

1. Mission and communication DNA are stored.
2. Candidate sources add people/posts to a persistent pool.
3. Cheap local filters remove obvious mismatches and duplicates.
4. The AI router ranks candidates against Mission.
5. A Daily Queue mixes follow, engagement, relationship and cleanup actions.
6. The PWA hands off to the official social surface.
7. On return, the user records the outcome in one tap.
8. Relationship stage, self-analysis and future ranking adapt.

## Client

- React + TypeScript + Vite
- installable standalone PWA
- local-first state for the initial single-user phase
- Service Worker for app-shell resilience
- X Web Intents for user-initiated handoff where available
- normal Instagram profile links for user-initiated handoff

## Server target

Cloudflare Workers + D1 is the intended low-cost backend. Secrets must never be shipped to the browser.

Server responsibilities:

- provider API keys and OAuth secrets
- candidate discovery connectors
- AI provider routing
- usage ledger and HARD LIMIT enforcement
- scheduled Daily Queue generation
- cached normalized social data
- encrypted/secure token storage where OAuth is later added

## AI router

Order of preference for the initial low-cost mode:

1. local deterministic rules / local embeddings
2. free model capacity (for example Groq when configured)
3. another permitted free provider for public-data workloads
4. low-cost paid fallback such as DeepSeek when configured
5. stop paid work when the configured HARD LIMIT would be crossed

Provider availability and prices change, so no price is hard-coded as product truth. Pricing/configuration belongs in server-side provider configuration and the usage ledger.

## Budget invariant

Every paid operation must reserve an estimated amount before the network call and reconcile actual cost afterward. If `hardLimit=true`, a request that could cross the monthly cap is rejected or downgraded to a free/local route.

The product should degrade acquisition volume, refresh frequency and model depth before degrading core features.

## Social safety invariant

- No DOM automation of X/Instagram.
- No hidden WebView follow/like/unfollow automation.
- No credential collection for social-account passwords.
- No automatic bulk follow/unfollow behavior.
- Unfollow is a review recommendation based on relationship value, not an automatic follow-back churn rule.

## Candidate sources

Candidate ingestion is adapter-based. Initial adapters can include:

- manually pasted/shared profile URLs
- X official API when budget permits
- user-owned X reads where useful
- official Instagram API capabilities where applicable
- approved web-search discovery that returns public URLs, without turning into social-platform scraping
- previously stored candidates and relationship history

## Relationship model

`discovered -> interested -> following -> engaged -> recognized -> conversation -> relationship`

Stages are guidance, not an irreversible funnel. The AI may recommend keeping a valuable one-way follow even without follow-back.

## Store migration path

The current PWA uses localStorage to make the first version immediately usable. `db/schema.sql` defines the server-side data model so local state can later synchronize to D1 without changing the product concepts.
