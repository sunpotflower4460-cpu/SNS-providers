import { apiBaseUrl, apiConfigured } from './api';
import { getSyncToken } from './sync';

export interface InstagramEngager {
  id: string;
  username: string;
  profileUrl: string;
  commentCount: number;
  mediaCount: number;
  lastCommentText: string;
  lastCommentAt: string | null;
  latestMediaPermalink: string | null;
}

export interface InstagramEngagerSyncResponse {
  enabled: boolean;
  source: 'instagram' | 'cache' | 'disabled';
  externalCostUsd: number;
  reason?: string;
  syncedAt?: string;
  accountId?: string;
  mediaScanned?: number;
  commentEvents?: number;
  engagers: InstagramEngager[];
}

export async function syncInstagramEngagers(userId = 'local-user') {
  if (!apiConfigured) throw new Error('Worker URLが設定されていません');
  const token = getSyncToken().trim();
  if (!token) throw new Error('先にSettingsの個人管理キーを保存してください');
  const response = await fetch(`${apiBaseUrl}/api/instagram/engagers/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, maxMedia: 8, maxCommentsPerMedia: 25 }),
  });
  const body = await response.json().catch(() => null) as InstagramEngagerSyncResponse | { error?: string } | null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error ? body.error : `Instagram sync returned ${response.status}`;
    throw new Error(message);
  }
  if (!body || typeof body !== 'object' || !('enabled' in body) || typeof body.enabled !== 'boolean' || !('engagers' in body) || !Array.isArray(body.engagers)) {
    throw new Error('Instagram sync returned an invalid success response');
  }
  return body as InstagramEngagerSyncResponse;
}
