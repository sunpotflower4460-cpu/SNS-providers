const TOKEN_KEY = 'sns-providers:sync-token';
export const CONTROL_TOKEN_CHANGED_EVENT = 'sns-providers:control-token-changed';

let memoryToken: string | null = null;
let memoryInitialized = false;

export function getSyncToken() {
  if (memoryInitialized) return memoryToken || '';
  memoryInitialized = true;
  try {
    memoryToken = localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    memoryToken = '';
  }
  return memoryToken;
}

export function setSyncToken(token: string) {
  const normalized = token.trim();
  memoryToken = normalized;
  memoryInitialized = true;
  let persisted = true;
  try {
    if (!normalized) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, normalized);
  } catch {
    // Keep the validated token available for this browser session even when persistent
    // storage is blocked/full. Callers receive false so they can warn that reload loses it.
    persisted = false;
  }
  notifyControlTokenChanged();
  return persisted;
}

export function clearSyncToken() {
  memoryToken = '';
  memoryInitialized = true;
  let persisted = true;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Memory is cleared immediately, but the caller must warn that an old persisted value
    // may still exist and can reappear after a reload if browser storage becomes readable.
    persisted = false;
  }
  notifyControlTokenChanged();
  return persisted;
}

function notifyControlTokenChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONTROL_TOKEN_CHANGED_EVENT));
}
