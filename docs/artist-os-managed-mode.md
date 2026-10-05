# Artist OS managed mode

SNS-providers can run in two modes, selected by the non-secret Worker variable `ARTIST_OS_MODE`.

| `ARTIST_OS_MODE` | Mode | `modeInvalid` |
|---|---|---|
| unset, empty, `standalone` | standalone (default) | false |
| `artist_os_managed` | managed | false |
| anything else | managed (fail closed) | true |

Resolution happens per request in `worker/src/artistOsMode.ts` (`resolveArtistOsMode`). It is set in `worker/wrangler.jsonc` `vars` (a commented example is included) and is not a secret.

## Why

In managed mode, Artist OS has decided that **My-SNS is the canonical inbound owner for Instagram comment and DM events and the canonical Meta webhook receiver**. SNS-providers is relationship intelligence and proactive engagement only, and must never send an external reply for an inbound event that My-SNS owns.

## What changes in managed mode

- **Instagram comment reply / DM reply execution is refused.** `executeSocialAction` (`worker/src/social/execute.ts`) returns HTTP 409 with
  `{ ok:false, executionMode:'handoff', ownerSystem:'my-sns', code:'MANAGED_MODE_INBOUND_OWNER_MY_SNS', message }`
  before any D1 claim, execution row, fingerprint, budget reservation or provider call. The guard checks the action id (`sa-ig-comment-*`, `sa-ig-dm-*`) first, with no D1 access, and again by canonical platform/type after the action is loaded. Defense in depth: `performProviderWrite` and the adapters `replyToInstagramComment` / `sendInstagramDm` also refuse.
- **Meta webhook** (`/api/instagram/webhook`): GET verification returns 403 `MANAGED_MODE_NOT_CANONICAL_META_RECEIVER`; POST returns 200 `{ ignored:true, reason }` without signature work, ingestion, D1 or budget access (a 200 stops Meta retries).
- **Instagram comment/DM polling** does not ingest: `syncInstagramComments`, `syncInstagramDirectMessages`, `/api/instagram/dm/sync`, `/api/social/inbox/sync` and the scheduled sync return a non-error disabled result with code `MANAGED_MODE_INBOUND_OWNER_MY_SNS` (HTTP 200). No Instagram lease, checkpoint, API call or `social_events`/`social_actions` write happens. The engager sync (`/api/instagram/engagers/sync`) still returns engager data for relationship intelligence but does not persist comment events.
- **Reporting** (additive): `GET /api/health` (public) and `GET /api/social/capabilities` include `runtimeMode`, `modeInvalid`, `ownership` and `capabilities`:
  - `ownership.inboundReplyExecution.instagram`: managed = false. Standalone = true only when the write flags make it executable (`SOCIAL_WRITE_ENABLED=true` plus `INSTAGRAM_COMMENT_REPLY_ENABLED` or `INSTAGRAM_DM_WRITE_ENABLED`, or `SOCIAL_WRITE_MODE=test`).
  - `ownership.inboundReplyExecution.x`: follows `X_REPLY_WRITE_ENABLED` in both modes.
  - `ownership.canonicalMetaWebhookReceiver`: true standalone, false managed.
  - `ownership.relationshipIntelligence` and `proactiveEngagement`: always true.
  - `capabilities` may contain `reply.instagram.comment.execute`, `reply.instagram.dm.execute`, `reply.x.mention.execute` (standalone, subject to flags). Managed mode never lists any `reply.instagram.*.execute`. No secrets are exposed.

## What does not change

- Standalone behavior is unchanged: the same code paths, flags, approvals and refusal reasons as before.
- X flows (mentions, DMs, follows, unfollows, likes) are not My-SNS-owned inbound and are unchanged in managed mode. X like stays human-approved; Artist OS treats `x.like` as a HANDOFF on its side, and this Worker keeps its existing behavior.
- `prepare` (draft / recommended reply direction) stays allowed.
- Reconcile (`/api/social/executions/:id/reconcile`) is read-only against the provider for executions that already exist and never sends; it is unchanged.
- The Meta webhook implementation is retained and active in standalone mode.
- Existing stored Instagram actions/events remain readable; they simply cannot be executed from here in managed mode.

## Relationship enrichment (managed mode, read-only)

`GET /api/service/v1/relationship-enrichment` lets Artist OS ask SNS-providers for relationship intelligence about the inbound events My-SNS owns. It is intelligence only: it never creates an executable action, never carries reply text, and SNS-providers still never sends a reply for a My-SNS-owned event.

**Existence.** Only when `ARTIST_OS_MODE=artist_os_managed` (an invalid value counts as managed). In standalone mode the route does not exist (404, no outbound call, no D1 access). Non-GET in managed mode is 405.

**Auth and token scopes.**
- `ARTIST_OS_READ_TOKEN_SHA256` (secret): hex SHA-256 of a read-only token, compared in constant time. It is accepted ONLY for `/api/service/*` read routes (today: this one). `authorizeSync` (every other route: execute, prepare, snooze, dismiss, reconcile, sync, OAuth, ...) never accepts it.
- The existing `SYNC_TOKEN_SHA256` token keeps working everywhere, including this route.
- No/invalid token: 401. Neither token configured: 503 (fail closed). Auth runs before any D1 read or outbound call.

**Environment variables.** `ARTIST_OS_READ_TOKEN_SHA256` (secret), `MY_SNS_URL` (non-secret https origin; `http` only for localhost; no credentials; only the origin is used, the path is fixed), `MY_SNS_READ_TOKEN` (secret, sent only to My-SNS, never logged or returned).

