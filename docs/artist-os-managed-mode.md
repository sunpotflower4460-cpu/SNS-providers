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

## Relationship to My-SNS inbound

My-SNS owns Inbox/ReplyJob and receives the Meta webhook. Artist OS may later pass My-SNS inbound events to SNS-providers read-only, as context for relationship intelligence. That would be a read-only input: it would not create executable reply actions here.

## Verification

`node scripts/check-managed-mode.mjs` (part of `npm run security:check`) bundles the real router and proves the mode table, the handoff result with zero provider calls and zero D1 access, webhook GET/POST behavior, no IG ingestion on sync, X unaffected, standalone reaching the existing path, and the health/capabilities fields in both modes.
