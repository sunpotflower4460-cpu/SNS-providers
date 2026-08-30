import { fetchWithTimeout } from '../../fetchWithTimeout';

export interface InstagramPermissionSnapshot {
  configured: boolean;
  tokenValid: boolean;
  professionalAccount: boolean;
  readComments: boolean;
  sendCommentReply: boolean;
  readDm: boolean;
  sendDm: boolean;
  permissionsVerified: boolean;
  accountType?: string;
  grantedPermissions: string[];
  reason?: string;
  checkedAt: string;
}

const COMMENT_PERMISSIONS = new Set([
  'instagram_business_manage_comments',
  'instagram_manage_comments',
]);
const MESSAGE_PERMISSIONS = new Set([
  'instagram_business_manage_messages',
  'instagram_manage_messages',
]);
const PROFESSIONAL_TYPES = new Set(['BUSINESS', 'CREATOR', 'MEDIA_CREATOR']);
const PROBE_TTL_MS = 15 * 60 * 1000;

export async function probeInstagramPermissions(env: {
  DB: D1Database;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_API_VERSION?: string;
  SOCIAL_WRITE_MODE?: string;
}, userId = 'local-user'): Promise<InstagramPermissionSnapshot> {
  const checkedAt = new Date().toISOString();
  const token = env.INSTAGRAM_ACCESS_TOKEN?.trim() || '';
  const igUserId = env.INSTAGRAM_USER_ID?.trim() || '';
  const version = env.INSTAGRAM_API_VERSION?.trim() || '';
  const configured = Boolean(token && /^\d{4,30}$/.test(igUserId) && /^v\d+\.\d+$/.test(version));
  if (env.SOCIAL_WRITE_MODE === 'test') {
    return {
      configured: true,
      tokenValid: true,
      professionalAccount: true,
      readComments: true,
      sendCommentReply: true,
      readDm: true,
      sendDm: true,
      permissionsVerified: true,
      grantedPermissions: ['instagram_business_manage_comments', 'instagram_business_manage_messages'],
      checkedAt,
    };
  }
  if (!configured) {
    return {
      configured: false,
      tokenValid: false,
      professionalAccount: false,
      readComments: false,
      sendCommentReply: false,
      readDm: false,
      sendDm: false,
      permissionsVerified: false,
      grantedPermissions: [],
      reason: 'Instagram token, professional user ID, and API version are not fully configured.',
      checkedAt,
    };
  }

  const cached = await loadProbe(env.DB, userId);
  if (cached && Date.now() - new Date(cached.checkedAt).getTime() < PROBE_TTL_MS) return cached;

  try {
    const meUrl = `https://graph.instagram.com/${version}/${encodeURIComponent(igUserId)}?fields=id,username,account_type`;
    const me = await igGet<{ id?: unknown; account_type?: unknown; error?: { message?: string } }>(meUrl, token, 'Instagram account probe');
    const accountId = typeof me.id === 'string' ? me.id : '';
    if (accountId && accountId !== igUserId) {
      return remember(env.DB, userId, {
        configured: true,
        tokenValid: true,
        professionalAccount: false,
        readComments: false,
        sendCommentReply: false,
        readDm: false,
        sendDm: false,
        permissionsVerified: false,
        grantedPermissions: [],
        reason: 'Configured Instagram user ID does not match the authenticated professional account.',
        checkedAt,
      });
    }
    const accountType = typeof me.account_type === 'string' ? me.account_type.toUpperCase() : '';
    const professionalAccount = PROFESSIONAL_TYPES.has(accountType);
    if (!professionalAccount) {
      return remember(env.DB, userId, {
        configured: true,
        tokenValid: true,
        professionalAccount: false,
        readComments: false,
        sendCommentReply: false,
        readDm: false,
        sendDm: false,
        permissionsVerified: false,
        accountType,
        grantedPermissions: [],
        reason: 'Instagram account is not a Professional (Business/Creator) account.',
        checkedAt,
      });
    }

    let granted: string[] = [];
    try {
      const permissionsUrl = `https://graph.instagram.com/${version}/me/permissions`;
      const permissions = await igGet<{ data?: Array<{ permission?: unknown; status?: unknown }> }>(permissionsUrl, token, 'Instagram permissions probe');
      granted = (permissions.data || [])
        .filter((row) => row.status === 'granted' && typeof row.permission === 'string')
        .map((row) => String(row.permission));
    } catch {
      granted = [];
    }

    const permissionsVerified = granted.length > 0;
    const comments = granted.some((permission) => COMMENT_PERMISSIONS.has(permission));
    const messages = granted.some((permission) => MESSAGE_PERMISSIONS.has(permission));
    return remember(env.DB, userId, {
      configured: true,
      tokenValid: true,
      professionalAccount: true,
      readComments: permissionsVerified && comments,
      sendCommentReply: permissionsVerified && comments,
      readDm: permissionsVerified && messages,
      sendDm: permissionsVerified && messages,
      permissionsVerified,
      accountType,
      grantedPermissions: granted,
      reason: permissionsVerified
        ? undefined
        : 'Instagram permission listing could not be verified. Capabilities stay fail-closed.',
      checkedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instagram permission probe failed';
    const tokenValid = !/ 401| 403/.test(` ${message}`);
    return remember(env.DB, userId, {
      configured: true,
      tokenValid,
      professionalAccount: false,
      readComments: false,
      sendCommentReply: false,
      readDm: false,
      sendDm: false,
      permissionsVerified: false,
      grantedPermissions: [],
      reason: message.slice(0, 240),
      checkedAt,
    });
  }
}

async function loadProbe(db: D1Database, userId: string): Promise<InstagramPermissionSnapshot | null> {
  try {
    const row = await db.prepare(
      'SELECT checked_at, payload_json FROM instagram_permission_probes WHERE user_id = ?',
    ).bind(userId).first<{ checked_at: string; payload_json: string }>();
    if (!row) return null;
    const parsed = JSON.parse(row.payload_json) as InstagramPermissionSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...parsed, checkedAt: row.checked_at };
  } catch {
    return null;
  }
}

async function remember(db: D1Database, userId: string, snapshot: InstagramPermissionSnapshot) {
  try {
    await db.prepare(
      `INSERT INTO instagram_permission_probes (user_id, checked_at, payload_json, permissions_verified)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         checked_at = excluded.checked_at,
         payload_json = excluded.payload_json,
         permissions_verified = excluded.permissions_verified`,
    ).bind(userId, snapshot.checkedAt, JSON.stringify(snapshot), snapshot.permissionsVerified ? 1 : 0).run();
  } catch {
    // Probe result is still returned; persistence is best-effort.
  }
  return snapshot;
}

async function igGet<T>(url: string, token: string, label: string): Promise<T> {
  const response = await fetchWithTimeout(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  }, 20_000, label);
  const body = await response.json().catch(() => null) as T | { error?: { message?: string } } | null;
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'error' in body && body.error?.message
      ? `: ${body.error.message.slice(0, 180)}`
      : '';
    throw new Error(`${label} returned ${response.status}${detail}`);
  }
  if (!body || typeof body !== 'object') throw new Error(`${label} returned invalid JSON`);
  return body as T;
}