**What is read.**
1. From My-SNS: one `GET {MY_SNS_URL}/api/service/v1/inbound-events` (8 s timeout, `redirect:'error'`, 1 MB response cap, strict hand-written validation of `contractVersion:1`, `service:'my-sns'` and every event field). One malformed event invalidates the whole feed. Unknown upstream keys are tolerated and discarded. Only `platform`, `kind`, `externalEventId`, `contactRef`, `needsAction`, `replyState` are used; handle, excerpt and seedRef are validated and dropped, DM text is never available.
2. From D1: one `SELECT ... FROM state_snapshots WHERE user_id = 'local-user'` (the AppState blob: candidates, interactions). No D1 write, no provider/Meta/X call, no AI call, no paid API.

**What is never sent.** No reply text, draft, handle, display name, bio, message text, URL, token or upstream junk field. The response contains only the strict payload keys below. At most 200 artifacts (first 200 distinct events of the feed).

**Response.** `{ contractVersion:1, service:'sns-providers', generatedAt, artifacts:[...], truncated, hasMore }` with `Cache-Control: no-store`. `truncated`/`hasMore` are `true` when more distinct events existed than the 200-artifact cap (the list is then a prefix, not the whole truth; events beyond it have no relationship context). They are explicit booleans, `false` when the report is complete. Each artifact is an envelope `{ schemaVersion:1, artifactId:'rel_<platform>_<externalEventId>', kind:'RelationshipEnrichmentArtifact', producer:'sns-providers', createdAt, subjectRefs:[], payloadVersion:1, payload }`. The payload mirrors Artist-OS `src/contracts/relationship.ts` exactly (strict, no extra keys): `subject{platform, externalEventId}` (copied unchanged from the My-SNS event; one artifact per distinct (platform, externalEventId), first wins), `candidateRef?`, `relationshipStage`, `relationshipValue` (0..1 or null), `priority`, `recommendedHandling`, `reasonCodes` (max 8), `interactionCount?`, `generatedAt`, `analyzer{name:'sns-providers-relationship', version}`. Every artifact is re-checked by a strict validator before it is emitted.

**Scoring rules** (pure functions in `worker/src/relationshipEnrichment.ts`; no AI).
- Join key: `(event.platform, contactRef.externalContactId)` equals `(candidate.platform, candidate.platformUserId)`. Never handle, username or title. `contactRef.platform` must equal the event platform. Candidates without a stable `platformUserId` are not joinable.
- No match (no contactRef, or no candidate): stage `unknown`, value `null`, priority `normal`, reasons `no-candidate-match` + `new-contact` (contact known, no candidate) or `no-candidate-match` + `insufficient-data` (no contactRef, or more than one candidate shares the id: ambiguous). Handling: DM, missing or ambiguous contact => `human_review`; otherwise public event => `reply`.
- Match: `relationshipStage` = candidate stage (an unreadable stage becomes `unknown`, never guessed); `relationshipValue` = `relationshipScore/100`; `interactionCount` = interactions of that candidate excluding `skipped` (omitted if the snapshot has no interactions array).
  - `repeat-interaction`: interactionCount >= 2. `high-match`: mission `match` >= 70. `low-match`: `match` <= 29. `dormant`: `lastInteractionAt` older than 90 days. `insufficient-data`: stage/score unreadable, or no interactions and score 0. `mission-aligned` and `stage-advanced-recently` are not emitted (no verifiable history yet).
  - Priority: `high` if stage is recognized/conversation/relationship or score >= 70; `normal` if stage is engaged or score >= 35 (or stage/score unreadable); else `low`.
  - Handling: `reply` for high/normal, `reply_later` for low, `human_review` when stage/score is unreadable.
- Override for any event: `replyState` is `sent` or `scheduled`, or `needsAction` is false => `no_reply`.

**Failure behavior (fail closed, explicit, never fabricated).** Body `{ ok:false, contractVersion:1, service:'sns-providers', code, reason }` with static reason text (no upstream body, no URL, no token) and no `artifacts` key:
- 503 `ENRICHMENT_NOT_CONFIGURED` (MY_SNS_URL/MY_SNS_READ_TOKEN missing or invalid; no outbound call).
- 502 `MY_SNS_UNREACHABLE`, `MY_SNS_HTTP_ERROR` (non-2xx, including redirects), `MY_SNS_RESPONSE_INVALID` (not JSON, wrong service/version, any malformed event), `MY_SNS_RESPONSE_TOO_LARGE`; 504 `MY_SNS_TIMEOUT`.
- 503 `RELATIONSHIP_STATE_UNAVAILABLE`: snapshot missing, unreadable, unparsable or without a candidates array (only checked when the feed has events; an empty feed returns empty artifacts without reading D1).

**Health.** `/api/service/health` lists `relationship.enrichment.read` only in managed mode when the route is usable (read token hash + valid `MY_SNS_URL` + `MY_SNS_READ_TOKEN`). Otherwise managed mode reports `status:'degraded'` with a `degradedReason`. Standalone never lists it.

## Relationship to My-SNS inbound

My-SNS owns Inbox/ReplyJob and receives the Meta webhook. The relationship enrichment route above reads My-SNS inbound events read-only, as context for relationship intelligence; it never creates executable reply actions here.

## Verification

`node scripts/check-managed-mode.mjs` (part of `npm run security:check`) bundles the real router and proves the mode table, the handoff result with zero provider calls and zero D1 access, webhook GET/POST behavior, no IG ingestion on sync, X unaffected, standalone reaching the existing path, and the health/capabilities fields in both modes.

`node scripts/check-relationship-enrichment.mjs` (also in `npm run security:check`) covers the enrichment route: standalone 404, auth/503, read-token scoping across every other route, GET-only/zero-write outbound behavior, 1:1 id mapping and (platform, platformUserId) joining, privacy, fail-closed upstream/state failures, the strict payload validator, and the health capability.
