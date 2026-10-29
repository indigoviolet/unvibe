/**
 * J308 (#308): repeated expand-20 keeps working in both directions —
 * real service.
 *
 * E2 put the expand controls on the hunk's own first/last rows, so
 * after one expansion the outermost visible row offered only the
 * collapse toggle. Now expand-more (`^`/`^^`, `v`/`vv`) rides the
 * outermost visible row in each direction and the `fold` collapse
 * chevron ("Hide expanded lines above/below") the next row in; both
 * move outward with every expansion until the gap closes or the file's
 * start or end.
 *
 * Scratch repo (made-up content only):
 * - `src/mid.py`: 220 lines, changed at 10/110/200 — the middle hunk
 *   has ~100 lines of real context each way (three 20-line steps up
 *   and down, then show-all closes the gap);
 * - `src/first.py`: hunk at line 1 (no up controls, number shows);
 * - `src/last.py`: last hunk ends at EOF (optimistic step drops).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import type { Locator, Page } from "@playwright/test";
import { fileKeyForPath } from "@unvibe/shared";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { apiJson, createScratchReview, git } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const midKey = fileKeyForPath("src/mid.py");
const firstKey = fileKeyForPath("src/first.py");
const lastKey = fileKeyForPath("src/last.py");

/** Issue #285 (E2): hover the button's row, then click. */
async function clickRowControl(scope: Locator, name: string | RegExp, nth = 0): Promise<void> {
  const btn = scope.getByRole("button", { name }).nth(nth);
  await btn.locator("xpath=ancestor::tr[1]").hover();
  await btn.click();
}

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });

async function makeJ308Repo(dir: string): Promise<void> {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  const midBase = Array.from({ length: 220 }, (_, i) => `mid_${String(i + 1).padStart(3, "0")} = ${i + 1}`);
  writeFileSync(path.join(dir, "src", "mid.py"), `${midBase.join("\n")}\n`);
  const firstBase = Array.from({ length: 60 }, (_, i) => `first_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
  writeFileSync(path.join(dir, "src", "first.py"), `${firstBase.join("\n")}\n`);
  const lastBase = Array.from({ length: 60 }, (_, i) => `last_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
  writeFileSync(path.join(dir, "src", "last.py"), `${lastBase.join("\n")}\n`);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  const midFeat = [...midBase];
  midFeat[9] = "mid_010 = 1000  # changed";
  midFeat[109] = "mid_110 = 11000  # changed";
  midFeat[199] = "mid_200 = 20000  # changed";
  writeFileSync(path.join(dir, "src", "mid.py"), `${midFeat.join("\n")}\n`);
  const firstFeat = [...firstBase];
  firstFeat[0] = "first_01 = 1000  # changed";
  firstFeat[49] = "first_50 = 5000  # changed";
  writeFileSync(path.join(dir, "src", "first.py"), `${firstFeat.join("\n")}\n`);
  const lastFeat = [...lastBase];
  lastFeat[9] = "last_10 = 1000  # changed";
  lastFeat[59] = "last_60 = 6000  # changed";
  writeFileSync(path.join(dir, "src", "last.py"), `${lastFeat.join("\n")}\n`);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "feature work");
}

