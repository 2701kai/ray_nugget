import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './runs/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8081',
    viewport: { width: 1440, height: 1000 },
    permissions: ['microphone'],
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'bun run web --host localhost', env: { EXPO_PUBLIC_PROCESSING_URL: 'http://127.0.0.1:8091' }, url: 'http://localhost:8081', reuseExistingServer: true, timeout: 90000 },
});
