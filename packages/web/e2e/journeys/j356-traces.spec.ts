/**
 * J356 (#356): opt-in performance traces on the real service.
 *
 * Lean builds (the normal gate) ship no tracing code in the web app,
 * but the service still records when OTel is installed (always true in
 * a dev checkout; never true in a lean install):
 *
 * - record/export journey: switch on, open the demo review, export, and
 *   check the file has HTTP and job spans with no token leakage;
 * - lean behaviour (service started with UNVIBE_DISABLE_TRACING=1, i.e.
 *   what a lean install sees): the Debug section names the matching
 *   debug install instead of recording, and every trace route answers
 *   501.
 *
 * The debug-only journey and frames (browser SDK spans) live in
 * `j356-traces-debug.spec.ts` and run only against a debug build
 * (`mise run test:e2e:debug`).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J356 traces unavailable without OTel", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    // UNVIBE_DISABLE_TRACING=1 simulates the lean install (no OTel
    // packages): the loader degrades to null and every trace route 501s.
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j356-lean-"));
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_DISABLE_TRACING: "1" } });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
      // The sibling trace store lives outside the data dir.
      rmSync(`${dataDir}-traces`, { recursive: true, force: true });
    }
  });

  test("Debug names the matching debug install instead of recording", async ({ page }) => {
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/settings?tab=debug&token=${svc.token}`);
    await page.waitForLoadState("networkidle");
    // The source checkout behind a test build carries no channel, so
    // the notice falls back to the release debug build.
    await expect(page.getByText(/aren't available in this build/)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("npm install -g github:indigoviolet/unvibe#release-debug"),
    ).toBeVisible();
    await expect(page.getByLabel("Record performance traces")).toHaveCount(0);
  });

  test("trace routes answer 501 while settings still saves", async () => {
    if (!svc) throw new Error("no service");
    const put = await apiJson(svc, "PUT", "/api/settings", { recordTraces: true });
    expect(put.status).toBe(200);
    for (const [method, url] of [
      ["GET", "/api/traces/status"],
      ["GET", "/api/traces/export"],
      ["POST", "/api/traces/spans"],
      ["POST", "/api/traces/clear"],
    ] as const) {
      const res = await apiJson(svc, method, url, method === "POST" ? { spans: [] } : undefined);
      expect(res.status, url).toBe(501);
    }
  });
});
