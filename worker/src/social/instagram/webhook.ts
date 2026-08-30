const MAX_BODY_BYTES = 200_000;

export interface InstagramWebhookEnv {
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN?: string;
  INSTAGRAM_APP_SECRET?: string;
}

export async function handleInstagramWebhookVerification(request: Request, env: InstagramWebhookEnv) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode') || '';
  const token = url.searchParams.get('hub.verify_token') || '';
  const challenge = url.searchParams.get('hub.challenge') || '';
  const expected = env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() || '';
  if (mode !== 'subscribe' || !expected || token !== expected || !challenge) {
    return new Response('Forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  return new Response(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function readValidatedInstagramWebhook(request: Request, env: InstagramWebhookEnv) {
  const secret = env.INSTAGRAM_APP_SECRET?.trim() || '';
  if (!secret) {
    return { ok: false as const, status: 503, reason: 'Instagram webhook signature secret is not configured.' };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { ok: false as const, status: 413, reason: 'Webhook body is too large.' };
  }
  const header = request.headers.get('x-hub-signature-256') || '';
  const expected = await hmacSha256Hex(secret, raw);
  const provided = header.startsWith('sha256=') ? header.slice(7).trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(provided) || !constantTimeEqual(provided, expected)) {
    return { ok: false as const, status: 401, reason: 'Invalid Instagram webhook signature.' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false as const, status: 400, reason: 'Webhook body must be valid JSON.' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false as const, status: 400, reason: 'Webhook payload is malformed.' };
  }
  return { ok: true as const, payload: payload as Record<string, unknown> };
}

export function extractInstagramWebhookMessages(payload: Record<string, unknown>) {
  const entries: Array<{ conversationId?: string; messageId: string; fromId?: string; text?: string; timestamp?: string }> = [];
  const objectName = typeof payload.object === 'string' ? payload.object : '';
  if (objectName && objectName !== 'instagram' && objectName !== 'page') return entries;
  const body = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of body) {
    if (!isRecord(entry)) continue;
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const item of messaging) {
      if (!isRecord(item) || !isRecord(item.message)) continue;
      const messageId = typeof item.message.mid === 'string' ? item.message.mid
        : typeof item.message.id === 'string' ? item.message.id
          : '';
      if (!messageId) continue;
      const fromId = isRecord(item.sender) && typeof item.sender.id === 'string' ? item.sender.id : undefined;
      const text = typeof item.message.text === 'string' ? item.message.text : undefined;
      const timestamp = typeof item.timestamp === 'number'
        ? new Date(item.timestamp).toISOString()
        : typeof item.timestamp === 'string' ? item.timestamp : undefined;
      const conversationId = isRecord(item.recipient) && typeof item.recipient.id === 'string'
        ? item.recipient.id
        : typeof entry.id === 'string' ? entry.id : undefined;
      entries.push({ conversationId, messageId, fromId, text, timestamp });
    }
  }
  return entries;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
