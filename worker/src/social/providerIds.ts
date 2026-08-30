const NUMERIC_PROVIDER_ID = /^\d{1,30}$/;

/**
 * Compare opaque decimal provider IDs (X snowflakes, Instagram numeric IDs).
 * Returns null when either value is not a decimal integer so callers cannot
 * fall back to unsafe lexical string ordering.
 */
export function compareNumericProviderIds(a: string, b: string): number | null {
  if (!NUMERIC_PROVIDER_ID.test(a) || !NUMERIC_PROVIDER_ID.test(b)) return null;
  const left = BigInt(a);
  const right = BigInt(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function isNewerNumericProviderId(candidate: string, known: string): boolean {
  if (!known) return Boolean(candidate);
  const cmp = compareNumericProviderIds(candidate, known);
  return cmp != null && cmp > 0;
}

export function maxNumericProviderId(current: string | null | undefined, candidate: string | null | undefined): string | null {
  const left = typeof current === 'string' ? current : '';
  const right = typeof candidate === 'string' ? candidate : '';
  if (!left) return right || null;
  if (!right) return left || null;
  const cmp = compareNumericProviderIds(left, right);
  if (cmp == null) return left;
  return cmp < 0 ? right : left;
}

export function maxNumericProviderIdFrom(values: Iterable<string>): string | null {
  let newest: string | null = null;
  for (const value of values) {
    newest = maxNumericProviderId(newest, value);
  }
  return newest;
}
