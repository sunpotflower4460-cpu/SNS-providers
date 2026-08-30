export function queryRecord(params: URLSearchParams): Record<string, string> {
  const query: Record<string, string> = {};
  params.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}
