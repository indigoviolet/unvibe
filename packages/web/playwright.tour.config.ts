/**
 * On-demand visual-tour config (#363): runs ONLY `e2e/tour/`
 * (visual-tour*.spec.ts, ported from the gate in package D).
 *
 * The gate config (`playwright.config.ts`) ignores `e2e/tour/` — frame
 * capture never runs in `check`, `test:slow`, `gate` or `test:affected`.
 * Run the tour with `mise run visual-tour` (slim set: 1440px light
 * Default plus the `tour-matrix.ts` named keeps) or
 * `UNVIBE_TOUR_MATRIX=full mise run visual-tour` for the full matrix.
 * Screenshots land in `packages/web/visual-tour/` (git-ignored).
 *
 * Mirrors the gate config's environment (per-run temp root, real-home
 * guard, per-checkout port, mock vite server, home-guard setup and
 * tmp teardown): the tour boots the same services and mock bundle.
 */
import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-run temp root (issue #24): same as the gate config — all
// `mkdtemp(path.join(os.tmpdir(), ...))` in the specs lands inside one
// fresh directory, removed by `e2e/tmp-teardown.ts` even when specs fail.
if (!process.env.UNVIBE_E2E_TMPROOT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-test-"));
  process.env.UNVIBE_E2E_TMPROOT = root;
  process.env.TMPDIR = root;
  process.env.TEMP = root;
  process.env.TMP = root;
}

// Real-home guard (#313): same as the gate config.
process.env.UNVIBE_TEST = "1";
if (!process.env.UNVIBE_REAL_HOME) {
  try {
    const info = os.userInfo();
    process.env.UNVIBE_REAL_HOME = info && info.homedir ? info.homedir : os.homedir();
  } catch {
    process.env.UNVIBE_REAL_HOME = os.homedir();
  }
}

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

export default defineConfig({
  testDir: "./e2e/tour",
  timeout: 30_000,
  // The tour is owner-reviewed and on-demand: one worker, serial scenes.
  workers: 1,
  globalTimeout: 60 * 60_000,
  retries: 0,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `VITE_MOCK=1 npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `${BASE}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  outputDir: "./test-results",
  globalSetup: "./e2e/home-guard.ts",
  globalTeardown: "./e2e/tmp-teardown.ts",
});
