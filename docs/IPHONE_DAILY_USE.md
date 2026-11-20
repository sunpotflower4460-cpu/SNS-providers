# iPhone personal-use release check

This first release uses the PWA in local mode. Leave the repository Actions variable `VITE_API_BASE_URL` unset. X and Instagram writes, paid API calls, and D1 sync are outside this release.

1. Confirm CI passes, including `npm run test:e2e`, and review the Pages build artifact. The E2E test covers manual candidate entry, profile handoff, result recording, reload, JSON backup/restore, and the offline shell.
2. The review branch was deployed successfully in [run 36096681288](https://github.com/sunpotflower4460-cpu/SNS-providers/actions/runs/36096681288). Merging into `main` triggers a new **Deploy PWA to Pages** run; confirm that the deployed SHA matches the merge commit. A successful code merge does not substitute for the physical-device checks below.
3. Confirm `https://sunpotflower4460-cpu.github.io/SNS-providers/` returns the app over HTTPS, with the correct icon and manifest. In iPhone Safari, use Share → Add to Home Screen and launch the icon.
4. On the iPhone, set your Mission. Add one real candidate by profile URL or handle. Confirm that an invalid URL stays in the input with an explanation. Open the official profile, close and reopen the PWA, and confirm the result sheet returns. Record only what actually happened. Check that Today and Relations agree after another restart.
5. In Settings → Backup, export JSON and confirm the file exists in Files. Restore it in a separate clean browser profile or device, then compare Mission, candidate, relationship history, and budget setting. Keep the verified file outside browser storage before relying on the PWA for daily records.
6. Repeat the core flow for seven days on the published build. Check keyboard and safe areas, VoiceOver labels, airplane mode and reconnection, midnight rollover, snooze, and app updates. Record each blocker with iPhone model, iOS version, URL, deployed SHA, steps, and expected/actual result; fix any data loss or blocked core flow before calling the release ready for daily use. These physical-device and seven-day checks remain unverified by automated CI.

The app cannot run an iPhone home-screen or seven-day check in CI. Those two checks require the owner's physical device and daily use.
