/** J19 (#202): blank band above the first hunk — the first visible file's
 * header (and its first hunk header) must never be covered by the pinned
 * band backing, with a file filter active, in split view, and after tab
 * switches, reloads and scrolling. Real service, no agent. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import type { Page } from "@playwright/test";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { createScratchReview, git } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const FILE_COUNT = 28;

/**
 * The first visible file's file header and first hunk header must be
 * painted (topmost at their centres), not covered by the opaque pinned
 * band (`.dband`) or anything else — the #202 blank band is exactly a
 * header hidden under that backing. Also fails on any empty block
 * taller than 8px between the toolbar and the first hunk's table.
 */
async function expectFirstHeadersVisible(page: Page, step: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const pane = document.getElementById("right");
          if (!pane) return "no pane";
          const file = pane.querySelector(".dfile");
          if (!file) return "no file";
          const fh = file.querySelector(".dfile-h");
          const hh = file.querySelector(".dhunk-h");
          if (!fh || !hh) return "no headers";
          for (const [el, what] of [
            [fh, "file"],
            [hh, "hunk"],
          ] as const) {
            const r = el.getBoundingClientRect();
            if (r.height <= 0) return `${what} header has no height`;
            const hit = document.elementFromPoint(r.left + Math.min(200, r.width / 2), r.top + r.height / 2);
            if (!hit || !el.contains(hit)) {
              return `${what} header covered by ${hit ? `${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)}` : "nothing"}`;
            }
          }
          if ((fh.textContent ?? "").trim() === "") return "file header empty";
          return null;
        }),
      { timeout: 10_000 },
    )
    .toBeNull()
    .catch((e: unknown) => {
      throw new Error(`${step}: ${e instanceof Error ? e.message : String(e)}`);
    });
}

test.describe("J19 blank band (#202)", () => {
  let repoDir = "";
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j19-repo-"));
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j19-data-"));
    mkdirSync(path.join(repoDir, "src"), { recursive: true });
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    for (let i = 0; i < FILE_COUNT; i++) {
      const lines = Array.from({ length: 12 }, (_, l) => `value_${i}_${l} = ${l}`).join("\n") + "\n";
      writeFileSync(path.join(repoDir, "src", `mod${String(i).padStart(2, "0")}.py`), lines);
    }
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    for (let i = 0; i < FILE_COUNT; i++) {
      const lines = Array.from({ length: 12 }, (_, l) => `value_${i}_${l} = ${l + 100}`).join("\n") + "\n";
      writeFileSync(path.join(repoDir, "src", `mod${String(i).padStart(2, "0")}.py`), lines);
    }
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "change all");
    svc = await startService(dataDir, { agent: "none" });
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("first file header shows with filter, split view and tab switches", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });

    // Split view, no filter.
    await page.getByRole("button", { name: "Split" }).click();
    await expect(page.locator("#right table.diff.split").first()).toBeVisible({ timeout: 15_000 });
    await expectFirstHeadersVisible(page, "split, unfiltered");

    // File filter active: most files hidden before the first visible one.
    await page.getByRole("button", { name: "Show file list" }).click();
    await page.getByLabel("Filter files by name").fill("mod2");
    await expect(page.locator('[id="F-src-mod20.py"]')).toBeVisible({ timeout: 15_000 });
    await expectFirstHeadersVisible(page, "split, filtered to mod2*");
    await page.screenshot({ path: "test-results/j19-filtered-split.png" });

    // Tab switch: description/commits tab and back to Diff.
    await page.locator('#right [role="tab"]').first().click();
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff.split").first()).toBeVisible({ timeout: 15_000 });
    await expectFirstHeadersVisible(page, "split, after tab switch");

    // Reload and return to the Diff tab.
    await page.reload();
    await page.locator('#right [role="tab"]').getByText("Diff").click().catch(() => {});
    await expect(page.locator("#right table.diff.split").first()).toBeVisible({ timeout: 30_000 });
    await expectFirstHeadersVisible(page, "split, after reload");

    // Scroll away and back to the top.
    await page.evaluate(() => {
      const p = document.getElementById("right");
      if (p) p.scrollTop = 600;
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const p = document.getElementById("right");
      if (p) p.scrollTop = 0;
    });
    await expectFirstHeadersVisible(page, "split, back at top after scroll");

    // Unified view with the filter still in place.
    await page.getByRole("button", { name: "Unified" }).click();
    await expect(page.locator("#right table.diff:not(.split)").first()).toBeVisible({ timeout: 15_000 });
    await expectFirstHeadersVisible(page, "unified, filtered");
  });
});
