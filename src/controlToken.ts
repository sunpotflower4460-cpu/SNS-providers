const TOKEN_KEY = 'sns-providers:sync-token';
export const CONTROL_TOKEN_CHANGED_EVENT = 'sns-providers:control-token-changed';

export function getSyncToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setSyncToken(token: string) {
  const normalized = token.trim();
  if (!normalized) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, normalized);
  notifyControlTokenChanged();
}

export function clearSyncToken() {
  localStorage.removeItem(TOKEN_KEY);
  notifyControlTokenChanged();
}

function notifyControlTokenChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONTROL_TOKEN_CHANGED_EVENT));
}
