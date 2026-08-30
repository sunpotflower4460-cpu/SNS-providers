#!/usr/bin/env node
/**
 * Resolve (or create) the Cloudflare D1 database ID for Worker deploys.
 *
 * worker/wrangler.jsonc omits database_id so Cloudflare Workers Builds can
 * auto-provision / bind by database_name. GitHub Actions / local deploy can
 * still run this script with CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID to
 * patch a real UUID into wrangler.jsonc for that job only.
 *
 * Usage:
 *   node scripts/resolve-d1-database-id.mjs [--write]
 *
 * Prints the database UUID to stdout. With `--write`, also patches
 * worker/wrangler.jsonc in place for the subsequent `wrangler deploy`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = 'REPLACE_WITH_D1_DATABASE_ID';
const DATABASE_NAME = 'social-mission';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerPath = join(root, 'worker', 'wrangler.jsonc');
const write = process.argv.includes('--write');

const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();

if (!token || !accountId) {
  console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required to resolve the D1 database ID.');
  console.error('Create a D1 database once with: cd worker && npx wrangler d1 create social-mission');
  console.error('Then either set those secrets for CI, or rely on Wrangler auto-provisioning by database_name.');
  process.exit(1);
}

const wrangler = readFileSync(wranglerPath, 'utf8');
const existing = wrangler.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
if (existing && existing !== PLACEHOLDER && /^[0-9a-f-]{36}$/i.test(existing)) {
  process.stdout.write(`${existing}\n`);
  process.exit(0);
}

const listUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`;
const listed = await cf(listUrl);
const found = (listed.result || []).find((row) => row.name === DATABASE_NAME);
let databaseId = found?.uuid || found?.id;

if (!databaseId) {
  const created = await cf(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name: DATABASE_NAME }),
  });
  databaseId = created.result?.uuid || created.result?.id;
}

if (!databaseId || !/^[0-9a-f-]{36}$/i.test(databaseId)) {
  console.error('Could not resolve a valid D1 database UUID for social-mission.');
  process.exit(1);
}

if (write) {
  writeFileSync(wranglerPath, upsertDatabaseId(wrangler, databaseId));
  console.error(`Patched worker/wrangler.jsonc with D1 database_id=${databaseId}`);
}

process.stdout.write(`${databaseId}\n`);

function upsertDatabaseId(source, databaseId) {
  if (source.includes(PLACEHOLDER)) return source.replaceAll(PLACEHOLDER, databaseId);
  if (/"database_id"\s*:\s*"[^"]+"/.test(source)) {
    return source.replace(/"database_id"\s*:\s*"[^"]+"/, `"database_id": "${databaseId}"`);
  }
  if (!source.includes(`"database_name": "${DATABASE_NAME}"`)) {
    throw new Error('worker/wrangler.jsonc does not contain the expected D1 database_name field.');
  }
  return source.replace(
    /("database_name"\s*:\s*"social-mission")/,
    `$1,\n      "database_id": "${databaseId}"`,
  );
}

async function cf(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const detail = body?.errors?.[0]?.message || response.statusText || `HTTP ${response.status}`;
    throw new Error(`Cloudflare API failed: ${detail}`);
  }
  return body;
}
