#!/usr/bin/env node
/**
 * Production / staging preflight.
 *
 *   npm run preflight         mock/staging diagnostics (no secrets required)
 *   npm run preflight:prod    GET /api/preflight against a live Worker
 *
 * Production requires WORKER_URL (or VITE_API_BASE_URL) plus PERSONAL_CONTROL_TOKEN.
 * Missing production credentials is not a compile/test failure; the command prints
 * the manual next step and exits 0 in CI / mock mode.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const prod = process.argv.includes('--prod');

const check = spawnSync(process.execPath, [join(root, 'scripts', 'd1-migrate.mjs'), '--check'], {
  cwd: root,
  encoding: 'utf8',
});
if (check.status !== 0) {
  process.stderr.write(check.stdout || '');
  process.stderr.write(check.stderr || '');
  process.exit(check.status || 1);
}
process.stdout.write(check.stdout || '');

if (!prod) {
  console.log('Preflight (CI/mock): migration files are ordered and checksummed.');
  console.log('Preflight (CI/mock): production Worker URL is not required. Capability probes fail closed without secrets.');
  console.log('Manual next step: npm run preflight:prod after setting WORKER_URL and PERSONAL_CONTROL_TOKEN.');
  process.exit(0);
}

const workerUrl = (process.env.WORKER_URL || process.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const token = (process.env.PERSONAL_CONTROL_TOKEN || process.env.SYNC_TOKEN || '').trim();
if (!workerUrl || !token) {
  console.log('Preflight (prod): WORKER_URL / PERSONAL_CONTROL_TOKEN are not set.');
  console.log('Manual next step: export WORKER_URL and PERSONAL_CONTROL_TOKEN, then re-run npm run preflight:prod.');
  process.exit(0);
}

const response = await fetch(`${workerUrl}/api/preflight?userId=local-user`, {
  headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
});
const body = await response.json().catch(() => null);
if (!response.ok || !body || typeof body !== 'object') {
  console.error(`Preflight (prod) failed: HTTP ${response.status}`);
  process.exit(1);
}
const checks = Array.isArray(body.checks) ? body.checks : [];
for (const item of checks) {
  const severity = item.severity === 'block' ? '停止' : item.severity === 'warn' ? '注意' : '問題なし';
  console.log(`${severity} · ${item.label}: ${item.reason || ''}`);
  if (item.nextStep) console.log(`  次の作業: ${item.nextStep}`);
}
const blocked = checks.filter((item) => item.severity === 'block');
process.exit(blocked.length ? 2 : 0);
