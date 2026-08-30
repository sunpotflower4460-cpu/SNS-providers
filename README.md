# Social Mission / SNS-providers

Mission-driven, mobile-first PWA for growing meaningful social relationships. The product discovers, ranks, drafts and remembers; a social write happens only after one explicit user approval. When an official platform API permits that action, SNS-providers may execute it. Otherwise it uses an explicit HANDOFF to the official app. There is no auto-send and no bulk write.

## Current v0.1 foundation

- installable mobile PWA shell with 180 / 192 / 512 / 1024 truecolor sRGB PNG icons plus SVG fallback
- 5-tab UX: Today (Mission Inbox) / Discover / Relations / Me / Settings
- Mission + Communication DNA settings
- Mission Match candidate ranking and strategic next-action guidance
- SocialAction model for concrete work items, kept separate from Candidate (person/relationship CRM)
- Mission Inbox that prioritizes inbound DMs/replies/comments, conversation opportunities, relationship maintenance, new connections, light engagement and cleanup
- local-first Daily Queue fallback that still mixes connection, conversation, light engagement, self-improvement and follow cleanup while SocialActions are rolling out
- user-configurable daily workload caps for total queue / new connections / conversations / light engagement / cleanup / self-improvement
- local workload advisor that proposes a practical daily action volume from candidate quality and remaining budget; this is not a platform safety limit
- Today progress and summary cards are derived from the actual current Daily Queue instead of the raw candidate pool
- queue items automatically roll forward as today's interactions are recorded
- `明日へ` snooze temporarily removes a candidate from Today/Discover until the next local day without deleting relationship history
- local-day boundary refresh updates Today/Discover after midnight even when the PWA was left open; returning from the background also rechecks the current local day
- real-user candidate queues start empty; legacy development/demo candidates are removed from old local or restored state
- zero-cost local candidate prefilter before LLM ranking, reducing the normal ranking batch from up to 50 candidates to the strongest 30
- relationship-aware AI ranking receives stage, relationship score, existing reason/strategy and real engagement URL context
- reply/DM drafts are generated only when relationship/context guards allow them; stale drafts are cleared after reevaluation
- draft generation can be turned off from Settings (`autoDraftReplies`); when off the AI still ranks/recommends actions but writes no draft text
- suggested drafts are editable in place before use, with a one-tap revert to the AI's original suggestion; sending still requires one explicit user approval and never happens in the background
- social profile/comment text is treated as untrusted data and never as instructions to the ranking model
- X/Instagram official profile or real conversation-post handoff; no legacy tweet/follow intent shortcut and no automatic final action
- one-tap outcome capture after returning to the PWA
- manual outcomes conservatively grow relationship score/stage into an AI-assisted social CRM
- follow-cleanup `keep` decisions are tracked separately from genuine engagement and do not falsely increase relationship score
- iPhone-friendly candidate import by profile URL / handle / clipboard
- clear Discover empty states for no candidates, all-snoozed candidates and filtered-empty views
- free-first Tavily discovery for public X/Instagram profile candidates when explicitly configured in free mode
- official X public-profile enrichment in batches of up to 100 usernames when explicitly enabled
- read-only X OAuth 2.0 PKCE using only `tweet.read`, `users.read`, `follows.read`, `offline.access` by default; Settings upgrade buttons add write scopes cumulatively on the same X account (`tweet.write`, `follows.write`, `like.read`+`like.write`, `dm.read`+`dm.write`)
- AES-GCM encrypted X access/refresh token storage in D1 with server-side refresh
- budget-guarded owned X sync for the user's profile, recent posts, followers and following when explicitly eligible/configured
- 20-hour D1 cache for owned X sync to avoid needless repeated reads
- monthly X sync pacing based on remaining budget / remaining billing-month days
- rotating followers/following pagination so later syncs progress beyond the first page
- accumulated full-cycle follower evidence for tracked X accounts; partial pages never create negative follow-back evidence, while a completed cycle can safely classify tracked accounts as seen/unseen
- inbound X followers can be reused as candidate seeds without another X request
- optional Instagram Professional comment-engager sync using only the official API on the user's own media
- Instagram commenters can become high-signal `engaged` candidates and retain the related post as the next conversation surface
- Instagram comment sync preserves latestCommentId, lastCommentText, lastCommentAt, mediaId and latestMediaPermalink for the same latest event, then creates a `comment_reply` SocialAction
- server-authoritative `POST /api/social/actions/:id/execute` resolves the write target from D1 `social_actions` + `social_events`; client JSON cannot retarget the provider
- Instagram comment reply and Instagram Professional DM reply can be sent in-app after one explicit user approval when live permission probes and write flags are configured
- X mention/reply inbound sync, X DM inbound sync, X reply/follow/unfollow/like/DM write adapters, and Instagram webhook receiver code are in the Worker; production writes stay flag-off until a human turns them on
- Instagram follow / arbitrary like stay HANDOFF because the official Professional management API does not provide those writes
- versioned D1 migrations in `db/migrations/` with `npm run d1:migrate` and a `workflow_dispatch` production migrate Action
- Settings 本番準備チェック plus `npm run preflight` / `npm run preflight:prod`
- 12-hour D1 cache for Instagram engager sync
- local relationship history and relationship stages
- configurable follow-back review window with Mission-aware keep/cleanup advice
- AI self-analysis from profile + recent post text, including Mission Score, diagnosis, strategy and profile rewrite suggestion
- self-analysis stays explicitly unmeasured until the first real analysis; no placeholder score is shown
- X self-profile/recent-post sync automatically feeds the same Me analysis inputs
- JSON backup/restore for local-first Mission, candidate and relationship state
- restored JSON state is canonicalized and bounded: Mission, budget, workload, candidates, socialActions, social URLs, relationship fields, dates, metrics and insights are normalized before use
- optional token-gated D1 snapshot sync for moving state between personal devices
- D1 downloads pass through the same AppState normalization/validation as JSON backups before becoming live application state
- optimistic D1 concurrency protection prevents a stale/unknown device from silently overwriting a newer remote snapshot
- personal control key protects D1 state sync, X OAuth management/owned reads, Instagram Professional engager sync, user-approved social execute, social capability lookup, optional X inbound sync, budget reads, AI ranking, Tavily discovery and optional X enrichment
- configurable monthly API/LLM budget with a $3 server HARD LIMIT default; Settings persist a user ceiling and the Worker uses `min(HARD LIMIT, user ceiling)` so the client cannot raise the server cap
- restored state cannot disable HARD LIMIT
- free-first AI provider routing with local fallback
- fail-closed paid usage when the D1 budget ledger, provider rates, or Owned Read eligibility cannot be trusted
- pre-request budget reservations for paid calls to reduce concurrent overspend risk
- personal/provider Worker JSON responses use `Cache-Control: no-store` plus `X-Content-Type-Options: nosniff`
- production CSP restricts PWA API traffic to the configured Worker origin; CI verifies the generated binding
- CI security invariant checks guard provider authentication, conservative budget accounting, default read-only X OAuth with explicit optional write scopes, relationship-stage reply/DM rules, canonical social handoff, SocialAction restore/execute guards, full restored-state normalization, D1 restore validation and optimistic D1 sync
- D1 schema for candidates, interactions, Daily Queue, insights, budget ledger, OAuth tokens, pagination, full-cycle follow evidence and personal X/Instagram snapshots
- GitHub Pages PWA deployment workflow plus subpath-safe manifest / Service Worker
- CI verifies PWA icon dimensions/references, Service Worker precache coverage, web/Worker typechecking, security invariants and GitHub Pages/CSP builds

