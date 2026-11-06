/**
 * J356 (#356): opt-in performance traces on the real service.
 *
 * Journey: turn recording on in Settings → Debug, open the demo review,
 * export the traces, and check the file has HTTP and job spans with no
 * token leakage. Frames: the Debug section off, on with a size, after
 * Clear, and capped — at 1440/960, light/dark, in /tmp/356-frames/.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, truncateSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const FRAMES = "/tmp/356-frames";

test.describe("J356 traces", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    mkdirSync(FRAMES, { recursive: true });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j356-"));
    svc = await startService(dataDir, { agent: "replay" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  test("record, open the demo review, export HTTP + job spans", async ({ page }) => {
    if (!svc) throw new Error("no service");
    test.setTimeout(240_000);
    // Recording on through the UI switch (not the API).
    await page.goto(`${svc.origin}/settings?tab=debug&token=${svc.token}`);
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
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
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

  const combos = [
    { name: "1440-light", width: 1440, dark: false },
    { name: "1440-dark", width: 1440, dark: true },
    { name: "960-light", width: 960, dark: false },
    { name: "960-dark", width: 960, dark: true },
  ] as const;

  for (const combo of combos) {
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

      // Off: normalize first (combos share one service; a previous
      // combo may have left recording on with spans stored): switch
      // off, then Clear, so the frame shows the pristine off state.
      await page.goto(`${svc.origin}/settings?tab=debug&token=${svc.token}`);
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

  for (const combo of combos) {
    test(`debug capped frame (${combo.name})`, async ({ page }) => {
      test.setTimeout(120_000);
      // Realistic over-cap store: a few real span lines, then sparse
      // padding past 256 MB (instant, no 256 MB write). Created before
      // the service boots so the count is picked up.
      const cappedDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j356-capped-"));
      let capped: RunningService | null = null;
      try {
        mkdirSync(path.join(cappedDir, "traces"), { recursive: true });
        const file = path.join(cappedDir, "traces", "spans.jsonl");
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
      }
    });
  }
});
