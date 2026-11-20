import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/ui',
  testMatch: '*.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4179', viewport: { width: 1360, height: 960 } },
  webServer: {
    command: 'node scripts/preview.mjs',
    env: { CONTEXT_CARDS_PREVIEW_PORT: '4179' },
    wait: { stdout: /Development preview:/ },
    timeout: 15000,
  },
});
