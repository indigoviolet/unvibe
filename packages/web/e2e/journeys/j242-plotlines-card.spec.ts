/** J242 (#242): Plotlines card — no numbers, hunk-count chips, a
 * builds-on chip that goes to the earlier plotline, titles in full —
 * against the real service in replay (the demo has two plotlines
 * where one builds on the other). #343 extends it with the per-plotline
 * reviewed checkbox. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { checkLayout } from "../layout-check.js";
import { apiJson, createDemoReview, stampDataFormat } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J242 plotlines card", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j242-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
    // #343 read-only test needs an older version and the demo has only
    // one: stamp the stored snapshot as having a newer current version,
    // then restart. Let the replay pipeline settle first: stopping with
    // a D2 render in flight orphans its `unvibe-d2-*` temp dir (the
    // render cleans up in `finally`), which fails the per-run temp
    // guard (#24) — same pattern as visual-tour-255.
    const quietDeadline = Date.now() + 90_000;
    for (;;) {
      const jobsRes = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
      const jobs = (jobsRes.json as { jobs: { state: string }[] }).jobs ?? [];
      if (jobs.length > 0 && jobs.every((j) => j.state === "done" || j.state === "error" || j.state === "cancelled")) break;
      if (Date.now() > quietDeadline) throw new Error("replay jobs never settled before the restart");
      await new Promise((r) => setTimeout(r, 500));
    }
    await svc.stop();
    {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
      try {
        const row = db
          .prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?")
          .get(reviewId) as { rev: number; snapshot: string };
        const snap = JSON.parse(row.snapshot) as { review: { currentVersion: number } };
        snap.review.currentVersion = 2;
        db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
          row.rev + 1,
          JSON.stringify(snap),
          reviewId,
        );
        stampDataFormat(db);
      } finally {
        db.close();
      }
    }
    svc = await startService(dataDir, { agent: "replay" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("plotlines read as chips, builds-on goes to the earlier plotline", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    const box = page.locator(".plotlines");
    await expect(box).toBeVisible({ timeout: 15_000 });
    // Two plotlines where one builds on the other, plus Other.
    await expect(box.locator(".plname", { hasText: "Unfold folded values" })).toBeVisible();
    await expect(box.locator(".plname", { hasText: "Prove the unfolding works" })).toBeVisible();
    // #242: no numbering; every row carries its hunk count as a chip
    // in the same trailing slot.
    await expect(box.locator(".plorder")).toHaveCount(0);
    await expect(box.locator(".ui-row .ui-badge", { hasText: /^\d+\/\d+$/ }).first()).toBeVisible();
    // #324: shares sum to the total and one stacked bar mirrors them.
    const shareText = await box.locator(".ui-row .ui-badge").allTextContents();
    const shares = shareText.filter((c) => /^\d+\/\d+$/.test(c.trim())).map((c) => c.trim().split("/").map(Number));
    expect(shares.length).toBeGreaterThan(0);
    expect(shares.reduce((n, [num]) => n + (num ?? 0), 0)).toBe(shares[0]?.[1]);
    await expect(box.locator(".plshare-seg")).toHaveCount(shares.length);
    // Builds on names the earlier plotline in a chip.
    const chip = box.locator('[data-buildson="unfold"]');
    await expect(chip).toContainText("Unfold folded values");
    await expect(box.locator(".plbuilds")).toContainText("Builds on");

    // Titles show in full: nothing is ellipsized, long titles wrap.
    const truncated = await box.locator(".plname").evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
    );
    expect(truncated).toEqual([]);

    await checkLayout(page, "j242-plotlines");

    // The builds-on chip goes to the earlier plotline: the diff
    // filters to it and its first hunk scrolls into view.
    await chip.click();
    await expect(page.locator('[data-filterchip="plotline"]')).toContainText("Plotline: Unfold folded values", {
      timeout: 15_000,
    });
    const inView = await page.evaluate(() => {
      const el = document.querySelector("[data-hunk]");
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight;
    });
    expect(inView).toBe(true);
    await checkLayout(page, "j242-plotlines-filtered");
  });

  // #343: the row-end checkbox marks a whole plotline reviewed (and
  // folds it) or unmarks it all, through the same per-hunk API as the
  // diff's per-file mark-all.
  test("plotline reviewed checkbox checks, partials and unchecks the whole plotline", async ({ page }) => {
    test.setTimeout(240_000);
    const s = svc;
    if (!s) throw new Error("no service");
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    const box = page.locator(".plotlines");
    await expect(box).toBeVisible({ timeout: 15_000 });
    const unfold = box.locator('[data-plotreviewed="unfold"]');
    const unfoldTests = box.locator('[data-plotreviewed="unfold-tests"]');
    const other = box.locator('[data-plotreviewed="other"]');

    // The previous test leaves the diff filtered to a plotline; clear
    // it so the file headers below render every hunk.
    const pressed = box.locator('[data-plotpick][aria-pressed="true"]');
    if ((await pressed.count()) > 0) {
      await pressed.first().click();
      await expect(box.locator('[data-plotpick][aria-pressed="true"]')).toHaveCount(0, { timeout: 15_000 });
    }

    type HS = { contentHash: string; reviewed: boolean; folded: boolean; plotline?: string };
    const snapshot = async (): Promise<{
      files: { hunks: { contentHash: string; hiddenReason?: string }[] }[];
      hunkStates: HS[];
    }> => (await apiJson(s, "GET", `/api/reviews/${reviewId}`)).json as never;
    const statesOf = async (plot: string): Promise<HS[]> =>
      (await snapshot()).hunkStates.filter((h) => (h.plotline ?? "other") === plot);

    // Initial state: the live demo starts fully unreviewed (the
    // fixture's mid-use reviewed hunk is mock-mode only), so all three
    // rows start unchecked.
    await expect(unfold).toHaveAttribute("aria-label", "Mark plotline reviewed");
    await expect(unfold).not.toBeChecked();
    expect(await unfold.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(false);
    await expect(unfoldTests).toHaveAttribute("aria-label", "Mark plotline reviewed");
    await expect(unfoldTests).not.toBeChecked();
    await expect(other).toHaveAttribute("aria-label", "Mark plotline reviewed");
    await expect(other).not.toBeChecked();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "0 of 8 hunks reviewed");

    // Checking "Unfold folded values" reviews and folds both its hunks.
    await unfold.click();
    await expect(unfold).toBeChecked({ timeout: 15_000 });
    await expect(unfold).toHaveAttribute("aria-label", "Mark plotline unreviewed");
    await expect
      .poll(async () => (await statesOf("unfold")).filter((h) => h.reviewed && h.folded).length, {
        timeout: 30_000,
      })
      .toBe(2);
    // The diff's counts move with it: the file header and the progress bar.
    await expect(page.locator('[id="F-src-urllib3-connection.py"] .revc')).toContainText("2/2", {
      timeout: 30_000,
    });
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "2 of 8 hunks reviewed");

    // Checking "Prove the unfolding works" covers its hidden import
    // hunks too — every one of the four ends up reviewed and folded.
    await unfoldTests.click();
    await expect(unfoldTests).toBeChecked({ timeout: 15_000 });
    await expect
      .poll(async () => (await statesOf("unfold-tests")).filter((h) => h.reviewed && h.folded).length, {
        timeout: 30_000,
      })
      .toBe(4);
    const snap = await snapshot();
    const testHashes = new Set((await statesOf("unfold-tests")).map((h) => h.contentHash));
    const hiddenCovered = snap.files
      .flatMap((f) => f.hunks)
      .filter((h) => testHashes.has(h.contentHash) && h.hiddenReason !== undefined).length;
    expect(hiddenCovered).toBeGreaterThan(0);
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "6 of 8 hunks reviewed");

    // Unmarking one hunk by hand drops the row back to partial.
    const oneHash = (await statesOf("unfold-tests"))[0]!.contentHash;
    await apiJson(s, "PATCH", `/api/reviews/${reviewId}/hunks/${oneHash}`, { reviewed: false, folded: false });
    await expect(unfoldTests).not.toBeChecked({ timeout: 15_000 });
    // The partial flag is set in a post-paint effect, so poll for it.
    await expect
      .poll(async () => unfoldTests.evaluate((el) => (el as HTMLInputElement).indeterminate), {
        timeout: 15_000,
      })
      .toBe(true);
    await expect(unfoldTests).toHaveAttribute("aria-label", "Mark plotline reviewed");
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "5 of 8 hunks reviewed");

    // Mixed states for the frames: one checked, one partial, one unchecked.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await box.scrollIntoViewIfNeeded();
    const shots = fileURLToPath(new URL("../../visual-tour", import.meta.url));
    await box.screenshot({ path: path.join(shots, "j343-plotlines-mixed-1440-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await box.screenshot({ path: path.join(shots, "j343-plotlines-mixed-1440-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });

    // Unchecking the fully-checked row reverts both reviewed and
    // folded on every hunk. (Clicking the partial row would complete
    // the marking instead, like the diff's per-file box.)
    await unfold.click();
    await expect(unfold).not.toBeChecked({ timeout: 15_000 });
    await expect
      .poll(async () => (await statesOf("unfold")).filter((h) => !h.reviewed && !h.folded).length, {
        timeout: 30_000,
      })
      .toBe(2);
    await expect(unfold).toHaveAttribute("aria-label", "Mark plotline reviewed");
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "3 of 8 hunks reviewed");

    // "Other" marks the hunks no plotline claimed.
    await other.click();
    await expect(other).toBeChecked({ timeout: 15_000 });
    await expect
      .poll(async () => (await statesOf("other")).filter((h) => h.reviewed && h.folded).length, {
        timeout: 30_000,
      })
      .toBe(2);
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "5 of 8 hunks reviewed");
    await other.click();
    await expect
      .poll(async () => (await statesOf("other")).filter((h) => !h.reviewed && !h.folded).length, {
        timeout: 30_000,
      })
      .toBe(2);
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "3 of 8 hunks reviewed");

    await checkLayout(page, "j242-plotlines-reviewed");
  });

  // #343: on an older version the checkboxes disable with the usual
  // read-only tooltip. The demo has a single version; `beforeAll`
  // stamps the stored snapshot as having a newer current version, so
  // `?version=1` reads as an older version with real plotlines.
  test("plotline reviewed checkboxes disable on older versions", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}&version=1`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    const box = page.locator(".plotlines");
    await expect(box).toBeVisible({ timeout: 15_000 });
    for (const id of ["unfold", "unfold-tests", "other"]) {
      const control = box.locator(`[data-plotreviewed="${id}"]`);
      await expect(control).toBeDisabled();
      await expect(control).toHaveAttribute("aria-label", "Viewing an older version · read-only");
    }
  });
});
