/** J283 (#283): hidden-hunk rows — real service, no agent.
 *
 * Scratch repo where the FIRST file is hidden-only (docs-only change) and the
 * second mixes a hidden imports hunk with a shown code hunk. Long summaries
 * are PATCHed onto the hidden hunks (what the hunk pass would write) so the
 * summary-flow geometry is exercised deterministically.
 *
 * Asserts, at 960px and 1440px in light and dark:
 * - every hidden row shows its label, the first file's included (the label
 *   used to paint under the opaque `.dband` backing: present in the DOM,
 *   topmost at its centre);
 * - the summary uses the full width (union box wider than half the row, or
 *   starting at the row's left content edge on its own line) — never a
 *   fixed narrow right column;
 * - the `>` expand box lines up with the hunk-header chevrons (same x/width);
 * - the first file's hidden row sits directly under its file header (no
 *   blank band), and checkLayout stays green.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { apiJson, createScratchReview, git } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const DOCS_SUMMARY =
  "Rewords the four onboarding notes for the new checkout flow, keeping every " +
  "heading and the step order exactly as documented so downstream links hold.";
const IMPORTS_SUMMARY =
  "Swaps the two stdlib imports the helper module needs for the new value " +
  "formatting path, leaving every call site untouched and sorted in place.";

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });

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
      await expect(label).toContainText(/Hunks? \d+.*hidden/, { timeout: 10_000 });
      const labelBox = (await label.boundingBox())!;
      expect(labelBox.x, `${step}: row ${i} label outside the row`).toBeGreaterThanOrEqual(rowBox.x);
      expect(labelBox.x + labelBox.width, `${step}: row ${i} label outside the row`).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
      const topmost = await page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return hit?.closest("button.hid")?.getAttribute("aria-label") ?? `${hit?.tagName}.${(hit as HTMLElement | null)?.className}`;
      }, { x: labelBox.x + labelBox.width / 2, y: labelBox.y + labelBox.height / 2 });
      expect(topmost, `${step}: row ${i} label covered by ${topmost}`).toMatch(/hidden\. Show these hunks/);
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

  for (const combo of [
    { name: "1440-light", width: 1440, dark: false },
    { name: "1440-dark", width: 1440, dark: true },
    { name: "960-light", width: 960, dark: false },
    { name: "960-dark", width: 960, dark: true },
  ] as const) {
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
      await page.screenshot({ path: `test-results/283-hidden-${combo.name}.png` });
    });
  }
});
