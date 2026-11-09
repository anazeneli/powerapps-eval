import { defineConfig } from '@playwright/test';

const API_PORT = 3101;
const WEB_PORT = 5175;
const DB_FILE = '../api/data/e2e.sqlite';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  use: { baseURL: `http://localhost:${WEB_PORT}` },
  webServer: [
    {
      command: `pnpm --filter @kyc/api seed && pnpm --filter @kyc/api exec tsx src/server.ts`,
      env: { DB_FILE, PORT: String(API_PORT) },
      url: `http://127.0.0.1:${API_PORT}/api/apps`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      env: { API_PORT: String(API_PORT) },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
