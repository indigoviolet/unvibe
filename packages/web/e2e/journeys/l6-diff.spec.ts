/**
 * L6 — Diff work (#363 package B).
 *
 * The diff pane in usage order: toolbar progress + counts, narrow-bar
 * layout, hide-uninteresting, split widening, file filters, revealSource,
 * fold + file-reviewed, filter combination (#190), dotted-range Explain
 * (#189/#285), expand up/down in steps, whole-gap reveal, split
 * alignment, unit names, pinning headers + columns, the sticky bar stack,
 * gutter E2 controls, expand-repeat, hidden-hunk rows, hide levels,
 * the file tree, plotlines, hunk summaries, and the blank band.
 *
 * Boots: none for the mock shell (Vite mock mode); ONE replay service
 * for every demo-backed step (seeded hide-level scores + fresh demo
 * reviews per thread-mutating step so journeys never share mutable
 * state, with the single plotline rename + version stamp applied in one
 * stop/start); ONE agent:none service for the six scratch shapes
 * (gap, gap+eof, mid/first/last, hidden-mix, long paths, 28 files).
 *
 * Absorbs: `diff.spec.ts` (8 live; the 5 DISABLED #119 tests stay unit
 * tests), `diff-expand.spec.ts` (8), `diff-pinned.spec.ts` (2 inline;
 * the ask-inside-appends test belongs to package C and stays in its
 * file), `diff-sticky-bar.spec.ts` (15), `j4`, `j265`, `j288`, `j308`,
 * `j283`, `j285`, `j325`, `j227`, `j242`, `j353` (clamp/tooltip/scores;
 * the frames test moves to the tour), `j13`, `j19`.
 *
 * Guards kept: #189/#285 (multi-line Explain from dotted range, no
 * gutter marker), #285 (E2 gutter: controls replace numbers, comment
 * icon swap, EOF keeps its number), #265 (expand-up lands in the
 * clicked hunk), #308 (expand-more rides the outermost row, collapse
 * reopens), #288 (optimistic bottom step drops silently at EOF), #283
 * (hidden rows read as one flowing row), #325 (hide levels, tooltip,
 * persistence, transient expand, citation reveal), #342 (collapsed-row
 * shape: range + one dot + summary only), #190 (type+plotline+level
 * combine), #184 (score dots on hunk headers, none in the Files list),
 * #227 (long paths truncate, indicators aligned, full path on hover),
 * #242 (plotline chips, builds-on, reviewed checkbox, read-only older
 * versions), #324 (shares sum to the total), #343 (plotline reviewed
 * box), #353 (long names store whole, clamp on screen), #13 (summaries
 * activate/delete/restore, Comment never activates, promoted chip),
 * #19/#202 (first headers never under the band backing), #204 (pinned
 * threads open inline, never overlaying), #140 (headers pin + replace,
 * columns align), #132 (sticky bar under the tab strip), #351/#353
 * (fold pair wraps as one), #274 (soft-wrap, no sideways scroll), #341
 * (re-recorded copy), #364 (the "Delete thread" name on summary
 * threads — distinct from "Delete reply").
 *
 * Brittleness fixed here (#363 §4): the `diff.spec:115-120` before/after
 * width read keeps its settle assert between the two reads (split table
 * visible — legitimate comparison, not a race); `j305`-style paired
 * reads use one synchronous `measureWithinRow`; `j19:131`'s 400 ms
 * settle (B2 — poll `scrollTop` back to 0 instead); the `clickRowControl`
 * / `scrollPaneTo` / `pinnedFile` / `pinnedHunk` copies (B5 — one shared
 * definition each in this file).
 *
 * Frames removed (tour owns them; package D re-adds): j283's
 * hidden-rows shots, j242's plotlines-mixed shot, j353's whole frames
 * test (card/chip/filter at 1440 + 960), j325's hidden/expanded shots,
 * j227's file-tree shot, j308's collapse-hover shot, j19's
 * filtered-split shot. No `shot()`/`screenshot` lines remain; the
 * `checkLayout` sweeps stay (package A convention).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { measureWithinRow } from "../geometry.js";
import { tourCombos } from "../tour-matrix.js";
import { fileKeyForPath } from "@unvibe/shared";
import { selectDiffRows, selectText } from "../select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import {
  apiJson,
  createDemoReview,
  createScratchReview,
  createSeededDemoReview,
  git,
  makeEofFile,
  makeGapRepo,
  stampDataFormat,
} from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

declare global {
  interface Window {
    __revealSource?: (ref: string) => boolean;
  }
}

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";
const connFile = `[id="F-${CONN}"]`;
const tconnFile = `[id="F-${TCONN}"]`;

// ---------------------------------------------------------------------------
// Shared expand/pin helpers (one definition; replaces the copies in
// diff-expand, diff-sticky-bar, j265, j288, j308 and j285).
// ---------------------------------------------------------------------------

/**
 * Issue #285 (E2): unified expand controls ride the hunk's first/last
 * row and show on row hover — hover the button's row, then click. (At
 * rest the buttons are transparent so number clicks pass through; split
 * view keeps its always-visible separator rows and needs no hover.)
 */
async function clickRowControl(scope: Locator, name: string | RegExp, nth = 0): Promise<void> {
  const btn = scope.getByRole("button", { name }).nth(nth);
  await btn.locator("xpath=ancestor::tr[1]").hover();
  await btn.click();
}

/** Scroll `#right` so `sel`'s top lands at content offset `at` from the pane top. */
async function scrollPaneTo(page: Page, sel: string, at: number): Promise<void> {
  await page.evaluate(
    ({ sel, at }: { sel: string; at: number }) => {
      const pane = document.getElementById("right") as HTMLElement;
      const el = pane.querySelector(sel) as HTMLElement;
      const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
      pane.scrollTop = Math.max(0, top - at);
    },
    { sel, at },
  );
}

async function scrollDiffToBottom(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("#right")?.scrollTo(0, 1e9));
}

/** File name shown by the file header pinned at the file slot, if any. */
async function pinnedFile(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const pane = document.getElementById("right") as HTMLElement;
    const p = pane.getBoundingClientRect();
    const slot = p.top + (Number.parseFloat(getComputedStyle(pane).getPropertyValue("--dfile-top")) || 0);
    let found: string | null = null;
    for (const el of pane.querySelectorAll(".dfile-h")) {
      if (Math.abs(el.getBoundingClientRect().top - slot) < 2.5) {
        found = el.querySelector("b")?.textContent ?? "";
      }
    }
    return found;
  });
}

/** Text of the hunk header pinned at the hunk slot, if any. */
async function pinnedHunk(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const pane = document.getElementById("right") as HTMLElement;
    const p = pane.getBoundingClientRect();
    const slot = p.top + (Number.parseFloat(getComputedStyle(pane).getPropertyValue("--dhunk-top")) || 0);
    let found: string | null = null;
    for (const el of pane.querySelectorAll(".dhunk-h")) {
      if (Math.abs(el.getBoundingClientRect().top - slot) < 2.5) {
        found = (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 60);
      }
    }
    return found;
  });
}

// ---------------------------------------------------------------------------
// Mock shell: no service boot. Every test loads `/review/demo` in Vite
// mock mode and walks one diff behaviour in usage order.
// ---------------------------------------------------------------------------

