import { fetchWithTimeout } from './fetchWithTimeout';
import { releaseSyncLease, reserveSyncLease } from './syncLease';

export interface XOAuthEnv {
  DB: D1Database;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_OAUTH_CALLBACK_URL?: string;
  PWA_RETURN_URL?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY_B64?: string;
}

interface XTokenResponse {
  token_type?: string;
  expires_in?: number;
  access_token?: string;
  scope?: string;
  refresh_token?: string;
}

interface StoredTokenRow {
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  scope: string;
  updated_at: string;
}

const READ_ONLY_SCOPES = ['tweet.read', 'users.read', 'follows.read', 'offline.access'];
const READ_ONLY_SCOPE_SET = new Set(READ_ONLY_SCOPES);
const SESSION_TTL_MS = 10 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;
const X_IDENTITY_LEASE_MS = 3 * 60 * 1000;

export function xOAuthConfigured(env: XOAuthEnv) {
  return Boolean(
    env.X_CLIENT_ID?.trim()
    && env.X_CLIENT_SECRET?.trim()
    && validHttpsOrLocalUrl(env.X_OAUTH_CALLBACK_URL)
    && validHttpsOrLocalUrl(env.PWA_RETURN_URL)
    && parseEncryptionKey(env.OAUTH_TOKEN_ENCRYPTION_KEY_B64),
  );
}

export async function startXOAuth(env: XOAuthEnv) {
  assertConfigured(env);
  await pruneOAuthSessions(env);

  const state = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const challenge = await sha256Base64Url(verifier);
  const createdAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO x_oauth_sessions (state, code_verifier, created_at) VALUES (?, ?, ?)')
    .bind(state, verifier, createdAt)
    .run();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.X_CLIENT_ID!.trim(),
    redirect_uri: env.X_OAUTH_CALLBACK_URL!.trim(),
    scope: READ_ONLY_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return `https://x.com/i/oauth2/authorize?${params.toString()}`;
}

export async function completeXOAuth(env: XOAuthEnv, requestUrl: URL, userId = 'local-user') {
  assertConfigured(env);
  const oauthError = requestUrl.searchParams.get('error');
  if (oauthError) return returnUrl(env, `x_oauth=${encodeURIComponent(oauthError)}`);

  // Account replacement and owned-data sync share one lease. Without this boundary an
  // old-account sync can finish after a new OAuth callback clears derived rows and then
  // recreate the old account's cache/paging under the newly connected identity.
  const leaseResult = await reserveSyncLease(env.DB, userId, 'x_owned_sync', X_IDENTITY_LEASE_MS);
  if (!leaseResult.ok) throw new Error('Xの情報更新中です。完了後にX接続をもう一度お試しください。');

  try {
    const code = requestUrl.searchParams.get('code') || '';
    const state = requestUrl.searchParams.get('state') || '';
    if (!code || !state) throw new Error('Missing OAuth code or state');

    const session = await env.DB.prepare('SELECT code_verifier, created_at FROM x_oauth_sessions WHERE state = ?')
      .bind(state)
      .first<{ code_verifier: string; created_at: string }>();
    await env.DB.prepare('DELETE FROM x_oauth_sessions WHERE state = ?').bind(state).run();
    if (!session) throw new Error('OAuth session not found or already used');
    const createdMs = new Date(session.created_at).getTime();
    const sessionAgeMs = Date.now() - createdMs;
    if (!Number.isFinite(createdMs) || sessionAgeMs < 0 || sessionAgeMs > SESSION_TTL_MS) throw new Error('OAuth session expired or malformed');

    const token = await exchangeAuthorizationCode(env, code, session.code_verifier);
    await clearOwnedXDerivedState(env, userId);
    await persistTokenResponse(env, userId, token);
    return returnUrl(env, 'x_oauth=connected');
  } finally {
    await releaseSyncLease(env.DB, leaseResult.lease);
  }
}

export async function xOAuthStatus(env: XOAuthEnv, userId = 'local-user') {
  if (!xOAuthConfigured(env)) {
    return { configured: false, connected: false, scopes: [], expiresAt: null, updatedAt: null, refreshable: false };
  }
  const row = await loadStoredToken(env, userId);
  if (!row) return { configured: true, connected: false, scopes: [], expiresAt: null, updatedAt: null, refreshable: false };

  try {
    const scopes = validateGrantedScopes(row.scope);
    await decryptToken(env, row.access_token_enc);
    const expiresAtMs = parseStoredExpiry(row.expires_at);
    const accessUsable = expiresAtMs > Date.now();
    let refreshable = false;
    if (row.refresh_token_enc) {
      try {
        // A non-empty encrypted refresh token is not enough to claim the connection can
        // be maintained. Verify its ciphertext now so an expired access token with a
        // corrupt refresh row does not appear connected until the first real sync fails.
        await decryptToken(env, row.refresh_token_enc);
        refreshable = true;
      } catch {
        refreshable = false;
      }
    }
    const usable = accessUsable || refreshable;
    return {
      configured: true,
      connected: usable,
      scopes: usable ? scopes : [],
      expiresAt: usable ? row.expires_at : null,
      updatedAt: usable && validIso(row.updated_at) ? row.updated_at : null,
      refreshable: usable && refreshable,
    };
  } catch {
    // A malformed/undecryptable access-token row is not a usable connection. Keep
    // configuration true so the UI offers a fresh OAuth connection that can replace it.
    return { configured: true, connected: false, scopes: [], expiresAt: null, updatedAt: null, refreshable: false };
  }
}

