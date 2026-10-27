import { defineConfig } from '@playwright/test';
const production = process.env.PETE_E2E_PRODUCTION === '1';
const port = production ? 8082 : 8081;

export default defineConfig({
  testDir: './e2e',
  testIgnore: production ? undefined : '**/pwa.spec.ts',
  outputDir: './runs/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 1000 },
    permissions: ['microphone'],
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: production ? 'bun run preview' : 'bun run web --host localhost', env: { EXPO_PUBLIC_PROCESSING_URL: 'http://127.0.0.1:8091', PETE_PREVIEW_PORT: String(port) }, url: `http://localhost:${port}`, reuseExistingServer: !production, timeout: 90000 },
});
