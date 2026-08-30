import { writeFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const base = env.VITE_BASE_PATH || '/';
  const apiOrigin = safeOrigin(env.VITE_API_BASE_URL);
  const connectSources = mode === 'development'
    ? ["'self'", 'http:', 'https:', 'ws:', 'wss:']
    : ["'self'", ...(apiOrigin ? [apiOrigin] : [])];

  return {
    base,
    plugins: [react(), cspConnectPlugin(connectSources.join(' ')), keepDistGitkeepPlugin()],
    server: { host: true },
    preview: { host: true },
  };
});

function keepDistGitkeepPlugin(): Plugin {
  return {
    name: 'keep-dist-gitkeep',
    closeBundle() {
      writeFileSync('dist/.gitkeep', '# Keep ./dist in git so Workers Builds can see assets.directory before Vite runs.\n');
    },
  };
}

function cspConnectPlugin(connectSources: string): Plugin {
  return {
    name: 'social-mission-csp-connect-src',
    transformIndexHtml(html) {
      return html.replace('__CSP_CONNECT_SRC__', connectSources);
    },
  };
}

function safeOrigin(value?: string) {
  if (!value?.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
  } catch {
    return '';
  }
}
