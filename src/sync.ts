import { apiBaseUrl, apiConfigured } from './api';
import { normalizeAppState, validateAppState } from './backup';
import { getSyncToken } from './controlToken';
import type { AppState } from './types';

export { clearSyncToken, getSyncToken, setSyncToken } from './controlToken';

interface DownloadResponse {
  found: boolean;
  state: AppState | null;
  updatedAt: string | null;
}

interface UploadResponse {
  ok: boolean;
  updatedAt: string;
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
  if (result.found && result.state) {
    result.state = normalizeAppState(result.state);
    validateAppState(result.state);
  }
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
