import { defineConfig } from '@playwright/test';

// End-to-end checks of the two core flows against the fixture-backed mock API.
// Uses the locally installed Edge (or Chrome via PW_CHANNEL=chrome) so no
// browser download is needed.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    channel: process.env.PW_CHANNEL ?? 'msedge',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile-360', use: { viewport: { width: 360, height: 760 }, hasTouch: true, isMobile: true } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
