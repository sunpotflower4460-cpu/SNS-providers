import { apiBaseUrl, apiConfigured } from './api';

export interface XOAuthStatus {
  configured: boolean;
  connected: boolean;
  scopes: string[];
  expiresAt: string | null;
  updatedAt: string | null;
}

export async function fetchXOAuthStatus(userId = 'local-user') {
  if (!apiConfigured) return { configured: false, connected: false, scopes: [], expiresAt: null, updatedAt: null } satisfies XOAuthStatus;
  return request<XOAuthStatus>(`/api/x/oauth/status?userId=${encodeURIComponent(userId)}`);
}

export function startXOAuth() {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  window.location.assign(`${apiBaseUrl}/api/x/oauth/start`);
}

export async function disconnectXOAuth(userId = 'local-user') {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  return request<{ ok: boolean }>(`/api/x/oauth/disconnect?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error ? body.error : `X OAuth API returned ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}
