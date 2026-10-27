import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-hosted', outputDir: './runs/hosted-e2e', workers: 1, timeout: 60000,
  expect: { timeout: 15000 }, reporter: 'list',
  use: { baseURL: 'http://localhost:8085', viewport: { width: 390, height: 844 }, serviceWorkers: 'block', permissions: ['microphone'], screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
  webServer: { command: 'bun run preview', env: { PETE_WEB_OUTPUT: 'dist-hosted', PETE_PREVIEW_PORT: '8085' }, url: 'http://localhost:8085', reuseExistingServer: false },
});
