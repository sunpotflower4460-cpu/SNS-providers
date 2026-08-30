/**
 * X Account Activity (Enterprise) is intentionally not a required dependency.
 * Polling via tweet.read / dm.read is the supported inbox path.
 */
export function xAccountActivityAvailable(env: { X_ACCOUNT_ACTIVITY_ENABLED?: string }) {
  return env.X_ACCOUNT_ACTIVITY_ENABLED === 'true';
}

export function xAccountActivityStatus(env: { X_ACCOUNT_ACTIVITY_ENABLED?: string }) {
  if (!xAccountActivityAvailable(env)) {
    return {
      enabled: false,
      required: false,
      reason: 'X Account Activity is Enterprise-only and is not required. Polling remains the default inbox path.',
    };
  }
  return {
    enabled: true,
    required: false,
    reason: 'X Account Activity adapter boundary is present; production still uses polling unless explicitly contracted.',
  };
}
