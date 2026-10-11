import { defineConfig } from '@playwright/test';

// End-to-end checks of the two core flows against the fixture-backed mock API.
// Uses the locally installed Edge (or Chrome via PW_CHANNEL=chrome) so no
// browser download is needed. PW_PORT moves the dev server off 5173 when
// another checkout is already serving there (a running server is reused).
const port = Number(process.env.PW_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    channel: process.env.PW_CHANNEL ?? 'msedge',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile-360', use: { viewport: { width: 360, height: 760 }, hasTouch: true, isMobile: true } },
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'wide-1920', use: { viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: [
    ...(process.env.VITE_USE_MOCKS === 'false' ? [{
      command: 'python -m backend.varuna.local_server --host 127.0.0.1 --port 8000',
      cwd: '..',
      env: { VARUNA_LOCAL_USERS_JSON: JSON.stringify({
        resident: { password: 'throwaway-resident-test', sub: 'e2e-resident', groups: [] },
        responder: { password: 'throwaway-responder-test', sub: 'e2e-responder', groups: ['varuna-responder'] },
      }) },
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: true,
      timeout: 60_000,
    }] : []),
    {
      command: `npm run dev -- --port ${port} --strictPort`,
      // Tests use an empty URL unless explicitly supplied. An ignored local
      // key must never cause automated checks to request live map tiles.
      env: {
        VITE_REAL_ROADS_PREVIEW: process.env.VITE_REAL_ROADS_PREVIEW ?? 'false',
        VITE_DELHI_STANDARD_STYLE_URL: process.env.VITE_DELHI_STANDARD_STYLE_URL ?? '',
        VITE_DELHI_HYBRID_STYLE_URL: process.env.VITE_DELHI_HYBRID_STYLE_URL ?? '',
        VITE_LOCAL_AUTH: process.env.VITE_USE_MOCKS === 'false' ? 'true' : 'false',
        VITE_COGNITO_DOMAIN: '', VITE_COGNITO_CLIENT_ID: '',
      },
      url: `http://localhost:${port}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