## Product rule

DISCOVER → COLLECT → PRIORITIZE → DRAFT → HUMAN APPROVAL → EXECUTE → RECORD / RECONCILE.

Only EXECUTE performs a social write. The app may discover, collect, prioritize, draft, remember and recommend. A social write requires one explicit user approval for one action. When an official platform API permits that action, SNS-providers may execute it in-app. When it does not, the PWA uses an explicit HANDOFF. There is no auto-send, no background bulk action, and no autonomous follow/unfollow/like/reply/DM. See `docs/ARCHITECTURE.md` for the safety and cost invariants.

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
npm run pwa:check
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
4. Optionally connect X in read-only mode by default. Write scopes are a separate optional set and are never requested by the default connect button.
5. Tap `Xデータを同期` to import the connected account's profile/recent posts and budget-permitted follower/following samples. Repeated taps within the cache window reuse D1 data at `$0` application-tracked cost.
6. Each non-cached X sync is paced from remaining monthly budget and continues followers/following from stored pagination cursors, gradually widening coverage instead of repeatedly buying the first page.
7. For X candidates already marked as followed, the Worker snapshots the tracked set at the start of a follower cycle and records whether each one is seen across rotated pages. Only a completed cycle can create negative follow-back evidence.
8. Existing tracked candidates are reconciled with follower data; inbound X followers can become new candidate seeds for later Mission ranking.
9. If an Instagram Professional account is configured, tap `コメント反応者を同期`. The Worker reads a bounded set of the user's own media/comments through the official API and turns existing commenters into high-signal relationship candidates without crawling Instagram globally.
10. Open Discover and tap `Missionから無料で候補を探す` when Tavily free discovery is configured, or add a profile URL/handle manually. A fresh install starts with no fabricated/demo people.
11. For arbitrary X candidates, optionally run `X公式情報を補完` if an X bearer token and current User Read rate are explicitly configured.
12. Run `AIで候補を再評価`. A zero-cost local filter chooses the strongest subset first; the AI then receives relationship context and produces Mission Match, strategy and only context-justified drafts.
13. Today builds a Mission Inbox from SocialActions when they exist, and still builds a Daily Queue from Mission Match, relationship state, recommended action, workload caps, self-improvement items and cleanup reviews as fallback. Its progress target and summary are based on that actual queue.
14. Use `明日へ` when an item is relevant but not worth handling now; the relationship record stays intact and the item returns after the snooze window.
15. Approve one action at a time from Mission Inbox. Official-API writes execute in-app after that one approval; Instagram follow/arbitrary like remain HANDOFF.
16. If a write result is unknown, use `結果を再確認`. Do not send again with a new execution id.
17. In Relations, review mutual/no-follow-back/unknown state. Cleanup advice never auto-unfollows, and the return sheet explicitly distinguishes `フォローを継続する` from `フォロー解除した`.
18. In Me, run AI analysis on the synced or manually pasted profile/recent posts to get Mission-based account improvement guidance. Before the first analysis, Mission Score remains unmeasured rather than displaying a fake value.
19. When moving state between devices, use JSON backup or D1 sync. Both restore paths normalize the complete AppState before it becomes active.

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
14. build the Daily Queue, local-day rollover and workload recommendation locally instead of paying an LLM every morning
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

