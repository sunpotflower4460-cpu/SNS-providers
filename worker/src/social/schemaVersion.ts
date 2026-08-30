export const EXPECTED_SCHEMA_VERSION = 7;

export interface SchemaVersionSnapshot {
  connected: boolean;
  currentVersion: number | null;
  expectedVersion: number;
  pending: number[];
  partial: number[];
  checksumMismatch: boolean;
  reason?: string;
}

export async function readSchemaVersion(db: D1Database): Promise<SchemaVersionSnapshot> {
  const expectedVersion = EXPECTED_SCHEMA_VERSION;
  try {
    const rows = await db.prepare(
      'SELECT version, name, checksum, status FROM schema_migrations ORDER BY version',
    ).all<{ version: number; name: string; checksum: string; status: string }>();
    const applied = rows.results || [];
    const partial = applied.filter((row) => row.status === 'applying').map((row) => Number(row.version));
    const current = applied
      .filter((row) => row.status === 'applied')
      .map((row) => Number(row.version));
    const currentVersion = current.length ? Math.max(...current) : 0;
    const pending = [];
    for (let version = 1; version <= expectedVersion; version += 1) {
      if (!current.includes(version)) pending.push(version);
    }
    return {
      connected: true,
      currentVersion,
      expectedVersion,
      pending,
      partial,
      checksumMismatch: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'schema_migrations is unavailable';
    const missing = /no such table/i.test(message);
    return {
      connected: !missing,
      currentVersion: missing ? 0 : null,
      expectedVersion,
      pending: Array.from({ length: expectedVersion }, (_, index) => index + 1),
      partial: [],
      checksumMismatch: false,
      reason: missing
        ? 'schema_migrations table is missing. Run npm run d1:migrate (or the production migration workflow).'
        : 'D1 schema version could not be read. Fail closed until the ledger is reachable.',
    };
  }
}
