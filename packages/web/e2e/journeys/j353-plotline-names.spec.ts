/** J353 (#353): plotline names with a long identifier store whole and
 * shorten only on screen — the plotlines card clamps the name to two
 * lines, chips and the filter ellipsize on one line, and the full name
 * is in the tooltip — against the real service in replay (the demo's
 * single plotline is renamed in the stored snapshot to a long
 * identifier-heavy name, plus a second plotline that builds on it). */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { checkLayout } from "../layout-check.js";
import { apiJson, createDemoReview, stampDataFormat } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

// A storable name (under the 120-char safety cap) that the old 40-char
// cut would have destroyed: its last space before 40 sits at "Add the".
const LONG_NAME =
  "Add the `some_very_long_table_identifier_xyz` guard for the retry path with backoff and jitter";
const LONG_DESC =
  "Watches the retry path end to end: the `some_very_long_table_identifier_xyz` guard trips on repeated failures, backs off with jitter, and reports through the shared retry_helper without touching unrelated hunks.";
const SECOND_NAME = "Retry failed uploads with the `retry_helper` and exponential backoff";
const FRAMES = "/tmp/353-frames";

test.describe("J353 long plotline names", () => {
  let dataDir = "";
  let homeDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    mkdirSync(FRAMES, { recursive: true });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j353-data-"));
    homeDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j353-home-"));
    svc = await startService(dataDir, { agent: "replay", extraEnv: { HOME: homeDir } });
    reviewId = await createDemoReview(svc);
    // Let the replay pipeline settle before editing the stored
    // snapshot (same pattern as j242), then rename the demo plotline
    // to a long identifier-heavy name in the database and restart.
    const quietDeadline = Date.now() + 90_000;
    for (;;) {
      const jobsRes = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
      const jobs = (jobsRes.json as { jobs: { state: string }[] }).jobs ?? [];
      if (jobs.length > 0 && jobs.every((j) => j.state === "done" || j.state === "error" || j.state === "cancelled")) break;
      if (Date.now() > quietDeadline) throw new Error("replay jobs never settled before the rename");
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
        const snap = JSON.parse(row.snapshot) as {
          files: { fileKey: string; hunks: { contentHash: string }[] }[];
          plotlines: { id: string; name: string; description: string; buildsOn?: string }[];
          sinceBaseline?: unknown;
          sinceHunks?: unknown;
        };
        const first = snap.plotlines.find((p) => p.id === "obs-fold-unfolding") ?? snap.plotlines[0];
        if (!first) throw new Error("replay snapshot has no plotlines to rename");
        first.name = LONG_NAME;
        first.description = LONG_DESC;
        snap.plotlines.push({
          id: "retry-guard",
          name: SECOND_NAME,
          description: "Proves the retry path backs off.",
          buildsOn: first.id,
        });
        // Two changed hunks of the first plotline, so its `+N since`
        // marker renders against a version baseline.
        const hunkIds: string[] = [];
        for (const f of snap.files ?? []) {
          for (const h of f.hunks ?? []) hunkIds.push(`h:${f.fileKey}:${h.contentHash}`);
        }
        snap.sinceBaseline = { kind: "version", version: 1 };
        snap.sinceHunks = { added: [], changed: hunkIds.slice(0, 2) };
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
    svc = await startService(dataDir, { agent: "replay", extraEnv: { HOME: homeDir } });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("long names store whole and clamp on screen with full-name tooltips", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    expect(LONG_NAME.length).toBeGreaterThan(60);
    expect(LONG_NAME.length).toBeLessThanOrEqual(120);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    const box = page.locator(".plotlines");
    await expect(box).toBeVisible({ timeout: 15_000 });

    // Stored whole: the row shows the full name, not a cut prefix.
    const nameEl = box.locator(".plname").first();
    await expect(nameEl).toHaveText(LONG_NAME);
    await expect(nameEl).toHaveAttribute("data-tip", LONG_NAME);

    // The row clamps to two lines (the rule), while the data stays whole.
    expect(await nameEl.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("2");

    // The tooltip shows the full text.
    await nameEl.hover();
    const tip = page.locator("#tip");
    await expect(tip).toBeVisible({ timeout: 5_000 });
    await expect(tip).toHaveText(LONG_NAME);

    // The second row builds on the first: its chip names the long
    // name in full via its tooltip.
    const buildsOn = box.locator('[data-buildson]').first();
    await expect(buildsOn).toHaveAttribute("data-tip", `Show only ${LONG_NAME}`);

    // The Since marker counts the two fabricated changed hunks. (Badge
    // drops extra props, so there is no data hook — assert the text in
    // the first row instead.)
    await expect(box.locator("li").first().getByText("+2 since v1")).toBeVisible();

    // Hunk header chips carry the full name in text and tooltip, and
    // ellipsize on one line instead of wrapping the header.
    const chip = page.locator(".dhunk-h .ptag").first();
    await expect(chip).toHaveText(LONG_NAME);
    await expect(chip).toHaveAttribute("title", LONG_NAME);
    expect(await chip.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(true);

    await checkLayout(page, "j353-plotlines");

    // Filtering to the plotline shows its full name in the filter chip.
    await box.locator('[data-plotpick]').first().click();
    const fchip = page.locator('[data-filterchip="plotline"]');
    await expect(fchip).toBeVisible({ timeout: 15_000 });
    await expect(fchip.locator(".fchip-name")).toContainText("Plotline:");
    await expect(fchip.locator(".fchip-name")).toHaveAttribute("title", LONG_NAME);

    // Narrow: the two-line clamp visibly engages on the card row, and
    // the filter chip ellipsizes on one line keeping its clear button.
    await page.setViewportSize({ width: 960, height: 900 });
    await expect(box).toBeVisible();
    expect(await nameEl.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
    expect(await fchip.locator(".fchip-name").evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(true);
  });

  test("frames: card, hunk chip and filter at 1440 and 960, light and dark", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const shot = (name: string): string => path.join(FRAMES, name);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    const box = page.locator(".plotlines");
    await expect(box).toBeVisible({ timeout: 15_000 });

    // The previous test leaves the plotline filter persisted
    // server-side, so clear it first for clean frames (the row click
    // later toggles) — same pattern as j242.
    const pressed = box.locator('[data-plotpick][aria-pressed="true"]');
    if ((await pressed.count()) > 0) {
      await pressed.first().click();
      await expect(page.locator('[data-filterchip="plotline"]')).toHaveCount(0, { timeout: 15_000 });
    }

    // The plotlines card with a long name, one tooltip shown.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await box.scrollIntoViewIfNeeded();
    await box.locator(".plname").first().hover();
    await expect(page.locator("#tip")).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: shot("j353-card-1440-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await box.locator(".plname").first().hover();
    await expect(page.locator("#tip")).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: shot("j353-card-1440-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 960, height: 900 });
    await box.scrollIntoViewIfNeeded();
    await box.screenshot({ path: shot("j353-card-960-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await box.screenshot({ path: shot("j353-card-960-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });

    // A hunk header chip with the long name. The two-pane header line
    // clips the chip, so show the source pane alone (the
    // `[ Guide | Source ]` toggle): it fills the window and the chip
    // shows whole. Prefer a header its own line does not clip.
    await page.getByRole("group", { name: "Panes" }).getByRole("button", { name: "Guide" }).click();
    const idx = await page.evaluate(() => {
      const headers = [...document.querySelectorAll(".dhunk-h")];
      const fit = headers.findIndex((h) => {
        const chip = h.querySelector(".ptag");
        const line = h.querySelector(".hl2");
        if (!chip || !line) return false;
        const cr = chip.getBoundingClientRect();
        const lr = line.getBoundingClientRect();
        return cr.width > 0 && cr.right <= lr.right + 1;
      });
      return fit >= 0 ? fit : 0;
    });
    const header = page.locator(".dhunk-h").nth(idx);
    await expect(header).toBeVisible();
    await header.scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1440, height: 900 });
    await header.screenshot({ path: shot("j353-chip-1440-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await header.screenshot({ path: shot("j353-chip-1440-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 960, height: 900 });
    await header.screenshot({ path: shot("j353-chip-960-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await header.screenshot({ path: shot("j353-chip-960-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    // Back to two panes for the filter frames.
    await page.getByRole("group", { name: "Panes" }).getByRole("button", { name: "Guide" }).click();
    await expect(box).toBeVisible();

    // The plotline filter chip with the long name.
    await page.setViewportSize({ width: 1440, height: 900 });
    await box.locator('[data-plotpick]').first().click();
    const fchip = page.locator('[data-filterchip="plotline"]');
    await expect(fchip).toBeVisible({ timeout: 15_000 });
    const dtool = page.locator(".dtool");
    await expect(dtool).toBeVisible();
    await dtool.screenshot({ path: shot("j353-filter-1440-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await dtool.screenshot({ path: shot("j353-filter-1440-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 960, height: 900 });
    await dtool.screenshot({ path: shot("j353-filter-960-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await dtool.screenshot({ path: shot("j353-filter-960-dark.png") });
    await page.emulateMedia({ colorScheme: "light" });
  });
});
