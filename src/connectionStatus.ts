import { useCallback, useEffect, useState } from 'react';
import { apiBaseUrl, apiConfigured, fetchProductionPreflight } from './api';
import { CONTROL_TOKEN_CHANGED_EVENT, getSyncToken } from './controlToken';
import { fetchWithTimeout } from './fetchWithTimeout';

export type StepState = 'ready' | 'todo' | 'partial' | 'unknown';

export interface ConnectionStatus {
  /** PWA was built with a Worker URL. */
  server: StepState;
  /** Worker answered /api/health. */
  reachable: StepState;
  key: StepState;
  ai: StepState;
  discovery: StepState;
  x: StepState;
  instagram: StepState;
  checking: boolean;
  error: string;
}

const initial = (): ConnectionStatus => ({
  server: apiConfigured ? 'ready' : 'todo',
  reachable: apiConfigured ? 'unknown' : 'todo',
  key: getSyncToken().trim() ? 'ready' : 'todo',
  ai: 'unknown',
  discovery: 'unknown',
  x: 'unknown',
  instagram: 'unknown',
  checking: false,
  error: '',
});

let cached: ConnectionStatus | null = null;
const listeners = new Set<(status: ConnectionStatus) => void>();

function publish(status: ConnectionStatus) {
  cached = status;
  listeners.forEach((listener) => listener(status));
}

/**
 * Plain-language readiness for Settings/Today. Uses only the public health route and the
 * personal-key protected preflight route; it never calls a paid provider.
 */
export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>(() => cached || initial());

  const refresh = useCallback(async (): Promise<ConnectionStatus> => {
    const base = initial();
    if (!apiConfigured) {
      publish(base);
      return base;
    }
    publish({ ...(cached || base), key: base.key, checking: true, error: '' });
    let next: ConnectionStatus = { ...base };
    try {
      const response = await fetchWithTimeout(`${apiBaseUrl}/api/health`, {}, 10_000, 'Worker health');
      next.reachable = response.ok ? 'ready' : 'todo';
    } catch {
      next.reachable = 'todo';
      next.error = 'サーバーに接続できませんでした。URLが正しいか、デプロイ済みかを確認してください。';
    }
    if (next.reachable === 'ready' && next.key === 'ready') {
      try {
        const result = await fetchProductionPreflight();
        const ai = record(result.ai);
        const x = record(result.x);
        const instagram = record(result.instagram);
        next.ai = ai.sakura || ai.groq || ai.deepseek ? 'ready' : 'todo';
        next.discovery = ai.discovery ? 'ready' : 'todo';
        next.x = x.tokenValid ? 'ready' : x.configured ? 'partial' : 'todo';
        next.instagram = instagram.tokenValid ? 'ready' : instagram.configured ? 'partial' : 'todo';
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        next = { ...next, key: /auth|token|401|403|unauth/i.test(message) ? 'todo' : next.key };
        next.error = message ? `状態を確認できませんでした: ${message}` : '状態を確認できませんでした';
      }
    }
    next.checking = false;
    publish(next);
    return next;
  }, []);

  useEffect(() => {
    listeners.add(setStatus);
    if (!cached) void refresh();
    const onToken = () => void refresh();
    window.addEventListener(CONTROL_TOKEN_CHANGED_EVENT, onToken);
    return () => {
      listeners.delete(setStatus);
      window.removeEventListener(CONTROL_TOKEN_CHANGED_EVENT, onToken);
    };
  }, [refresh]);

  return { status, refresh };
}

export function coreReady(status: ConnectionStatus) {
  return status.server === 'ready' && status.reachable !== 'todo' && status.key === 'ready';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
