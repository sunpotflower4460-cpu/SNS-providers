#!/usr/bin/env node
/**
 * Workers Builds ignores wrangler.toml [build] and may have an empty dashboard
 * Build command. Cloudflare injects WORKERS_CI=1; use that to create ./dist
 * during npm install so `npx wrangler versions upload` finds assets.
 */
import { spawnSync } from 'node:child_process';

if (process.env.WORKERS_CI !== '1') process.exit(0);

const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV === 'production' ? 'development' : process.env.NODE_ENV },
});
process.exit(result.status ?? 1);
