import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-update', outputDir: './runs/update-e2e', workers: 1, timeout: 60000,
  expect: { timeout: 15000 }, reporter: 'list',
  use: { viewport: { width: 402, height: 874 }, permissions: ['microphone'], serviceWorkers: 'allow', screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } },
});