test.describe("J308 repeated expansion", () => {
  let repoDir = "";
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  let mid1End = 0;
  let mid2Start = 0;
  let mid2End = 0;
  let mid3Start = 0;

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j308-repo-"));
    await makeJ308Repo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j308-data-"));
    svc = await startService(dataDir, { agent: "none" });
    reviewId = await createScratchReview(svc, repoDir);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const files = (snap.json as { files: { path: string; hunks: { newStart: number; newEnd: number }[] }[] }).files ?? [];
      const mid = files.find((f) => f.path === "src/mid.py");
      const first = files.find((f) => f.path === "src/first.py");
      const last = files.find((f) => f.path === "src/last.py");
      if (mid && mid.hunks.length === 3 && first && first.hunks.length === 2 && last && last.hunks.length === 2) {
        mid1End = mid.hunks[0].newEnd;
        mid2Start = mid.hunks[1].newStart;
        mid2End = mid.hunks[1].newEnd;
        mid3Start = mid.hunks[2].newStart;
        break;
      }
      if (Date.now() > deadline) throw new Error(`ingest did not produce the j308 shape: ${JSON.stringify(files.map((f) => ({ p: f.path, n: f.hunks.length })))}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    // The middle hunk needs 60+ lines of hidden context each way for
    // three 20-line steps up and down, plus a remainder so show-all
    // stays offered.
    if (mid2Start - mid1End - 1 < 61) throw new Error(`upper gap too small: ${mid1End + 1}-${mid2Start - 1}`);
    if (mid3Start - mid2End - 1 < 61) throw new Error(`lower gap too small: ${mid2End + 1}-${mid3Start - 1}`);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir]) rmSync(d, { recursive: true, force: true });
  });

  async function openMid(page: Page): Promise<Locator> {
    await page.goto(`${svc!.origin}/review/${reviewId}?token=${svc!.token}`);
    const file = page.locator(`[id="F-${midKey}"]`);
    await expect(file).toBeVisible({ timeout: 60_000 });
    await expect(file.getByText("Hunk 3 of 3")).toBeVisible({ timeout: 30_000 });
    return file;
  }

  test("expands up three times from the middle hunk, controls moving outward", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const file = await openMid(page);
    const dhunks = file.locator(".dhunk");
    const second = dhunks.nth(1);
    // Three 20-line up-steps; the up control stays nth(0) in the
    // section (the down control rides after the hunk rows).
    for (let k = 1; k <= 3; k++) {
      await clickRowControl(second, "Show 20 more lines", 0);
      await expect(second.locator("tr[data-revealed]")).toHaveCount(20 * k, { timeout: 30_000 });
      await expect(page.locator(`[id="L-${midKey}-${mid2Start - 20 * k}"]`)).toBeVisible();
    }
    // Still offered (the gap is larger than 60 lines) — the remaining
    // count shrinks with every step.
    const remaining = mid2Start - mid1End - 1 - 60;
    await expect(second.getByRole("button", { name: `Show all ${remaining} lines` })).toBeVisible({ timeout: 30_000 });
    // The outermost revealed row carries expand-more, the next row in
    // the collapse chevron; the hunk's own first row shows its number.
    const outer = page.locator(`[id="L-${midKey}-${mid2Start - 60}"]`);
    await expect(outer).toHaveClass(/has-xup/);
    const inner = page.locator(`[id="L-${midKey}-${mid2Start - 59}"]`);
    await expect(inner).toHaveClass(/has-xhide-up/);
    await expect(inner.getByRole("button", { name: "Hide expanded lines above" })).toBeVisible();
    // The hunk's own first row offers nothing upward anymore (its
    // down side may still offer below on a one-row hunk).
    await expect(page.locator(`[id="L-${midKey}-${mid2Start}"]`)).not.toHaveClass(/has-xup/);
    await expect(page.locator(`[id="L-${midKey}-${mid2Start}"]`)).not.toHaveClass(/has-xhide-up/);
    await expect(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
    await expect(dhunks.nth(2).locator("tr[data-revealed]")).toHaveCount(0);
    await expect(page.locator(".xerr")).toHaveCount(0);
  });

  test("expands down three times from the middle hunk, controls moving outward", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const file = await openMid(page);
    const dhunks = file.locator(".dhunk");
    const second = dhunks.nth(1);
    // The down control stays nth(1) in the section (the up control
    // rides before the hunk rows).
    for (let k = 1; k <= 3; k++) {
      await clickRowControl(second, "Show 20 more lines", 1);
      await expect(second.locator("tr[data-revealed]")).toHaveCount(20 * k, { timeout: 30_000 });
      await expect(page.locator(`[id="L-${midKey}-${mid2End + 20 * k}"]`)).toBeVisible();
    }
    const remaining = mid3Start - mid2End - 1 - 60;
    await expect(second.getByRole("button", { name: `Show all ${remaining} lines` })).toBeVisible({ timeout: 30_000 });
    const outer = page.locator(`[id="L-${midKey}-${mid2End + 60}"]`);
    await expect(outer).toHaveClass(/has-xdown/);
    const inner = page.locator(`[id="L-${midKey}-${mid2End + 59}"]`);
    await expect(inner).toHaveClass(/has-xhide-down/);
    await expect(inner.getByRole("button", { name: "Hide expanded lines below" })).toBeVisible();
    await expect(page.locator(`[id="L-${midKey}-${mid2End}"]`)).not.toHaveClass(/has-xdown/);
    await expect(page.locator(`[id="L-${midKey}-${mid2End}"]`)).not.toHaveClass(/has-xhide-down/);
    await expect(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
    await expect(dhunks.nth(2).locator("tr[data-revealed]")).toHaveCount(0);
    await expect(page.locator(".xerr")).toHaveCount(0);
  });

  test("expand, expand, collapse, expand in both directions", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const file = await openMid(page);
    const dhunks = file.locator(".dhunk");
    const second = dhunks.nth(1);
    // Up twice, collapse, expand again.
    await clickRowControl(second, "Show 20 more lines", 0);
    await expect(second.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
    await clickRowControl(second, "Show 20 more lines", 0);
    await expect(second.locator("tr[data-revealed]")).toHaveCount(40, { timeout: 30_000 });
    await clickRowControl(second, "Hide expanded lines above");
    await expect(second.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
    // Expand-more is back on the hunk's own first row.
    await expect(page.locator(`[id="L-${midKey}-${mid2Start}"]`)).toHaveClass(/has-xup/);
    await clickRowControl(second, "Show 20 more lines", 0);
    await expect(second.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
    // Down once, collapse, expand again — the upper tail is untouched.
    await clickRowControl(second, "Show 20 more lines", 1);
    await expect(second.locator("tr[data-revealed]")).toHaveCount(40, { timeout: 30_000 });
    await clickRowControl(second, "Hide expanded lines below");
    await expect(second.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
    await expect(page.locator(`[id="L-${midKey}-${mid2Start - 20}"]`)).toBeVisible();
    await clickRowControl(second, "Show 20 more lines", 1);
    await expect(second.locator("tr[data-revealed]")).toHaveCount(40, { timeout: 30_000 });
    await expect(page.locator(".xerr")).toHaveCount(0);
    // Hover the collapse row and capture a tight frame of both gutter
    // controls for the report: expand-more on the outermost row, the
    // collapse chevron on the next row in.
    const outerUp = page.locator(`[id="L-${midKey}-${mid2Start - 20}"]`);
    const inner = page.locator(`[id="L-${midKey}-${mid2Start - 19}"]`);
    await expect(inner.getByRole("button", { name: "Hide expanded lines above" })).toBeVisible();
    await inner.hover();
    const obox = await outerUp.boundingBox();
    const ibox = await inner.boundingBox();
    if (obox && ibox) {
      await page.screenshot({
        path: "test-results/j308-collapse-hover.png",
        clip: {
          x: Math.max(0, obox.x - 4),
          y: Math.max(0, obox.y - 8),
          width: 620,
          height: obox.height + ibox.height + 16,
        },
      });
    }
  });

  test("show-all closes the gap; collapsing reopens it", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const file = await openMid(page);
    const dhunks = file.locator(".dhunk");
    const first = dhunks.nth(0);
    const second = dhunks.nth(1);
    const gapLen = mid2Start - mid1End - 1;
    // ⇞ from the lower hunk fills the whole gap at once.
    await clickRowControl(second, `Show all ${gapLen} lines`);
    await expect(file.locator("tr[data-revealed]")).toHaveCount(gapLen, { timeout: 60_000 });
    await expect(second.locator("tr[data-revealed]")).toHaveCount(gapLen);
    await expect(first.locator("tr[data-revealed]")).toHaveCount(0);
    // Gap closed: neither end offers show-all for it anymore.
    await expect(second.getByRole("button", { name: `Show all ${gapLen} lines` })).toHaveCount(0);
    // Collapsing the tail reopens the gap from the lower side.
    await clickRowControl(second, "Hide expanded lines above");
    await expect(file.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
    await expect(second.getByRole("button", { name: `Show all ${gapLen} lines` })).toBeVisible({ timeout: 30_000 });
    await expect(first.getByRole("button", { name: `Show all ${gapLen} lines` })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".xerr")).toHaveCount(0);
  });

  test("a hunk at line 1 keeps its number and expands down repeatedly", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const file = page.locator(`[id="F-${firstKey}"]`);
    await expect(file).toBeVisible({ timeout: 60_000 });
    await expect(file.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
    const dhunks = file.locator(".dhunk");
    const hunk1 = dhunks.nth(0);
    // No up controls above a hunk starting at line 1; the first row
    // shows its number.
    const line1 = page.locator(`[id="L-${firstKey}-1"]`);
    await expect(line1).not.toHaveClass(/has-xup/);
    await expect(line1).not.toHaveClass(/has-xhide-up/);
    await expect(line1.locator("td.n .nnum").first()).toHaveText("1");
    // Down expands repeatedly below it (gap is 48 lines: 2, then 20).
    await clickRowControl(hunk1, "Show 20 more lines");
    await expect(hunk1.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
    await clickRowControl(hunk1, "Show 20 more lines");
    await expect(hunk1.locator("tr[data-revealed]")).toHaveCount(40, { timeout: 30_000 });
    await expect(page.locator(".xerr")).toHaveCount(0);
  });

  test("the last hunk drops its down control at EOF", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const file = page.locator(`[id="F-${lastKey}"]`);
    await expect(file).toBeVisible({ timeout: 60_000 });
    await expect(file.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
    const dhunks = file.locator(".dhunk");
    const last = dhunks.nth(1);
    // Optimistic bottom step before the total is known (beside the
    // gap's own up step).
    await expect(last.getByRole("button", { name: "Show 20 more lines" })).toHaveCount(2, { timeout: 30_000 });
    await clickRowControl(last, "Show 20 more lines", 1);
    // The hunk ends at EOF: nothing added, the down control drops, the
    // row shows its number again — silently. The gap's up step stays.
    await expect(file.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
    await expect(last.locator("tr.has-xdown")).toHaveCount(0, { timeout: 30_000 });
    await expect(last.getByRole("button", { name: "Show 20 more lines" })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator(".xerr")).toHaveCount(0);
  });
});
