import { defineConfig, devices } from "@playwright/test";

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

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: BASE },
  webServer: {
    command: `VITE_MOCK=1 npx vite --port ${PORT} --strictPort`,
    url: `${BASE}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  outputDir: "./test-results",
});
