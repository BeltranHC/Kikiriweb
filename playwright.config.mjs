import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', timeout: 30000, workers: 1, fullyParallel: false,
  outputDir: 'artifacts/ui-test-results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3108', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true,
    viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node e2e/server.mjs', url: 'http://127.0.0.1:3108/__health', reuseExistingServer: false, timeout: 20000 },
});