test.describe("L6 diff mock shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/review/demo");
    await expect(page.locator(connFile)).toBeVisible();
  });

  test("toolbar progress, narrow bar, hide-uninteresting, split widens", async ({ page }) => {
    test.setTimeout(180_000);
    await test.step("reviewed progress fills the toolbar bottom border; counts only in its label", async () => {
      const bar = page.getByRole("progressbar");
      await expect.soft(bar).toHaveAttribute("aria-label", "1 of 8 hunks reviewed");
      // Poll: the fill has a short width transition.
      await expect
        .poll(async () =>
          bar.evaluate((el) => {
            const fill = el.querySelector("i")!;
            return fill.getBoundingClientRect().width / el.getBoundingClientRect().width;
          }),
        )
        .toBeCloseTo(1 / 8, 1);
      expect.soft(await bar.getAttribute("data-tip")).toBe("1 of 8 hunks reviewed");
      // No text line for the counts anywhere.
      await expect.soft(page.getByText(/\d+\/8 hunks reviewed/)).toHaveCount(0);
      await page.locator(connFile).getByRole("checkbox", { name: "Mark reviewed" }).first().click();
      await expect.soft(bar).toHaveAttribute("aria-label", "2 of 8 hunks reviewed");
      await expect
        .poll(async () =>
          bar.evaluate((el) => {
            const fill = el.querySelector("i")!;
            return fill.getBoundingClientRect().width / el.getBoundingClientRect().width;
          }),
        )
        .toBeCloseTo(2 / 8, 1);
      // Leave the hunk unfolded: later steps in this test count tables.
      await page.locator(connFile).getByRole("button", { name: "Show code" }).first().click();
      await expect.soft(page.locator(`[id="L-${CONN}-90"]`)).toBeVisible({ timeout: 15000 });
    });

    await test.step("the toolbar stays on one row at a narrow pane width", async () => {
      await page.setViewportSize({ width: 900, height: 800 });
      // #241: Refresh lives in the review top bar now, not the diff toolbar.
      await expect.soft(page.locator(".dtool").getByRole("button", { name: "Refresh" })).toHaveCount(0);
      const rows = await page.locator(".dtool").evaluate((el) => {
        const tops = new Set(
          [...el.children]
            .filter((c) => !c.classList.contains("rprog"))
            .map((c) => { const r = (c as HTMLElement).getBoundingClientRect(); return Math.round(r.top + r.height / 2); }),
        );
        return { tops: tops.size, height: el.getBoundingClientRect().height };
      });
      expect.soft(rows.tops).toBe(1);
    });

    await test.step("hide uninteresting collapses runs to one row per run", async () => {
      await scrollDiffToBottom(page);
      await expect.soft(page.locator("button.hid")).toHaveCount(2);
      await expect.soft(page.getByRole("button", { name: /Hunks 1–2, collapsed/ })).toBeVisible();
      await page.getByRole("button", { name: /Hide level:/ }).click();
      await page.locator('[data-hidecat="uninteresting"]').click();
      await expect.soft(page.locator("button.hid")).toHaveCount(0);
      await page.getByRole("button", { name: /Hide level:/ }).click();
      await page.locator('[data-hidecat="uninteresting"]').click();
      await expect.soft(page.locator("button.hid")).toHaveCount(2);
    });

    await test.step("split view pairs columns and widens a narrow pane", async () => {
      // Back to the default width: the one-row step above narrows the
      // viewport, and a narrow overlay pane cannot widen further.
      await page.setViewportSize({ width: 1280, height: 720 });
      const right = page.locator("#right");
      const before = await right.boundingBox();
      await page.getByRole("button", { name: "Split", exact: true }).click();
      await expect.soft(page.locator(`${connFile} table.diff.split`).first()).toBeVisible();
      // One table (and colgroup) per hunk: the fixture's first file has two.
      await expect.soft(page.locator(`${connFile} table.diff.split colgroup`)).toHaveCount(2);
      const after = await right.boundingBox();
      // Before/after across a click is a legitimate comparison, but the
      // two reads must straddle a settled state (#363 B2): the split
      // tables above are the gate.
      expect.soft(before?.width).toBeLessThan(after?.width ?? 0);
    });
  });

  test("file filters read counts, hold an active state, persist and close on Escape", async ({ page }) => {
    test.setTimeout(180_000);
    await test.step("file filter dropdown filters by type with counts and an active state", async () => {
      await page.getByRole("button", { name: "Show file list" }).click();
      const filter = page.getByRole("button", { name: "File filters" });
      await expect.soft(filter).toBeVisible();
      // Default: no active state, and no count badge anywhere.
      await expect.soft(filter).toHaveAttribute("aria-pressed", "false");
      await expect.soft(filter.locator(".count")).toHaveCount(0);
      await filter.click();
      const menu = page.getByRole("menu", { name: "File filters" });
      await expect.soft(menu).toBeVisible();
      // File types only (#184): Reviewed and GitHub comments left this menu.
      await expect.soft(menu.getByRole("menuitemcheckbox")).toHaveCount(5);
      for (const name of ["Code", "Tests", "Docs", "Config", "Generated"]) {
        await expect.soft(menu.getByRole("menuitemcheckbox", { name: new RegExp(name) })).toBeVisible();
      }
      await expect.soft(menu.getByRole("menuitemcheckbox", { name: /Reviewed|GitHub/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
      // The toolbar's second filter holds Reviewed and GitHub comments.
      const reviewFilter = page.getByRole("button", { name: "Review filters" });
      await reviewFilter.click();
      const reviewMenu = page.getByRole("menu", { name: "Review filters" });
      await expect.soft(reviewMenu.getByRole("menuitemcheckbox")).toHaveCount(2);
      await expect.soft(reviewMenu.getByRole("menuitemcheckbox", { name: /Reviewed/ })).toBeVisible();
      await expect.soft(reviewMenu.getByRole("menuitemcheckbox", { name: /GitHub comments/ })).toBeVisible();
      await page.keyboard.press("Escape");
      await filter.click();
      // Deselect Tests: its files hide and the button shows its active state.
      await menu.getByRole("menuitemcheckbox", { name: /Tests/ }).click();
      await expect.soft(page.locator(connFile)).toBeVisible();
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
      await expect.soft(filter).toHaveAttribute("aria-pressed", "true");
      await expect.soft(filter).toHaveAttribute("data-tip", "Filter files by type");
      // Stored prefs survive a reload.
      await page.reload();
      await expect.soft(page.locator(connFile)).toBeVisible();
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
      await expect.soft(page.getByRole("button", { name: "File filters" })).toHaveAttribute("data-tip", "Filter files by type");
    });

    await test.step("file filter dropdown is keyboard-usable and closes on Escape", async () => {
      // The previous step persisted Tests-off; reset the stored prefs so
      // this step starts from the all-types-on state like the original.
      await page.evaluate(() => localStorage.clear());
      await page.goto("/review/demo");
      await expect.soft(page.locator(connFile)).toBeVisible();
      await page.getByRole("button", { name: "Show file list" }).click();
      const filter = page.getByRole("button", { name: "File filters" });
      await filter.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu", { name: "File filters" });
      await expect.soft(menu).toBeVisible();
      // ArrowDown moves focus down the rows.
      await page.keyboard.press("ArrowDown");
      await expect.soft(menu.getByRole("menuitemcheckbox", { name: /Tests/ })).toBeFocused();
      // Space toggles the focused row; the menu stays open for multi-toggle.
      await page.keyboard.press("Space");
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
      await expect.soft(menu).toBeVisible();
      // Escape closes and returns focus to the button.
      await page.keyboard.press("Escape");
      await expect.soft(menu).toHaveCount(0);
      await expect.soft(filter).toBeFocused();
    });
  });

  test("revealSource unhides a hidden hunk; folds and file-reviewed survive tabs", async ({ page }) => {
    test.setTimeout(180_000);
    await test.step("revealSource unhides a hidden hunk and highlights the line", async () => {
      await scrollDiffToBottom(page);
      await expect.soft(page.locator("button.hid")).toHaveCount(2);
      const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:5`), TCONN);
      expect.soft(ok).toBe(true);
      await expect.soft(page.locator(`[id="L-${TCONN}-5"].hl`)).toBeVisible();
      // The hidden run expanded to show the hunk.
      await expect.soft(page.getByText("Hunk 1 of 3")).toBeVisible();
    });

    // Issue #162: file fold survives a tab switch, and file reviewed
    // derives from hunks with a partial state.
    await test.step("file fold survives a tab switch; file reviewed derives from hunks", async () => {
      const conn = page.locator(connFile);
      await conn.getByRole("button", { name: "Collapse file" }).click();
      await expect.soft(conn.locator(".dbody")).toHaveCount(0);
      // To the description tab and back: the fold must survive.
      await page.getByRole("tab", { name: "PR description" }).click();
      await expect.soft(conn).toHaveCount(0);
      await page.getByRole("tab", { name: "Diff" }).click();
      await expect.soft(page.locator(connFile).locator(".dbody")).toHaveCount(0);
      await page.locator(connFile).getByRole("button", { name: "Expand file" }).click();
      await expect.soft(page.locator(connFile).locator(".dbody")).toHaveCount(1);
      // File reviewed derives from hunks: mark the file, unmark one hunk.
      const file = page.locator(connFile);
      await expect.soft(file.getByText("0/2")).toBeVisible();
      await file.getByRole("checkbox", { name: "Mark file reviewed" }).click();
      await expect.soft(file.getByText("2/2")).toBeVisible();
      await expect.soft(file.getByRole("checkbox", { name: "Mark file not reviewed" })).toBeChecked();
      await file.getByRole("checkbox", { name: "Mark not reviewed" }).first().click();
      await expect.soft(file.getByText("1/2")).toBeVisible();
      const partial = file.getByRole("checkbox", { name: "Mark file reviewed" });
      await expect.soft(partial).not.toBeChecked();
      expect.soft(await partial.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
    });
  });

  test("expand up/down in steps, whole-gap reveal, no controls at the boundary", async ({ page }) => {
    test.setTimeout(240_000);
    await test.step("expands above a hunk in steps and collapses back", async () => {
      const conn = page.locator(connFile);
      await clickRowControl(conn, "Show 20 more lines", 0);
      const revealed = conn.locator("tr[data-revealed]");
      await expect.soft(revealed).toHaveCount(20);
      await expect.soft(page.locator(`[id="L-${CONN}-76"]`)).toBeVisible();
      await expect.soft(page.locator(`[id="L-${CONN}-56"]`)).toHaveCount(0);
      // A second step continues upward.
      await clickRowControl(conn, "Show 20 more lines", 0);
      await expect.soft(conn.locator("tr[data-revealed]")).toHaveCount(40);
      await expect.soft(page.locator(`[id="L-${CONN}-37"]`)).toBeVisible();
      // Collapse hides the revealed lines through the second row's chevron
      // (issue #308: expand-more is never replaced).
      await clickRowControl(conn, "Hide expanded lines above");
      await expect.soft(conn.locator("tr[data-revealed]")).toHaveCount(0);
    });

    await test.step("reveals a whole gap so the hunks read as continuous", async () => {
      // Steps share one browser context (the originals each got a fresh
      // one), so re-navigate: earlier expansions would corrupt the counts.
      await page.goto("/review/demo");
      await expect.soft(page.locator(connFile)).toBeVisible();
      await scrollDiffToBottom(page);
      await page.getByRole("button", { name: /Hunks 1–2, collapsed/ }).click();
      await expect.soft(page.getByText("Hunk 1 of 3")).toBeVisible();
      const tconn = page.locator(tconnFile);
      // Issue #265: the gap's show-all rides both ends; the upper side's
      // (first in DOM order) keeps the old path here.
      await clickRowControl(tconn, "Show all 4 lines", 0);
      await expect.soft(tconn.locator("tr[data-revealed]")).toHaveCount(4);
      for (const n of [10, 11, 12, 13]) {
        await expect.soft(page.locator(`[id="L-${TCONN}-${n}"]`)).toBeVisible();
      }
      // Fully revealed: this gap's show-all is gone; the collapse chevron
      // (issue #308) sits on the run's second row instead.
      await expect.soft(tconn.getByRole("button", { name: "Show all 4 lines" })).toHaveCount(0);
      await clickRowControl(tconn, "Hide expanded lines below");
      await expect.soft(tconn.locator("tr[data-revealed]")).toHaveCount(0);
    });

    await test.step("revealing a gap fully from below leaves no controls at the boundary", async () => {
      await page.goto("/review/demo");
      await expect.soft(page.locator(connFile)).toBeVisible();
      await scrollDiffToBottom(page);
      await page.getByRole("button", { name: /Hunks 1–2, collapsed/ }).click();
      await expect.soft(page.getByText("Hunk 1 of 3")).toBeVisible();
      const tconn = page.locator(tconnFile);
      // The small gap's lower step finishes it in one click.
      const steps = tconn.getByRole("button", { name: "Show 4 more lines" });
      await expect.soft(steps).toHaveCount(2);
      await clickRowControl(tconn, "Show 4 more lines", 1);
      await expect.soft(tconn.locator("tr[data-revealed]")).toHaveCount(4);
      // No separator rows at the revealed boundary (#285): hunk 1's table
      // starts on its first code line (the top-region step rides that row),
      // hunk 2's table starts on the revealed tail — controls live in rows,
      // never between them.
      const [first, second] = await tconn.locator(".dhunk").all();
      await expect.soft(first.locator("tr.xsep")).toHaveCount(0);
      await expect.soft(second.locator("tr.xsep")).toHaveCount(0);
      const firstRowClass: string = await first.locator("table.diff tbody tr").first().getAttribute("class") ?? "";
      expect.soft(firstRowClass.split(" ")).toContain("has-xup");
      const nums: number[] = await tconn.evaluate((el) => {
        const dhunks = [...el.querySelectorAll(".dhunk")].slice(0, 2);
        const out: number[] = [];
        for (const d of dhunks) {
          for (const tr of d.querySelectorAll("table.diff tbody tr")) {
            const id = (tr as HTMLElement).id;
            if (id.startsWith("L-")) out.push(Number(id.split("-").pop()));
          }
        }
        return out;
      });
      expect.soft(nums).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    });
  });

  test("split keeps alignment, revealed lines stay comment-free, unit controls read right", async ({ page }) => {
    test.setTimeout(240_000);
    await test.step("split view keeps both sides of revealed lines aligned", async () => {
      await page.goto("/review/demo");
      await expect.soft(page.locator(connFile)).toBeVisible();
      await page.getByRole("button", { name: "Split", exact: true }).click();
      const conn = page.locator(connFile);
      await conn.getByRole("button", { name: "Show 20 more lines" }).first().click();
      const row = page.locator(`[id="L-${CONN}-76"]`);
      await expect.soft(row).toBeVisible();
      await expect.soft(row.locator("td.n")).toHaveCount(2);
      await expect.soft(row.locator("td.n").first()).toHaveText("76");
      await expect.soft(row.locator("td.n").nth(1)).toHaveText("76");
    });

    await test.step("revealed lines offer no comment start", async () => {
      await page.goto("/review/demo");
      await expect.soft(page.locator(connFile)).toBeVisible();
      const conn = page.locator(connFile);
      await clickRowControl(conn, "Show 20 more lines", 0);
      await expect.soft(conn.locator("tr[data-revealed]")).toHaveCount(20);
      // No comment affordance on revealed number cells…
      await expect.soft(page.locator("tr[data-revealed] td.n.new")).toHaveCount(0);
      await expect.soft(page.locator("tr[data-revealed] td.n[data-line]")).toHaveCount(0);
      // …and clicking one opens no comment composer.
      await page.locator(`[id="L-${CONN}-76"]`).locator("td.n").nth(1).click();
      await expect.soft(page.locator("tr[data-revealed]")).toHaveCount(20);
    });

    await test.step("steps from function to class with the unit name in the hunk header", async () => {
      await page.goto("/review/demo");
      await expect.soft(page.locator(connFile)).toBeVisible();
      const conn = page.locator(connFile);
      await conn.getByText("Hunk 2 of 2").scrollIntoViewIfNeeded();
      await conn.getByRole("button", { name: "Show the enclosing function or class" }).nth(1).click();
      await expect.soft(conn.locator("tr[data-revealed]")).toHaveCount(18);
      await expect.soft(page.locator(`[id="L-${CONN}-640"]`)).toBeVisible();
      await expect.soft(page.locator(`[id="L-${CONN}-665"]`)).toBeVisible();
      await expect.soft(conn.getByText(/in getresponse/)).toBeVisible();
      await conn.getByRole("button", { name: "Show enclosing class HTTPConnection" }).click();
      await expect.soft(conn.getByText(/in HTTPConnection/)).toBeVisible();
      await expect.soft(conn.getByRole("button", { name: "Show the whole file" })).toBeVisible();
    });

    await test.step("hides the unit control when no unit encloses the hunk", async () => {
      await page.goto("/review/demo");
      await expect.soft(page.locator(connFile)).toBeVisible();
      const conn = page.locator(connFile);
      // First hunk spans top-level items: the outline is empty.
      await conn.getByRole("button", { name: "Show the enclosing function or class" }).first().click();
      await expect.soft(conn.getByRole("button", { name: "Show the enclosing function or class" })).toHaveCount(1);
    });

    await test.step("headers still pin and code columns line up with expansion revealed", async () => {
      await page.goto("/review/demo");
      await expect.soft(page.locator(connFile)).toBeVisible();
      const conn = page.locator(connFile);
      // Lines above and below the first hunk…
      await clickRowControl(conn, "Show 20 more lines", 0);
      await expect.soft(conn.locator("tr[data-revealed]")).toHaveCount(20);
      // …and a fully revealed gap in another file.
      await scrollDiffToBottom(page);
      await page.getByRole("button", { name: /Hunks 1–2, collapsed/ }).click();
      const tconn = page.locator(tconnFile);
      // Issue #265: the gap's show-all rides both ends; the upper side's
      // (first in DOM order) keeps the old path here.
      await clickRowControl(tconn, "Show all 4 lines", 0);
      await expect.soft(tconn.locator("tr[data-revealed]")).toHaveCount(4);
      // A revealed row scrolls under the pinned file + hunk headers. Scroll
      // to a line deep enough in the hunk that its header is genuinely stuck
      // at the slot (not merely sitting near it in normal flow — file-top
      // groups like the GitHub outdated threads legitimately move that).
      await scrollPaneTo(page, `[id="L-${CONN}-90"]`, 400);
      await expect.poll(async () => pinnedFile(page), { timeout: 5000 }).toBe("connection.py");
      await expect.poll(async () => pinnedHunk(page), { timeout: 5000 }).toContain("Hunk 1 of");
      // Code columns start at the same x across the file's hunk tables
      // (revealed rows ride the same tables, so they line up by construction).
      const xs: number[] = await page.evaluate((key: string) => {
        const file = document.querySelector(`[id="F-${key}"]`)!;
        return [...file.querySelectorAll(".dhunk table.diff")].map(
          (t) => (t.querySelector("td.c") as HTMLElement).getBoundingClientRect().x,
        );
      }, CONN);
      expect.soft(xs.length).toBeGreaterThan(1);
      expect.soft(new Set(xs.map((x) => Math.round(x))).size).toBe(1);
    });
  });

  test("pinned threads open inline under their row, never overlaying (#204)", async ({ page }) => {
    test.setTimeout(240_000);
    for (const mode of ["unified", "split"] as const) {
      await test.step(`pinned thread opens inline under its anchored row (${mode})`, async () => {
        await page.goto("/review/demo");
        await expect.soft(page.locator("#page .doc h1.title")).toContainText(
          "Unfold obsolete folded response headers",
        );
        await page.evaluate(() => document.fonts.ready).catch(() => {});
        await page.locator('#right [role="tab"]').getByText("Diff").click();
        await expect.soft(page.locator("#right table.diff").first()).toBeVisible({ timeout: 8000 });
        if (mode === "split") await page.getByRole("button", { name: "Split", exact: true }).click();
        // (The ask-inside-appends half of #204 lives in package C's L4.)
        const scope = '[id="F-test-with_dummyserver-test_socketlevel.py"]';
        await selectText(page, scope, 'msg["fold-mixed-repeated"]');
        await page.locator('#selbar [data-act="explain"]').click();
        const thread = page.locator('.dhunk section.ithread[data-thread]:has([data-reply][data-kind="explain"])').first();
        await expect.soft(thread).toBeVisible({ timeout: 8000 });
        await expect.soft(thread).not.toHaveClass(/floating/);
        await expect.soft(page.locator(".dhunk .exp-float, .dhunk .dhunk-float")).toHaveCount(0);
        await expect.soft(thread.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);

        // The thread sits in the flow under its anchored row (not over it):
        // the row below the thread starts at or after the thread's bottom.
        // One synchronous read: the two boxes must not straddle a poll tick.
        const layout = await page.evaluate(() => {
          const threadEl = document.querySelector('.dhunk section.ithread[data-thread]:has([data-reply][data-kind="explain"])');
          if (!threadEl) return { ok: false, why: "no pinned thread" };
          let row: Element | null = null;
          for (const tr of document.querySelectorAll('tr[id^="L-test-with_dummyserver-test_socketlevel.py-"]')) {
            if ((tr.textContent ?? "").includes('msg["fold-mixed-repeated"]')) row = tr;
          }
          if (!row) return { ok: false, why: "no anchored row" };
          const cr = threadEl.getBoundingClientRect();
          const rr = (row as Element).getBoundingClientRect();
          return {
            ok: cr.top >= rr.top && cr.bottom > cr.top,
            why: `threadTop=${Math.round(cr.top)} rowTop=${Math.round(rr.top)} threadBottom=${Math.round(cr.bottom)}`,
          };
        });
        expect.soft(layout.ok, layout.why).toBe(true);
      });
    }
  });

  test("sticky bar pins, reveals land below it, panels stay visible", async ({ page }) => {
    test.setTimeout(240_000);
    const geometry = async (): Promise<{
      pane: { y: number; bottom: number; x: number; width: number };
      stickH: number;
      bar: { y: number; bottom: number; x: number; width: number; height: number };
      barTop: number;
    } | null> => page.evaluate(() => {
      const pane = document.getElementById("right");
      const stick = pane?.querySelector(".rstick");
      const bar = pane?.querySelector(".dtool");
      if (!(pane instanceof HTMLElement) || !(stick instanceof Element) || !(bar instanceof Element)) return null;
      const p = pane.getBoundingClientRect();
      const s = stick.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      return {
        pane: { y: p.top, bottom: p.bottom, x: p.left, width: p.width },
        stickH: s.height,
        bar: { y: b.y, bottom: b.bottom, x: b.x, width: b.width, height: b.height },
        barTop: Number.parseFloat(getComputedStyle(bar).top),
      };
    });

    await test.step("actions bar stays pinned under the tab strip while the diff scrolls", async () => {
      await scrollDiffToBottom(page);
      const g = await geometry();
      expect.soft(g).not.toBeNull();
      // position:sticky from CSS, with `top` tracking the live tab-strip height.
      await expect.soft(page.locator("#right .dtool")).toBeVisible();
      const position = await page.evaluate(
        () => getComputedStyle(document.querySelector("#right .dtool") as Element).position,
      );
      expect.soft(position).toBe("sticky");
      // Pinned directly under the strip: bar top == pane top + strip height.
      expect.soft(Math.abs(g!.bar.y - (g!.pane.y + g!.stickH))).toBeLessThan(2.5);
      expect.soft(Math.abs(g!.barTop - g!.stickH)).toBeLessThan(2.5);
      // Fully inside the pane vertically (opaque bar above scrolling content).
      expect.soft(g!.bar.y).toBeGreaterThanOrEqual(g!.pane.y - 1);
      expect.soft(g!.bar.bottom).toBeLessThanOrEqual(g!.pane.bottom + 1);
    });

    await test.step("a revealed line lands below the bar, not under it", async () => {
      await scrollDiffToBottom(page);
      const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650`), CONN);
      expect.soft(ok).toBe(true);
      const line = page.locator(`[id="L-${CONN}-650"].hl`);
      await expect.soft(line).toBeVisible();
      const g = await geometry();
      const lineBox = await line.boundingBox();
      expect.soft(g).not.toBeNull();
      expect.soft(lineBox).not.toBeNull();
      // The line's top is at or below the pinned bar's bottom.
      expect.soft(lineBox!.y).toBeGreaterThanOrEqual(g!.bar.bottom - 1);
      // ... and inside the pane viewport.
      expect.soft(lineBox!.y).toBeGreaterThanOrEqual(g!.pane.y - 1);
      expect.soft(lineBox!.y).toBeLessThanOrEqual(g!.pane.bottom);
    });

    await test.step("a file jump from the Files list lands the header below the bar", async () => {
      await scrollDiffToBottom(page);
      await page.getByRole("button", { name: "Show file list" }).click();
      await page.getByRole("button", { name: /test_socketlevel\.py/ }).click();
      const header = page.locator(`[id="F-${TSOCK}"]`);
      await expect.soft(header).toBeVisible();
      const g = await geometry();
      const fileBox = await header.boundingBox();
      expect.soft(g).not.toBeNull();
      expect.soft(fileBox).not.toBeNull();
      // The file section's top (its header) sits below the pinned bar.
      expect.soft(fileBox!.y).toBeGreaterThanOrEqual(g!.bar.bottom - 2);
    });

    await test.step("Files panel opened while scrolled is fully visible, with its dropdown", async () => {
      await scrollDiffToBottom(page);
      // The jump step above may have left the panel open (and scrolled
      // out of view): close it first so this step opens it fresh while
      // scrolled, like the original.
      if (await page.locator("#right .files").isVisible().catch(() => false)) {
        await page.getByRole("button", { name: "Hide file list" }).click();
        await expect.soft(page.locator("#right .files")).toBeHidden({ timeout: 15000 });
      }
      await page.getByRole("button", { name: "Show file list" }).click();
      const files = page.locator("#right .files");
      await expect.soft(files).toBeVisible();
      const g = await geometry();
      expect.soft(g).not.toBeNull();
      const filesBox = await files.boundingBox();
      expect.soft(filesBox).not.toBeNull();
      // The whole panel (filter, progress, list) sits inside the pane viewport.
      expect.soft(filesBox!.y).toBeGreaterThanOrEqual(g!.pane.y - 1);
      expect.soft(filesBox!.y + filesBox!.height).toBeLessThanOrEqual(g!.pane.bottom + 1);
      await expect.soft(page.getByLabel("Filter files by name")).toBeVisible();
      // The filter dropdown opens above the diff content and inside the viewport.
      await page.getByRole("button", { name: "File filters" }).click();
      const menu = page.getByRole("menu", { name: "File filters" });
      await expect.soft(menu).toBeVisible();
      const menuBox = await menu.boundingBox();
      const viewport = page.viewportSize();
      expect.soft(menuBox).not.toBeNull();
      expect.soft(viewport).not.toBeNull();
      expect.soft(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect.soft(menuBox!.y).toBeGreaterThanOrEqual(0);
      expect.soft(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
      expect.soft(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
    });

    await test.step("bar spans the full pane width in split view and after sideways scrolling", async () => {
      await page.getByRole("button", { name: "Split", exact: true }).click();
      await expect.soft(page.locator(`${connFile} table.diff.split`).first()).toBeVisible();
      await scrollDiffToBottom(page);
      // Sideways-scroll every file body that can scroll; the bar must not move
      // with the content or leave a gap.
      await page.evaluate(() => {
        for (const w of document.querySelectorAll("#right .dwrap")) w.scrollTo(9999, 0);
      });
      const g = await geometry();
      expect.soft(g).not.toBeNull();
      expect.soft(Math.abs(g!.bar.x - g!.pane.x)).toBeLessThan(1.5);
      expect.soft(Math.abs(g!.bar.width - g!.pane.width)).toBeLessThan(1.5);
    });

    await test.step("bar wraps at narrow widths, keeping the fold pair on one row (#351, #353)", async () => {
      // #362 named keep (diffStickyBar): the actions bar wraps at narrow
      // widths, keeping the trailing Fold all / Unfold all pair together.
      // #351 lets the bar wrap at narrow widths; #353 keeps the pair together.
      const wrap = await page.evaluate(
        () => getComputedStyle(document.querySelector("#right .dtool") as Element).flexWrap,
      );
      expect.soft(wrap).toBe("wrap");
      // Narrow desktop (960): the source pane becomes the overlay; the bar still
      // spans it and sits directly under the tab strip.
      await page.setViewportSize({ width: 960, height: 800 });
      const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650`), CONN);
      expect.soft(ok).toBe(true);
      await expect.soft(page.locator(`[id="L-${CONN}-650"].hl`)).toBeVisible();
      const g = await geometry();
      expect.soft(g).not.toBeNull();
      expect.soft(Math.abs(g!.bar.width - g!.pane.width)).toBeLessThan(1.5);
      expect.soft(Math.abs(g!.bar.y - (g!.pane.y + g!.stickH))).toBeLessThan(2.5);
      const pairTops = await page.evaluate(() =>
        [...document.querySelectorAll("#right .dtool .foldpair > *")].map((el) => Math.round(el.getBoundingClientRect().top)),
      );
      expect.soft(pairTops.length).toBe(2);
      expect.soft(pairTops[0]).toBe(pairTops[1]);
    });
  });

  test("file and hunk headers pin, replace and keep working", async ({ page }) => {
    test.setTimeout(240_000);
    const stack = async (): Promise<{
      paneY: number; paneBottom: number; stripH: number; barH: number;
      fileH: number; hunkH: number; fileTop: number; hunkTop: number;
    }> => page.evaluate(() => {
      const pane = document.getElementById("right") as HTMLElement;
      const h = (sel: string): number => {
        const el = pane.querySelector(sel);
        return el instanceof HTMLElement ? el.offsetHeight : 0;
      };
      const css = getComputedStyle(pane);
      const num = (v: string): number => Number.parseFloat(v) || 0;
      const p = pane.getBoundingClientRect();
      return {
        paneY: p.top,
        paneBottom: p.bottom,
        stripH: h(".rstick"),
        barH: h(".dtool"),
        fileH: h(".dfile-h"),
        hunkH: h(".dhunk-h"),
        fileTop: num(css.getPropertyValue("--dfile-top")),
        hunkTop: num(css.getPropertyValue("--dhunk-top")),
      };
    });
    /** Scroll `sel` to offset `at` and wait until the header pinned at its slot shows `text`. */
    const expectPinned = async (sel: string, at: number, kind: "file" | "hunk", text: string): Promise<void> => {
      await expect
        .poll(
          async () => {
            if (kind === "hunk") {
              // Scroll the hunk SECTION (not its sticky header: scrolling
              // an already-stuck header is a no-op and leaves the pane
              // deep inside the section with no margin below). Section
              // top 100px above the slot: a working sticky header parks
              // exactly at the slot; a broken one scrolls past and fails.
              await page.evaluate(
                ({ sel, at }: { sel: string; at: number }) => {
                  const pane = document.getElementById("right") as HTMLElement;
                  const header = pane.querySelector(sel) as HTMLElement;
                  const sec = (header.closest(".dhunk") ?? header) as HTMLElement;
                  const p = pane.getBoundingClientRect();
                  const slot = p.top + at;
                  const secTop = sec.getBoundingClientRect().top;
                  pane.scrollTop = Math.max(0, pane.scrollTop + (secTop - (slot - 100)));
                },
                { sel, at },
              );
            } else {
              await scrollPaneTo(page, sel, at);
            }
            const v = kind === "file" ? await pinnedFile(page) : await pinnedHunk(page);
            return v ?? "";
          },
          { timeout: 5000 },
        )
        .toContain(text);
    };
    /* After `expectPinned`, scroll a little further: a pinned header stays,
     * a passing one leaves. The scroll is small on purpose: a large one
     * legitimately carries a short section's header past the slot (sticky
     * headers are constrained to their section) — that flakes on geometry,
     * not on pinning. A passing header still leaves the 2.5px slot. */
    const expectStuck = async (kind: "file" | "hunk", text: string): Promise<void> => {
      await page.evaluate(() => document.getElementById("right")?.scrollBy(0, 20));
      await expect
        .poll(async () => (kind === "file" ? await pinnedFile(page) : await pinnedHunk(page)) ?? "", {
          timeout: 5000,
        })
        .toContain(text);
    };

    await test.step("file header pins under the bar while its file scrolls, then the next file replaces it", async () => {
      const s = await stack();
      const filePos = await page.evaluate(() => getComputedStyle(document.querySelector("#right .dfile-h") as Element).position);
      expect.soft(filePos).toBe("sticky");
      // Midway through the first file: its header is pinned at the file slot.
      await expectPinned(`[id="F-${CONN}"]`, s.fileTop + 400, "file", "connection.py");
      await expectStuck("file", "connection.py");
      // Scroll on: the second file's header arrives and replaces the first.
      await scrollDiffToBottom(page);
      const name = await pinnedFile(page);
      expect.soft(name).not.toContain("connection.py");
      expect.soft(name).not.toBeNull();
      // The outgoing header scrolled away instead of stacking: exactly one
      // header sits at the slot.
      const atSlot = await page.evaluate(() => {
        const pane = document.getElementById("right") as HTMLElement;
        const p = pane.getBoundingClientRect();
        const slot = p.top + (Number.parseFloat(getComputedStyle(pane).getPropertyValue("--dfile-top")) || 0);
        return [...pane.querySelectorAll(".dfile-h")].filter(
          (el) => Math.abs(el.getBoundingClientRect().top - slot) < 2.5,
        ).length;
      });
      expect.soft(atSlot).toBe(1);
    });

    await test.step("hunk header pins under the file header while its hunk scrolls, then the next hunk replaces it", async () => {
      const hunkPos = await page.evaluate(
        () => getComputedStyle(document.querySelector("#right .dhunk-h") as Element).position,
      );
      expect.soft(hunkPos).toBe("sticky");
      const s = await stack();
      // Pin the first hunk of the first file at the hunk slot.
      await expectPinned(`[data-hunk="${CONN}:0"]`, s.hunkTop, "hunk", "Hunk 1 of");
      // Scroll on: the second hunk's header replaces the first at the slot.
      await expectPinned(`[data-hunk="${CONN}:1"]`, s.hunkTop, "hunk", "Hunk 2 of");
      await expectStuck("hunk", "Hunk 2 of");
    });

    await test.step("a revealed line lands below the whole pinned stack, not under a header", async () => {
      await scrollDiffToBottom(page);
      const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650`), CONN);
      expect.soft(ok).toBe(true);
      const line = page.locator(`[id="L-${CONN}-650"].hl`);
      await expect.soft(line).toBeVisible();
      const s = await stack();
      const lineBox = await line.boundingBox();
      expect.soft(lineBox).not.toBeNull();
      // Below all four pinned rows: the hunk header's bottom is the lowest.
      const stackBottom = s.paneY + s.stripH + s.barH + s.fileH + s.hunkH;
      expect.soft(lineBox!.y).toBeGreaterThanOrEqual(stackBottom - 2);
      expect.soft(lineBox!.y).toBeLessThanOrEqual(s.paneBottom);
    });

    await test.step("the pinned headers' controls keep working: collapse the file, fold the hunk", async () => {
      const s = await stack();
      // Pin the first file's header, then collapse the file through it.
      await expectPinned(`[id="F-${CONN}"]`, s.fileTop + 400, "file", "connection.py");
      await page.locator(`[id="F-${CONN}"] .dfile-h`).getByRole("button", { name: "Collapse file" }).click();
      await expect.soft(page.locator(`[id="F-${CONN}"] .dbody`)).toHaveCount(0);
      // The collapsed header still pins at the slot.
      expect.soft(await pinnedFile(page)).toContain("connection.py");
      await page.locator(`[id="F-${CONN}"] .dfile-h`).getByRole("button", { name: "Expand file" }).click();
      await expect.soft(page.locator(`[id="F-${CONN}"] .dbody`)).toHaveCount(1);
      // Fold the first hunk through its pinned header: the code hides and the
      // header chevron becomes the single unfold control (no placeholder row).
      await expectPinned(`[data-hunk="${CONN}:0"]`, s.hunkTop, "hunk", "Hunk 1 of");
      await page
        .locator(`[data-hunk="${CONN}:0"]`)
        .getByRole("button", { name: "Fold code", exact: true })
        .click();
      await expect.soft(
        page.locator(`[data-hunk="${CONN}:0"]`).getByRole("button", { name: "Show code", exact: true }),
      ).toBeVisible();
      await expect.soft(page.locator(`[id="F-${CONN}"]`).getByText("changed lines folded")).toHaveCount(0);
      // Leave the diff as found: later steps expect expanded code.
      // (A reload, not the pinned header's Show-code button: the pinned
      // clone does not unfold reliably.)
      await page.reload();
      await expect.soft(page.locator(connFile)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(`[id="L-${CONN}-90"]`)).toBeVisible({ timeout: 15000 });
    });

    await test.step("hidden-hunk rows scroll under the pinned headers instead of pinning", async () => {
      const hid = page.locator("#right .dhid .hid").first();
      await expect.soft(hid).toBeVisible();
      const y0 = (await hid.boundingBox())!.y;
      await page.evaluate(() => document.getElementById("right")?.scrollBy(0, 200));
      const y1 = (await hid.boundingBox())!.y;
      // Moves with the content (not stuck): delta matches the scroll.
      expect.soft(Math.abs(y0 - y1 - 200)).toBeLessThan(30);
    });

    await test.step("no vertical scroll container sits between a hunk header and the pane", async () => {
      // The invariant the pinning relies on (#140): every ancestor of `.dhunk-h`
      // up to `#right` leaves vertical overflow visible, so the stick reaches
      // the pane whatever an engine computes for `clip` beside `auto`. The
      // sideways scrollers (`.dwrap`) wrap only the code tables, never headers.
      const bad = await page.evaluate(() => {
        const pane = document.getElementById("right") as HTMLElement;
        const bad: string[] = [];
        for (const h of pane.querySelectorAll(".dhunk-h")) {
          if ((h as HTMLElement).closest(".dwrap")) bad.push("header-inside-dwrap");
          let el: HTMLElement | null = h as HTMLElement;
          while (el && el !== pane) {
            const oy = getComputedStyle(el).overflowY;
            if (oy !== "visible") bad.push(`${el.className || el.tagName}: ${oy}`);
            el = el.parentElement;
          }
        }
        if (pane.querySelectorAll(".dhunk-h").length === 0) bad.push("no-headers");
        return bad;
      });
      expect.soft(bad).toEqual([]);
    });

    await test.step("hunk headers pin while long lines wrap instead of scrolling sideways", async () => {
      // #274 soft-wrap: long code lines wrap, so no code table is wider than
      // the pane and there is nothing to scroll sideways.
      const overflow = await page.evaluate(() => {
        const pane = document.getElementById("right") as HTMLElement;
        return Math.max(
          0,
          ...[...pane.querySelectorAll(".dwrap")].map((w) => (w as HTMLElement).scrollWidth - (w as HTMLElement).clientWidth),
        );
      });
      expect.soft(overflow).toBeLessThanOrEqual(2);
      // The headers still pin: scroll the pane down to a hunk. The header is
      // outside the (now never-scrolled) sideways scroller.
      const s = await stack();
      await expectPinned(`[data-hunk="${CONN}:1"]`, s.hunkTop, "hunk", "Hunk 2 of");
      await expectStuck("hunk", "Hunk 2 of");
      // The pinned header still spans the pane width (not scrolled away).
      const span = await page.evaluate(() => {
        const pane = document.getElementById("right") as HTMLElement;
        const p = pane.getBoundingClientRect();
        const css = getComputedStyle(pane);
        const slot = p.top + (Number.parseFloat(css.getPropertyValue("--dhunk-top")) || 0);
        for (const el of pane.querySelectorAll(".dhunk-h")) {
          const b = el.getBoundingClientRect();
          if (Math.abs(b.top - slot) < 2.5) return { x: b.x, width: b.width, paneX: p.x, paneWidth: p.width };
        }
        return null;
      });
      expect.soft(span).not.toBeNull();
      expect.soft(Math.abs(span!.x - span!.paneX)).toBeLessThan(1.5);
      expect.soft(Math.abs(span!.width - span!.paneWidth)).toBeLessThan(1.5);
    });

    await test.step("hunk headers pin even if the code wrapper computes overflow-y:hidden", async () => {
      // Regression guard for the owner's report (#140): per the CSS Overflow
      // spec, `overflow-y: clip` beside `overflow-x: auto` computes to `hidden`,
      // which makes the wrapper a vertical scroll container and traps any sticky
      // header inside it. Some Chromium builds compute `hidden`; the headers
      // live outside the wrapper, so pinning must not depend on the outcome.
      await page.evaluate(() => {
        for (const w of document.querySelectorAll("#right .dwrap")) {
          (w as HTMLElement).style.overflowY = "hidden";
        }
      });
      const s = await stack();
      // Pin the tall first hunk: the last hunk's section is only ~240px,
      // so a fixed +120px scroll legitimately carries it past the slot
      // (sticky headers are constrained to their section) — flaky by
      // geometry, not by pinning. The tall hunk tolerates the scroll.
      await expectPinned(`[data-hunk="${CONN}:0"]`, s.hunkTop, "hunk", "Hunk 1 of");
      await expectStuck("hunk", "Hunk 1 of");
    });

    await test.step("code columns start at the same x in every hunk of a file", async () => {
      // Each hunk is its own table (#140), so the file shares one line-number
      // width (`--lnw`): 2-digit and 4-digit hunks must still line their code
      // columns up. Checked in unified and split.
      for (const view of ["unified", "split"] as const) {
        if (view === "split") {
          await page.getByRole("button", { name: "Split", exact: true }).click();
          await expect.soft(page.locator(`${connFile} table.diff.split`).first()).toBeVisible();
        }
        const xs = await page.evaluate((key) => {
          const file = document.getElementById(`F-${key}`) as HTMLElement;
          return [...file.querySelectorAll(".dhunk")].map((sec) =>
            Math.round(sec.querySelector("td.c")?.getBoundingClientRect().x ?? -1),
          );
        }, CONN);
        expect.soft(xs.length).toBeGreaterThan(1);
        expect.soft(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1.5);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Demo-backed diff: one replay service (j4/j13/j242/j353 demo reviews +
// the seeded j325 scores; the plotline rename + version stamp land in a
// single stop/start).
// ---------------------------------------------------------------------------

const J325_SCORES: Record<string, string> = {
  "src/urllib3/connection.py:0": "substantive",
  "src/urllib3/connection.py:1": "substantive",
  "test/test_connection.py:0": "mechanical",
  "test/test_connection.py:1": "mechanical",
  "test/test_connection.py:2": "routine",
  "test/with_dummyserver/test_socketlevel.py:0": "mechanical",
  "test/with_dummyserver/test_socketlevel.py:1": "substantive",
  "changelog/1362.bugfix.rst:0": "routine",
};

// j242's long-name rename target (issue #353's fixture, shared here).
const J353_LONG_NAME =
  "Add the `some_very_long_table_identifier_xyz` guard for the retry path with backoff and jitter";
const J353_STRIPPED_NAME =
  "Add the some_very_long_table_identifier_xyz guard for the retry path with backoff and jitter";
const J353_STRIPPED_DESC =
  "Watches the retry path end to end: the some_very_long_table_identifier_xyz guard trips on repeated failures, backs off with jitter, and reports through the shared retry_helper without touching unrelated hunks.";
const J353_LONG_DESC =
  "Watches the retry path end to end: the `some_very_long_table_identifier_xyz` guard trips on repeated failures, backs off with jitter, and reports through the shared retry_helper without touching unrelated hunks.";
const J353_SECOND_NAME = "Retry failed uploads with the `retry_helper` and exponential backoff";

test.describe("L6 demo diff work", () => {
  let dataDir = "";
  let homeDir = "";
  let svc: RunningService | null = null;
  let foldReview = "";
  let summaryReview = "";
  let plotReview = "";
  let namesReview = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-data-"));
    homeDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-home-"));
    createSeededDemoReview(dataDir, "j325-seed");
    // j325's deterministic hunk scores, written straight into the seeded
    // snapshot's hunk states (what the hunk pass would store).
    {
      const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
      try {
        const row = db.prepare("SELECT snapshot FROM review_snapshots WHERE review_id = ?").get("j325-seed") as { snapshot: string };
        const snap = JSON.parse(row.snapshot) as {
          files: { path: string; hunks: { contentHash: string }[] }[];
          hunkStates: { contentHash: string; score?: string }[];
        };
        const byHash = new Map(snap.hunkStates.map((s) => [s.contentHash, s]));
        for (const f of snap.files) {
          f.hunks.forEach((h, i) => {
            const score = J325_SCORES[`${f.path}:${i}`];
            const entry = byHash.get(h.contentHash) ?? { contentHash: h.contentHash };
            entry.score = score;
            byHash.set(h.contentHash, entry);
          });
        }
        snap.hunkStates = [...byHash.values()];
        db.prepare("UPDATE review_snapshots SET snapshot = ? WHERE review_id = ?").run(JSON.stringify(snap), "j325-seed");
        stampDataFormat(db);
      } finally {
        db.close();
      }
    }
    svc = await startService(dataDir, { agent: "replay", label: "l6demo" });
    foldReview = await createDemoReview(svc);
    summaryReview = await createDemoReview(svc);
    // j13's hunk summaries land asynchronously.
    {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const snap = await apiJson(svc, "GET", `/api/reviews/${summaryReview}`);
        const states = (snap.json as { hunkStates?: { summary?: string }[] }).hunkStates ?? [];
        if (states.filter((s) => s.summary).length >= 8) break;
        if (Date.now() > deadline) throw new Error("hunk summaries did not land");
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    plotReview = await createDemoReview(svc);
    namesReview = await createDemoReview(svc);
    // Let the replay pipeline settle before editing the stored snapshots
    // (same pattern as j242/j353): stopping with a render in flight
    // orphans temp dirs and fails the per-run temp guard (#24).
    for (const id of [plotReview, namesReview]) {
      const quietDeadline = Date.now() + 90_000;
      for (;;) {
        const jobsRes = await apiJson(svc, "GET", `/api/jobs?review=${id}`);
        const jobs = (jobsRes.json as { jobs: { state: string }[] }).jobs ?? [];
        if (jobs.length > 0 && jobs.every((j) => j.state === "done" || j.state === "error" || j.state === "cancelled")) break;
        if (Date.now() > quietDeadline) throw new Error("replay jobs never settled before the rename");
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    // One stop/start for both stored-snapshot edits: j242's older-version
    // stamp and j353's long-name rename.
    await svc.stop();
    {
      const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
      try {
        // j242 #343 read-only test: an older version with real plotlines.
        {
          const row = db
            .prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?")
            .get(plotReview) as { rev: number; snapshot: string };
          const snap = JSON.parse(row.snapshot) as { review: { currentVersion: number } };
          snap.review.currentVersion = 2;
          db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
            row.rev + 1,
            JSON.stringify(snap),
            plotReview,
          );
        }
        // j353: rename the demo plotline to a long identifier-heavy name,
        // plus a second plotline that builds on it, plus a Since marker.
        {
          const row = db
            .prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?")
            .get(namesReview) as { rev: number; snapshot: string };
          const snap = JSON.parse(row.snapshot) as {
            files: { fileKey: string; hunks: { contentHash: string }[] }[];
            plotlines: { id: string; name: string; description: string; buildsOn?: string }[];
            sinceBaseline?: unknown;
            sinceHunks?: unknown;
          };
          const first = snap.plotlines.find((p) => p.id === "obs-fold-unfolding") ?? snap.plotlines[0];
          if (!first) throw new Error("replay snapshot has no plotlines to rename");
          first.name = J353_LONG_NAME;
          first.description = J353_LONG_DESC;
          snap.plotlines.push({
            id: "retry-guard",
            name: J353_SECOND_NAME,
            description: "Proves the retry path backs off.",
            buildsOn: first.id,
          });
          const hunkIds: string[] = [];
          for (const f of snap.files ?? []) {
            for (const h of f.hunks ?? []) hunkIds.push(`h:${f.fileKey}:${h.contentHash}`);
          }
          snap.sinceBaseline = { kind: "version", version: 1 };
          snap.sinceHunks = { added: [], changed: hunkIds.slice(0, 2) };
          db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
            row.rev + 1,
            JSON.stringify(snap),
            namesReview,
          );
        }
        stampDataFormat(db);
      } finally {
        db.close();
      }
    }
    svc = await startService(dataDir, { agent: "replay", extraEnv: { HOME: homeDir }, label: "l6demo" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    for (const d of [dataDir, homeDir]) rmSync(d, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function openReview(page: Page, reviewId: string): Promise<void> {
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator(`[id="F-${CONN}"]`)).toBeVisible({ timeout: 60_000 });
  }

  test("fold, filters, reviewed, scores and plotlines filter", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    await openReview(page, foldReview);
    const connFileLoc = page.locator(`[id="F-${CONN}"]`);
    await test.step("hunk scores land; plotline filter keeps every file", async () => {
      // Hunk passes land asynchronously; wait until every hunk carries a score
      // (an unscored hunk matches any score filter, so filtering earlier lies).
      await expect
        .poll(
          async () => {
            const snap = await apiJson(s, "GET", `/api/reviews/${foldReview}`);
            const states = (snap.json as { hunkStates?: { score?: string }[] }).hunkStates ?? [];
            return states.filter((st) => st.score).length;
          },
          { timeout: 90_000 },
        )
        .toBe(8);
      await expect.soft(page.locator(".dhunk-h .score-dot").first()).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator('.dhunk-h .score-dot[data-score="substantive"]').first()).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator(".dhunk-h .ptag", { hasText: "Unfold obsolete folded response headers" }).first()).toBeVisible({ timeout: 30_000 });

      // Plotline filter: the re-recorded reader has one plotline covering
      // every hunk, so filtering by it keeps every file visible.
      await page.locator('[data-plotpick="obs-fold-unfolding"]').first().click();
      await expect.soft(page.locator('[data-filterchip="plotline"]')).toContainText("Plotline: Unfold obsolete folded response headers", { timeout: 15_000 });
      await expect.soft(connFileLoc).toBeVisible();
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toBeVisible({ timeout: 15_000 });
      await expect.soft(page.locator(`[id="F-${TSOCK}"]`)).toBeVisible({ timeout: 15_000 });
      await page.locator('[data-filterchip="plotline"] button').click();
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toBeVisible({ timeout: 15_000 });
    });

    await test.step("hide level hides routine; the file stays; old score filters are gone", async () => {
      // Hide level (#325): substantive hunks are the conn change (from the recordings).
      await page.getByRole("button", { name: /Hide level:/ }).click();
      await page.locator('[data-hidecat="routine"]').click();
      await expect.soft(page.locator('[data-hidelevel-current="substantive"]')).toBeVisible({ timeout: 15_000 });
      await expect.soft(connFileLoc).toBeVisible();
      await expect.soft(page.locator("[data-scorepick]")).toHaveCount(0);
      await page.getByRole("button", { name: /Hide level:/ }).click();
      await page.locator('[data-hidecat="mechanical"]').click();
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toBeVisible({ timeout: 15_000 });
    });

    await test.step("mark a file reviewed; it survives reload", async () => {
      await connFileLoc.getByRole("checkbox", { name: "Mark reviewed" }).first().click();
      await expect.soft(connFileLoc.getByRole("button", { name: "Show code" }).first()).toBeVisible({ timeout: 15_000 });
      await page.reload();
      await expect.soft(connFileLoc).toBeVisible({ timeout: 60_000 });
      await expect.soft(connFileLoc.getByRole("button", { name: "Show code" }).first()).toBeVisible({ timeout: 15_000 });
      // Unfold it again for the summary step.
      await connFileLoc.getByRole("button", { name: "Show code" }).first().click();

      // File list opens and names the files in the diff.
      const filterBtn = page.getByRole("button", { name: "Show file list" });
      if ((await filterBtn.count()) > 0) {
        await filterBtn.first().click();
        await expect.soft(page.locator(".flist")).toContainText("connection.py", { timeout: 15_000 });
      }
    });
  });

  test("filters combine; dotted-range Explain leaves no gutter marker (#190, #189, #285)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    await openReview(page, foldReview);
    const connFileLoc = page.locator(`[id="F-${CONN}"]`);

    await test.step("filters combine: file type AND plotline AND level (#190)", async () => {
      // Wait for the hunk pass so every hunk carries a score and plotline.
      await expect
        .poll(
          async () => {
            const snap = await apiJson(s, "GET", `/api/reviews/${foldReview}`);
            const states = (snap.json as { hunkStates?: { score?: string }[] }).hunkStates ?? [];
            return states.filter((st) => st.score).length;
          },
          { timeout: 90_000 },
        )
        .toBe(8);
      await expect.soft(page.locator('.dhunk-h .score-ind[data-score="substantive"]').first()).toBeVisible({ timeout: 30_000 });

      // File-type filter first: Tests off hides both test files.
      await page.getByRole("button", { name: "Show file list" }).click();
      await page.getByRole("button", { name: "File filters" }).click();
      const menu = page.getByRole("menu", { name: "File filters" });
      await menu.getByText("Tests", { exact: true }).click();
      await page.keyboard.press("Escape");
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
      await expect.soft(page.locator(`[id="F-${TSOCK}"]`)).toHaveCount(0);
      await expect.soft(connFileLoc).toBeVisible();

      // Plotline on top: the conn file stays, the test files stay hidden.
      await page.locator('[data-plotpick="obs-fold-unfolding"]').first().click();
      await expect.soft(page.locator('[data-filterchip="plotline"]')).toContainText("Plotline: Unfold obsolete folded response headers", { timeout: 15_000 });
      await expect.soft(connFileLoc).toBeVisible();
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
      await expect.soft(page.locator(`[id="F-${TSOCK}"]`)).toHaveCount(0);

      // Hide level on top of both (#325).
      await page.getByRole("button", { name: /Hide level:/ }).click();
      await page.locator('[data-hidecat="routine"]').click();
      await expect.soft(page.locator('[data-hidelevel-current="substantive"]')).toBeVisible({ timeout: 15_000 });
      await expect.soft(connFileLoc).toBeVisible();
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);

      // Clearing one filter leaves the others exactly as they were.
      await page.locator('[data-filterchip="plotline"] button').click();
      await expect.soft(page.locator('[data-hidelevel-current="substantive"]')).toBeVisible();
      await expect.soft(connFileLoc).toBeVisible();
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
      await page.getByRole("button", { name: /Hide level:/ }).click();
      await page.locator('[data-hidecat="mechanical"]').click();
      await expect.soft(connFileLoc).toBeVisible();
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);

      // Turning Tests back on brings the test files back.
      await page.getByRole("button", { name: "File filters" }).click();
      await page.getByRole("menu", { name: "File filters" }).getByText("Tests", { exact: true }).click();
      await page.keyboard.press("Escape");
      await expect.soft(page.locator(`[id="F-${TCONN}"]`)).toBeVisible({ timeout: 15_000 });
    });

    await test.step("multi-line Explain reopens from dotted range text, no gutter marker (#189/#285)", async () => {
      await page.setViewportSize({ width: 1280, height: 1000 });
      await openReview(page, foldReview);
      await page.getByRole("button", { name: "Unfold all" }).click({ timeout: 10_000 }).catch(() => {});

      const explainAndClose = async (): Promise<string> => {
        const beforeIds = ((await apiJson(s, "GET", `/api/reviews/${foldReview}`)).json as { annotations: { id: string }[] }).annotations.map((a) => a.id);
        await page.locator('#selbar [data-act="explain"]').click();
        let newId: string | null = null;
        {
          const deadline = Date.now() + 60_000;
          for (;;) {
            const res = await apiJson(s, "GET", `/api/reviews/${foldReview}`);
            const ids = ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
            newId = ids.find((id) => !beforeIds.includes(id)) ?? null;
            if (newId || Date.now() > deadline) break;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        if (!newId) throw new Error("new diff thread did not appear");
        const card = page.locator(`.dhunk section.ithread[data-thread="${newId}"]`).first();
        await expect.soft(card).toBeVisible({ timeout: 15_000 });
        await expect.soft(card.locator(".working")).toHaveCount(0, { timeout: 30_000 });
        await card.getByRole("button", { name: "Close" }).click();
        await expect.soft(page.locator(`.dhunk section.ithread[data-thread="${newId}"]`)).toBeHidden({ timeout: 10_000 });
        return newId;
      };

      // Across three rows inside one hunk.
      await selectDiffRows(page, CONN, 86, 88);
      const rangeId = await explainAndClose();
      // Issue #285: no gutter marker — every line of the range keeps its
      // dotted anchor text plus the tint, and clicking any dotted piece
      // reopens the card.
      const rangeMarks = page.locator(`#right mark.anc.exl[data-jump="${rangeId}"]`);
      await expect.soft(rangeMarks).toHaveCount(3, { timeout: 15_000 });
      await expect.soft(page.locator(`[id="L-${CONN}-87"]`)).toHaveClass(/rng/);
      // The gutter holds no marker: the first cell keeps its number.
      await expect.soft(page.locator(`[id="L-${CONN}-87"] td.n mark`)).toHaveCount(0);
      // The new numbers keep their comment affordance (hover swaps the
      // number for the icon; the tooltip names it).
      const tip = await page.locator(`[id="L-${CONN}-87"] td.n.new`).getAttribute("data-tip");
      expect.soft(tip).toMatch(/Comment on line 87|Show comment/);
      // A dotted piece reopens the card.
      await rangeMarks.first().click();
      await expect.soft(page.locator(".dhunk section.ithread[data-thread]").first()).toBeVisible({ timeout: 15_000 });
      await page.locator(".dhunk section.ithread[data-thread]").first().getByRole("button", { name: "Close" }).click();

      // Across a hunk boundary, over long lines: the selection runs to
      // several hundred characters, well past the old 300-char cap.
      // Every rendered row of the range reads dotted; clicking one
      // reopens the card.
      await selectDiffRows(page, CONN, 108, 650);
      const boundaryId = await explainAndClose();
      const boundaryMarks = page.locator(`#right mark.anc.exl[data-jump="${boundaryId}"]`);
      await expect.soft(boundaryMarks.first()).toBeVisible({ timeout: 15_000 });
      await expect.soft(page.locator(`[id="L-${CONN}-650"]`)).toHaveClass(/rng/);
      await boundaryMarks.first().click();
      await expect.soft(page.locator(".dhunk section.ithread[data-thread]").first()).toBeVisible({ timeout: 15_000 });
    });
  });

  test("hunk summaries activate, delete, restore and fold; Comment never activates (#13)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    await openReview(page, summaryReview);
    const connFileLoc = page.locator(`[id="F-${CONN}"]`);
    await page.locator('#right [role="tab"]').getByText("Diff").click().catch(() => {});

    await test.step("summary activates as a card, delete removes it, Summarize restores it, Fold all folds", async () => {
      const idle = connFileLoc.locator("p[data-hunksum]").first();
      await expect.soft(idle).toBeVisible({ timeout: 60_000 });
      const summariesBefore = await connFileLoc.locator("p[data-hunksum]").count();

      // Activate: clicking the idle summary opens it as a thread.
      await idle.click();
      const card = connFileLoc.locator(".dhunk [data-thread]").first();
      await expect.soft(card).toBeVisible({ timeout: 15_000 });
      await expect.soft(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 30_000 });
      const cardId = await card.getAttribute("data-thread");

      // Delete: thread and its summary are both gone (seeded suggestion
      // threads elsewhere in the file are untouched). #364: the
      // thread-level delete is still named "Delete thread" (distinct from
      // the per-reply "Delete reply").
      await card.getByRole("button", { name: "Delete thread" }).click();
      await expect.soft(connFileLoc.locator(`.dhunk section.ithread[data-thread="${cardId}"]`)).toHaveCount(0, { timeout: 15_000 });
      await expect.soft(connFileLoc.locator("p[data-hunksum]")).toHaveCount(summariesBefore - 1, { timeout: 15_000 });

      // Summarize on demand: the replay hunk pass writes it again as idle text.
      await connFileLoc.getByRole("button", { name: "Summarize" }).first().click();
      await expect.soft(connFileLoc.locator("p[data-hunksum]")).toHaveCount(summariesBefore, { timeout: 60_000 });

      // Fold all (diff toolbar): hunks fold behind their headers.
      await page.getByRole("button", { name: "Fold all", exact: true }).click();
      await expect.soft(connFileLoc.getByRole("button", { name: "Show code" }).first()).toBeVisible({ timeout: 15_000 });
    });

    await test.step("summary Comment never activates, Explain activates under the hunk, promoted hunk keeps its chip", async () => {
      // The previous test leaves hunks folded; expand the first folded
      // hunk so its summary is selectable (expanding more would remount
      // bodies under the selection and drop the toolbar).
      const folded = connFileLoc.getByRole("button", { name: "Show code" }).first();
      if (await folded.count()) {
        await folded.click();
      }
      await expect.soft(connFileLoc.locator("p[data-hunksum]").first()).toBeVisible({ timeout: 60_000 });
      const words = (h: string | null): string =>
        (h ?? "").trim().split(/\s+/).slice(0, 3).join(" ");

      // A Comment on a summary lands on the line and never activates the hunk.
      const threadsBefore = await connFileLoc.locator(".dhunk section.ithread[data-thread]").count();
      const idleText = words(await connFileLoc.locator("p[data-hunksum]").first().textContent());
      await selectText(page, "p[data-hunksum]", idleText);
      await page.locator('#selbar [data-act="note"]').click();
      await expect.soft(page.locator(".ithread[data-pending-thread]")).toBeVisible({ timeout: 15_000 });
      await expect.soft(connFileLoc.locator("p[data-hunksum]").first()).toBeVisible();
      await expect.soft(connFileLoc.locator(".dhunk section.ithread[data-thread]")).toHaveCount(threadsBefore);
      await page.keyboard.press("Escape");

      // Explain on a summary activates it into a thread under the hunk.
      const target = connFileLoc.locator("p[data-hunksum]").first();
      const summaryText = words(await target.textContent());
      await selectText(page, "p[data-hunksum]", summaryText);
      await page.locator('#selbar [data-act="explain"]').click();
      const thread = connFileLoc.locator(".dhunk section.ithread[data-thread]", { hasText: summaryText }).first();
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      // Let the answer fill so the pipeline is idle for the tests below.
      await expect.soft(thread.locator(".exp-b").first()).not.toBeEmpty({ timeout: 90_000 });

      // Promoting the hunk keeps its summary plus chip; Explain reopens the page.
      await thread.getByRole("button", { name: "Open as page" }).click();
      await expect.soft(page).toHaveURL(/\/review\/[\w-]+\/page\/p-/, { timeout: 30_000 });
      const pageUrl = page.url();
      await page.goBack();
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      await expect.soft(connFileLoc.locator("p[data-hunksum]", { hasText: summaryText }).first()).toBeVisible({
        timeout: 30_000,
      });
      const chip = connFileLoc.locator(".dhunk a.cx.pg").first();
      await expect.soft(chip).toBeVisible({ timeout: 15_000 });
      await selectText(page, "p[data-hunksum]", summaryText);
      await page.locator('#selbar [data-act="explain"]').click();
      await expect.soft(page).toHaveURL(pageUrl, { timeout: 30_000 });
    });
  });

  test("plotlines read as chips, filter, review and disable on old versions (#242, #324, #343)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");

    await test.step("plotlines read as chips, builds-on goes to the earlier plotline", async () => {
      await openReview(page, plotReview);
      const box = page.locator(".plotlines");
      await expect.soft(box).toBeVisible({ timeout: 15_000 });
      // One plotline covering every hunk (issue #341 re-record), so no
      // Other row and no builds-on.
      await expect.soft(box.locator(".plname", { hasText: "Unfold obsolete folded response headers" })).toBeVisible();
      // #242: no numbering; every row carries its hunk count as a chip
      // in the same trailing slot.
      await expect.soft(box.locator(".plorder")).toHaveCount(0);
      await expect.soft(box.locator(".ui-row .ui-badge", { hasText: /^\d+\/\d+$/ }).first()).toBeVisible();
      // #324: shares sum to the total and one stacked bar mirrors them.
      const shareText = await box.locator(".ui-row .ui-badge").allTextContents();
      const shares = shareText.filter((c) => /^\d+\/\d+$/.test(c.trim())).map((c) => c.trim().split("/").map(Number));
      expect.soft(shares.length).toBeGreaterThan(0);
      expect.soft(shares.reduce((n, [num]) => n + (num ?? 0), 0)).toBe(shares[0]?.[1]);
      await expect.soft(box.locator(".plshare-seg")).toHaveCount(shares.length);
      // No builds-on: the single plotline builds on nothing.
      await expect.soft(box.locator(".plbuilds")).toHaveCount(0);
      const chip = box.locator('[data-plotpick="obs-fold-unfolding"]');
      await expect.soft(chip).toBeVisible();

      // Titles show in full: nothing is ellipsized, long titles wrap.
      const truncated = await box.locator(".plname").evaluateAll((els) =>
        els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
      );
      expect.soft(truncated).toEqual([]);

      await checkLayout(page, "j242-plotlines");

      // The builds-on chip goes to the earlier plotline: the diff
      // filters to it and its first hunk scrolls into view.
      await chip.click();
      await expect.soft(page.locator('[data-filterchip="plotline"]')).toContainText("Plotline: Unfold obsolete folded response headers", {
        timeout: 15_000,
      });
      const inView = await page.evaluate(() => {
        const el = document.querySelector("[data-hunk]");
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.top < window.innerHeight;
      });
      expect.soft(inView).toBe(true);
      await checkLayout(page, "j242-plotlines-filtered");
    });

    await test.step("plotline reviewed checkbox checks, partials and unchecks the whole plotline (#343)", async () => {
      await openReview(page, plotReview);
      const box = page.locator(".plotlines");
      await expect.soft(box).toBeVisible({ timeout: 15_000 });
      const unfold = box.locator('[data-plotreviewed="obs-fold-unfolding"]');

      // The previous step leaves the diff filtered to a plotline; clear
      // it so the file headers below render every hunk.
      const pressed = box.locator('[data-plotpick][aria-pressed="true"]');
      if ((await pressed.count()) > 0) {
        await pressed.first().click();
        await expect.soft(box.locator('[data-plotpick][aria-pressed="true"]')).toHaveCount(0, { timeout: 15_000 });
      }

      type HS = { contentHash: string; reviewed: boolean; folded: boolean; plotline?: string };
      const snapshot = async (): Promise<{
        files: { hunks: { contentHash: string; hiddenReason?: string }[] }[];
        hunkStates: HS[];
      }> => (await apiJson(s, "GET", `/api/reviews/${plotReview}`)).json as never;
      const statesOf = async (plot: string): Promise<HS[]> =>
        (await snapshot()).hunkStates.filter((h) => (h.plotline ?? "other") === plot);

      // Initial state: the live demo starts fully unreviewed (the
      // fixture's mid-use reviewed hunk is mock-mode only), so the single
      // row starts unchecked.
      await expect.soft(unfold).toHaveAttribute("aria-label", "Mark plotline reviewed");
      await expect.soft(unfold).not.toBeChecked();
      expect.soft(await unfold.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(false);
      await expect.soft(page.getByRole("progressbar")).toHaveAttribute("aria-label", "0 of 8 hunks reviewed");

      // Checking the plotline reviews and folds all eight hunks.
      await unfold.click();
      await expect.soft(unfold).toBeChecked({ timeout: 15_000 });
      await expect.soft(unfold).toHaveAttribute("aria-label", "Mark plotline unreviewed");
      await expect
        .poll(async () => (await statesOf("obs-fold-unfolding")).filter((h) => h.reviewed && h.folded).length, {
          timeout: 30_000,
        })
        .toBe(8);
      // The diff's counts move with it: the file header and the progress bar.
      await expect.soft(page.locator('[id="F-src-urllib3-connection.py"] .revc')).toContainText("2/2", {
        timeout: 30_000,
      });
      await expect.soft(page.getByRole("progressbar")).toHaveAttribute("aria-label", "8 of 8 hunks reviewed");

      // Unmarking one hunk by hand drops the row back to partial.
      const oneHash = (await statesOf("obs-fold-unfolding"))[0]!.contentHash;
      await apiJson(s, "PATCH", `/api/reviews/${plotReview}/hunks/${oneHash}`, { reviewed: false, folded: false });
      await expect.soft(unfold).not.toBeChecked({ timeout: 15_000 });
      // The partial flag is set in a post-paint effect, so poll for it.
      await expect
        .poll(async () => unfold.evaluate((el) => (el as HTMLInputElement).indeterminate), {
          timeout: 15_000,
        })
        .toBe(true);
      await expect.soft(unfold).toHaveAttribute("aria-label", "Mark plotline reviewed");
      await expect.soft(page.getByRole("progressbar")).toHaveAttribute("aria-label", "7 of 8 hunks reviewed");

      // Clicking the partial row completes the marking instead, like the
      // diff's per-file box.
      await unfold.click();
      await expect.soft(unfold).toBeChecked({ timeout: 15_000 });
      await expect.soft(page.getByRole("progressbar")).toHaveAttribute("aria-label", "8 of 8 hunks reviewed");

      // Unchecking the fully-checked row reverts both reviewed and
      // folded on every hunk.
      await unfold.click();
      await expect.soft(unfold).not.toBeChecked({ timeout: 15_000 });
      await expect
        .poll(async () => (await statesOf("obs-fold-unfolding")).filter((h) => !h.reviewed && !h.folded).length, {
          timeout: 30_000,
        })
        .toBe(8);
      await expect.soft(unfold).toHaveAttribute("aria-label", "Mark plotline reviewed");
      await expect.soft(page.getByRole("progressbar")).toHaveAttribute("aria-label", "0 of 8 hunks reviewed");

      await checkLayout(page, "j242-plotlines-reviewed");
    });

    await test.step("plotline reviewed checkboxes disable on older versions (#343)", async () => {
      await page.goto(`${s.origin}/review/${plotReview}?token=${s.token}&version=1`);
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      const box = page.locator(".plotlines");
      await expect.soft(box).toBeVisible({ timeout: 15_000 });
      for (const id of ["obs-fold-unfolding"]) {
        const control = box.locator(`[data-plotreviewed="${id}"]`);
        await expect.soft(control).toBeDisabled();
        await expect.soft(control).toHaveAttribute("aria-label", "Viewing an older version · read-only");
      }
    });
  });

  test("long plotline names store whole and clamp on screen; hunk chips carry scores (#353, #184)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");

    await test.step("long names store whole and clamp on screen with full-name tooltips", async () => {
      expect.soft(J353_LONG_NAME.length).toBeGreaterThan(60);
      expect.soft(J353_LONG_NAME.length).toBeLessThanOrEqual(120);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openReview(page, namesReview);
      const box = page.locator(".plotlines");
      await expect.soft(box).toBeVisible({ timeout: 15_000 });

      // Stored whole: the row shows the full name, not a cut prefix.
      // Backticks render as code; tooltips and chips read plain text.
      const nameEl = box.locator(".plname").first();
      await expect.soft(nameEl).toHaveText(J353_STRIPPED_NAME);
      await expect.soft(nameEl).toHaveAttribute("data-tip", J353_STRIPPED_NAME);
      await expect.soft(nameEl.locator("code")).toHaveText("some_very_long_table_identifier_xyz");
      await expect.soft(box.locator("[data-plotpick]").first()).toHaveAttribute(
        "data-tip",
        `Show only ${J353_STRIPPED_NAME}`,
      );

      // The name and description rows clamp to two lines (the rule),
      // while the data stays whole.
      expect.soft(await nameEl.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("2");
      const descEl = box.locator(".pldesc").first();
      await expect.soft(descEl).toHaveText(J353_STRIPPED_DESC);
      await expect.soft(descEl).toHaveAttribute("data-tip", J353_STRIPPED_DESC);
      await expect.soft(descEl.locator("code").first()).toHaveText("some_very_long_table_identifier_xyz");
      expect.soft(await descEl.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("2");

      // The tooltips show the full plain text.
      const tip = page.locator("#tip");
      await nameEl.hover();
      await expect.soft(tip).toBeVisible({ timeout: 5_000 });
      await expect.soft(tip).toHaveText(J353_STRIPPED_NAME);
      await descEl.hover();
      await expect.soft(tip).toHaveText(J353_STRIPPED_DESC);

      // The second row builds on the first: its chip names the long
      // name in plain text via its tooltip.
      const buildsOn = box.locator("[data-buildson]").first();
      await expect.soft(buildsOn).toHaveAttribute("data-tip", `Show only ${J353_STRIPPED_NAME}`);
      await expect.soft(buildsOn.locator(".ui-badge")).toHaveText(J353_STRIPPED_NAME);

      // The Since marker counts the two fabricated changed hunks. (Badge
      // drops extra props, so there is no data hook — assert the text in
      // the first row instead.)
      await expect.soft(box.locator("li").first().getByText("+2 since v1")).toBeVisible();

      // Hunk header chips carry the full plain name in text and tooltip,
      // and ellipsize on one line instead of wrapping the header.
      const chip = page.locator(".dhunk-h .ptag").first();
      await expect.soft(chip).toHaveText(J353_STRIPPED_NAME);
      await expect.soft(chip).toHaveAttribute("title", J353_STRIPPED_NAME);
      await expect.soft(chip).toHaveAttribute("data-tip", `Show only ${J353_STRIPPED_NAME}`);
      expect.soft(await chip.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(true);

      await checkLayout(page, "j353-plotlines");

      // Filtering to the plotline shows its full name in the filter chip.
      await box.locator("[data-plotpick]").first().click();
      const fchip = page.locator('[data-filterchip="plotline"]');
      await expect.soft(fchip).toBeVisible({ timeout: 15_000 });
      await expect.soft(fchip.locator(".fchip-name")).toContainText(`Plotline: ${J353_STRIPPED_NAME}`);
      await expect.soft(fchip.locator(".fchip-name")).toHaveAttribute("title", J353_STRIPPED_NAME);

      // Narrow: the two-line clamps visibly engage on the card rows, the
      // filter chip ellipsizes on one line keeping its clear button, and
      // the builds-on chip stays inside the row.
      await page.setViewportSize({ width: 960, height: 900 });
      await expect.soft(box).toBeVisible();
      expect.soft(await nameEl.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
      expect.soft(await descEl.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
      expect.soft(await fchip.locator(".fchip-name").evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(true);
      const buildsBadge = buildsOn.locator(".ui-badge");
      expect.soft(await buildsBadge.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(true);
      expect.soft(
        await buildsBadge.evaluate((el) => {
          const chip = el.getBoundingClientRect();
          const card = el.closest(".plotlines")?.getBoundingClientRect();
          return !!card && chip.right <= card.right + 1;
        }),
      ).toBe(true);
    });

    await test.step("hunk headers carry score dots; Files list has no dots or legend (#184)", async () => {
      await openReview(page, namesReview);
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      await expect.soft(page.locator(".dhunk-h .score-dot").first()).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Show file list" }).click();
      await expect.soft(page.locator(".flist .score-dot")).toHaveCount(0);
      await expect.soft(page.locator(".legend")).toHaveCount(0);
      // The level lives on the hunk dot's tooltip; the dot is an
      // indicator, not a filter button.
      const dot = page.locator('.dhunk-h .score-ind[data-score="substantive"]').first();
      await expect.soft(dot).toHaveAttribute("data-tip", "Substantive");
      await expect.soft(page.locator("[data-scorepick]")).toHaveCount(0);
    });
  });

  test("hide levels hide, persist, expand transiently and reveal on cite (#325, #342)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${s.origin}/review/j325-seed?token=${s.token}`);
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator(`[id="F-${CONN}"]`)).toBeVisible({ timeout: 30_000 });

    /** Click one category row; the stored level lands on `expected`. */
    const clickCategory = async (category: string, expected: string): Promise<void> => {
      await page.getByRole("button", { name: /Hide level:/ }).click();
      await page.locator(`[data-hidecat="${category}"]`).click();
      await expect(page.locator(`[data-hidelevel-current="${expected}"]`)).toBeVisible();
    };

    /** Issue #342: a collapsed row carries only the range, one score dot
     * and the summary — no size, no score words, no "hidden" — with the
     * collapsed state in the accessible name and `aria-expanded`. */
    const expectCollapsedRow = async (index: number): Promise<void> => {
      const row = page.locator("button.hid").nth(index);
      await expect.soft(row).toBeVisible();
      await expect.soft(row).toHaveAttribute("aria-expanded", "false");
      const accessible = (await row.getAttribute("aria-label")) ?? "";
      expect.soft(accessible).toMatch(/collapsed/);
      expect.soft(accessible).not.toMatch(/hidden/i);
      const label = ((await row.locator(".hidl").textContent()) ?? "").trim();
      expect.soft(label).toMatch(/^Hunks? \d+(–\d+)?$/);
      const text = (await row.textContent()) ?? "";
      expect.soft(text).not.toMatch(/hidden/i);
      expect.soft(text).not.toMatch(/\+\d+\s*−\d+/);
      expect.soft(text).not.toMatch(/mechanical|routine|substantive|needs attention/i);
      expect.soft(((await row.locator(".hidb").textContent()) ?? "").trim().length).toBeGreaterThan(0);
      await expect.soft(row.locator(".score-dot")).toHaveCount(1);
    };

    await test.step("levels, tooltip and the #342 collapsed-row shape", async () => {
      // Default: Hide uninteresting, with the live breakdown tooltip.
      const selector = page.getByRole("button", { name: /Hide level:/ });
      await expect.soft(page.locator('[data-hidelevel-current="uninteresting"]')).toBeVisible();
      await expect.soft(selector).toHaveAttribute("data-tip", "Hiding 3 of 8 hunks: 3 uninteresting");
      await revealAll(page);
      await expect.soft(page.locator("button.hid")).toHaveCount(2);
      await expect.soft(page.locator("[data-scorepick]")).toHaveCount(0);
      await expect.soft(page.locator('.dhunk-h .score-ind[data-score="substantive"]').first()).toBeVisible();

      // Issue #342: both collapsed rows keep only the range, one score
      // dot and the summary — no size, no score words, no "hidden".
      await expectCollapsedRow(0);
      await expectCollapsedRow(1);
    });

    await test.step("reload keeps the level but not the transient expansion", async () => {
      await page.locator("button.hid").first().click();
      await expect.soft(page.locator(`[data-hunk="test-test_connection.py:0"]`)).toBeVisible();
      await page.reload();
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      await expect.soft(page.locator('[data-hidelevel-current="uninteresting"]')).toBeVisible({ timeout: 30_000 });
      await revealAll(page);
      await expect.soft(page.locator("button.hid")).toHaveCount(2);
      await expect.soft(page.locator(`[data-hunk="test-test_connection.py:0"]`)).toHaveCount(0);
    });

    await test.step("thresholds move one level at a time and persist", async () => {
      const selector = page.getByRole("button", { name: /Hide level:/ });
      // The menu is the category list: only Uninteresting starts hidden
      // (greyed, eye-off); clicking the shown Routine row hides it and
      // everything above it, landing on the substantive threshold.
      await page.getByRole("button", { name: /Hide level:/ }).click();
      const menu = page.getByRole("menu", { name: "Hunk categories" });
      await expect.soft(menu.getByRole("menuitemcheckbox")).toHaveCount(5);
      await expect.soft(page.locator('[data-hidecat="uninteresting"]')).toHaveAttribute("data-hidden", "true");
      await expect.soft(page.locator('[data-hidecat="uninteresting"]')).toHaveAttribute("aria-checked", "false");
      await expect.soft(page.locator('[data-hidecat="uninteresting"] .cnt')).toHaveText("3");
      await expect.soft(page.locator('[data-hidecat="routine"]')).toHaveAttribute("data-hidden", "false");
      await page.locator('[data-hidecat="routine"]').click();
      await expect.soft(page.locator('[data-hidelevel-current="substantive"]')).toBeVisible();
      await expect.soft(selector).toHaveAttribute("data-tip", /^Hiding 5 of 8 hunks:/);
      await revealAll(page);
      await expect.soft(page.locator("button.hid")).toHaveCount(3);
      const snap = await apiJson(s, "GET", `/api/reviews/j325-seed`);
      expect.soft((snap.json as { viewPrefs: { hideLevel?: string } }).viewPrefs.hideLevel).toBe("substantive");

      // Persistence across reload.
      await page.reload();
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      await expect.soft(page.locator('[data-hidelevel-current="substantive"]')).toBeVisible({ timeout: 30_000 });
      await revealAll(page);
      await expect.soft(page.locator("button.hid")).toHaveCount(3);
    });

    await test.step("expansion is transient; a level change re-collapses; citations still reveal", async () => {
      const selector = page.getByRole("button", { name: /Hide level:/ });
      // Expanding a hidden row shows it now ...
      await page.locator(`[id="F-${TSOCK}"] button.hid`).first().click();
      await expect.soft(page.locator(`[data-hunk="${TSOCK}:0"]`)).toBeVisible();
      // ... but the next level change fully re-applies the level, so the
      // run collapses again instead of staying visible. Guide-cited hunks
      // hide like any other (owner decision, #325): the cited connection
      // hunk hides too, and the tooltip drops both "kept" clauses.
      await clickCategory("substantive", "needs-attention");
      await expect.soft(page.locator(`[data-hunk="${TSOCK}:0"]`)).toHaveCount(0);
      await expect.soft(page.locator(`[data-hunk="${CONN}:0"]`)).toHaveCount(0);
      await expect.soft(selector).not.toHaveAttribute("data-tip", /kept because/);
      await expect.soft(selector).toContainText("Hiding 8");
      await expect.soft(selector).toHaveAttribute("data-eye", "off");

      // Clicking a citation to a hidden hunk still reveals it temporarily.
      await page.locator('.lk[data-refs="diff:src-urllib3-connection.py:80-88"]').first().click();
      await expect.soft(page.locator(`[data-hunk="${CONN}:0"]`)).toBeVisible({ timeout: 15_000 });

      // Clicking the most important hidden row (Substantive) shows it
      // again: the threshold moves down by one.
      await clickCategory("substantive", "substantive");
    });

    await test.step("keyboard: ArrowDown opens, Home jumps, Enter picks All", async () => {
      // Keyboard: open with ArrowDown, Home to the first row, Enter shows
      // Uninteresting and everything above nothing — the all level.
      const selector = page.getByRole("button", { name: /Hide level:/ });
      await selector.focus();
      await page.keyboard.press("ArrowDown");
      await expect.soft(page.getByRole("menu", { name: "Hunk categories" })).toBeVisible();
      await expect.soft(page.getByRole("menuitemcheckbox", { name: /Uninteresting/ })).toBeVisible();
      await page.keyboard.press("Home");
      await page.keyboard.press("Enter");
      await expect.soft(page.locator('[data-hidelevel-current="all"]')).toBeVisible();
      await expect.soft(page.locator("button.hid")).toHaveCount(0);
      await expect.soft(selector).toContainText("All shown");
      // Nothing hidden: the button shows an open eye, not eye-off.
      await expect.soft(selector).toHaveAttribute("data-eye", "open");
    });
  });
});

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

// ---------------------------------------------------------------------------
// Scratch-backed diff: one agent:none service (gap, gap+eof, mid, hidden,
// long-path and 28-file repos; per-test reviews so nothing is shared).
// ---------------------------------------------------------------------------

test.describe("L6 scratch diff work", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  // j265 shape: one two-hunk file over a real ~50-line gap.
  let repoGap = "";
  let gapReview = "";
  let gap1End = 0;
  let gap2Start = 0;
  // j285 shape: gap repo + a whole-file new file ending at EOF.
  let repoEof = "";
  let eofReview = "";
  // j288 shape: bottom.py (last hunk ends mid-file) + eof.py (ends at EOF).
  let repoBottom = "";
  let bottomReview = "";
  let bottomEnd = 0;
  let eof1Start = 0;
  let eof1End = 0;
  let eof2Start = 0;
  let eofGapStart = 0;
  let eofGapEnd = 0;
  // j308 shape: 220-line mid file + first-line + EOF files.
  let repoMid = "";
  let midReview = "";
  let mid1End = 0;
  let mid2Start = 0;
  let mid2End = 0;
  let mid3Start = 0;
  // j283 shape: docs-only first file + mixed imports/code file.
  let repoHidden = "";
  let hiddenReview = "";
  // j227 shape: top + two very long paths.
  let repoLong = "";
  let longReview = "";
  // j19 shape: 28 changed files.
  let repoMany = "";
  let manyReview = "";

  const J227_LONG_DIR =
    "packages/very-long-component-directory-name/and-another-long-directory-level/with-a-deeply-nested-module/and-one-more-long-directory-level";
  const J227_LONG_FILE = `${J227_LONG_DIR}/a_very_long_file_name_for_the_component_under_review_with_extra_words.py`;
  const J227_LONG_FILE_2 = `${J227_LONG_DIR}/another_long_file_name_for_a_helper_module_with_extra_words.py`;
  const J283_DOCS_SUMMARY =
    "Rewords the four onboarding notes for the new checkout flow, keeping every " +
    "heading and the step order exactly as documented so downstream links hold.";
  const J283_IMPORTS_SUMMARY =
    "Swaps the two stdlib imports the helper module needs for the new value " +
    "formatting path, leaving every call site untouched and sorted in place.";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-scratch-"));
    svc = await startService(dataDir, { agent: "none", label: "l6scratch" });

    // j265 + j285 gap repos.
    repoGap = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-gap-"));
    await makeGapRepo(repoGap);
    repoEof = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-eof-"));
    await makeGapRepo(repoEof);
    await makeEofFile(repoEof);
    repoBottom = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-bottom-"));
    {
      mkdirSync(path.join(repoBottom, "src"), { recursive: true });
      await git(repoBottom, "init", "-b", "main");
      await git(repoBottom, "config", "user.email", "t@example.com");
      await git(repoBottom, "config", "user.name", "T");
      const bottomBase = Array.from({ length: 80 }, (_, i) => `value_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
      writeFileSync(path.join(repoBottom, "src", "bottom.py"), `${bottomBase.join("\n")}\n`);
      const eofBase = Array.from({ length: 20 }, (_, i) => `item_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
      writeFileSync(path.join(repoBottom, "src", "eof.py"), `${eofBase.join("\n")}\n`);
      await git(repoBottom, "add", ".");
      await git(repoBottom, "commit", "-m", "base");
      await git(repoBottom, "checkout", "-b", "feature");
      const bottomFeat = [...bottomBase];
      bottomFeat[9] = "value_10 = 1000  # changed";
      bottomFeat[49] = "value_50 = 5000  # changed";
      writeFileSync(path.join(repoBottom, "src", "bottom.py"), `${bottomFeat.join("\n")}\n`);
      const eofFeat = [...eofBase];
      eofFeat[19] = "item_20 = 9999  # changed";
      writeFileSync(path.join(repoBottom, "src", "eof.py"), `${eofFeat.join("\n")}\n`);
      await git(repoBottom, "add", ".");
      await git(repoBottom, "commit", "-m", "feature work");
    }

    // j308 mid/first/last repo.
    repoMid = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-mid-"));
    {
      mkdirSync(path.join(repoMid, "src"), { recursive: true });
      await git(repoMid, "init", "-b", "main");
      await git(repoMid, "config", "user.email", "t@example.com");
      await git(repoMid, "config", "user.name", "T");
      const midBase = Array.from({ length: 220 }, (_, i) => `mid_${String(i + 1).padStart(3, "0")} = ${i + 1}`);
      writeFileSync(path.join(repoMid, "src", "mid.py"), `${midBase.join("\n")}\n`);
      const firstBase = Array.from({ length: 60 }, (_, i) => `first_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
      writeFileSync(path.join(repoMid, "src", "first.py"), `${firstBase.join("\n")}\n`);
      const lastBase = Array.from({ length: 60 }, (_, i) => `last_${String(i + 1).padStart(2, "0")} = ${i + 1}`);
      writeFileSync(path.join(repoMid, "src", "last.py"), `${lastBase.join("\n")}\n`);
      await git(repoMid, "add", ".");
      await git(repoMid, "commit", "-m", "base");
      await git(repoMid, "checkout", "-b", "feature");
      const midFeat = [...midBase];
      midFeat[9] = "mid_010 = 1000  # changed";
      midFeat[109] = "mid_110 = 11000  # changed";
      midFeat[199] = "mid_200 = 20000  # changed";
      writeFileSync(path.join(repoMid, "src", "mid.py"), `${midFeat.join("\n")}\n`);
      const firstFeat = [...firstBase];
      firstFeat[0] = "first_01 = 1000  # changed";
      firstFeat[49] = "first_50 = 5000  # changed";
      writeFileSync(path.join(repoMid, "src", "first.py"), `${firstFeat.join("\n")}\n`);
      const lastFeat = [...lastBase];
      lastFeat[9] = "last_10 = 1000  # changed";
      lastFeat[59] = "last_60 = 6000  # changed";
      writeFileSync(path.join(repoMid, "src", "last.py"), `${lastFeat.join("\n")}\n`);
      await git(repoMid, "add", ".");
      await git(repoMid, "commit", "-m", "feature work");
    }

    // j283 docs + mixed repo.
    repoHidden = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-hidden-"));
    {
      mkdirSync(path.join(repoHidden, "a-docs"), { recursive: true });
      mkdirSync(path.join(repoHidden, "src"), { recursive: true });
      await git(repoHidden, "init", "-b", "main");
      await git(repoHidden, "config", "user.email", "t@example.com");
      await git(repoHidden, "config", "user.name", "T");
      writeFileSync(
        path.join(repoHidden, "a-docs", "notes.md"),
        ["# Notes", "", "Alpha line one.", "Alpha line two.", "Alpha line three.", "Alpha line four.", ""].join("\n"),
      );
      const codeBase = [
        "import os",
        "import re",
        ...Array.from({ length: 78 }, (_, i) => `value_${String(i + 1).padStart(2, "0")} = ${i + 1}`),
        `tail_marker = "end"`,
      ].join("\n") + "\n";
      writeFileSync(path.join(repoHidden, "src", "app.py"), codeBase);
      await git(repoHidden, "add", ".");
      await git(repoHidden, "commit", "-m", "base");
      await git(repoHidden, "checkout", "-b", "feature");
      writeFileSync(
        path.join(repoHidden, "a-docs", "notes.md"),
        ["# Notes", "", "Beta line one revised.", "Beta line two revised.", "Beta line three revised.", "Beta line four revised.", ""].join("\n"),
      );
      const codeLines = codeBase.split("\n");
      codeLines[0] = "import sys";
      codeLines[1] = "import json";
      codeLines[70] = "value_69 = 6900  # changed";
      writeFileSync(path.join(repoHidden, "src", "app.py"), codeLines.join("\n"));
      await git(repoHidden, "add", ".");
      await git(repoHidden, "commit", "-m", "feature work");
    }

    // j227 long-path repo.
    repoLong = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-long-"));
    {
      const write = async (rel: string, text: string): Promise<void> => {
        mkdirSync(path.join(repoLong, path.dirname(rel)), { recursive: true });
        writeFileSync(path.join(repoLong, rel), text);
      };
      await git(repoLong, "init", "-b", "main");
      await git(repoLong, "config", "user.email", "t@example.com");
      await git(repoLong, "config", "user.name", "T");
      await write("top.py", "VALUE = 1\n");
      await write(J227_LONG_FILE, "def a():\n    return 1\n");
      await write(J227_LONG_FILE_2, "def b():\n    return 2\n");
      await git(repoLong, "add", ".");
      await git(repoLong, "commit", "-m", "base");
      await git(repoLong, "checkout", "-b", "feature");
      await write("top.py", "VALUE = 1\nEXTRA = 2\n");
      await write(
        J227_LONG_FILE,
        ["def a():", "    return 10", ...Array.from({ length: 14 }, (_, i) => `ADDED_${i} = ${i}`), ""].join("\n"),
      );
      await write(J227_LONG_FILE_2, "def b():\n    return 22\n    \n");
      await git(repoLong, "add", ".");
      await git(repoLong, "commit", "-m", "feature work");
    }

    // j19 28-file repo.
    repoMany = mkdtempSync(path.join(os.tmpdir(), "unvibe-l6-many-"));
    {
      mkdirSync(path.join(repoMany, "src"), { recursive: true });
      await git(repoMany, "init", "-b", "main");
      await git(repoMany, "config", "user.email", "t@example.com");
      await git(repoMany, "config", "user.name", "T");
      for (let i = 0; i < 28; i++) {
        const lines = Array.from({ length: 12 }, (_, l) => `value_${i}_${l} = ${l}`).join("\n") + "\n";
        writeFileSync(path.join(repoMany, "src", `mod${String(i).padStart(2, "0")}.py`), lines);
      }
      await git(repoMany, "add", ".");
      await git(repoMany, "commit", "-m", "base");
      await git(repoMany, "checkout", "-b", "feature");
      for (let i = 0; i < 28; i++) {
        const lines = Array.from({ length: 12 }, (_, l) => `value_${i}_${l} = ${l + 100}`).join("\n") + "\n";
        writeFileSync(path.join(repoMany, "src", `mod${String(i).padStart(2, "0")}.py`), lines);
      }
      await git(repoMany, "add", ".");
      await git(repoMany, "commit", "-m", "change all");
    }

    gapReview = await createScratchReview(svc, repoGap);
    eofReview = await createScratchReview(svc, repoEof);
    bottomReview = await createScratchReview(svc, repoBottom);
    midReview = await createScratchReview(svc, repoMid);
    hiddenReview = await createScratchReview(svc, repoHidden);
    longReview = await createScratchReview(svc, repoLong);
    manyReview = await createScratchReview(svc, repoMany);

    // Wait for the gap + eof shapes; record the hunk edges the steps assert.
    {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const snap = await apiJson(svc, "GET", `/api/reviews/${gapReview}`);
        const file = (snap.json as { files: { path: string; hunks: { newStart: number; newEnd: number }[] }[] }).files?.find(
          (f) => f.path === "src/big.py",
        );
        if (file && file.hunks.length === 2) {
          gap1End = file.hunks[0].newEnd;
          gap2Start = file.hunks[1].newStart;
          break;
        }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (gap2Start - gap1End - 1 < 40) throw new Error(`gap too small: ${gap1End + 1}-${gap2Start - 1}`);
    }
    {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const snap = await apiJson(svc, "GET", `/api/reviews/${eofReview}`);
        const files = (snap.json as { files: { path: string; hunks: { newStart: number; newEnd: number }[] }[] }).files ?? [];
        const big = files.find((f) => f.path === "src/big.py");
        const eof = files.find((f) => f.path === "src/eof.py");
        if (big && big.hunks.length === 2 && eof && eof.hunks.length === 1) {
          eof1Start = big.hunks[0].newStart;
          eof1End = big.hunks[0].newEnd;
          eof2Start = big.hunks[1].newStart;
          eofGapStart = eof1End + 1;
          eofGapEnd = eof2Start - 1;
          break;
        }
        if (Date.now() > deadline) throw new Error(`ingest did not produce the gap+eof shape`);
        await new Promise((r) => setTimeout(r, 500));
      }
      if (eofGapEnd - eofGapStart + 1 < 40) throw new Error("gap too small for step asserts");
    }
    // j288 bottom+eof shape.
    {
      const deadline = Date.now() + 90_000;
      let bottom: { newStart: number; newEnd: number }[] | undefined;
      let eof: { newStart: number; newEnd: number }[] | undefined;
      for (;;) {
        const snap = await apiJson(svc, "GET", `/api/reviews/${bottomReview}`);
        const files = (snap.json as { files: { path: string; hunks: { newStart: number; newEnd: number }[] }[] }).files ?? [];
        bottom = files.find((f) => f.path === "src/bottom.py")?.hunks;
        eof = files.find((f) => f.path === "src/eof.py")?.hunks;
        if (bottom && bottom.length === 2 && eof && eof.length === 1) break;
        if (Date.now() > deadline) throw new Error(`ingest did not produce the bottom+eof shape: ${JSON.stringify(files.map((f) => ({ p: f.path, n: f.hunks.length })))}`);
        await new Promise((r) => setTimeout(r, 500));
      }
      bottomEnd = bottom![1].newEnd;
      if (bottomEnd + 20 > 80) throw new Error(`bottom hunk ends too late for a 20-line step: ${bottomEnd}`);
    }
    // j308 mid shape.
    {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const snap = await apiJson(svc, "GET", `/api/reviews/${midReview}`);
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
        if (Date.now() > deadline) throw new Error("ingest did not produce the j308 shape");
        await new Promise((r) => setTimeout(r, 500));
      }
      if (mid2Start - mid1End - 1 < 61) throw new Error("upper gap too small for three 20-line steps");
      if (mid3Start - mid2End - 1 < 61) throw new Error("lower gap too small for three 20-line steps");
    }
    // j283 hidden shape + long summaries PATCHed onto the hidden hunks.
    {
      const deadline = Date.now() + 90_000;
      let hashes: { docs: string; imports: string } | null = null;
      for (;;) {
        const snap = await apiJson(svc, "GET", `/api/reviews/${hiddenReview}`);
        const files = (snap.json as { files: { path: string; hunks: { contentHash: string; hiddenReason?: string }[] }[] }).files ?? [];
        const docs = files.find((f) => f.path === "a-docs/notes.md")?.hunks[0];
        const mixed = files.find((f) => f.path === "src/app.py")?.hunks ?? [];
        if (docs?.hiddenReason && mixed.length === 2 && mixed[0].hiddenReason && !mixed[1].hiddenReason) {
          hashes = { docs: docs.contentHash, imports: mixed[0].contentHash };
          break;
        }
        if (Date.now() > deadline) throw new Error("ingest did not produce the hidden shape");
        await new Promise((r) => setTimeout(r, 500));
      }
      await apiJson(svc, "PATCH", `/api/reviews/${hiddenReview}/hunks/${hashes.docs}`, { summary: J283_DOCS_SUMMARY });
      await apiJson(svc, "PATCH", `/api/reviews/${hiddenReview}/hunks/${hashes.imports}`, { summary: J283_IMPORTS_SUMMARY });
      const echoDeadline = Date.now() + 30_000;
      for (;;) {
        const snap = await apiJson(svc, "GET", `/api/reviews/${hiddenReview}`);
        const states = (snap.json as { hunkStates: { contentHash: string; summary?: string }[] }).hunkStates ?? [];
        const got = new Set(states.filter((s) => s.summary).map((s) => s.contentHash));
        if (got.has(hashes.docs) && got.has(hashes.imports)) break;
        if (Date.now() > echoDeadline) throw new Error("summaries did not land");
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    // j227 ingest ready.
    {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const snap = await apiJson(svc, "GET", `/api/reviews/${longReview}`);
        const st = (snap.json as { ingest?: { status?: string } }).ingest?.status ?? "ready";
        if (st === "ready") break;
        if (Date.now() > deadline) throw new Error("ingest not ready");
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    for (const d of [repoGap, repoEof, repoBottom, repoMid, repoHidden, repoLong, repoMany, dataDir]) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function openReview(page: Page, reviewId: string): Promise<void> {
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
  }

  /** Row ids/classes of a hunk section's table, in order. */
  async function rowIds(dhunk: Locator): Promise<string[]> {
    return dhunk.locator("table.diff tbody tr").evaluateAll((rows) =>
      rows.map((r) => {
        const el = r as HTMLElement;
        return el.id !== "" ? el.id : el.className;
      }),
    );
  }

  test("expand up lands in the clicked hunk; show-all fills the gap once (#265)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    const bigKey = fileKeyForPath("src/big.py");
    const gapStart = gap1End + 1;
    const gapEnd = gap2Start - 1;

    await test.step("expand up reveals the tail above the clicked hunk", async () => {
      await openReview(page, gapReview);
      const bigFile = page.locator(`[id="F-${bigKey}"]`);
      await expect.soft(bigFile).toBeVisible({ timeout: 60_000 });
      await expect.soft(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
      const dhunks = bigFile.locator(".dhunk");
      const second = dhunks.nth(1);
      // The second hunk's own step-up (^): one 20-line step of the gap.
      await clickRowControl(second, "Show 20 more lines", 0);
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
      // Nothing leaks into the previous hunk's section.
      await expect.soft(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
      // The tail sits in this hunk's section, directly above its first
      // code line and under its own header. No separator rows (#285: the
      // step rides the first row, so the table starts on the revealed
      // tail itself).
      const ids = await rowIds(second);
      expect.soft(ids[0]).toBe(`L-${bigKey}-${gapEnd - 19}`);
      expect.soft(ids[19]).toBe(`L-${bigKey}-${gapEnd}`);
      expect.soft(ids[20]).toBe(`L-${bigKey}-${gap2Start}`);
    });

    await test.step("expand down adds lines to the bottom of the clicked hunk", async () => {
      await openReview(page, gapReview);
      const bigFile = page.locator(`[id="F-${bigKey}"]`);
      await expect.soft(bigFile).toBeVisible({ timeout: 60_000 });
      await expect.soft(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
      const dhunks = bigFile.locator(".dhunk");
      const first = dhunks.nth(0);
      // The gap step-down (v): the top step's count differs (6 lines), so
      // the 20-line step is unambiguous.
      await clickRowControl(first, "Show 20 more lines");
      await expect.soft(first.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
      await expect.soft(dhunks.nth(1).locator("tr[data-revealed]")).toHaveCount(0);
      // The head sits directly below this hunk's last code line (#285: no
      // separator row after it — the revealed head ends the table while
      // the gap still has lines hidden).
      const ids = await rowIds(first);
      const codeEnd = ids.indexOf(`L-${bigKey}-${gap1End}`);
      expect.soft(codeEnd).toBeGreaterThan(0);
      expect.soft(ids.slice(codeEnd, codeEnd + 21)).toEqual([
        `L-${bigKey}-${gap1End}`,
        ...Array.from({ length: 20 }, (_, k) => `L-${bigKey}-${gapStart + k}`),
      ]);
      expect.soft(ids).toHaveLength(codeEnd + 21);
    });

    await test.step("show-all up fills the gap once, atop the clicked hunk", async () => {
      const gapLen = gapEnd - gapStart + 1;
      await openReview(page, gapReview);
      const bigFile = page.locator(`[id="F-${bigKey}"]`);
      await expect.soft(bigFile).toBeVisible({ timeout: 60_000 });
      await expect.soft(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
      const dhunks = bigFile.locator(".dhunk");
      const second = dhunks.nth(1);
      // ⇞ to the previous hunk fills the whole gap at once.
      await clickRowControl(second, `Show all ${gapLen} lines`);
      await expect.soft(bigFile.locator("tr[data-revealed]")).toHaveCount(gapLen, { timeout: 60_000 });
      await expect.soft(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(gapLen);
      // Shown once: exactly one row per line, no duplicates.
      await expect.soft(page.locator(`[id="L-${bigKey}-${gapStart}"]`)).toHaveCount(1);
      await expect.soft(page.locator(`[id="L-${bigKey}-${gapEnd}"]`)).toHaveCount(1);
      // The whole gap reads atop the clicked hunk, into its first line.
      const ids = await rowIds(second);
      expect.soft(ids[0]).toBe(`L-${bigKey}-${gapStart}`);
      expect.soft(ids[gapLen - 1]).toBe(`L-${bigKey}-${gapEnd}`);
      expect.soft(ids[gapLen]).toBe(`L-${bigKey}-${gap2Start}`);
    });
  });

  test("expand down past the last hunk teaches the total; EOF drops the control (#288)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    const bottomKey = fileKeyForPath("src/bottom.py");
    const eofKey = fileKeyForPath("src/eof.py");

    await test.step("expands down from the last hunk with no prior expansion", async () => {
      await openReview(page, bottomReview);
      const file = page.locator(`[id="F-${bottomKey}"]`);
      await expect.soft(file).toBeVisible({ timeout: 60_000 });
      await expect.soft(file.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
      // No prior expansion anywhere in this file.
      await expect.soft(file.locator("tr[data-revealed]")).toHaveCount(0);
      const dhunks = file.locator(".dhunk");
      const last = dhunks.nth(1);
      // The last hunk carries two 20-line steps: the gap above (up) and
      // the optimistic bottom below it (down, #285: `v` on the last row)
      // — visible even though no slice has taught the total yet.
      const steps = last.getByRole("button", { name: "Show 20 more lines" });
      await expect.soft(steps).toHaveCount(2, { timeout: 30_000 });
      await clickRowControl(last, "Show 20 more lines", 1);
      // One 20-line step below the hunk, with no prior expansion.
      await expect.soft(last.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
      await expect.soft(page.locator(`[id="L-${bottomKey}-${bottomEnd + 1}"]`)).toHaveCount(1);
      await expect.soft(page.locator(`[id="L-${bottomKey}-${bottomEnd + 20}"]`)).toHaveCount(1);
      // Nothing leaks into the earlier hunk's section.
      await expect.soft(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
      // The total is now known: the short tail offers its own show-all —
      // riding the outermost revealed row (issue #308), not the hunk row.
      await expect.soft(file.getByRole("button", { name: "Show all 7 lines" })).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator(".xerr")).toHaveCount(0);
    });

    await test.step("clicking past EOF adds nothing and drops the control silently", async () => {
      await openReview(page, bottomReview);
      const file = page.locator(`[id="F-${eofKey}"]`);
      await expect.soft(file).toBeVisible({ timeout: 60_000 });
      await expect.soft(file.getByText("Hunk 1 of 1")).toBeVisible({ timeout: 30_000 });
      const dhunks = file.locator(".dhunk");
      const only = dhunks.nth(0);
      // Optimistic bottom step shows before the total is known (the top
      // region's step names its own 16-line run, so the 20-line step is
      // unambiguous).
      await expect.soft(only.getByRole("button", { name: "Show 20 more lines" })).toBeVisible({ timeout: 30_000 });
      await expect.soft(file.locator("tr[data-revealed]")).toHaveCount(0);
      await clickRowControl(only, "Show 20 more lines");
      // No lines added, no error, and the bottom control is gone — the row
      // shows its number again (#285: no `has-xdown`), while the top
      // control on the hunk's first row stays.
      await expect.soft(file.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(only.getByRole("button", { name: "Show 20 more lines" })).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(file.locator("tr.has-xdown")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(file.locator("tr.has-xup")).toHaveCount(1, { timeout: 30_000 });
      await expect.soft(file.locator("tr.xsep")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(page.locator(".xerr")).toHaveCount(0);
    });
  });

  test("repeated expand-20 keeps working in both directions; line-1 and EOF hold (#308)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    const midKey = fileKeyForPath("src/mid.py");
    const firstKey = fileKeyForPath("src/first.py");
    const lastKey = fileKeyForPath("src/last.py");

    const openMid = async (): Promise<Locator> => {
      await openReview(page, midReview);
      const file = page.locator(`[id="F-${midKey}"]`);
      await expect.soft(file).toBeVisible({ timeout: 60_000 });
      await expect.soft(file.getByText("Hunk 3 of 3")).toBeVisible({ timeout: 30_000 });
      return file;
    };

    await test.step("expands up three times from the middle hunk, controls moving outward", async () => {
      const file = await openMid();
      const dhunks = file.locator(".dhunk");
      const second = dhunks.nth(1);
      // Three 20-line up-steps; the up control stays nth(0) in the
      // section (the down control rides after the hunk rows).
      for (let k = 1; k <= 3; k++) {
        await clickRowControl(second, "Show 20 more lines", 0);
        await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(20 * k, { timeout: 30_000 });
        await expect.soft(page.locator(`[id="L-${midKey}-${mid2Start - 20 * k}"]`)).toBeVisible();
      }
      // Still offered (the gap is larger than 60 lines) — the remaining
      // count shrinks with every step.
      const remaining = mid2Start - mid1End - 1 - 60;
      await expect.soft(second.getByRole("button", { name: `Show all ${remaining} lines` })).toBeVisible({ timeout: 30_000 });
      // The outermost revealed row carries expand-more, the next row in
      // the collapse chevron; the hunk's own first row shows its number.
      const outer = page.locator(`[id="L-${midKey}-${mid2Start - 60}"]`);
      await expect.soft(outer).toHaveClass(/has-xup/);
      const inner = page.locator(`[id="L-${midKey}-${mid2Start - 59}"]`);
      await expect.soft(inner).toHaveClass(/has-xhide-up/);
      await expect.soft(inner.getByRole("button", { name: "Hide expanded lines above" })).toBeVisible();
      await expect.soft(page.locator(`[id="L-${midKey}-${mid2Start}"]`)).not.toHaveClass(/has-xup/);
      await expect.soft(page.locator(`[id="L-${midKey}-${mid2Start}"]`)).not.toHaveClass(/has-xhide-up/);
      await expect.soft(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
      await expect.soft(dhunks.nth(2).locator("tr[data-revealed]")).toHaveCount(0);
      await expect.soft(page.locator(".xerr")).toHaveCount(0);
    });

    await test.step("expands down three times from the middle hunk, controls moving outward", async () => {
      const file = await openMid();
      const dhunks = file.locator(".dhunk");
      const second = dhunks.nth(1);
      // The down control stays nth(1) in the section (the up control
      // rides before the hunk rows).
      for (let k = 1; k <= 3; k++) {
        await clickRowControl(second, "Show 20 more lines", 1);
        await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(20 * k, { timeout: 30_000 });
        await expect.soft(page.locator(`[id="L-${midKey}-${mid2End + 20 * k}"]`)).toBeVisible();
      }
      const remaining = mid3Start - mid2End - 1 - 60;
      await expect.soft(second.getByRole("button", { name: `Show all ${remaining} lines` })).toBeVisible({ timeout: 30_000 });
      const outer = page.locator(`[id="L-${midKey}-${mid2End + 60}"]`);
      await expect.soft(outer).toHaveClass(/has-xdown/);
      const inner = page.locator(`[id="L-${midKey}-${mid2End + 59}"]`);
      await expect.soft(inner).toHaveClass(/has-xhide-down/);
      await expect.soft(inner.getByRole("button", { name: "Hide expanded lines below" })).toBeVisible();
      await expect.soft(page.locator(`[id="L-${midKey}-${mid2End}"]`)).not.toHaveClass(/has-xdown/);
      await expect.soft(page.locator(`[id="L-${midKey}-${mid2End}"]`)).not.toHaveClass(/has-xhide-down/);
      await expect.soft(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(0);
      await expect.soft(dhunks.nth(2).locator("tr[data-revealed]")).toHaveCount(0);
      await expect.soft(page.locator(".xerr")).toHaveCount(0);
    });

    await test.step("expand, expand, collapse, expand in both directions", async () => {
      const file = await openMid();
      const dhunks = file.locator(".dhunk");
      const second = dhunks.nth(1);
      // Up twice, collapse, expand again.
      await clickRowControl(second, "Show 20 more lines", 0);
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
      await clickRowControl(second, "Show 20 more lines", 0);
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(40, { timeout: 30_000 });
      await clickRowControl(second, "Hide expanded lines above");
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
      // Expand-more is back on the hunk's own first row.
      await expect.soft(page.locator(`[id="L-${midKey}-${mid2Start}"]`)).toHaveClass(/has-xup/);
      await clickRowControl(second, "Show 20 more lines", 0);
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
      // Down once, collapse, expand again — the upper tail is untouched.
      await clickRowControl(second, "Show 20 more lines", 1);
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(40, { timeout: 30_000 });
      await clickRowControl(second, "Hide expanded lines below");
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
      await expect.soft(page.locator(`[id="L-${midKey}-${mid2Start - 20}"]`)).toBeVisible();
      await clickRowControl(second, "Show 20 more lines", 1);
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(40, { timeout: 30_000 });
      await expect.soft(page.locator(".xerr")).toHaveCount(0);
    });

    await test.step("show-all closes the gap; collapsing reopens it", async () => {
      const file = await openMid();
      const dhunks = file.locator(".dhunk");
      const first = dhunks.nth(0);
      const second = dhunks.nth(1);
      const gapLen = mid2Start - mid1End - 1;
      // ⇞ from the lower hunk fills the whole gap at once.
      await clickRowControl(second, `Show all ${gapLen} lines`);
      await expect.soft(file.locator("tr[data-revealed]")).toHaveCount(gapLen, { timeout: 60_000 });
      await expect.soft(second.locator("tr[data-revealed]")).toHaveCount(gapLen);
      await expect.soft(first.locator("tr[data-revealed]")).toHaveCount(0);
      // Gap closed: neither end offers show-all for it anymore.
      await expect.soft(second.getByRole("button", { name: `Show all ${gapLen} lines` })).toHaveCount(0);
      // Collapsing the tail reopens the gap from the lower side.
      await clickRowControl(second, "Hide expanded lines above");
      await expect.soft(file.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(second.getByRole("button", { name: `Show all ${gapLen} lines` })).toBeVisible({ timeout: 30_000 });
      await expect.soft(first.getByRole("button", { name: `Show all ${gapLen} lines` })).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator(".xerr")).toHaveCount(0);
    });

    await test.step("a hunk at line 1 keeps its number and expands down repeatedly", async () => {
      await openReview(page, midReview);
      const file = page.locator(`[id="F-${firstKey}"]`);
      await expect.soft(file).toBeVisible({ timeout: 60_000 });
      await expect.soft(file.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
      const dhunks = file.locator(".dhunk");
      const hunk1 = dhunks.nth(0);
      // No up controls above a hunk starting at line 1; the first row
      // shows its number.
      const line1 = page.locator(`[id="L-${firstKey}-1"]`);
      await expect.soft(line1).not.toHaveClass(/has-xup/);
      await expect.soft(line1).not.toHaveClass(/has-xhide-up/);
      await expect.soft(line1.locator("td.n .nnum").first()).toHaveText("1");
      // Down expands repeatedly below it (gap is 48 lines: 2, then 20).
      await clickRowControl(hunk1, "Show 20 more lines");
      await expect.soft(hunk1.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
      await clickRowControl(hunk1, "Show 20 more lines");
      await expect.soft(hunk1.locator("tr[data-revealed]")).toHaveCount(40, { timeout: 30_000 });
      await expect.soft(page.locator(".xerr")).toHaveCount(0);
    });

    await test.step("the last hunk drops its down control at EOF", async () => {
      await openReview(page, midReview);
      const file = page.locator(`[id="F-${lastKey}"]`);
      await expect.soft(file).toBeVisible({ timeout: 60_000 });
      await expect.soft(file.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
      const dhunks = file.locator(".dhunk");
      const last = dhunks.nth(1);
      // Optimistic bottom step before the total is known (beside the
      // gap's own up step).
      await expect.soft(last.getByRole("button", { name: "Show 20 more lines" })).toHaveCount(2, { timeout: 30_000 });
      await clickRowControl(last, "Show 20 more lines", 1);
      // The hunk ends at EOF: nothing added, the down control drops, the
      // row shows its number again — silently. The gap's up step stays.
      await expect.soft(file.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(last.locator("tr.has-xdown")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(last.getByRole("button", { name: "Show 20 more lines" })).toHaveCount(1, { timeout: 30_000 });
      await expect.soft(page.locator(".xerr")).toHaveCount(0);
    });
  });

  test("gutter E2: controls replace numbers, icons swap, EOF keeps numbers (#285)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    const bigKey = fileKeyForPath("src/big.py");
    const eofKey = fileKeyForPath("src/eof.py");

    /** Computed opacity of a row's expand controls ("0" at rest, "1" on hover). */
    const controlsOpacity = (row: Locator): Promise<string> => row.evaluate((el) => {
      const btns = el.querySelector(".xbtns");
      return btns ? getComputedStyle(btns).opacity : "missing";
    });

    await test.step("hover reveals the controls on the first/last rows, click expands", async () => {
      await openReview(page, eofReview);
      const bigFile = page.locator(`[id="F-${bigKey}"]`);
      await expect.soft(bigFile).toBeVisible({ timeout: 60_000 });
      await expect.soft(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
      // Mouse away from the diff so rows rest on their numbers.
      await bigFile.locator(".dfile-h").hover();
      const firstCode = page.locator(`[id="L-${bigKey}-${eof1Start}"]`);
      // At rest the controls are transparent and the numbers show…
      expect.soft(await controlsOpacity(firstCode)).toBe("0");
      await expect.soft(firstCode.locator("td.n .nnum").first()).toHaveText(String(eof1Start));
      // …row hover reveals the up pair, and it expands like the old control.
      // The first row rides the top-region step (6 lines above hunk 1).
      await firstCode.hover();
      expect.soft(await controlsOpacity(firstCode)).toBe("1");
      const dhunks = bigFile.locator(".dhunk");
      await firstCode.getByRole("button", { name: "Show 6 more lines" }).click();
      await expect.soft(dhunks.nth(0).locator("tr[data-revealed]")).toHaveCount(6, { timeout: 30_000 });
      await expect.soft(page.locator(`[id="L-${bigKey}-${eof1Start - 1}"]`)).toBeVisible();
      // No separator rows anywhere in the file.
      await expect.soft(bigFile.locator("tr.xsep")).toHaveCount(0);
    });

    await test.step("comment icon swaps on hover and rests on commented lines", async () => {
      // Seed a comment on a middle line of the first hunk.
      const line = eof1Start + 1;
      const made = await apiJson(s, "POST", `/api/reviews/${eofReview}/comments`, {
        anchor: { where: "diff-line", fileKey: bigKey, line },
        quote: "",
        text: "E2 gutter check",
      });
      expect.soft(made.status).toBe(201);
      await openReview(page, eofReview);
      const bigFile = page.locator(`[id="F-${bigKey}"]`);
      await expect.soft(bigFile).toBeVisible({ timeout: 60_000 });
      await expect.soft(bigFile.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
      await bigFile.locator(".dfile-h").hover();
      // Commented middle line: the icon permanently replaces the number.
      const commented = page.locator(`[id="L-${bigKey}-${line}"] td.n.new`);
      await expect.soft(commented).toHaveClass(/e-commented/);
      expect.soft(await commented.locator(".nic").evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
      // Plain middle line (no expand controls there): the number shows at
      // rest…
      const plainRow = page.locator(`[id="L-${bigKey}-${eof1Start + 2}"]`);
      const plain = plainRow.locator("td.n.new");
      await expect.soft(plain).not.toHaveClass(/e-commented/);
      expect.soft(await plain.locator(".nnum").evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
      // …and hover swaps the number for the icon.
      await plainRow.hover();
      expect.soft(await plain.locator(".nic").evaluate((el) => getComputedStyle(el).display)).not.toBe("none");
      expect.soft(await plain.locator(".nnum").evaluate((el) => getComputedStyle(el).display)).toBe("none");
      // Clicking the swapped-in icon starts a comment like the number does.
      await plain.locator(".nic").click();
      await expect.soft(bigFile.locator(".ithread[data-pending-thread] textarea")).toBeVisible({ timeout: 15_000 });
    });

    await test.step("a hunk ending at EOF drops the down control and keeps its number", async () => {
      await openReview(page, eofReview);
      const file = page.locator(`[id="F-${eofKey}"]`);
      await expect.soft(file).toBeVisible({ timeout: 60_000 });
      await expect.soft(file.getByText("Hunk 1 of 1")).toBeVisible({ timeout: 30_000 });
      const only = file.locator(".dhunk").nth(0);
      // Optimistic bottom step before the total is known (the new file's
      // single hunk starts at line 1, so only the down step shows).
      await expect.soft(only.getByRole("button", { name: "Show 20 more lines" })).toBeVisible({ timeout: 30_000 });
      await expect.soft(file.locator("tr[data-revealed]")).toHaveCount(0);
      await clickRowControl(only, "Show 20 more lines");
      // At EOF nothing is added and the row shows its number again.
      await expect.soft(file.locator("tr[data-revealed]")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(file.locator("tr.has-xdown")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(page.locator(`[id="L-${eofKey}-20"] td.n .nnum`).first()).toHaveText("20");
      await expect.soft(page.locator(".xerr")).toHaveCount(0);
    });
  });

  test("hidden-hunk rows read as one flowing row with full-width summaries (#283, #342)", async ({ page }) => {
    test.setTimeout(180_000);
    const s = service();
    if (!s) throw new Error("no service");

    const expectHiddenRows = async (step: string): Promise<void> => {
      const rows = page.locator("button.hid");
      await expect.soft(rows).toHaveCount(2, { timeout: 30_000 });
      // Hunk-header chevron box to align against (same file flow, below).
      const headerBox = await page.locator(".dhunk-h .ib").first().boundingBox();
      expect.soft(headerBox, `${step}: no hunk header to align against`).not.toBeNull();
      for (let i = 0; i < 2; i++) {
        const row = rows.nth(i);
        await expect.soft(row).toBeVisible();
        const rowLoc = page.locator("button.hid").nth(i);
        // One synchronous read per row: the label/row/header boxes must
        // not straddle a poll tick (#363 B1).
        const geo = await measureWithinRow(rowLoc, [".hidl", ".hidb", ".hic"]);
        const rowBox = geo.row;
        const labelBox = geo.inner[".hidl"]!;
        const briefBox = geo.inner[".hidb"]!;
        const hicBox = geo.inner[".hic"]!;
        // The label shows: non-empty, and the row is topmost at the label's
        // centre (not painted under the band backing, issue #283).
        // Issue #342: the label is range-only ("Hunk 1", "Hunks 1–2") —
        // no 'hidden' word (asserted in diffLogic.test.ts too).
        await expect.soft(row.locator(".hidl")).toContainText(/^Hunks? \d/, { timeout: 10_000 });
        expect.soft(labelBox.x, `${step}: row ${i} label outside the row`).toBeGreaterThanOrEqual(rowBox.x);
        expect.soft(labelBox.x + labelBox.width, `${step}: row ${i} label outside the row`).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
        const topmost = await page.evaluate(({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return hit?.closest("button.hid")?.getAttribute("aria-label") ?? `${hit?.tagName}.${((hit as HTMLElement | null)?.className ?? "").toString().slice(0, 40)}`;
        }, { x: labelBox.x + labelBox.width / 2, y: labelBox.y + labelBox.height / 2 });
        expect.soft(topmost, `${step}: row ${i} label covered by ${topmost}`).toMatch(/collapsed\. Show these hunks/);
        // The summary uses the full width: its union box is either wider
        // than half the row or starts at the row's left content edge (its
        // own line) — never a fixed narrow right column.
        const wide = briefBox.width > rowBox.width * 0.5;
        const ownLine = briefBox.x <= rowBox.x + 14;
        expect.soft(wide || ownLine, `${step}: row ${i} summary squeezed`).toBe(true);
        // The `>` expand box lines up with the hunk-header chevrons.
        expect.soft(Math.abs(hicBox.x - headerBox!.x), `${step}: row ${i} chevron x ${hicBox.x} vs header ${headerBox!.x}`).toBeLessThanOrEqual(2);
        expect.soft(Math.abs(hicBox.width - headerBox!.width), `${step}: row ${i} chevron width`).toBeLessThanOrEqual(1);
      }
      // No blank band above the first file's hidden row: it sits directly
      // under its file header.
      const firstFile = page.locator(".dfile").first();
      const fileHeaderBox = (await firstFile.locator(".dfile-h").boundingBox())!;
      const rowTop = (await firstFile.locator("button.hid").boundingBox())!.y;
      expect.soft(rowTop - (fileHeaderBox.y + fileHeaderBox.height), `${step}: blank band above the first hidden row`).toBeLessThanOrEqual(2);
    };

    // #362 default: one 1440-light pass in the gate; dark + 960 only in
    // the full matrix (never in `check`, `gate` or `test:affected`).
    for (const combo of tourCombos("hiddenRows", [
      { name: "1440-light", width: 1440, dark: false },
      { name: "1440-dark", width: 1440, dark: true },
      { name: "960-light", width: 960, dark: false },
      { name: "960-dark", width: 960, dark: true },
    ] as const)) {
      await test.step(`hidden rows read as one flowing row (${combo.name})`, async () => {
        await page.setViewportSize({ width: combo.width, height: 900 });
        if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
        else await page.emulateMedia({ colorScheme: "light" });
        await openReview(page, hiddenReview);
        await page.locator('#right [role="tab"]').getByText("Diff").click();
        await expect.soft(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });
        const step = `hidden-rows-${combo.name}`;
        await expectHiddenRows(step);
        await checkLayout(page, step);
      });
    }
  });

  test("long file-tree paths truncate, indicators align, full path hovers (#227)", async ({ page }) => {
    test.setTimeout(180_000);
    const s = service();
    if (!s) throw new Error("no service");
    const keyFor = (p: string): string => p.replace(/[^A-Za-z0-9_.-]/g, "-");
    await page.setViewportSize({ width: 1100, height: 900 });
    await openReview(page, longReview);
    const longSection = page.locator(`[id="F-${keyFor(J227_LONG_FILE)}"]`);
    await expect.soft(longSection).toBeVisible({ timeout: 60_000 });

    await test.step("diff file header: full path on hover, readable tail, indicators inside", async () => {
      // Diff file header: full path on hover, deepest directory and the
      // file name stay readable, indicators inside the header's right edge.
      await expect.soft(longSection.locator(".dfile-h .path")).toHaveAttribute("title", J227_LONG_FILE);
      await expect.soft(longSection.locator(".dfile-h .path .dir-end")).toContainText("and-one-more-long-directory-level/");
      await expect.soft(longSection.locator(".dfile-h .path b")).toHaveText("a_very_long_file_name_for_the_component_under_review_with_extra_words.py");
      await expect.soft(longSection.locator(".dfile-h .ui-diffstat")).toContainText("+15");
    });

    await test.step("file list: no sideways scroll, truncated names, aligned indicators", async () => {
      // Open the file list.
      if (!(await page.locator(".flist").isVisible().catch(() => false))) {
        await page.getByRole("button", { name: "Show file list" }).click();
      }
      const flist = page.locator(".flist");
      await expect.soft(flist.locator(".fr.file")).toHaveCount(3, { timeout: 15_000 });
      await expect.soft(flist.locator(`.fr.file[title="${J227_LONG_FILE}"]`)).toHaveCount(1);
      await expect.soft(flist.locator(".fr.dir .nm-end")).toContainText("and-one-more-long-directory-level");

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
      expect.soft(geo.scrollW).toBeLessThanOrEqual(geo.clientW + 1);
      expect.soft(geo.rows).toHaveLength(3);
      for (const r of geo.rows) {
        // Indicators inside the panel, never scrolled out of view.
        expect.soft(r.stLeft).toBeGreaterThanOrEqual(geo.boxLeft - 1);
        expect.soft(r.rvRight).toBeLessThanOrEqual(geo.boxRight + 1);
      }
      // The two long names truncate (tree order: the deep files first).
      expect.soft(geo.rows[0].nameTruncated).toBe(true);
      expect.soft(geo.rows[1].nameTruncated).toBe(true);
      // The indicator columns align across rows.
      const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
      expect.soft(spread(geo.rows.map((r) => r.rvRight))).toBeLessThanOrEqual(2);
      expect.soft(spread(geo.rows.map((r) => r.stRight))).toBeLessThanOrEqual(2);
      expect.soft(spread(geo.rows.map((r) => r.rvLeft))).toBeLessThanOrEqual(2);
      // The long directory chain is shortened, not fully shown.
      expect.soft(geo.dirTruncated).toBe(true);
    });

    await test.step("header: indicators and checkbox inside the pane, names truncated", async () => {
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
      expect.soft(header.stLeft).toBeGreaterThanOrEqual(header.boxLeft - 1);
      expect.soft(header.revcRight).toBeLessThanOrEqual(header.boxRight + 1);
      // The whole header — checkbox included — fits the pane.
      expect.soft(header.boxRight).toBeLessThanOrEqual(header.paneRight + 1);
      expect.soft(header.checkRight).toBeLessThanOrEqual(header.paneRight + 1);
      expect.soft(header.nameTruncated).toBe(true);
      expect.soft(header.dirTruncated).toBe(true);
    });
  });

  test("first file header shows with filter, split view and tab switches (#19, #202)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReview(page, manyReview);
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect.soft(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });

    /**
     * The first visible file's file header and first hunk header must be
     * painted (topmost at their centres), not covered by the opaque pinned
     * band (`.dband`) or anything else — the #202 blank band is exactly a
     * header hidden under that backing. Also fails on any empty block
     * taller than 8px between the toolbar and the first hunk's table.
     */
    const expectFirstHeadersVisible = async (step: string): Promise<void> => {
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
                  return `${what} header covered by ${hit ? `${hit.tagName}.${(hit.className as string).toString().slice(0, 40)}` : "nothing"}`;
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
    };

    await test.step("split, unfiltered", async () => {
      // Split view, no filter.
      await page.getByRole("button", { name: "Split", exact: true }).click();
      await expect.soft(page.locator("#right table.diff.split").first()).toBeVisible({ timeout: 15_000 });
      await expectFirstHeadersVisible("split, unfiltered");
    });

    await test.step("split, filtered to mod2*", async () => {
      // File filter active: most files hidden before the first visible one.
      await page.getByRole("button", { name: "Show file list" }).click();
      await page.getByLabel("Filter files by name").fill("mod2");
      await expect.soft(page.locator('[id="F-src-mod20.py"]')).toBeVisible({ timeout: 15_000 });
      await expectFirstHeadersVisible("split, filtered to mod2*");
    });

    await test.step("split, after tab switch", async () => {
      // Tab switch: description/commits tab and back to Diff.
      await page.locator('#right [role="tab"]').first().click();
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      await expect.soft(page.locator("#right table.diff.split").first()).toBeVisible({ timeout: 15_000 });
      await expectFirstHeadersVisible("split, after tab switch");
    });

    await test.step("split, after reload", async () => {
      await page.reload();
      await page.locator('#right [role="tab"]').getByText("Diff").click().catch(() => {});
      await expect.soft(page.locator("#right table.diff.split").first()).toBeVisible({ timeout: 30_000 });
      await expectFirstHeadersVisible("split, after reload");
    });

    await test.step("split, back at top after scroll", async () => {
      // Scroll away and back to the top: poll the scroll back to 0
      // instead of a fixed settle (#363 B2), then assert the headers.
      await page.evaluate(() => {
        const p = document.getElementById("right");
        if (p) p.scrollTop = 600;
      });
      await page.evaluate(() => {
        const p = document.getElementById("right");
        if (p) p.scrollTop = 0;
      });
      await expect.poll(() => page.evaluate(() => document.getElementById("right")?.scrollTop ?? -1), { timeout: 5000 }).toBe(0);
      await expectFirstHeadersVisible("split, back at top after scroll");
    });

    await test.step("unified, filtered", async () => {
      // Unified view with the filter still in place.
      await page.getByRole("button", { name: "Unified" }).click();
      await expect.soft(page.locator("#right table.diff:not(.split)").first()).toBeVisible({ timeout: 15_000 });
      await expectFirstHeadersVisible("unified, filtered");
    });
  });
});
