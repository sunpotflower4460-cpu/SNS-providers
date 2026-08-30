export function classifyProviderHttpStatus(status: number): 'success' | 'failure' | 'unknown' {
  if (status >= 200 && status < 300) return 'success';
  if (status === 429 || status >= 500) return 'unknown';
  if (status >= 400 && status < 500) return 'failure';
  return 'unknown';
}

export function providerErrorDetail(payload: unknown, maxLength = 180) {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : null;
  const detail = typeof record.detail === 'string' ? record.detail
    : typeof record.title === 'string' ? record.title
      : typeof error?.message === 'string' ? error.message
        : Array.isArray(record.errors) && record.errors[0] && typeof (record.errors[0] as { message?: unknown }).message === 'string'
          ? String((record.errors[0] as { message: string }).message)
          : '';
  return detail ? `: ${detail.slice(0, maxLength)}` : '';
}
