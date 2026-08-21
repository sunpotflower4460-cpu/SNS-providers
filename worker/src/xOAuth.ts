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

const READ_ONLY_SCOPES = ['tweet.read', 'users.read', 'follows.read', 'offline.access'];
const SESSION_TTL_MS = 10 * 60 * 1000;

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

  const code = requestUrl.searchParams.get('code') || '';
  const state = requestUrl.searchParams.get('state') || '';
  if (!code || !state) throw new Error('Missing OAuth code or state');

  const session = await env.DB.prepare('SELECT code_verifier, created_at FROM x_oauth_sessions WHERE state = ?')
    .bind(state)
    .first<{ code_verifier: string; created_at: string }>();
  await env.DB.prepare('DELETE FROM x_oauth_sessions WHERE state = ?').bind(state).run();
  if (!session) throw new Error('OAuth session not found or already used');
  if (Date.now() - new Date(session.created_at).getTime() > SESSION_TTL_MS) throw new Error('OAuth session expired');

  const token = await exchangeAuthorizationCode(env, code, session.code_verifier);
  if (!token.access_token) throw new Error('X token response did not include access_token');

  const accessTokenEnc = await encryptToken(env, token.access_token);
  const refreshTokenEnc = token.refresh_token ? await encryptToken(env, token.refresh_token) : null;
  const expiresAt = Number.isFinite(token.expires_in)
    ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString()
    : null;
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
  ).bind(userId, accessTokenEnc, refreshTokenEnc, expiresAt, token.scope || READ_ONLY_SCOPES.join(' '), updatedAt).run();

  return returnUrl(env, 'x_oauth=connected');
}

export async function xOAuthStatus(env: XOAuthEnv, userId = 'local-user') {
  if (!xOAuthConfigured(env)) return { configured: false, connected: false, scopes: [], expiresAt: null, updatedAt: null };
  const row = await env.DB.prepare('SELECT expires_at, scope, updated_at FROM x_oauth_tokens WHERE user_id = ?')
    .bind(userId)
    .first<{ expires_at: string | null; scope: string; updated_at: string }>();
  return {
    configured: true,
    connected: Boolean(row),
    scopes: row?.scope ? row.scope.split(/\s+/).filter(Boolean) : [],
    expiresAt: row?.expires_at || null,
    updatedAt: row?.updated_at || null,
  };
}

export async function disconnectXOAuth(env: XOAuthEnv, userId = 'local-user') {
  await env.DB.prepare('DELETE FROM x_oauth_tokens WHERE user_id = ?').bind(userId).run();
  return { ok: true };
}

async function exchangeAuthorizationCode(env: XOAuthEnv, code: string, verifier: string) {
  const credentials = btoa(`${env.X_CLIENT_ID!.trim()}:${env.X_CLIENT_SECRET!.trim()}`);
  const form = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: env.X_OAUTH_CALLBACK_URL!.trim(),
    code_verifier: verifier,
  });
  const response = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!response.ok) throw new Error(`X OAuth token exchange returned ${response.status}`);
  return response.json<XTokenResponse>();
}

async function encryptToken(env: XOAuthEnv, plaintext: string) {
  const rawKey = parseEncryptionKey(env.OAUTH_TOKEN_ENCRYPTION_KEY_B64);
  if (!rawKey) throw new Error('OAuth encryption key is invalid');
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
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

function bytesToBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
