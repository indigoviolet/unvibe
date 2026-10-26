/**
 * J265 (#265): expanding up lands in the clicked hunk — real service.
 *
 * The demo cannot serve this: its worktree pads every line outside the
 * hunks blank, so the content probe answers `no-content` (hiding every
 * expansion control) and hidden-region slices fail. This journey uses a
 * scratch repo with one two-hunk file over a real ~50-line gap instead.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import type { Locator } from "@playwright/test";
import { fileKeyForPath } from "@unvibe/shared";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { apiJson, createScratchReview, makeGapRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const bigKey = fileKeyForPath("src/big.py");

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });
test.describe("J265 expand up", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  let h1End = 0;
  let h2Start = 0;
  let gapStart = 0;
  let gapEnd = 0;

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j265-repo-"));
    await makeGapRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j265-data-"));
    svc = await startService(dataDir, { agent: "none" });
    reviewId = await createScratchReview(svc, repoDir);
    // Wait for ingest: the diff lands asynchronously.
    const deadline = Date.now() + 90_000;
    let file: { hunks: { newStart: number; newEnd: number }[] } | undefined;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      file = (snap.json as { files: { path: string; hunks: { newStart: number; newEnd: number }[] }[] }).files?.find(
        (f) => f.path === "src/big.py",
      );
      if (file && file.hunks.length === 2) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!file || file.hunks.length !== 2) throw new Error(`expected one two-hunk file, got ${JSON.stringify(file?.hunks)}`);
    h1End = file.hunks[0].newEnd;
    h2Start = file.hunks[1].newStart;
    gapStart = h1End + 1;
    gapEnd = h2Start - 1;
    if (gapEnd - gapStart + 1 < 40) throw new Error(`gap too small for step asserts: ${gapStart}-${gapEnd}`);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir]) rmSync(d, { recursive: true, force: true });
  });

  /** Row ids/classes of a hunk section's table, in order. */
  async function rowIds(dhunk: Locator): Promise<string[]> {
    return dhunk.locator("table.diff tbody tr").evaluateAll((rows) =>
      rows.map((r) => {
        const el = r as HTMLElement;
        return el.id !== "" ? el.id : el.className;
      }),
    );
  }

  test("expand up reveals the tail above the clicked hunk", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const bigFile = page.locator(`[id="F-${bigKey}"]`);
    await expect(bigFile).toBeVisible({ timeout: 60_000 });
    await expect(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
    const dhunks = bigFile.locator(".dhunk");
    const second = dhunks.nth(1);
    // The second hunk's own step-up (^): one 20-line step of the gap.
    await second.getByRole("button", { name: "Show 20 more lines" }).click();
    await expect(second.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
    // Nothing leaks into the previous hunk's section.
    await expect(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
    // The tail sits in this hunk's section, directly above its first
    // code line and under its own header.
    const ids = await rowIds(second);
    expect(ids[0]).toContain("xsep");
    expect(ids[1]).toBe(`L-${bigKey}-${gapEnd - 19}`);
    expect(ids[20]).toBe(`L-${bigKey}-${gapEnd}`);
    expect(ids[21]).toBe(`L-${bigKey}-${h2Start}`);
  });

  test("expand down adds lines to the bottom of the clicked hunk", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const bigFile = page.locator(`[id="F-${bigKey}"]`);
    await expect(bigFile).toBeVisible({ timeout: 60_000 });
    await expect(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
    const dhunks = bigFile.locator(".dhunk");
    const first = dhunks.nth(0);
    // The gap step-down (v): the top step's count differs (6 lines), so
    // the 20-line step is unambiguous.
    await first.getByRole("button", { name: "Show 20 more lines" }).click();
    await expect(first.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
    await expect(dhunks.nth(1).locator("tr[data-revealed]")).toHaveCount(0);
    // The head sits directly below this hunk's last code line.
    const ids = await rowIds(first);
    const codeEnd = ids.indexOf(`L-${bigKey}-${h1End}`);
    expect(codeEnd).toBeGreaterThan(0);
    expect(ids.slice(codeEnd, codeEnd + 22)).toEqual([
      `L-${bigKey}-${h1End}`,
      ...Array.from({ length: 20 }, (_, k) => `L-${bigKey}-${gapStart + k}`),
      expect.stringContaining("xsep"),
    ]);
  });

  test("show-all up fills the gap once, atop the clicked hunk", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const gapLen = gapEnd - gapStart + 1;
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const bigFile = page.locator(`[id="F-${bigKey}"]`);
    await expect(bigFile).toBeVisible({ timeout: 60_000 });
    await expect(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
    const dhunks = bigFile.locator(".dhunk");
    const second = dhunks.nth(1);
    // ⇞ to the previous hunk fills the whole gap at once.
    await second.getByRole("button", { name: `Show all ${gapLen} lines` }).click();
    await expect(bigFile.locator("tr[data-revealed]")).toHaveCount(gapLen, { timeout: 60_000 });
    await expect(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
    await expect(second.locator("tr[data-revealed]")).toHaveCount(gapLen);
    // Shown once: exactly one row per line, no duplicates.
    await expect(page.locator(`[id="L-${bigKey}-${gapStart}"]`)).toHaveCount(1);
    await expect(page.locator(`[id="L-${bigKey}-${gapEnd}"]`)).toHaveCount(1);
    // The whole gap reads atop the clicked hunk, into its first line.
    const ids = await rowIds(second);
    expect(ids[0]).toBe(`L-${bigKey}-${gapStart}`);
    expect(ids[gapLen - 1]).toBe(`L-${bigKey}-${gapEnd}`);
    expect(ids[gapLen]).toBe(`L-${bigKey}-${h2Start}`);
  });
});
