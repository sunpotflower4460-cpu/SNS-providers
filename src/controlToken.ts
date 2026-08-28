const TOKEN_KEY = 'sns-providers:sync-token';
export const CONTROL_TOKEN_CHANGED_EVENT = 'sns-providers:control-token-changed';

let memoryToken = '';
let memoryAuthoritative = false;

export function getSyncToken() {
  if (memoryAuthoritative) return memoryToken;
  try {
    memoryToken = localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    // If storage is temporarily unreadable, preserve the most recently known in-memory
    // value. When no value has ever been set this naturally remains empty.
  }
  return memoryToken;
}

export function setSyncToken(token: string) {
  const normalized = token.trim();
  memoryToken = normalized;
  let persisted = true;
  try {
    if (!normalized) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, normalized);
    memoryAuthoritative = false;
  } catch {
    // Keep the validated token available for this browser session even when persistent
    // storage is blocked/full. While in this mode, do not let a stale disk value replace it.
    memoryAuthoritative = true;
    persisted = false;
  }
  notifyControlTokenChanged();
  return persisted;
}

export function clearSyncToken() {
  memoryToken = '';
  let persisted = true;
  try {
    localStorage.removeItem(TOKEN_KEY);
    memoryAuthoritative = false;
  } catch {
    // Memory is cleared immediately. Prefer it over a stale persisted value for the rest
    // of this session; the caller warns that reload may expose the old disk value again.
    memoryAuthoritative = true;
    persisted = false;
  }
  notifyControlTokenChanged();
  return persisted;
}

function notifyControlTokenChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONTROL_TOKEN_CHANGED_EVENT));
}
