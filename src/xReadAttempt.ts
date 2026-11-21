const KEY = 'sns-providers:x-read-attempt';
const MAX_AGE_MS = 15 * 60 * 1000;
let memoryAttempt: number | null = null;
let memoryOnly = false;

export function rememberXReadAttempt() {
  memoryAttempt = Date.now();
  try {
    localStorage.setItem(KEY, String(memoryAttempt));
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
}

export function pendingXReadAttempt() {
  if (!memoryOnly) {
    try {
      const value = localStorage.getItem(KEY);
      memoryAttempt = value === null ? null : Number(value);
    } catch {
      // Keep the attempt available while this app instance is open.
    }
  }
  const age = memoryAttempt === null ? Infinity : Date.now() - memoryAttempt;
  return Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS ? memoryAttempt : null;
}

export function consumeXReadAttempt(attempt: number) {
  if (pendingXReadAttempt() !== attempt) return false;
  memoryAttempt = null;
  try {
    localStorage.removeItem(KEY);
    memoryOnly = false;
  } catch {
    memoryOnly = true;
  }
  return true;
}

export function readXConsentCompleted(attempt: number, updatedAt: string | null) {
  const updated = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(updated) && updated >= attempt && updated <= Date.now() + 60_000;
}

export function takeXOAuthReturn() {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('x_oauth');
  if (result !== null) {
    url.searchParams.delete('x_oauth');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  return result;
}