export async function getValidXAccessToken(env: XOAuthEnv, userId = 'local-user') {
  assertConfigured(env);
  const row = await loadStoredToken(env, userId);
  if (!row) throw new Error('X account is not connected');
  validateGrantedScopes(row.scope);

  const expiresAt = parseStoredExpiry(row.expires_at);
  if (expiresAt > Date.now() + REFRESH_EARLY_MS) return decryptToken(env, row.access_token_enc);
  if (!row.refresh_token_enc) throw new Error('X access token expired and no refresh token is available');

  const refreshToken = await decryptToken(env, row.refresh_token_enc);
  const refreshed = await refreshAccessToken(env, refreshToken);
  try {
    await persistTokenResponse(env, userId, refreshed, row.refresh_token_enc, row.scope);
  } catch {
    // OAuth providers may rotate/invalidate the old refresh token as soon as a refresh
    // succeeds. If the new token set cannot be persisted, keeping the old D1 row would make
    // the connection look refreshable even though a later paid owned-read could fail only
    // after budget reservation. Invalidate the stale credential best-effort and require a
    // fresh user authorization before any paid provider request is allowed to start.
    await invalidateStoredConnectionAfterRefreshPersistenceFailure(env, userId);
    throw new Error('Xの接続更新は完了しましたが、新しい認証情報を安全に保存できませんでした。Xを接続し直してから再度お試しください。');
  }
  if (!refreshed.access_token) throw new Error('X refresh response did not include access_token');
  return refreshed.access_token;
}

export async function disconnectXOAuth(env: XOAuthEnv, userId = 'local-user') {
  // A cross-tab disconnect must not race an owned read. Otherwise the old read can write
  // derived cache/paging after token deletion and leave it waiting for a later reconnect.
  const leaseResult = await reserveSyncLease(env.DB, userId, 'x_owned_sync', X_IDENTITY_LEASE_MS);
  if (!leaseResult.ok) throw new Error('Xの情報更新中です。完了後に接続解除をもう一度お試しください。');

  try {
    // Token deletion is the authoritative disconnect. Derived-cache cleanup is hygiene only:
    // owned-cache reads now require a connected token record, so a cleanup failure must not
    // report "disconnect failed" after the credential has already been removed.
    await env.DB.prepare('DELETE FROM x_oauth_tokens WHERE user_id = ?').bind(userId).run();
    try {
      await clearOwnedXDerivedState(env, userId);
    } catch {
      // Stale derived rows are unreachable while disconnected and will be cleared on reconnect.
    }
    return { ok: true };
  } finally {
    await releaseSyncLease(env.DB, leaseResult.lease);
  }
}

async function invalidateStoredConnectionAfterRefreshPersistenceFailure(env: XOAuthEnv, userId: string) {
  try {
    await env.DB.prepare('DELETE FROM x_oauth_tokens WHERE user_id = ?').bind(userId).run();
  } catch {
    // The original persistence failure may be a wider D1 outage. The caller still aborts
    // before the paid reservation/provider boundary, so no X owned-read starts in this run.
  }
  try {
    await clearOwnedXDerivedState(env, userId);
  } catch {
    // A later successful reconnect clears these rows before the replacement token is stored.
  }
}

async function clearOwnedXDerivedState(env: XOAuthEnv, userId: string) {
  await env.DB.prepare('DELETE FROM x_owned_snapshots WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM x_owned_paging WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM x_follow_cycle_targets WHERE user_id = ?').bind(userId).run();
}

async function loadStoredToken(env: XOAuthEnv, userId: string) {
  return env.DB.prepare('SELECT access_token_enc, refresh_token_enc, expires_at, scope, updated_at FROM x_oauth_tokens WHERE user_id = ?')
    .bind(userId)
    .first<StoredTokenRow>();
}

