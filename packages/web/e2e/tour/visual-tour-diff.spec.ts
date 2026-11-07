/**
 * Tour: diff work (package D re-adds the frames packages B removed
 * from the gate in #363).
 *
 * On-demand only (`mise run visual-tour`): the diff states the owner
 * reviews as frames — hidden-hunk rows, the plotlines mixed row, the
 * long-name card/hunk-chip/filter frames (1440 + the 960 named keeps),
 * the hide-level hidden/expanded states, the file-tree long path, the
 * collapse-hover state and the filtered split. Behaviour for all of
 * these lives in `e2e/journeys/l6-diff.spec.ts`; this file keeps just
 * enough asserts to prove each framed state.
 *
 * Slim set: 1440px light Default plus the `tour-matrix.ts` named keeps;
 * the full matrix runs with `UNVIBE_TOUR_MATRIX=full`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Locator, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { tourCombos } from "../tour-matrix.js";
import { fileKeyForPath } from "@unvibe/shared";
import { apiJson, createDemoReview, createScratchReview, createSeededDemoReview, git, stampDataFormat } from "../journeys/journey-helpers.js";

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));
const FRAMES = fileURLToPath(new URL("../../visual-tour/353", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

const DOCS_SUMMARY =
  "Rewords the four onboarding notes for the new checkout flow, keeping every " +
  "heading and the step order exactly as documented so downstream links hold.";
const IMPORTS_SUMMARY =
  "Swaps the two stdlib imports the helper module needs for the new value " +
  "formatting path, leaving every call site untouched and sorted in place.";


test.describe("J283 hidden-hunk rows", () => {
  let repoDir = "";
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-283-repo-"));
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-283-data-"));
    // Alphabetically first: docs-only multi-line change -> hidden-only file.
    mkdirSync(path.join(repoDir, "a-docs"), { recursive: true });
    mkdirSync(path.join(repoDir, "src"), { recursive: true });
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(
      path.join(repoDir, "a-docs", "notes.md"),
      ["# Notes", "", "Alpha line one.", "Alpha line two.", "Alpha line three.", "Alpha line four.", ""].join("\n"),
    );
    const codeBase = [
      "import os",
      "import re",
      ...Array.from({ length: 78 }, (_, i) => `value_${String(i + 1).padStart(2, "0")} = ${i + 1}`),
      `tail_marker = "end"`,
    ].join("\n") + "\n";
    writeFileSync(path.join(repoDir, "src", "app.py"), codeBase);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(
      path.join(repoDir, "a-docs", "notes.md"),
      ["# Notes", "", "Beta line one revised.", "Beta line two revised.", "Beta line three revised.", "Beta line four revised.", ""].join("\n"),
    );
    const codeLines = codeBase.split("\n");
    codeLines[0] = "import sys";
    codeLines[1] = "import json";
    codeLines[70] = "value_69 = 6900  # changed";
    writeFileSync(path.join(repoDir, "src", "app.py"), codeLines.join("\n"));
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");
    svc = await startService(dataDir, { agent: "none" });
    reviewId = await createScratchReview(svc, repoDir);
    // Wait for ingest, then PATCH long summaries onto the hidden hunks.
    const deadline = Date.now() + 90_000;
    let hashes: { docs: string; imports: string } | null = null;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const files = (snap.json as { files: { path: string; hunks: { contentHash: string; hiddenReason?: string }[] }[] }).files ?? [];
      const docs = files.find((f) => f.path === "a-docs/notes.md")?.hunks[0];
      const mixed = files.find((f) => f.path === "src/app.py")?.hunks ?? [];
      if (docs?.hiddenReason && mixed.length === 2 && mixed[0].hiddenReason && !mixed[1].hiddenReason) {
        hashes = { docs: docs.contentHash, imports: mixed[0].contentHash };
        break;
      }
      if (Date.now() > deadline) throw new Error(`ingest did not produce the hidden shape: ${JSON.stringify(files.map((f) => ({ p: f.path, h: f.hunks.map((h) => h.hiddenReason ?? null) })))}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${hashes.docs}`, { summary: DOCS_SUMMARY });
    await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${hashes.imports}`, { summary: IMPORTS_SUMMARY });
    // Wait for the snapshot echo so the rows render the long summaries.
    const echoDeadline = Date.now() + 30_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const states = (snap.json as { hunkStates: { contentHash: string; summary?: string }[] }).hunkStates ?? [];
      const got = new Set(states.filter((s) => s.summary).map((s) => s.contentHash));
      if (got.has(hashes.docs) && got.has(hashes.imports)) break;
      if (Date.now() > echoDeadline) throw new Error("summaries did not land");
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function expectHiddenRows(page: Page, step: string): Promise<void> {
    const rows = page.locator("button.hid");
    await expect(rows).toHaveCount(2, { timeout: 30_000 });
    // Hunk-header chevron box to align against (same file flow, below).
    const headerBox = await page.locator(".dhunk-h .ib").first().boundingBox();
    expect(headerBox, `${step}: no hunk header to align against`).not.toBeNull();
    for (let i = 0; i < 2; i++) {
      const row = rows.nth(i);
      await expect(row).toBeVisible();
      const rowBox = (await row.boundingBox())!;
      // The label shows: non-empty, and the row is topmost at the label's
      // centre (not painted under the band backing, issue #283).
      const label = row.locator(".hidl");
      // Issue #342: the label is range-only ("Hunk 1", "Hunks 1–2") —
      // no 'hidden' word (asserted in diffLogic.test.ts too).
      await expect(label).toContainText(/^Hunks? \d/, { timeout: 10_000 });
      const labelBox = (await label.boundingBox())!;
      expect(labelBox.x, `${step}: row ${i} label outside the row`).toBeGreaterThanOrEqual(rowBox.x);
      expect(labelBox.x + labelBox.width, `${step}: row ${i} label outside the row`).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
      const topmost = await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit?.closest("button.hid")?.getAttribute("aria-label") ?? `${hit?.tagName}.${(hit as HTMLElement | null)?.className}`;
      }, { x: labelBox.x + labelBox.width / 2, y: labelBox.y + labelBox.height / 2 });
      expect(topmost, `${step}: row ${i} label covered by ${topmost}`).toMatch(/collapsed\. Show these hunks/);
      // The summary uses the full width: its union box is either wider
      // than half the row or starts at the row's left content edge (its
      // own line) — never a fixed narrow right column.
      const briefBox = (await row.locator(".hidb").boundingBox())!;
      const wide = briefBox.width > rowBox.width * 0.5;
      const ownLine = briefBox.x <= rowBox.x + 14;
      expect(wide || ownLine, `${step}: row ${i} summary squeezed (box ${JSON.stringify(briefBox)} row ${JSON.stringify(rowBox)})`).toBe(true);
      // The `>` expand box lines up with the hunk-header chevrons.
      const hicBox = (await row.locator(".hic").boundingBox())!;
      expect(Math.abs(hicBox.x - headerBox!.x), `${step}: row ${i} chevron x ${hicBox.x} vs header ${headerBox!.x}`).toBeLessThanOrEqual(2);
      expect(Math.abs(hicBox.width - headerBox!.width), `${step}: row ${i} chevron width`).toBeLessThanOrEqual(1);
    }
    // No blank band above the first file's hidden row: it sits directly
    // under its file header.
    const firstFile = page.locator(".dfile").first();
    const fileHeaderBox = (await firstFile.locator(".dfile-h").boundingBox())!;
    const rowTop = (await firstFile.locator("button.hid").boundingBox())!.y;
    expect(rowTop - (fileHeaderBox.y + fileHeaderBox.height), `${step}: blank band above the first hidden row`).toBeLessThanOrEqual(2);
  }

  for (const combo of tourCombos("hiddenRows", [
    { name: "1440-light", width: 1440, dark: false },
    { name: "1440-dark", width: 1440, dark: true },
    { name: "960-light", width: 960, dark: false },
    { name: "960-dark", width: 960, dark: true },
  ] as const)) {
    test(`hidden rows read as one flowing row (${combo.name})`, async ({ page }) => {
      test.setTimeout(180_000);
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: combo.width, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      else await page.emulateMedia({ colorScheme: "light" });
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });
      const step = `hidden-rows-${combo.name}`;
      await expectHiddenRows(page, step);
      await checkLayout(page, step);
      await page.screenshot({ path: path.join(SHOTS, `283-hidden-${combo.name}.png`) });
    });
  }
});

// ---- j242-plotlines-card.spec.ts (frames re-added) ----
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

  test("plotline reviewed checkbox checks, partials and unchecks the whole plotline", async ({ page }) => {
    test.setTimeout(240_000);
    const s = svc;
    if (!s) throw new Error("no service");
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    const box = page.locator(".plotlines");
    await expect(box).toBeVisible({ timeout: 15_000 });
    const unfold = box.locator('[data-plotreviewed="obs-fold-unfolding"]');

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
    // fixture's mid-use reviewed hunk is mock-mode only), so the single
    // row starts unchecked.
    await expect(unfold).toHaveAttribute("aria-label", "Mark plotline reviewed");
    await expect(unfold).not.toBeChecked();
    expect(await unfold.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(false);
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "0 of 8 hunks reviewed");

    // Checking the plotline reviews and folds all eight hunks.
    await unfold.click();
    await expect(unfold).toBeChecked({ timeout: 15_000 });
    await expect(unfold).toHaveAttribute("aria-label", "Mark plotline unreviewed");
    await expect
      .poll(async () => (await statesOf("obs-fold-unfolding")).filter((h) => h.reviewed && h.folded).length, {
        timeout: 30_000,
      })
      .toBe(8);
    // The diff's counts move with it: the file header and the progress bar.
    await expect(page.locator('[id="F-src-urllib3-connection.py"] .revc')).toContainText("2/2", {
      timeout: 30_000,
    });
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "8 of 8 hunks reviewed");

    // Unmarking one hunk by hand drops the row back to partial.
    const oneHash = (await statesOf("obs-fold-unfolding"))[0]!.contentHash;
    await apiJson(s, "PATCH", `/api/reviews/${reviewId}/hunks/${oneHash}`, { reviewed: false, folded: false });
    await expect(unfold).not.toBeChecked({ timeout: 15_000 });
    // The partial flag is set in a post-paint effect, so poll for it.
    await expect
      .poll(async () => unfold.evaluate((el) => (el as HTMLInputElement).indeterminate), {
        timeout: 15_000,
      })
      .toBe(true);
    await expect(unfold).toHaveAttribute("aria-label", "Mark plotline reviewed");
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "7 of 8 hunks reviewed");

    // Partial state for the frames: the single row indeterminate.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await box.scrollIntoViewIfNeeded();
    const shots = fileURLToPath(new URL("../../visual-tour", import.meta.url));
    await box.screenshot({ path: path.join(shots, "j343-plotlines-mixed-1440-light.png") });

    // Clicking the partial row completes the marking instead, like the
    // diff's per-file box.
    await unfold.click();
    await expect(unfold).toBeChecked({ timeout: 15_000 });
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "8 of 8 hunks reviewed");

    // Unchecking the fully-checked row reverts both reviewed and
    // folded on every hunk.
    await unfold.click();
    await expect(unfold).not.toBeChecked({ timeout: 15_000 });
    await expect
      .poll(async () => (await statesOf("obs-fold-unfolding")).filter((h) => !h.reviewed && !h.folded).length, {
        timeout: 30_000,
      })
      .toBe(8);
    await expect(unfold).toHaveAttribute("aria-label", "Mark plotline reviewed");
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "0 of 8 hunks reviewed");

    await checkLayout(page, "j242-plotlines-reviewed");
  });

  // #343: on an older version the checkboxes disable with the usual
  // read-only tooltip. The demo has a single version; `beforeAll`
  // stamps the stored snapshot as having a newer current version, so
  // `?version=1` reads as an older version with real plotlines.
});


// ---- j353-plotline-names.spec.ts (frames re-added) ----
// A storable name (under the 120-char safety cap) that the old 40-char
// cut would have destroyed: its last space before 40 sits at "Add the".
const LONG_NAME =
  "Add the `some_very_long_table_identifier_xyz` guard for the retry path with backoff and jitter";
// Plain-text forms: code spans render as code on screen, while tooltips
// and chips read the name and description without backticks.
const LONG_DESC =
  "Watches the retry path end to end: the `some_very_long_table_identifier_xyz` guard trips on repeated failures, backs off with jitter, and reports through the shared retry_helper without touching unrelated hunks.";
const SECOND_NAME = "Retry failed uploads with the `retry_helper` and exponential backoff";

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

  test("frames: card, hunk chip and filter at 1440 and 960, light", async ({ page }) => {
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
    await box.scrollIntoViewIfNeeded();
    await box.locator(".plname").first().hover();
    await expect(page.locator("#tip")).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: shot("j353-card-1440-light.png") });
    await page.setViewportSize({ width: 960, height: 900 });
    await box.scrollIntoViewIfNeeded();
    await box.screenshot({ path: shot("j353-card-960-light.png") });

    // The builds-on chip stays inside the row at 960.
    const builds = box.locator(".plbuilds").first();
    await builds.scrollIntoViewIfNeeded();
    await builds.screenshot({ path: shot("j353-buildson-960-light.png") });

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
    await page.setViewportSize({ width: 960, height: 900 });
    await header.screenshot({ path: shot("j353-chip-960-light.png") });
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
    await page.setViewportSize({ width: 960, height: 900 });
    await dtool.screenshot({ path: shot("j353-filter-960-light.png") });

    // The trailing fold pair wraps as a group at both widths: the two
    // buttons always share a line.
    for (const width of [1440, 960]) {
      await page.setViewportSize({ width, height: 900 });
      const tops = await page.evaluate(() => {
        const btns = [...document.querySelectorAll(".dtool .foldpair .x")];
        return btns.map((b) => b.getBoundingClientRect().top);
      });
      expect(tops).toHaveLength(2);
      expect(tops[0]).toBe(tops[1]);
    }
  });

  // From score-plotline.spec.ts (#357 Q5): hunk scores and the Files-list
  // exclusion (#184). Chip filtering, the plotlines box and hide-level
  // live in J242/J4/J325 against the real service.
});


// ---- j325-hide-level.spec.ts (frames re-added) ----
const CONN = "src-urllib3-connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";

const SCORES: Record<string, string> = {
  "src/urllib3/connection.py:0": "substantive",
  "src/urllib3/connection.py:1": "substantive",
  "test/test_connection.py:0": "mechanical",
  "test/test_connection.py:1": "mechanical",
  "test/test_connection.py:2": "routine",
  "test/with_dummyserver/test_socketlevel.py:0": "mechanical",
  "test/with_dummyserver/test_socketlevel.py:1": "substantive",
  "changelog/1362.bugfix.rst:0": "routine",
};

function seedScores(dataDir: string, reviewId: string): void {
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    const row = db.prepare("SELECT snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as { snapshot: string };
    const snap = JSON.parse(row.snapshot) as {
      files: { path: string; hunks: { contentHash: string }[] }[];
      hunkStates: { contentHash: string; score?: string }[];
    };
    const byHash = new Map(snap.hunkStates.map((s) => [s.contentHash, s]));
    for (const f of snap.files) {
      f.hunks.forEach((h, i) => {
        const score = SCORES[`${f.path}:${i}`];
        const entry = byHash.get(h.contentHash) ?? { contentHash: h.contentHash };
        entry.score = score;
        byHash.set(h.contentHash, entry);
      });
    }
    snap.hunkStates = [...byHash.values()];
    db.prepare("UPDATE review_snapshots SET snapshot = ? WHERE review_id = ?").run(JSON.stringify(snap), reviewId);
  } finally {
    db.close();
  }
}

/** Scroll the diff pane through every file so lazy sections mount. */
async function revealAll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const pane = document.querySelector("#right");
    if (!pane) return;
    for (let y = 0; y <= pane.scrollHeight; y += 500) {
      pane.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    pane.scrollTo(0, 0);
  });
}

