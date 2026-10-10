import { defineConfig, devices } from "@playwright/test";

// Behaviour tests run against mock mode (`VITE_MOCK=1`), so no service is
// needed. Browsers come from `mise run playwright-install` and are never
// required by `mise run check`.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:5199" },
  webServer: {
    command: "VITE_MOCK=1 npx vite --port 5199 --strictPort",
    url: "http://127.0.0.1:5199/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  outputDir: "./test-results",
});
