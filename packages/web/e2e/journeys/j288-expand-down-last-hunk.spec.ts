/**
 * J288 (#288): expand-down below a file's last hunk — real service.
 *
 * The diff showed no expand-down control below a file's last hunk until
 * the file's total line count was known. The fix shows the step
 * optimistically: the first click fetches one assumed step, teaches the
 * total, and either reveals or (at EOF) disappears silently.
 *
 * Scratch repo (made-up content only) with two files:
 * - `src/bottom.py`: last hunk ends at line 53 of 80, so 27 lines remain
 *   below it — the first down-step reveals 20 with no prior expansion.
 * - `src/eof.py`: single hunk ends at EOF (line 20 of 20) — the click
 *   adds nothing, the control disappears, and nothing errors.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { fileKeyForPath } from "@unvibe/shared";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { apiJson, createScratchReview, git } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const bottomKey = fileKeyForPath("src/bottom.py");
const eofKey = fileKeyForPath("src/eof.py");

/**
 * Issue #285 (E2): expand controls ride the hunk's first/last row and
 * show on row hover — hover the button's row, then click.
 */
async function clickRowControl(scope: import("@playwright/test").Locator, name: string | RegExp, nth = 0): Promise<void> {
  const btn = scope.getByRole("button", { name }).nth(nth);
  await btn.locator("xpath=ancestor::tr[1]").hover();
  await btn.click();
}

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });

async function makeBottomEofRepo(dir: string): Promise<void> {
  mkdirSync(path.join(dir, "src"), { recursive: true });
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  const bottomBase = Array.from({ length: 80 }, (_, i) => `value_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
  writeFileSync(path.join(dir, "src", "bottom.py"), `${bottomBase.join("\n")}\n`);
  const eofBase = Array.from({ length: 20 }, (_, i) => `item_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
  writeFileSync(path.join(dir, "src", "eof.py"), `${eofBase.join("\n")}\n`);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  const bottomFeat = [...bottomBase];
  bottomFeat[9] = "value_10 = 1000  # changed";
  bottomFeat[49] = "value_50 = 5000  # changed";
  writeFileSync(path.join(dir, "src", "bottom.py"), `${bottomFeat.join("\n")}\n`);
  const eofFeat = [...eofBase];
  eofFeat[19] = "item_20 = 9999  # changed";
  writeFileSync(path.join(dir, "src", "eof.py"), `${eofFeat.join("\n")}\n`);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "feature work");
}

test.describe("J288 expand down last hunk", () => {
  let repoDir = "";
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  let bottomEnd = 0;

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j288-repo-"));
    await makeBottomEofRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j288-data-"));
    svc = await startService(dataDir, { agent: "none" });
    reviewId = await createScratchReview(svc, repoDir);
    const deadline = Date.now() + 90_000;
    let bottom: { newStart: number; newEnd: number }[] | undefined;
    let eof: { newStart: number; newEnd: number }[] | undefined;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const files = (snap.json as { files: { path: string; hunks: { newStart: number; newEnd: number }[] }[] }).files ?? [];
      bottom = files.find((f) => f.path === "src/bottom.py")?.hunks;
      eof = files.find((f) => f.path === "src/eof.py")?.hunks;
      if (bottom && bottom.length === 2 && eof && eof.length === 1) break;
      if (Date.now() > deadline) throw new Error(`ingest did not produce the bottom+eof shape: ${JSON.stringify(files.map((f) => ({ p: f.path, n: f.hunks.length })))}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    bottomEnd = bottom![1].newEnd;
    if (bottomEnd + 20 > 80) throw new Error(`bottom hunk ends too late for a 20-line step: ${bottomEnd}`);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir]) rmSync(d, { recursive: true, force: true });
  });

  test("expands down from the last hunk with no prior expansion", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const file = page.locator(`[id="F-${bottomKey}"]`);
    await expect(file).toBeVisible({ timeout: 60_000 });
    await expect(file.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
    // No prior expansion anywhere in this file.
    await expect(file.locator("tr[data-revealed]")).toHaveCount(0);
    const dhunks = file.locator(".dhunk");
    const last = dhunks.nth(1);
    // The last hunk carries two 20-line steps: the gap above (up) and
    // the optimistic bottom below it (down, #285: `v` on the last row)
    // — visible even though no slice has taught the total yet.
    const steps = last.getByRole("button", { name: "Show 20 more lines" });
    await expect(steps).toHaveCount(2, { timeout: 30_000 });
    await clickRowControl(last, "Show 20 more lines", 1);
    // One 20-line step below the hunk, with no prior expansion.
    await expect(last.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
    await expect(page.locator(`[id="L-${bottomKey}-${bottomEnd + 1}"]`)).toHaveCount(1);
    await expect(page.locator(`[id="L-${bottomKey}-${bottomEnd + 20}"]`)).toHaveCount(1);
    // Nothing leaks into the earlier hunk's section.
    await expect(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
    // The total is now known: the short tail offers its own show-all —
    // riding the outermost revealed row (issue #308), not the hunk row.
    await expect(file.getByRole("button", { name: "Show all 7 lines" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".xerr")).toHaveCount(0);
  });

  test("clicking past EOF adds nothing and drops the control silently", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const file = page.locator(`[id="F-${eofKey}"]`);
    await expect(file).toBeVisible({ timeout: 60_000 });
    await expect(file.getByText("Hunk 1 of 1")).toBeVisible({ timeout: 30_000 });
    const dhunks = file.locator(".dhunk");
    const only = dhunks.nth(0);
    // Optimistic bottom step shows before the total is known (the top
    // region's step names its own 16-line run, so the 20-line step is
    // unambiguous).
    await expect(only.getByRole("button", { name: "Show 20 more lines" })).toBeVisible({ timeout: 30_000 });
    await expect(file.locator("tr[data-revealed]")).toHaveCount(0);
    await clickRowControl(only, "Show 20 more lines");
    // No lines added, no error, and the bottom control is gone — the row
    // shows its number again (#285: no `has-xdown`), while the top
    // control on the hunk's first row stays.
    await expect(file.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
    await expect(only.getByRole("button", { name: "Show 20 more lines" })).toHaveCount(0, { timeout: 30_000 });
    await expect(file.locator("tr.has-xdown")).toHaveCount(0, { timeout: 30_000 });
    await expect(file.locator("tr.has-xup")).toHaveCount(1, { timeout: 30_000 });
    await expect(file.locator("tr.xsep")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".xerr")).toHaveCount(0);
  });
});
