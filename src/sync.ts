import { apiBaseUrl, apiConfigured } from './api';
import { validateAppState } from './backup';
import type { AppState } from './types';

const TOKEN_KEY = 'sns-providers:sync-token';

interface DownloadResponse {
  found: boolean;
  state: AppState | null;
  updatedAt: string | null;
}

interface UploadResponse {
  ok: boolean;
  updatedAt: string;
}

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

export async function uploadRemoteState(state: AppState, token = getSyncToken(), userId = 'local-user') {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  if (!token.trim()) throw new Error('同期キーを入力してください');
  return syncFetch<UploadResponse>(`/api/sync/state`, token, {
    method: 'PUT',
    body: JSON.stringify({ userId, state }),
  });
}

export async function downloadRemoteState(token = getSyncToken(), userId = 'local-user') {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  if (!token.trim()) throw new Error('同期キーを入力してください');
  const result = await syncFetch<DownloadResponse>(`/api/sync/state?userId=${encodeURIComponent(userId)}`, token);
  if (result.found && result.state) validateAppState(result.state);
  return result;
}

async function syncFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token.trim()}`,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error ? body.error : `Sync API returned ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}
