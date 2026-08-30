# Manual go-live checklist

This list contains only work that a human must do on external consoles, with real accounts, or on a physical device. There is no remaining code, migration authoring, or CI work in this repository for these items.

Do not turn production writes on until the matching official permission, price, and one-action smoke test are confirmed.

## Cloudflare

1. Confirm `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub Actions secrets.
2. Confirm Worker secrets in the Cloudflare dashboard. Do not paste them into git.
   - Personal control token hash: `SYNC_TOKEN_SHA256`
   - X OAuth: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_OAUTH_CALLBACK_URL`, `PWA_RETURN_URL`, `OAUTH_TOKEN_ENCRYPTION_KEY_B64`
   - Instagram: `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, `INSTAGRAM_API_VERSION`
   - Optional webhook: `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `INSTAGRAM_APP_SECRET`
3. Run GitHub Action **Migrate production D1** (`workflow_dispatch`) against production.
4. Cloudflare dashboard Worker `sns-providers` → Settings → Build: set **Build command** to `npm run build` if the GitHub `Workers Builds` check is still red. The repo also builds `./dist` during Cloudflare install when `WORKERS_CI=1`. Keep deploy as `npx wrangler deploy` and non-production as `npx wrangler versions upload`.
5. Confirm `/api/preflight` from Settings → 本番準備チェック, or `npm run preflight:prod`.

## Meta / Instagram

5. Complete Meta App permissions / App Review for comment and messaging scopes used by the current Instagram Login flow.
6. Issue a live Professional account token and set Worker secrets.
7. Register the Instagram webhook callback in Meta App Dashboard (`GET|POST /api/instagram/webhook`). Polling works without this.
8. Confirm the connected account is BUSINESS / CREATOR / MEDIA_CREATOR.

## X Developer

9. Configure the X app as a confidential web app with the exact Worker callback URL.
10. Keep default user connect read-only. Grant write scopes only through the in-app upgrade buttons:
    - 返信権限 → `tweet.write`
    - フォロー権限 → `follows.write`
    - いいね権限 → `like.write`
    - DM権限 → `dm.read` + `dm.write`
11. Complete each OAuth consent in the official X dialog.
12. Enter current official X API prices into Worker vars. Missing prices stay fail-closed. Do not set `$0` unless the operation is confirmed free.
    - `X_REPLY_WRITE_USD`
    - `X_FOLLOW_WRITE_USD`
    - `X_UNFOLLOW_WRITE_USD`
    - `X_LIKE_WRITE_USD`
    - `X_DM_WRITE_USD`
    - `X_DM_READ_USD`
    - `X_INBOUND_READ_USD`
    - `X_LOOKUP_READ_USD` or `X_USER_READ_USD`
    - `SOCIAL_RECONCILE_READ_USD`
    - Instagram: set `INSTAGRAM_COMMENT_REPLY_USD=0` and `INSTAGRAM_DM_READ_USD` / `INSTAGRAM_DM_WRITE_USD` only after confirming Meta does not bill those calls.

## Production write flags

Repository defaults stay OFF. Turn on one operation at a time after the matching permission and price exist:

13. `SOCIAL_WRITE_ENABLED=true`
14. `INSTAGRAM_COMMENT_REPLY_ENABLED=true`
15. `INSTAGRAM_DM_READ_ENABLED=true` / `INSTAGRAM_DM_WRITE_ENABLED=true`
16. `X_REPLY_WRITE_ENABLED=true`
17. `X_FOLLOW_WRITE_ENABLED=true` / `X_UNFOLLOW_WRITE_ENABLED=true`
18. `X_LIKE_WRITE_ENABLED=true`
19. `X_DM_READ_ENABLED=true` / `X_DM_WRITE_ENABLED=true`
20. Leave `SOCIAL_SCHEDULED_READ_ENABLED` false unless you have confirmed read cost and rate limits.

## Real-account smoke tests

Use Mission Inbox. One user approval per write. Never batch.

21. Instagram comment reply
22. Instagram inbound DM + approved reply (inside the 24-hour messaging window)
23. X mention/reply inbound + approved reply
24. X follow (confirm pending vs following)
25. X like
26. X inbound DM + approved reply

## Real-device checks

27. iPhone PWA install, keyboard, safe-area, offline note, snooze/dismiss, unknown-result “結果を再確認”
28. Desktop Settings capability upgrade buttons and 本番準備チェック copy (red/yellow/green also have words)

If a write is blocked, the preflight reason names the exact Settings button or secret to fix. Do not bypass HANDOFF for Instagram follow / arbitrary like; those are provider limitations, not unfinished code.
