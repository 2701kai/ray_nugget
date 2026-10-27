import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'storage-recovery.spec.ts',
  outputDir: './runs/webkit', workers: 1, timeout: 60000,
  expect: { timeout: 10000 }, reporter: 'list',
  use: {
    browserName: 'webkit', baseURL: 'http://localhost:8082',
    viewport: { width: 390, height: 844 }, isMobile: true,
    launchOptions: { executablePath: process.env.PETE_WEBKIT_EXECUTABLE },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: { command: 'bun run preview', env: { PETE_PREVIEW_PORT: '8082' }, url: 'http://localhost:8082', reuseExistingServer: false, timeout: 30000 },
});
