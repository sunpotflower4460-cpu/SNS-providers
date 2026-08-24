# Production data / provider preflight

This file is the production boundary checklist for the optional Cloudflare Worker + D1 deployment.

## 1. Prefer a fresh D1 database for the first production deployment

`db/schema.sql` is authoritative for a fresh database. The repository currently ships a placeholder D1 ID in `worker/wrangler.jsonc`; do not deploy paid/provider routes until that placeholder is replaced with the real database ID.

Typical setup from the `worker/` directory:

```bash
npx wrangler d1 create social-mission
# copy the returned database_id into worker/wrangler.jsonc
npx wrangler d1 execute social-mission --remote --file=../db/schema.sql
```

Then deploy the Worker and verify `/api/health` before connecting the PWA.

## 2. Existing D1 databases require an explicit schema review

Do **not** treat re-running `CREATE TABLE IF NOT EXISTS` as a migration. SQLite/D1 does not retrofit newer `CHECK`, `NOT NULL`, uniqueness, or column constraints onto an already-existing table merely because the current `CREATE TABLE IF NOT EXISTS` contains them.

Before reusing an older D1 database, inspect the deployed definitions, for example:

```sql
SELECT name, sql
FROM sqlite_master
WHERE type IN ('table', 'index')
ORDER BY type, name;
```

Compare the result with `db/schema.sql`. If the production database predates the current constraints, create and test an explicit migration (usually create-copy-validate-swap for SQLite constraints) or use a fresh database. Never assume the current schema was applied just because the command completed successfully.

The highest-risk tables to verify are:

- `budget_ledger` — non-negative cost/unit checks and the monthly HARD LIMIT depend on trustworthy rows.
- `x_oauth_tokens` — expiry/token fields must match the current OAuth code.
- `x_owned_paging` / `x_follow_cycle_targets` — cycle and evidence integrity protects follow-back decisions.
- `state_snapshots` — optimistic versioning protects cross-device state.
- `x_owned_snapshots` / `instagram_engager_snapshots` — current Worker code now rejects malformed cached JSON, but the tables still need to exist with the expected keys.

## 3. X API pricing must be confirmed at deployment time

X uses pay-per-usage credits and says endpoint rates are subject to change. As checked on 2026-08-24, the official X API pricing page lists:

- `User: Read`: `$0.010` per resource.
- `Following/Followers: Read`: `$0.010` per resource for ordinary reads.
- Qualifying **Owned Reads**: `$0.001` per resource, including your own `/2/users/{id}/tweets`, `/followers`, and `/following` when `{id}` is the authenticated user and that user owns the developer app.

Official reference: https://docs.x.com/x-api/getting-started/pricing

For the current adapter that means the deployment values should be reviewed in the Developer Console immediately before enabling paid X reads. At the rates above the expected values are:

```text
X_USER_READ_USD=0.010
X_OWNED_READ_USD=0.001
```

Only set:

```text
X_OWNED_READ_ELIGIBLE=true
```

when the connected account/app relationship actually satisfies X's current Owned Read eligibility rule. Leaving it unset/false intentionally fails closed.

Do not hard-code today's rates into application logic: the Worker requires explicit deployment-time rate configuration so a future X pricing change cannot silently become billable under an outdated assumption.

## 4. Production smoke test order

1. Apply/verify D1 schema.
2. Configure `SYNC_TOKEN_SHA256` and a 32-byte `OAUTH_TOKEN_ENCRYPTION_KEY_B64`.
3. Configure `ALLOWED_ORIGIN` to the production PWA origin.
4. Deploy Worker and verify `/api/health`.
5. Test D1 download/upload and an intentional optimistic conflict from a second client.
6. Configure X OAuth callback/return URLs; connect X and verify `/2/users/me`.
7. Confirm current X rates/Owned Read eligibility, then enable X read variables.
8. Test follower/following/posts sync twice and confirm the second run uses valid cache rather than another paid read when appropriate.
9. Configure Instagram Professional credentials/version and verify media/comment sync twice, including cache reuse.
10. Configure free Tavily/Groq paths as desired and test automatic replenishment with the monthly paid budget still protected.
11. Deploy the Pages build with `VITE_API_BASE_URL` pointing at the Worker.
12. Smoke-test Today/Discover/Relations/Me/Settings on desktop and iPhone, including official X/Instagram handoff.

Final follow/like/reply/DM/unfollow actions remain human-controlled on the official social platform.
