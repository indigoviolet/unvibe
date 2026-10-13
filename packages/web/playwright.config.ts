import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-run temp root (issue #24): all `mkdtemp(path.join(os.tmpdir(), ...))`
// in the specs (data dirs, scratch repos, fake bins) land inside one fresh
// directory, removed by `e2e/tmp-teardown.ts` even when specs fail. Only
// exact paths under this root are ever removed — other worktrees' suites
// share the system temp dir and are never touched. Created once per run:
// workers inherit the env, so a re-loaded config reuses the same root.
if (!process.env.UNVIBE_E2E_TMPROOT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-test-"));
  process.env.UNVIBE_E2E_TMPROOT = root;
  process.env.TMPDIR = root;
  process.env.TEMP = root;
  process.env.TMP = root;
}

// Behaviour tests run against mock mode (`VITE_MOCK=1`), so no service is
// needed. Browsers come from `mise run playwright-install` and are never
// required by `mise run check`.
// Each checkout gets its own port (derived from its path) so parallel
// worktrees never share or kill each other's dev server.
function portForCheckout(): number {
  if (process.env.UNVIBE_E2E_PORT) return Number(process.env.UNVIBE_E2E_PORT);
  let h = 0;
  for (const ch of process.cwd()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 5200 + (h % 700);
}
const PORT = portForCheckout();
const BASE = `http://127.0.0.1:${PORT}`;

// Worker caps (issue #119): at most min(4, cores/2) browsers, so parallel
// checkouts do not starve each other. Override with UNVIBE_E2E_WORKERS
// (e.g. =8 when the machine is known to be free). The global timeout ends
// a hung run on its own; retries stay 0 so flakes surface.
const e2eCores = os.availableParallelism();
const e2eWorkers = Number(process.env.UNVIBE_E2E_WORKERS) || Math.min(4, Math.max(1, Math.floor(e2eCores / 2)));

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/*.disabled.spec.ts",
  timeout: 30_000,
  workers: e2eWorkers,
  globalTimeout: 10 * 60_000,
  retries: 0,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: BASE,
    // Keep failure evidence for CI artifacts (uploaded on failure).
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // Bind 127.0.0.1 explicitly: bare `vite` listens on `localhost`, which
    // resolves to ::1 first on machines with IPv6-first resolution (notably
    // GitHub runners), while this config polls http://127.0.0.1:<port>/
    // and the service binds 127.0.0.1 by design (PRD §14). Without --host,
    // the server never becomes reachable and Playwright reports
    // "Timed out waiting ... from config.webServer".
    command: `VITE_MOCK=1 npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `${BASE}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  outputDir: "./test-results",
  globalTeardown: "./e2e/tmp-teardown.ts",
});
