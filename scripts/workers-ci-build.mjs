#!/usr/bin/env node
/**
 * Workers Builds ignores wrangler.toml [build] as the dashboard Build-command
 * step and may have an empty dashboard Build command. Cloudflare injects
 * WORKERS_CI=1 (and WORKERS_CI_BUILD_UUID). Build ./dist during npm install
 * so `npx wrangler versions upload` finds assets even if the dashboard Build
 * command is blank.
 */
import { spawnSync } from 'node:child_process';

const onWorkersCi = process.env.WORKERS_CI === '1'
  || Boolean(process.env.WORKERS_CI_BUILD_UUID);
if (!onWorkersCi) process.exit(0);

const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV === 'production' ? 'development' : process.env.NODE_ENV,
  },
});
process.exit(result.status ?? 1);
