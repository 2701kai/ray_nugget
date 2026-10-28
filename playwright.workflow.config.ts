import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-workflow', outputDir: './runs/workflow', workers: 1, timeout: 45000,
  expect: { timeout: 10000 }, reporter: 'list',
  use: { baseURL: 'http://localhost:8086', viewport: { width: 1440, height: 1000 }, permissions: ['microphone'],
    serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  webServer: { command: 'bun scripts/workflow-preview.ts', url: 'http://localhost:8086', reuseExistingServer: true },
  projects: [
    { name: 'chromium' },
    { name: 'webkit', grep: /slow and failed/, use: { browserName: 'webkit', permissions: [], viewport: { width: 390, height: 844 }, isMobile: true, launchOptions: { executablePath: process.env.PETE_WEBKIT_EXECUTABLE, args: [] } } },
  ],
});
