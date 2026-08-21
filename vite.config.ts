import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const base = env.VITE_BASE_PATH || '/';
  return {
    base,
    plugins: [react()],
    server: { host: true },
    preview: { host: true },
  };
});
