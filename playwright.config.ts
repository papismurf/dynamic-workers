import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the Agent Orchestrator e2e suite.
 *
 * Boots `wrangler dev` as the webServer so tests exercise the real Worker
 * runtime (workerd) rather than a Node mock. The suite is split into two
 * projects:
 *   - "chromium"    — browser-driven REST/UI probes
 *   - "http-ws"     — Node-side REST + WebSocket tests using request/ws
 *                     fixtures; no browser, so it's fast and can run in
 *                     parallel across a lot of shards in CI.
 *
 * Environment:
 *   PLAYWRIGHT_BASE_URL    override the default http://127.0.0.1:8787
 *   PLAYWRIGHT_P95_MS      perf threshold for the concurrency smoke
 *                          (defaults to 750 locally, 2000 in CI to absorb
 *                          cold-start variance on shared runners)
 */
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 8787);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "playwright-report/results.json" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    // Per-test request timeout; the perf project overrides this.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  // Boot wrangler dev before tests. In CI we always boot fresh; locally we
  // reuse whatever's already listening on the port so `npm run dev` +
  // `npm run test:e2e` in two terminals works.
  webServer: {
    command: `npx wrangler dev --ip 127.0.0.1 --port ${PORT} --local`,
    url: `${BASE_URL}/health`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /.*\.browser\.spec\.ts$/,
    },
    {
      name: "http-ws",
      // Pure Node project: no browser context, exercises HTTP + WS directly.
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /.*\.browser\.spec\.ts$/,
    },
  ],
  outputDir: "test-results",
});