/** Click one category row; the stored level lands on `expected`. */
async function clickCategory(page: Page, category: string, expected: string): Promise<void> {
  await page.getByRole("button", { name: /Hide level:/ }).click();
  await page.locator(`[data-hidecat="${category}"]`).click();
  await expect(page.locator(`[data-hidelevel-current="${expected}"]`)).toBeVisible();
}

/** Issue #342: a collapsed row carries only the range, one score dot
 * and the summary — no size, no score words, no "hidden" — with the
 * collapsed state in the accessible name and `aria-expanded`. */
async function expectCollapsedRow(page: Page, index: number): Promise<void> {
  const row = page.locator("button.hid").nth(index);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  const accessible = (await row.getAttribute("aria-label")) ?? "";
  expect(accessible).toMatch(/collapsed/);
  expect(accessible).not.toMatch(/hidden/i);
  const label = ((await row.locator(".hidl").textContent()) ?? "").trim();
  expect(label).toMatch(/^Hunks? \d+(–\d+)?$/);
  const text = (await row.textContent()) ?? "";
  expect(text).not.toMatch(/hidden/i);
  expect(text).not.toMatch(/\+\d+\s*−\d+/);
  expect(text).not.toMatch(/mechanical|routine|substantive|needs attention/i);
  expect(((await row.locator(".hidb").textContent()) ?? "").trim().length).toBeGreaterThan(0);
  await expect(row.locator(".score-dot")).toHaveCount(1);
}

