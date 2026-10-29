import { defineConfig, devices } from '@playwright/test'

// `shell` tests exercise Shasta itself against a local fixture site (deterministic, offline-safe).
// `compat` tests load real third-party sites through the proxy and depend on the network.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
  projects: [
    { name: 'shell', testDir: './e2e/shell' },
    // the Store runs against the real production server (API, SQLite, content origins) with a throw-away data folder
    { name: 'store', testDir: './e2e/store', use: { baseURL: 'http://localhost:4180' } },
    // the real on-device AI (downloads models through the mirror; slow, needs the network)
    { name: 'ai', testDir: './e2e/ai', use: { baseURL: 'http://localhost:4181' } },
    { name: 'compat', testDir: './e2e/compat' },
  ],
  webServer: [
    {
      command: 'bun e2e/support/server.mjs',
      url: 'http://localhost:4173/index.html',
      reuseExistingServer: true,
      timeout: 30_000,
      ignoreHTTPSErrors: true,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 },
    },
    {
      // no bundled apps here: the Store flow counts on an empty catalog
      command: 'rm -rf .e2e-store && PORT=4180 HOST=127.0.0.1 STORE_DIR=.e2e-store BUILTIN_APPS_DIR=.e2e-store/none OWNER_SETUP_CODE=E2E-SETUP-CODE STATIC_DIR=dist bun ../server/server.mjs',
      url: 'http://localhost:4180/healthz',
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 },
    },
    {
      // the on-device AI tests: the bundled Shasta AI app is published here, and model files are mirrored into .e2e-ai/ai-models
      command: 'rm -rf .e2e-ai && PORT=4181 HOST=127.0.0.1 STORE_DIR=.e2e-ai OWNER_SETUP_CODE=E2E-SETUP-CODE STATIC_DIR=dist bun ../server/server.mjs',
      url: 'http://localhost:4181/healthz',
      reuseExistingServer: false,
      timeout: 30_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 },
    },
  ],
})