async function persistTokenResponse(
  env: XOAuthEnv,
  userId: string,
  token: XTokenResponse,
  existingRefreshTokenEnc?: string | null,
  existingGrantedScope?: string,
) {
  if (!token.access_token) throw new Error('X token response did not include access_token');
  if ((token.token_type || '').trim().toLowerCase() !== 'bearer') throw new Error('X token response did not include a Bearer token type');
  if (typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new Error('X token response did not include a valid positive expires_in');
  }
  const grantedScopes = validateGrantedScopes(token.scope, existingGrantedScope);
  const accessTokenEnc = await encryptToken(env, token.access_token);
  const refreshTokenEnc = token.refresh_token
    ? await encryptToken(env, token.refresh_token)
    : existingRefreshTokenEnc || null;
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO x_oauth_tokens (user_id, access_token_enc, refresh_token_enc, expires_at, scope, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token_enc = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc,
       expires_at = excluded.expires_at,
       scope = excluded.scope,
       updated_at = excluded.updated_at`
  ).bind(userId, accessTokenEnc, refreshTokenEnc, expiresAt, grantedScopes.join(' '), updatedAt).run();
}

function validateGrantedScopes(scopeValue?: string, verifiedFallbackScope?: string) {
  // Authorization-code responses must prove the granted scopes. A refresh response may
  // omit an unchanged scope; in that one case only, reuse the already-validated stored scope.
  const rawScope = scopeValue?.trim() || verifiedFallbackScope?.trim();
  if (!rawScope) throw new Error('X OAuth response is missing granted scope metadata');
  const scopes = [...new Set(rawScope.split(/\s+/).filter(Boolean))];
  const unexpected = scopes.filter((scope) => !READ_ONLY_SCOPE_SET.has(scope));
  if (unexpected.length) throw new Error(`X OAuth returned unexpected scope(s): ${unexpected.join(', ')}`);
  const missing = READ_ONLY_SCOPES.filter((scope) => !scopes.includes(scope));
  if (missing.length) throw new Error(`X OAuth response is missing required scope(s): ${missing.join(', ')}`);
  return scopes;
}

async function exchangeAuthorizationCode(env: XOAuthEnv, code: string, verifier: string) {
  const form = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: env.X_OAUTH_CALLBACK_URL!.trim(),
    code_verifier: verifier,
  });
  return tokenRequest(env, form, 'token exchange');
}

async function refreshAccessToken(env: XOAuthEnv, refreshToken: string) {
  const form = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  return tokenRequest(env, form, 'token refresh');
}

async function tokenRequest(env: XOAuthEnv, form: URLSearchParams, operation: string) {
  const credentials = btoa(`${env.X_CLIENT_ID!.trim()}:${env.X_CLIENT_SECRET!.trim()}`);
  const response = await fetchWithTimeout('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  }, 20_000, `X OAuth ${operation}`);
  if (!response.ok) throw new Error(`X OAuth ${operation} returned ${response.status}`);
  const body = await response.json().catch(() => null) as XTokenResponse | null;
  if (!body || typeof body !== 'object') throw new Error(`X OAuth ${operation} returned invalid JSON`);
  return body;
}

async function encryptToken(env: XOAuthEnv, plaintext: string) {
  const key = await importEncryptionKey(env, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decryptToken(env: XOAuthEnv, payload: string) {
  const [ivValue, cipherValue] = payload.split('.');
  if (!ivValue || !cipherValue) throw new Error('Stored OAuth token is malformed');
  const iv = base64ToBytes(ivValue);
  const cipher = base64ToBytes(cipherValue);
  if (iv.length !== 12) throw new Error('Stored OAuth token IV is invalid');
  const key = await importEncryptionKey(env, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plaintext);
}

async function importEncryptionKey(env: XOAuthEnv, usages: KeyUsage[]) {
  const rawKey = parseEncryptionKey(env.OAUTH_TOKEN_ENCRYPTION_KEY_B64);
  if (!rawKey) throw new Error('OAuth encryption key is invalid');
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, usages);
}

function parseEncryptionKey(value?: string) {
  if (!value?.trim()) return null;
  try {
    const binary = atob(value.trim());
    if (binary.length !== 32) return null;
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function pruneOAuthSessions(env: XOAuthEnv) {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  await env.DB.prepare('DELETE FROM x_oauth_sessions WHERE created_at < ?').bind(cutoff).run();
}

function returnUrl(env: XOAuthEnv, query: string) {
  const url = new URL(env.PWA_RETURN_URL!.trim());
  const [key, value = ''] = query.split('=');
  url.searchParams.set(key, decodeURIComponent(value));
  return url.toString();
}

function assertConfigured(env: XOAuthEnv) {
  if (!xOAuthConfigured(env)) throw new Error('X OAuth is not fully configured');
}

function validHttpsOrLocalUrl(value?: string) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}

function parseStoredExpiry(value: string | null) {
  if (!value) throw new Error('Stored OAuth token expiry is missing');
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error('Stored OAuth token expiry is invalid');
  return time;
}

function validIso(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

function randomBase64Url(bytes: number) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