D1 downloads are treated as persisted data rather than trusted executable state: Mission fields, budget/HARD LIMIT, workload settings, candidates, social URLs, relationship fields, dates, metrics and insights are normalized and validated before they replace local state. JSON backup restore uses the same normalization rules.

This is conflict-safe manual synchronization, not yet a field-level automatic merge engine. The state snapshot is access-controlled but is not application-level encrypted at rest. X OAuth access/refresh tokens are different: they are AES-GCM encrypted before D1 storage and are never included in AppState or JSON backups. Instagram access tokens are Worker-side secrets and are also never placed in AppState or the browser bundle.

## Architecture

The browser-first v0.1 remains local-first so the PWA is useful before backend setup. Cloudflare Workers + D1 provide the server boundary for provider keys, encrypted X OAuth tokens, Instagram server-side credentials, budget accounting, public discovery and optional personal state/social snapshots.

- `src/` — PWA UI, local store, relationship CRM, workload advisor, zero-cost prefilter, Daily Queue, local-day rollover, backup/restore normalization, conflict-safe D1 sync, X/Instagram account controls, official social handoff, discovery, ranking and self-analysis integration
- `public/` — portable manifest, PNG/SVG icons and Service Worker
- `worker/` — Worker API, free-first provider routing, personal control gate, relationship-aware AI safety guards, X OAuth/owned sync, full-cycle follow evidence, Instagram Professional comment-engager sync, pagination/pacing, budget safeguards and caching
- `db/schema.sql` — D1 data model
- `docs/ARCHITECTURE.md` — product/technical architecture and invariants
- `scripts/verify-security-invariants.mjs` — CI guard for provider-route authentication, budget reservations, full restored-state validation, conservative CRM behavior and read-only X OAuth scopes
- `scripts/verify-pwa-assets.mjs` — CI guard for icon dimensions, manifest/HTML references, Service Worker precache and production Pages output

## Capability matrix

| Action | Read | In-app write | Permission / flag | Execution |
| --- | --- | --- | --- | --- |
| X reply | yes | yes | `tweet.write` + `X_REPLY_WRITE_ENABLED` | Mission Inbox, one approval |
| X follow | yes | yes | `follows.write` + `X_FOLLOW_WRITE_ENABLED`; immutable user ID | Mission Inbox, one approval |
| X unfollow | yes | yes | `follows.write` + `X_UNFOLLOW_WRITE_ENABLED` | Mission Inbox, extra confirm |
| X like | yes | yes | `like.read`+`like.write` + `X_LIKE_WRITE_ENABLED`; canonical tweet ID | Mission Inbox, one approval |
| X DM | yes | yes | `dm.read`/`dm.write` + matching flags; existing conversation | inbound → approved reply |
| Instagram comments | yes | yes | runtime permission probe + `INSTAGRAM_COMMENT_REPLY_ENABLED` | Mission Inbox, one approval |
| Instagram DM | yes | yes | runtime message permission + 24h window + DM flags | inbound → approved reply |
| Instagram follow | limited | HANDOFF | official management API does not provide general follow write | open official app |
| Instagram arbitrary like | no | HANDOFF | official management API does not provide general like write | open official app |

Default X OAuth stays read-only. Write scopes are requested only by the matching Settings button. Missing prices fail closed. Repository write flags default to `false`.

See `docs/MANUAL_GO_LIVE_CHECKLIST.md` for the remaining human-only console, billing, and real-account work.

## Next implementation milestones

- optional automatic/field-level merge sync beyond the current conflict-safe manual D1 push/pull
- optional push notifications around locally generated Daily Queue changes
- optional local embedding/WebGPU stage beyond the current zero-cost lexical prefilter
- richer real-device QA polish after the manual go-live checklist
