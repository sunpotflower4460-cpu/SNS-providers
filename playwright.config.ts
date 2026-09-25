import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173/SNS-providers/',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'VITE_BASE_PATH=/SNS-providers/ npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/SNS-providers/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
