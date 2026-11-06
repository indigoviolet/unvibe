/**
 * J356 debug flavour (#356): the record/export/scrub journey and the
 * Debug-section frames, against a real debug build.
 *
 * Runs ONLY with `UNVIBE_TEST_DEBUG_TRACES=1` (see `mise run
 * test:e2e:debug`, which builds with tracing first); otherwise the whole
 * file skips, so the lean gate (`check`, `test:slow`, `gate`,
 * `test:affected`) never touches it. `check-global-install` covers the
 * debug install end to end separately.
 *
 * Frames (issue #362): 1440px light only — off, on with a size, after
 * Clear, and capped. Saved under /tmp/356-frames/.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, truncateSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const debugTraces = process.env.UNVIBE_TEST_DEBUG_TRACES === "1";
test.skip(
  !debugTraces,
  "needs a debug build: UNVIBE_DEBUG_TRACES=1 mise run build && UNVIBE_TEST_DEBUG_TRACES=1 (or `mise run test:e2e:debug`)",
);

const FRAMES = "/tmp/356-frames";

test.describe("J356 debug traces", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    mkdirSync(FRAMES, { recursive: true });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j356-debug-"));
    svc = await startService(dataDir, { agent: "replay" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
      // The sibling trace store lives outside the data dir.
      rmSync(`${dataDir}-traces`, { recursive: true, force: true });
    }
  });

  test("record, open the demo review, export HTTP + job spans", async ({ page }) => {
    if (!svc) throw new Error("no service");
    test.setTimeout(240_000);
    // Debug build guard: fail loudly instead of passing vacuously when
    // the switch is missing or recording never starts.
    await page.goto(`${svc.origin}/settings?tab=debug&token=${svc.token}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Record performance traces")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Record performance traces").click();
    await expect(page.getByTestId("trace-state")).toHaveText("Recording", { timeout: 15_000 });
    // Demo review created (and built by the replay pipeline) while on.
    const reviewId = await createDemoReview(svc);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold", { timeout: 60_000 });
    // Export through the UI and check the file.
    await page.goto(`${svc.origin}/settings?tab=debug&token=${svc.token}`);
    await expect(page.getByTestId("trace-size")).toContainText(/spans/, { timeout: 15_000 });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export traces" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("unvibe-traces.json");
    const file = path.join(dataDir, "downloaded-traces.json");
    await download.saveAs(file);
    const text = readFileSync(file, "utf8");
    const body = JSON.parse(text) as {
      resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[];
    };
    const names = body.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans.map((sp) => sp.name)));
    expect(names.length).toBeGreaterThan(5);
    expect(names.some((n) => n.startsWith("http "))).toBe(true);
    expect(names.some((n) => n.startsWith("job "))).toBe(true);
    expect(text).not.toContain(svc.token);
    expect(text).not.toMatch(/\?token=/);
    await expect(page.getByText(/Exported \d+ spans? as OTLP JSON/)).toBeVisible();
    // The browser web SDK beacons document-load/fetch spans (flushed
    // on navigation); poll the export until one lands. These prove the
    // debug bundle's auto-instrumentation is live end to end.
    const deadline = Date.now() + 30_000;
    let hasBrowser = false;
    for (;;) {
      const exp = await apiJson(svc, "GET", "/api/traces/export");
      const expNames = (exp.json as { resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[] }).resourceSpans.flatMap((r) =>
        r.scopeSpans.flatMap((s) => s.spans.map((sp) => sp.name)),
      );
      hasBrowser = expNames.some((n) => n === "documentLoad" || n === "HTTP GET");
      if (hasBrowser || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(hasBrowser).toBe(true);
  });
});

test.describe("J356 debug frames", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    mkdirSync(FRAMES, { recursive: true });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j356-frames-"));
    svc = await startService(dataDir, { agent: "none" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
      // The sibling trace store lives outside the data dir.
      rmSync(`${dataDir}-traces`, { recursive: true, force: true });
    }
  });

  /** Empty the store through the inline confirm; settle with the pill gone. */
  async function clearTraces(page: import("@playwright/test").Page): Promise<void> {
    const clear = page.getByRole("button", { name: "Clear traces" });
    if (await clear.isDisabled()) return;
    await clear.click();
    await page.getByRole("button", { name: "Confirm clear traces" }).click();
    await expect(page.getByText("Cleared the recorded traces.")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Delete every recorded span on this machine?")).toBeHidden({
      timeout: 15_000,
    });
  }

  for (const combo of [{ name: "1440-light", width: 1440, dark: false }] as const) {
    test(`debug frames (${combo.name})`, async ({ page }) => {
      if (!svc) throw new Error("no service");
      test.setTimeout(240_000);
      await page.setViewportSize({ width: combo.width, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      const shot = async (tag: string): Promise<void> => {
        const region = page.getByRole("region", { name: "Performance traces" });
        await expect(region).toBeVisible();
        await region.scrollIntoViewIfNeeded();
        await region.screenshot({ path: path.join(FRAMES, `debug-${tag}-${combo.name}.png`) });
      };

      // Off: normalize first (recording may be on with spans stored):
      // switch off, then Clear, so the frame shows the pristine off state.
      await page.goto(`${svc.origin}/settings?tab=debug&token=${svc.token}`);
      await page.waitForLoadState("networkidle");
      const state = await page.getByTestId("trace-state").textContent();
      if ((state ?? "").includes("Recording")) {
        await page.getByLabel("Record performance traces").click();
        await expect(page.getByTestId("trace-state")).toHaveText("Off", { timeout: 15_000 });
      }
      await clearTraces(page);
      // Reload for the pristine off frame (drops the cleared note,
      // which is component state).
      await page.reload();
      await expect(page.getByTestId("trace-state")).toHaveText("Off");
      await shot("off");

      // On with a size: the toggle's own settings write already records.
      await page.getByLabel("Record performance traces").click();
      await expect(page.getByTestId("trace-state")).toHaveText("Recording", { timeout: 15_000 });
      await expect(page.getByTestId("trace-size")).toContainText(/spans/, { timeout: 15_000 });
      await shot("on");

      // After Clear: back to zero with the cleared note, shot once the
      // confirm pill dismisses itself.
      await clearTraces(page);
      await shot("cleared");
    });
  }

  for (const combo of [{ name: "1440-light", width: 1440, dark: false }] as const) {
    test(`debug capped frame (${combo.name})`, async ({ page }) => {
      test.setTimeout(120_000);
      // Realistic over-cap store: a few real span lines, then sparse
      // padding past 256 MB (instant: no 256 MB write). The store lives
      // next to the data dir, so pre-creating it is safe: unlike the old
      // in-dir layout it never trips the data-format "has data" gate.
      const cappedDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j356-capped-"));
      let capped: RunningService | null = null;
      try {
        mkdirSync(`${cappedDir}-traces`, { recursive: true });
        const file = `${cappedDir}-traces/spans.jsonl`;
        const line = (i: number): string =>
          JSON.stringify({
            traceId: "a".repeat(32),
            spanId: String(i).padStart(16, "0"),
            name: "http GET /api/reviews",
            kind: 2,
            startTimeUnixNano: "1793949394000000500",
            endTimeUnixNano: "1793949394000000600",
            attributes: [{ key: "http.method", value: { stringValue: "GET" } }],
          });
        writeFileSync(file, [line(1), line(2), line(3)].join("\n") + "\n");
        truncateSync(file, 256 * 1024 * 1024 + 1);
        capped = await startService(cappedDir, { agent: "none" });
        await page.setViewportSize({ width: combo.width, height: 900 });
        if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
        await page.evaluate(() => document.fonts?.ready).catch(() => {});
        await page.goto(`${capped.origin}/settings?tab=debug&token=${capped.token}`);
        // Let the settings + status probes settle: the switch remounts
        // when status lands, which detaches a mid-flight click.
        await page.waitForLoadState("networkidle");
        await page.getByLabel("Record performance traces").click();
        await expect(page.getByRole("alert")).toContainText("256", { timeout: 15_000 });
        await expect(page.getByTestId("trace-state")).toHaveText("Paused (size limit)", {
          timeout: 15_000,
        });
        await expect(page.getByTestId("trace-size")).toContainText("3 spans", { timeout: 15_000 });
        // Clear and Export are both available on an over-cap store.
        await expect(page.getByRole("button", { name: "Clear traces" })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Export traces" })).toBeEnabled();
        const region = page.getByRole("region", { name: "Performance traces" });
        await region.scrollIntoViewIfNeeded();
        await region.screenshot({ path: path.join(FRAMES, `debug-capped-${combo.name}.png`) });
      } finally {
        await capped?.stop().catch(() => {});
        rmSync(cappedDir, { recursive: true, force: true });
        rmSync(`${cappedDir}-traces`, { recursive: true, force: true });
      }
    });
  }
});
