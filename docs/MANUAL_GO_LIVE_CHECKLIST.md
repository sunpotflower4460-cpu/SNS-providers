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
4. Cloudflare dashboard Worker `sns-providers` → Settings → Build:
   - Enable **Builds for non-production branches** (Branch control). Pull-request `Workers Builds: sns-providers` stays `Deployment skipped` until this is on. The repo cannot flip that dashboard toggle.
   - Set **Build command** to `npm run build` if production builds still miss `./dist`. The repo also builds during Cloudflare install when `WORKERS_CI=1`, and `wrangler deploy` runs `[build]`.
   - Keep deploy as `npx wrangler deploy` (or `npm run deploy`) and non-production as `npx wrangler versions upload` (or `npm run upload`).
5. Confirm GitHub Pages is using GitHub Actions (Settings → Pages). The deploy workflow now requests enablement automatically.
6. Confirm `/api/preflight` from Settings → 本番準備チェック, or `npm run preflight:prod`.

## Meta / Instagram

7. Complete Meta App permissions / App Review for comment and messaging scopes used by the current Instagram Login flow.
8. Issue a live Professional account token and set Worker secrets.
9. Register the Instagram webhook callback in Meta App Dashboard (`GET|POST /api/instagram/webhook`). Webhook is the realtime primary for comments. Polling fallback covers bounded paginated catch-up of owned media. For reliable comments on older media, Meta webhook registration is required.
10. Confirm the connected account is BUSINESS / CREATOR / MEDIA_CREATOR.

## X Developer

11. Configure the X app as a confidential web app with the exact Worker callback URL.
12. Keep default user connect read-only. Grant write scopes only through the in-app upgrade buttons:
    - 返信権限 → `tweet.write`
    - フォロー権限 → `follows.write`
    - いいね権限 → `like.read` + `like.write`
    - DM権限 → `dm.read` + `dm.write`
13. Complete each OAuth consent in the official X dialog.
14. Enter current official X API prices into Worker vars. Missing prices stay fail-closed. Do not set `$0` unless the operation is confirmed free.
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

15. `SOCIAL_WRITE_ENABLED=true`
16. `INSTAGRAM_COMMENT_REPLY_ENABLED=true`
17. `INSTAGRAM_DM_READ_ENABLED=true` / `INSTAGRAM_DM_WRITE_ENABLED=true`
18. `X_REPLY_WRITE_ENABLED=true`
19. `X_FOLLOW_WRITE_ENABLED=true` / `X_UNFOLLOW_WRITE_ENABLED=true`
20. `X_LIKE_WRITE_ENABLED=true`
21. `X_DM_READ_ENABLED=true` / `X_DM_WRITE_ENABLED=true`
22. Leave `SOCIAL_SCHEDULED_READ_ENABLED` false unless you have confirmed read cost and rate limits.

## Real-account smoke tests

Use Mission Inbox. One user approval per write. Never batch.

23. Instagram comment reply
24. Instagram inbound DM + approved reply (inside the 24-hour messaging window)
25. X mention/reply inbound + approved reply
26. X follow (confirm pending vs following)
27. X like
28. X inbound DM + approved reply

## Real-device checks

29. iPhone PWA install, keyboard, safe-area, offline note, snooze/dismiss, unknown-result “結果を再確認”. Home-screen icons are 8-bit sRGB (180/192/512/1024). Regenerate on macOS only with `swift scripts/generate-pwa-icons.swift`.
30. Desktop Settings capability upgrade buttons and 本番準備チェック copy (red/yellow/green also have words)

If a write is blocked, the preflight reason names the exact Settings button or secret to fix. Do not bypass HANDOFF for Instagram follow / arbitrary like; those are provider limitations, not unfinished code.
