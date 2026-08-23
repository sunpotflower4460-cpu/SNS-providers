import { apiBaseUrl, apiConfigured } from './api';
import { normalizeAppState, validateAppState } from './backup';
import { getSyncToken } from './controlToken';
import type { AppState } from './types';

export { clearSyncToken, getSyncToken, setSyncToken } from './controlToken';

const REMOTE_VERSION_KEY = 'sns-providers:remote-state-version';

interface DownloadResponse {
  found: boolean;
  state: AppState | null;
  updatedAt: string | null;
}

interface UploadResponse {
  ok: boolean;
  updatedAt: string;
}

export function getRemoteStateVersion() {
  const value = localStorage.getItem(REMOTE_VERSION_KEY);
  return validIso(value) ? value : null;
}

export function clearRemoteStateVersion() {
  localStorage.removeItem(REMOTE_VERSION_KEY);
}

function setRemoteStateVersion(updatedAt: string | null) {
  if (validIso(updatedAt)) localStorage.setItem(REMOTE_VERSION_KEY, updatedAt);
  else localStorage.removeItem(REMOTE_VERSION_KEY);
}

export async function uploadRemoteState(
  state: AppState,
  token = getSyncToken(),
  userId = 'local-user',
  expectedUpdatedAt: string | null = getRemoteStateVersion(),
) {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  if (!token.trim()) throw new Error('同期キーを入力してください');
  const normalizedState = normalizeAppState(state);
  validateAppState(normalizedState);
  const result = await syncFetch<UploadResponse>(`/api/sync/state`, token, {
    method: 'PUT',
    body: JSON.stringify({
      userId,
      state: normalizedState,
      expectedUpdatedAt,
    }),
  });
  if (result.ok !== true || !validIso(result.updatedAt)) throw new Error('D1 upload returned an invalid version response');
  setRemoteStateVersion(result.updatedAt);
  return result;
}

export async function downloadRemoteState(token = getSyncToken(), userId = 'local-user') {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  if (!token.trim()) throw new Error('同期キーを入力してください');
  const result = await syncFetch<DownloadResponse>(`/api/sync/state?userId=${encodeURIComponent(userId)}`, token);
  if (typeof result.found !== 'boolean') throw new Error('D1 download returned an invalid found flag');
  if (result.found) {
    if (!result.state || !validIso(result.updatedAt)) throw new Error('D1 download returned an incomplete state snapshot');
    result.state = normalizeAppState(result.state);
    validateAppState(result.state);
  } else if (result.state !== null || result.updatedAt !== null) {
    throw new Error('D1 download returned an inconsistent empty snapshot');
  }
  setRemoteStateVersion(result.updatedAt);
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
  if (body == null) throw new Error('Sync API returned an empty or invalid JSON response');
  return body as T;
}

function validIso(value: string | null | undefined): value is string {
  if (!value) return false;
  return Number.isFinite(new Date(value).getTime());
}
