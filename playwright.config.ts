import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 25_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4180/game-trend-radar/',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: process.env.RADAR_CHROMIUM_PATH ? {
      executablePath: process.env.RADAR_CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote'],
    } : undefined,
  },
  webServer: {
    command: 'npm run preview -- --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180/game-trend-radar/',
    reuseExistingServer: !process.env.CI,
  },
});