test.describe("J325 hide-level selector", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j325-data-"));
    reviewId = createSeededDemoReview(dataDir, "j325-seed");
    seedScores(dataDir, reviewId);
    svc = await startService(dataDir, { agent: "none" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("levels, tooltip, persistence, transient expand and citation reveal", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator(`[id="F-${CONN}"]`)).toBeVisible({ timeout: 30_000 });

    // Default: Hide uninteresting, with the live breakdown tooltip.
    const selector = page.getByRole("button", { name: /Hide level:/ });
    await expect(page.locator('[data-hidelevel-current="uninteresting"]')).toBeVisible();
    await expect(selector).toHaveAttribute("data-tip", "Hiding 3 of 8 hunks: 3 uninteresting");
    await revealAll(page);
    await expect(page.locator("button.hid")).toHaveCount(2);
    await expect(page.locator("[data-scorepick]")).toHaveCount(0);
    await expect(page.locator('.dhunk-h .score-ind[data-score="substantive"]').first()).toBeVisible();

    // Issue #342: both collapsed rows keep only the range, one score
    // dot and the summary — no size, no score words, no "hidden".
    await expectCollapsedRow(page, 0);
    await expectCollapsedRow(page, 1);

    // Frames: 1440 light with hidden rows, then with a row expanded.
    await page.locator("button.hid").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "j342-hidden-1440-light.png") });
    await page.locator("button.hid").first().click();
    await expect(page.locator(`[data-hunk="test-test_connection.py:0"]`)).toBeVisible();
    await page.locator(`[data-hunk="test-test_connection.py:0"]`).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "j342-expanded-1440-light.png") });

    // Reload keeps the level but not the transient expansion.
    await page.reload();
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator('[data-hidelevel-current="uninteresting"]')).toBeVisible({ timeout: 30_000 });
    await revealAll(page);
    await expect(page.locator("button.hid")).toHaveCount(2);
    await expect(page.locator(`[data-hunk="test-test_connection.py:0"]`)).toHaveCount(0);

    // The menu is the category list: only Uninteresting starts hidden
    // (greyed, eye-off); clicking the shown Routine row hides it and
    // everything above it, landing on the substantive threshold.
    await page.getByRole("button", { name: /Hide level:/ }).click();
    const menu = page.getByRole("menu", { name: "Hunk categories" });
    await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(5);
    await expect(page.locator('[data-hidecat="uninteresting"]')).toHaveAttribute("data-hidden", "true");
    await expect(page.locator('[data-hidecat="uninteresting"]')).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('[data-hidecat="uninteresting"] .cnt')).toHaveText("3");
    await expect(page.locator('[data-hidecat="routine"]')).toHaveAttribute("data-hidden", "false");
    await page.locator('[data-hidecat="routine"]').click();
    await expect(page.locator('[data-hidelevel-current="substantive"]')).toBeVisible();
    await expect(selector).toHaveAttribute("data-tip", /^Hiding 5 of 8 hunks:/);
    await revealAll(page);
    await expect(page.locator("button.hid")).toHaveCount(3);
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    expect((snap.json as { viewPrefs: { hideLevel?: string } }).viewPrefs.hideLevel).toBe("substantive");

    // Persistence across reload.
    await page.reload();
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator('[data-hidelevel-current="substantive"]')).toBeVisible({ timeout: 30_000 });
    await revealAll(page);
    await expect(page.locator("button.hid")).toHaveCount(3);

    // Expanding a hidden row is transient: it shows now ...
    await page.locator(`[id="F-${TSOCK}"] button.hid`).first().click();
    await expect(page.locator(`[data-hunk="${TSOCK}:0"]`)).toBeVisible();
    // ... but the next level change fully re-applies the level, so the
    // run collapses again instead of staying visible. Guide-cited hunks
    // hide like any other (owner decision, #325): the cited connection
    // hunk hides too, and the tooltip drops both "kept" clauses.
    await clickCategory(page, "substantive", "needs-attention");
    await expect(page.locator(`[data-hunk="${TSOCK}:0"]`)).toHaveCount(0);
    await expect(page.locator(`[data-hunk="${CONN}:0"]`)).toHaveCount(0);
    await expect(selector).not.toHaveAttribute("data-tip", /kept because/);
    await expect(selector).toContainText("Hiding 8");
    await expect(selector).toHaveAttribute("data-eye", "off");

    // Clicking a citation to a hidden hunk still reveals it temporarily.
    await page.locator('.lk[data-refs="diff:src-urllib3-connection.py:80-88"]').first().click();
    await expect(page.locator(`[data-hunk="${CONN}:0"]`)).toBeVisible({ timeout: 15_000 });

    // Clicking the most important hidden row (Substantive) shows it
    // again: the threshold moves down by one.
    await clickCategory(page, "substantive", "substantive");

    // Keyboard: open with ArrowDown, Home to the first row, Enter shows
    // Uninteresting and everything above nothing — the all level.
    await selector.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu", { name: "Hunk categories" })).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: /Uninteresting/ })).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-hidelevel-current="all"]')).toBeVisible();
    await expect(page.locator("button.hid")).toHaveCount(0);
    await expect(selector).toContainText("All shown");
    // Nothing hidden: the button shows an open eye, not eye-off.
    await expect(selector).toHaveAttribute("data-eye", "open");
  });
});


