/**
 * J285 (#285 E2): the tight two-column gutter — real service.
 *
 * Expand controls replace the hunk's first/last row numbers and show on
 * row hover (numbers at rest); the comment icon swaps in for the
 * new-side number on hover and permanently on commented lines; closed
 * multi-line ranges read as dotted text (no gutter marker). A hunk at
 * line 1 or at EOF keeps its numbers.
 *
 * Scratch repo (made-up content only): `src/big.py` carries two hunks
 * over a ~50-line gap (step/up/down pairs, comment seeding), and
 * `src/eof.py` ends at EOF (optimistic bottom step drops silently).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import type { Locator } from "@playwright/test";
import { fileKeyForPath } from "@unvibe/shared";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { apiJson, createScratchReview, makeEofFile, makeGapRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const bigKey = fileKeyForPath("src/big.py");
const eofKey = fileKeyForPath("src/eof.py");

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });

/** Issue #285 (E2): hover the button's row, then click (controls are transparent at rest). */
async function clickRowControl(scope: Locator, name: string | RegExp, nth = 0): Promise<void> {
  const btn = scope.getByRole("button", { name }).nth(nth);
  await btn.locator("xpath=ancestor::tr[1]").hover();
  await btn.click();
}

/** Computed opacity of a row's expand controls ("0" at rest, "1" on hover). */
async function controlsOpacity(row: Locator): Promise<string> {
  return row.evaluate((el) => {
    const btns = el.querySelector(".xbtns");
    return btns ? getComputedStyle(btns).opacity : "missing";
  });
}

test.describe("J285 gutter E2", () => {
  let repoDir = "";
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  let h1Start = 0;
  let h1End = 0;
  let h2Start = 0;
  let gapStart = 0;
  let gapEnd = 0;

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j285-repo-"));
    await makeGapRepo(repoDir);
    // Whole-file new `src/eof.py`: one hunk, 1–20, ending at EOF.
    await makeEofFile(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j285-data-"));
    svc = await startService(dataDir, { agent: "none" });
    reviewId = await createScratchReview(svc, repoDir);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const files = (snap.json as { files: { path: string; hunks: { newStart: number; newEnd: number }[] }[] }).files ?? [];
      const big = files.find((f) => f.path === "src/big.py");
      const eof = files.find((f) => f.path === "src/eof.py");
      if (big && big.hunks.length === 2 && eof && eof.hunks.length === 1) {
        h1Start = big.hunks[0].newStart;
        h1End = big.hunks[0].newEnd;
        h2Start = big.hunks[1].newStart;
        gapStart = h1End + 1;
        gapEnd = h2Start - 1;
        break;
      }
      if (Date.now() > deadline) throw new Error(`ingest did not produce the gap+eof shape: ${JSON.stringify(files.map((f) => ({ p: f.path, n: f.hunks.length })))}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    if (gapEnd - gapStart + 1 < 40) throw new Error(`gap too small for step asserts: ${gapStart}-${gapEnd}`);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir]) rmSync(d, { recursive: true, force: true });
  });

  test("hover reveals the controls on the first/last rows, click expands", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const bigFile = page.locator(`[id="F-${bigKey}"]`);
    await expect(bigFile).toBeVisible({ timeout: 60_000 });
    await expect(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
    // Mouse away from the diff so rows rest on their numbers.
    await bigFile.locator(".dfile-h").hover();
    const firstCode = page.locator(`[id="L-${bigKey}-${h1Start}"]`);
    // At rest the controls are transparent and the numbers show…
    expect(await controlsOpacity(firstCode)).toBe("0");
    await expect(firstCode.locator("td.n .nnum").first()).toHaveText(String(h1Start));
    // …row hover reveals the up pair, and it expands like the old control.
    // The first row rides the top-region step (6 lines above hunk 1).
    await firstCode.hover();
    expect(await controlsOpacity(firstCode)).toBe("1");
    const dhunks = bigFile.locator(".dhunk");
    await firstCode.getByRole("button", { name: "Show 6 more lines" }).click();
    await expect(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(6, { timeout: 30_000 });
    await expect(page.locator(`[id="L-${bigKey}-${h1Start - 1}"]`)).toBeVisible();
    // No separator rows anywhere in the file.
    await expect(bigFile.locator("tr.xsep")).toHaveCount(0);
  });

  test("comment icon swaps on hover and rests on commented lines", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // Seed a comment on a middle line of the first hunk.
    const line = h1Start + 1;
    const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
      anchor: { where: "diff-line", fileKey: bigKey, line },
      quote: "",
      text: "E2 gutter check",
    });
    expect(made.status).toBe(201);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const bigFile = page.locator(`[id="F-${bigKey}"]`);
    await expect(bigFile).toBeVisible({ timeout: 60_000 });
    await expect(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
    await bigFile.locator(".dfile-h").hover();
    // Commented middle line: the icon permanently replaces the number.
    const commented = page.locator(`[id="L-${bigKey}-${line}"] td.n.new`);
    await expect(commented).toHaveClass(/e-commented/);
    expect(await commented.locator(".nic").evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
    // Plain middle line (no expand controls there): the number shows at
    // rest…
    const plainRow = page.locator(`[id="L-${bigKey}-${h1Start + 2}"]`);
    const plain = plainRow.locator("td.n.new");
    await expect(plain).not.toHaveClass(/e-commented/);
    expect(await plain.locator(".nnum").evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
    // …and hover swaps the number for the icon.
    await plainRow.hover();
    expect(await plain.locator(".nic").evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
    expect(await plain.locator(".nnum").evaluate((el) => getComputedStyle(el).display)).toBe("none");
    // Clicking the swapped-in icon starts a comment like the number does.
    await plain.locator(".nic").click();
    await expect(bigFile.locator(".ithread[data-pending-thread] textarea")).toBeVisible({ timeout: 15_000 });
  });

  test("a hunk ending at EOF drops the down control and keeps its number", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const file = page.locator(`[id="F-${eofKey}"]`);
    await expect(file).toBeVisible({ timeout: 60_000 });
    await expect(file.getByText("Hunk 1 of 1")).toBeVisible({ timeout: 30_000 });
    const only = file.locator(".dhunk").nth(0);
    // Optimistic bottom step before the total is known (the new file's
    // single hunk starts at line 1, so only the down step shows).
    await expect(only.getByRole("button", { name: "Show 20 more lines" })).toHaveCount(1, { timeout: 30_000 });
    await clickRowControl(only, "Show 20 more lines");
    // At EOF nothing is added and the row shows its number again.
    await expect(file.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
    await expect(file.locator("tr.has-xdown")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(`[id="L-${eofKey}-20"] td.n .nnum`).first()).toHaveText("20");
    await expect(page.locator(".xerr")).toHaveCount(0);
  });
});
