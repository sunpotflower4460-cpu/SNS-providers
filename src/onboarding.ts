const SEEN_KEY = 'sns-providers:onboarding-seen';

export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markOnboardingSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // ignore storage failures (private mode, quota) — onboarding just replays next launch
  }
}
