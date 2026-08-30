#!/usr/bin/env node
/**
 * Versioned D1 migrations.
 *
 *   npm run d1:migrate:check   validate files, order, checksums (no credentials)
 *   npm run d1:migrate         apply to production D1 when Cloudflare credentials exist
 *   npm run d1:migrate -- --dry-run
 *
 * Fail-closed: a row with status=applying is treated as a partial apply and blocks
 * further migrations until it is inspected.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'db', 'migrations');
const manifestPath = join(migrationsDir, 'manifest.json');
const checkOnly = process.argv.includes('--check');
const dryRun = process.argv.includes('--dry-run');
const remote = !process.argv.includes('--local');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!Number.isInteger(manifest.expectedVersion) || manifest.expectedVersion < 1) {
  fail('manifest.expectedVersion is missing or invalid.');
}
if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
  fail('manifest.migrations is empty.');
}

const seen = new Set();
const loaded = [];
for (const entry of manifest.migrations) {
  if (!Number.isInteger(entry.version) || entry.version < 1) fail(`Invalid migration version: ${entry.version}`);
  if (seen.has(entry.version)) fail(`Duplicate migration version: ${entry.version}`);
  seen.add(entry.version);
  const filePath = join(migrationsDir, entry.file);
  if (!existsSync(filePath)) fail(`Missing migration file: ${entry.file}`);
  const sql = readFileSync(filePath, 'utf8');
  if (!sql.trim()) fail(`Empty migration file: ${entry.file}`);
  loaded.push({
    version: entry.version,
    name: entry.file,
    sql,
    checksum: sha256(sql),
  });
}
loaded.sort((a, b) => a.version - b.version);
for (let i = 0; i < loaded.length; i += 1) {
  if (loaded[i].version !== i + 1) fail(`Migrations must be contiguous from 1. Missing version ${i + 1}.`);
}
if (loaded[loaded.length - 1].version !== manifest.expectedVersion) {
  fail(`manifest.expectedVersion ${manifest.expectedVersion} does not match last migration ${loaded[loaded.length - 1].version}.`);
}

console.log(`Migration check OK: ${loaded.length} files, expected version ${manifest.expectedVersion}.`);
if (checkOnly) process.exit(0);

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
if (!token || !accountId) {
  console.log('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not set.');
  console.log('Dry-run of SQL that a human workflow_dispatch will apply:');
  for (const migration of loaded) {
    console.log(`\n-- ${migration.version} ${migration.name} ${migration.checksum}`);
    console.log(migration.sql.trim());
  }
  console.log('\nNo credentials: migrations were not applied. Use GitHub Actions "Migrate production D1".');
  process.exit(dryRun ? 0 : 0);
}

if (dryRun) {
  console.log('Dry-run with credentials present; not applying.');
  process.exit(0);
}

const ensureTable = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('applying','applied')),
  applied_at TEXT NOT NULL
);`;
await wranglerSql(ensureTable);

const appliedRows = await wranglerQuery('SELECT version, name, checksum, status FROM schema_migrations ORDER BY version');
const applied = new Map();
for (const row of appliedRows) {
  const version = Number(row.version);
  if (row.status === 'applying') {
    fail(`Partial migration detected: version ${version} (${row.name}) is still 'applying'. Inspect D1 before retrying.`);
  }
  if (row.status !== 'applied') fail(`schema_migrations row ${version} has invalid status ${row.status}.`);
  applied.set(version, row);
}

for (const migration of loaded) {
  const existing = applied.get(migration.version);
  if (existing) {
    if (existing.checksum !== migration.checksum) {
      fail(`Applied migration ${migration.version} checksum mismatch. File changed after apply.`);
    }
    if (existing.name !== migration.name) {
      fail(`Applied migration ${migration.version} name mismatch: D1 has ${existing.name}, file is ${migration.name}.`);
    }
    continue;
  }
  const now = new Date().toISOString();
  await wranglerSql(
    `INSERT INTO schema_migrations (version, name, checksum, status, applied_at) VALUES (${migration.version}, '${escapeSql(migration.name)}', '${escapeSql(migration.checksum)}', 'applying', '${now}')`,
  );
  const statements = splitSql(migration.sql);
  for (const statement of statements) {
    try {
      await wranglerSql(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isIdempotentDdlError(message)) continue;
      fail(`Migration ${migration.version} failed: ${message}`);
    }
  }
  await wranglerSql(
    `UPDATE schema_migrations SET status = 'applied', applied_at = '${new Date().toISOString()}' WHERE version = ${migration.version} AND status = 'applying'`,
  );
  console.log(`Applied ${migration.version} ${migration.name}`);
}

console.log(`D1 schema is at version ${manifest.expectedVersion}.`);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}

function splitSql(sql) {
  return sql
    .split(';')
    .map((part) => part.replace(/--[^\n]*/g, '').trim())
    .filter(Boolean);
}

function isIdempotentDdlError(message) {
  const lower = message.toLowerCase();
  return lower.includes('duplicate column name')
    || lower.includes('already exists')
    || lower.includes('duplicate column');
}

function wranglerArgs() {
  return [
    'wrangler',
    'd1',
    'execute',
    'social-mission',
    remote ? '--remote' : '--local',
    '--config',
    join(root, 'worker', 'wrangler.jsonc'),
  ];
}

async function wranglerSql(sql) {
  const result = await runWrangler([...wranglerArgs(), '--command', sql]);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'wrangler d1 execute failed');
  return result.stdout;
}

async function wranglerQuery(sql) {
  const result = await runWrangler([...wranglerArgs(), '--command', sql, '--json']);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'wrangler d1 query failed');
  try {
    const parsed = JSON.parse(result.stdout);
    const results = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

function runWrangler(args) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--yes', ...args], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}
