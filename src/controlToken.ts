const TOKEN_KEY = 'sns-providers:sync-token';

export function getSyncToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setSyncToken(token: string) {
  const normalized = token.trim();
  if (!normalized) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, normalized);
}

export function clearSyncToken() {
  localStorage.removeItem(TOKEN_KEY);
}
