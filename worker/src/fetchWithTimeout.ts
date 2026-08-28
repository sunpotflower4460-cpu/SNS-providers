export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 45_000,
  label = 'Upstream request',
) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let timedOut = false;

  const relayAbort = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    else upstreamSignal.addEventListener('abort', relayAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1_000, timeoutMs));

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)}s`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener('abort', relayAbort);
  }
}
