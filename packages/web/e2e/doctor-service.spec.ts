/**
 * Doctor page + reload on the real service (issues #20/#21).
 *
 * Real built service (`mise run build` first) with UNVIBE_AGENT=none
 * (pipeline disabled), temp data dir, shared harness. Covers:
 * - Doctor page renders real diagnostics (service identity, PATH, tools).
 * - Model pickers show display names (static fallback carries names).
 * - Reload everything flips a fake tool from broken to working via an
 *   UNVIBE_*_BIN override pointing at a script we rewrite between reloads.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./network-guard.js";
import { startService, type RunningService } from "./service-harness.js";

const exec = promisify(execFile);

async function curlJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`];
  if (body !== undefined) args.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

test.describe("doctor on the real service", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let fakeDir = "";
  let fakeD2 = "";

  test.beforeAll(async () => {
    fakeDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-faked2-"));
    fakeD2 = path.join(fakeDir, "d2");
    // Start broken: --version fails.
    writeFileSync(fakeD2, "#!/bin/sh\necho broken-d2 >&2\nexit 1\n");
    chmodSync(fakeD2, 0o755);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-doctor-data-"));
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { UNVIBE_D2_BIN: fakeD2 } as Record<string, string>,
      label: "doctor",
    });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(fakeDir, { recursive: true, force: true });
  });

  test("doctor page shows real diagnostics with service identity", async ({ page }) => {
    test.setTimeout(60000);
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/doctor?token=${svc.token}`);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("doctor-report")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("doctor-service")).toContainText("pid");
    await expect(page.getByTestId("doctor-path")).toContainText("effective");
  });

  test("model pickers show display names on the real service", async ({ page }) => {
    test.setTimeout(60000);
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 20000 });
    await page.getByRole("tab", { name: "Models" }).click();
    // Static fallback carries names (Sonnet/Opus/GPT) even with UNVIBE_AGENT=none.
    const main = page.locator('[data-testid="model-main"]');
    await expect(main.locator("#model-main")).toContainText("Sonnet");
  });

  // DISABLED(#119): API-only; same routes covered by diagnostics-api.test.ts (UI Reload button stays in doctor.spec.ts)
  test.skip("reload flips fake d2 from broken to working", async () => {
    test.setTimeout(60000);
    if (!svc) throw new Error("service not running");
    const before = (await curlJson(svc.origin, svc.token, "GET", "/api/diagnostics")) as {
      tools: { tool: string; chosen: string | null; candidates: { path: string; runs: boolean }[] }[];
    };
    const d2before = before.tools.find((t) => t.tool === "d2")!;
    // Broken override: no working choice (missing-override or runs=false).
    expect(d2before.candidates.some((c) => c.path === fakeD2)).toBe(true);

    // Fix the script on disk (same UNVIBE_D2_BIN path, now runs).
    writeFileSync(fakeD2, "#!/bin/sh\necho 'd2 version v0.9.0'\n");
    chmodSync(fakeD2, 0o755);

    const reloaded = (await curlJson(svc.origin, svc.token, "POST", "/api/reload")) as {
      ok: boolean;
      changed: string[];
      diagnostics: { tools: { tool: string; chosen: string | null }[] };
    };
    expect(reloaded.ok).toBe(true);
    const d2after = reloaded.diagnostics.tools.find((t) => t.tool === "d2")!;
    expect(d2after.chosen).toBe(fakeD2);
  });
});