// ---- j227-file-tree.spec.ts (frames re-added) ----
const LONG_DIR =
  "packages/very-long-component-directory-name/and-another-long-directory-level/with-a-deeply-nested-module/and-one-more-long-directory-level";
const LONG_FILE = `${LONG_DIR}/a_very_long_file_name_for_the_component_under_review_with_extra_words.py`;
const LONG_FILE_2 = `${LONG_DIR}/another_long_file_name_for_a_helper_module_with_extra_words.py`;
const keyFor = (p: string): string => p.replace(/[^A-Za-z0-9_.-]/g, "-");

async function write(dir: string, rel: string, text: string): Promise<void> {
  mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
}

test.describe("J227 file tree (#227)", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j227-repo-"));
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j227-data-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    await write(repoDir, "top.py", "VALUE = 1\n");
    await write(repoDir, LONG_FILE, "def a():\n    return 1\n");
    await write(repoDir, LONG_FILE_2, "def b():\n    return 2\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    await write(repoDir, "top.py", "VALUE = 1\nEXTRA = 2\n");
    await write(
      repoDir,
      LONG_FILE,
      ["def a():", "    return 10", ...Array.from({ length: 14 }, (_, i) => `ADDED_${i} = ${i}`), ""].join("\n"),
    );
    await write(repoDir, LONG_FILE_2, "def b():\n    return 22\n    \n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");

    svc = await startService(dataDir, { agent: "none" });
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
    const registered = list.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
    const created = await apiJson(svc, "POST", "/api/reviews", { repoId: registered.id, branch: "feature" });
    if (created.status !== 201 && created.status !== 200 && created.status !== 202) {
      throw new Error(`review create failed: ${created.status} ${JSON.stringify(created.json)}`);
    }
    reviewId = (created.json as { review: { id: string } }).review.id;
    const deadline = Date.now() + 60_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const st = (snap.json as { ingest?: { status?: string } }).ingest?.status ?? "ready";
      if (st === "ready") break;
      if (Date.now() > deadline) throw new Error(`ingest not ready: ${JSON.stringify(snap.json)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("long path: no horizontal scroll, indicators visible and aligned, full path on hover", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const longSection = page.locator(`[id="F-${keyFor(LONG_FILE)}"]`);
    await expect(longSection).toBeVisible({ timeout: 60_000 });

    // Diff file header: full path on hover, deepest directory and the
    // file name stay readable, indicators inside the header's right edge.
    await expect(longSection.locator(".dfile-h .path")).toHaveAttribute("title", LONG_FILE);
    await expect(longSection.locator(".dfile-h .path .dir-end")).toContainText("and-one-more-long-directory-level/");
    await expect(longSection.locator(".dfile-h .path b")).toHaveText("a_very_long_file_name_for_the_component_under_review_with_extra_words.py");
    await expect(longSection.locator(".dfile-h .ui-diffstat")).toContainText("+15");

    // Open the file list.
    if (!(await page.locator(".flist").isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Show file list" }).click();
    }
    const flist = page.locator(".flist");
    await expect(flist.locator(".fr.file")).toHaveCount(3, { timeout: 15_000 });
    await expect(flist.locator(`.fr.file[title="${LONG_FILE}"]`)).toHaveCount(1);
    await expect(flist.locator(".fr.dir .nm-end")).toContainText("and-one-more-long-directory-level");

    const geo = await flist.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll(".fr.file")].map((row) => {
        const st = row.querySelector(".ui-diffstat")!.getBoundingClientRect();
        const rv = row.querySelector(".rv")!.getBoundingClientRect();
        const nm = row.querySelector(".nm")!;
        return {
          stLeft: st.left, stRight: st.right, rvLeft: rv.left, rvRight: rv.right,
          nameTruncated: nm.scrollWidth > nm.clientWidth,
        };
      });
      const dirPre = el.querySelector(".fr.dir .nm-pre")!;
      return {
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        boxLeft: box.left, boxRight: box.right,
        rows,
        dirTruncated: dirPre.scrollWidth > dirPre.clientWidth,
      };
    });
    // No horizontal scroll in the tree panel.
    expect(geo.scrollW).toBeLessThanOrEqual(geo.clientW + 1);
    expect(geo.rows).toHaveLength(3);
    for (const r of geo.rows) {
      // Indicators inside the panel, never scrolled out of view.
      expect(r.stLeft).toBeGreaterThanOrEqual(geo.boxLeft - 1);
      expect(r.rvRight).toBeLessThanOrEqual(geo.boxRight + 1);
    }
    // The two long names truncate (tree order: the deep files first).
    expect(geo.rows[0].nameTruncated).toBe(true);
    expect(geo.rows[1].nameTruncated).toBe(true);
    // The indicator columns align across rows.
    const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
    expect(spread(geo.rows.map((r) => r.rvRight))).toBeLessThanOrEqual(2);
    expect(spread(geo.rows.map((r) => r.stRight))).toBeLessThanOrEqual(2);
    expect(spread(geo.rows.map((r) => r.rvLeft))).toBeLessThanOrEqual(2);
    // The long directory chain is shortened, not fully shown.
    expect(geo.dirTruncated).toBe(true);

    const header = await longSection.locator(".dfile-h").evaluate((el) => {
      const box = el.getBoundingClientRect();
      const pane = document.getElementById("right")!.getBoundingClientRect();
      const st = el.querySelector(".ui-diffstat")!.getBoundingClientRect();
      const revc = el.querySelector(".revc")!.getBoundingClientRect();
      const box2 = el.querySelector("input.revbox")!.getBoundingClientRect();
      const name = el.querySelector(".path b")!;
      const dirPre = el.querySelector(".dir-pre");
      return {
        stRight: st.right, revcRight: revc.right, boxRight: box.right, boxLeft: box.left,
        stLeft: st.left, dirTruncated: dirPre ? dirPre.scrollWidth > dirPre.clientWidth : false,
        paneRight: pane.right, checkRight: box2.right,
        nameTruncated: name.scrollWidth > name.clientWidth,
      };
    });
    expect(header.stLeft).toBeGreaterThanOrEqual(header.boxLeft - 1);
    expect(header.revcRight).toBeLessThanOrEqual(header.boxRight + 1);
    // The whole header — checkbox included — fits the pane.
    expect(header.boxRight).toBeLessThanOrEqual(header.paneRight + 1);
    expect(header.checkRight).toBeLessThanOrEqual(header.paneRight + 1);
    expect(header.nameTruncated).toBe(true);
    expect(header.dirTruncated).toBe(true);

    await page.screenshot({ path: path.join(SHOTS, "j227-file-tree-long-path.png"), fullPage: false });
  });
});


// ---- j308-expand-repeat.spec.ts (frames re-added) ----
const midKey = fileKeyForPath("src/mid.py");

/** Issue #285 (E2): hover the button's row, then click. */
async function clickRowControl(scope: Locator, name: string | RegExp, nth = 0): Promise<void> {
  const btn = scope.getByRole("button", { name }).nth(nth);
  await btn.locator("xpath=ancestor::tr[1]").hover();
  await btn.click();
}


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
        path: path.join(SHOTS, "j308-collapse-hover.png"),
        clip: {
          x: Math.max(0, obox.x - 4),
          y: Math.max(0, obox.y - 8),
          width: 620,
          height: obox.height + ibox.height + 16,
        },
      });
    }
  });

});


// ---- j19-blank-band.spec.ts (frames re-added) ----
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
    await page.getByRole("button", { name: "Split", exact: true }).click();
    await expect(page.locator("#right table.diff.split").first()).toBeVisible({ timeout: 15_000 });
    await expectFirstHeadersVisible(page, "split, unfiltered");

    // File filter active: most files hidden before the first visible one.
    await page.getByRole("button", { name: "Show file list" }).click();
    await page.getByLabel("Filter files by name").fill("mod2");
    await expect(page.locator('[id="F-src-mod20.py"]')).toBeVisible({ timeout: 15_000 });
    await expectFirstHeadersVisible(page, "split, filtered to mod2*");
    await page.screenshot({ path: path.join(SHOTS, "j19-filtered-split.png") });

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
    // Let the scroll land: poll the pane position, never a fixed window (#363 B2).
    await expect
      .poll(() => page.evaluate(() => document.getElementById("right")?.scrollTop ?? -1), { timeout: 10_000 })
      .toBe(600);
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
