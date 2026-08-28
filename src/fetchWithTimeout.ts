export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 60_000,
  label = '通信',
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
    if (timedOut) {
      throw new Error(`${label}が${Math.ceil(timeoutMs / 1000)}秒以内に完了しませんでした。通信状態を確認して再試行してください。`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener('abort', relayAbort);
  }
}
