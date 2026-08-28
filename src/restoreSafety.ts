import type { AppState } from './types';

// JSON/D1 snapshots can outlive a server-side X reconnect or Instagram account change.
// Candidate/relationship history is portable user data, but these account summaries are
// derived from whichever official SNS identity was connected when the snapshot was saved.
// Drop only the derived summaries on external restore so the current connection must
// repopulate them from official data instead of displaying a stale self identity.
export function detachExternalAccountSummaries(state: AppState): AppState {
  return {
    ...state,
    xAccount: {},
    instagramAccount: undefined,
  };
}
