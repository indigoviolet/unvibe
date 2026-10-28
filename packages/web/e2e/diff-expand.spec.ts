/**
 * Expand-by-lines behaviour tests against mock mode (issue #133, stage
 * 1): step controls above/below hunks, gap show-all with continuity,
 * collapse, split alignment, and no comment start on revealed lines.
 *
 * File keys are the service-canonical path slugs, so element ids contain
 * dots: select them with `[id="…"]`.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const connFile = `[id="F-${CONN}"]`;
const tconnFile = `[id="F-${TCONN}"]`;

/**
 * Issue #285 (E2): unified expand controls ride the hunk's first/last
 * row and show on row hover — hover the button's row, then click. (At
 * rest the buttons are transparent so number clicks pass through; split
 * view keeps its always-visible separator rows and needs no hover.)
 */
async function clickRowControl(scope: import("@playwright/test").Locator, name: string | RegExp, nth = 0): Promise<void> {
  const btn = scope.getByRole("button", { name }).nth(nth);
  await btn.locator("xpath=ancestor::tr[1]").hover();
  await btn.click();
}

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

/** File name shown by the file header pinned at the file slot (if any). */
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

/** Text of the hunk header pinned at the hunk slot (if any). */
async function pinnedHunk(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const pane = document.getElementById("right") as HTMLElement;
    const p = pane.getBoundingClientRect();
    const slot = p.top + (Number.parseFloat(getComputedStyle(pane).getPropertyValue("--dhunk-top")) || 0);
    let found: string | null = null;
    for (const el of pane.querySelectorAll(".dhunk-h")) {
      if (Math.abs(el.getBoundingClientRect().top - slot) < 2.5) {
        found = el.textContent ?? "";
      }
    }
    return found;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/review/demo");
  await expect(page.locator(connFile)).toBeVisible();
});

async function scrollDiffToBottom(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("#right")?.scrollTo(0, 1e9));
}

test("expands above a hunk in steps and collapses back", async ({ page }) => {
  const conn = page.locator(connFile);
  await clickRowControl(conn, "Show 20 more lines", 0);
  const revealed = conn.locator("tr[data-revealed]");
  await expect(revealed).toHaveCount(20);
  await expect(page.locator(`[id="L-${CONN}-76"]`)).toBeVisible();
  await expect(page.locator(`[id="L-${CONN}-56"]`)).toHaveCount(0);
  // A second step continues upward.
  await clickRowControl(conn, "Show 20 more lines", 0);
  await expect(conn.locator("tr[data-revealed]")).toHaveCount(40);
  await expect(page.locator(`[id="L-${CONN}-37"]`)).toBeVisible();
  // Collapse hides the revealed lines through the second row's chevron
  // (issue #308: expand-more is never replaced).
  await clickRowControl(conn, "Hide expanded lines above");
  await expect(conn.locator("tr[data-revealed]")).toHaveCount(0);
});

test("reveals a whole gap so the hunks read as continuous", async ({ page }) => {
  await scrollDiffToBottom(page);
  await page.getByText(/Hunks 1–2 of 3 hidden · imports/).click();
  await expect(page.getByText("Hunk 1 of 3")).toBeVisible();
  const tconn = page.locator(tconnFile);
  // Issue #265: the gap's show-all rides both ends; the upper side's
  // (first in DOM order) keeps the old path here.
  await clickRowControl(tconn, "Show all 4 lines", 0);
  await expect(tconn.locator("tr[data-revealed]")).toHaveCount(4);
  for (const n of [10, 11, 12, 13]) {
    await expect(page.locator(`[id="L-${TCONN}-${n}"]`)).toBeVisible();
  }
  // Fully revealed: this gap's show-all is gone; the collapse chevron
  // (issue #308) sits on the run's second row instead.
  await expect(tconn.getByRole("button", { name: "Show all 4 lines" })).toHaveCount(0);
  await clickRowControl(tconn, "Hide expanded lines below");
  await expect(tconn.locator("tr[data-revealed]")).toHaveCount(0);
});

test("revealing a gap fully from below leaves no controls at the boundary", async ({ page }) => {
  await scrollDiffToBottom(page);
  await page.getByText(/Hunks 1–2 of 3 hidden · imports/).click();
  await expect(page.getByText("Hunk 1 of 3")).toBeVisible();
  const tconn = page.locator(tconnFile);
  // The small gap's lower step finishes it in one click.
  const steps = tconn.getByRole("button", { name: "Show 4 more lines" });
  await expect(steps).toHaveCount(2);
  await clickRowControl(tconn, "Show 4 more lines", 1);
  await expect(tconn.locator("tr[data-revealed]")).toHaveCount(4);
  // No separator rows at the revealed boundary (#285): hunk 1's table
  // starts on its first code line (the top-region step rides that row),
  // hunk 2's table starts on the revealed tail — controls live in rows,
  // never between them.
  const [first, second] = await tconn.locator(".dhunk").all();
  await expect(first.locator("tr.xsep")).toHaveCount(0);
  await expect(second.locator("tr.xsep")).toHaveCount(0);
  const firstRowClass: string = await first.locator("table.diff tbody tr").first().getAttribute("class") ?? "";
  expect(firstRowClass.split(" ")).toContain("has-xup");
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
  expect(nums).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
});

test("split view keeps both sides of revealed lines aligned", async ({ page }) => {
  await page.getByRole("button", { name: "Split" }).click();
  const conn = page.locator(connFile);
  await conn.getByRole("button", { name: "Show 20 more lines" }).first().click();
  const row = page.locator(`[id="L-${CONN}-76"]`);
  await expect(row).toBeVisible();
  await expect(row.locator("td.n")).toHaveCount(2);
  await expect(row.locator("td.n").first()).toHaveText("76");
  await expect(row.locator("td.n").nth(1)).toHaveText("76");
});

test("revealed lines offer no comment start", async ({ page }) => {
  const conn = page.locator(connFile);
  await clickRowControl(conn, "Show 20 more lines", 0);
  await expect(conn.locator("tr[data-revealed]")).toHaveCount(20);
  // No comment affordance on revealed number cells…
  await expect(page.locator("tr[data-revealed] td.n.new")).toHaveCount(0);
  await expect(page.locator("tr[data-revealed] td.n[data-line]")).toHaveCount(0);
  // …and clicking one opens no comment composer.
  await page.locator(`[id="L-${CONN}-76"]`).locator("td.n").nth(1).click();
  await expect(page.locator("tr[data-revealed]")).toHaveCount(20);
});

test("steps from function to class with the unit name in the hunk header", async ({ page }) => {
  const conn = page.locator(connFile);
  await conn.getByText("Hunk 2 of 2").scrollIntoViewIfNeeded();
  await conn.getByRole("button", { name: "Show the enclosing function or class" }).nth(1).click();
  await expect(conn.locator("tr[data-revealed]")).toHaveCount(18);
  await expect(page.locator(`[id="L-${CONN}-640"]`)).toBeVisible();
  await expect(page.locator(`[id="L-${CONN}-665"]`)).toBeVisible();
  await expect(conn.getByText(/in getresponse/)).toBeVisible();
  await conn.getByRole("button", { name: "Show enclosing class HTTPConnection" }).click();
  await expect(conn.getByText(/in HTTPConnection/)).toBeVisible();
  await expect(conn.getByRole("button", { name: "Show the whole file" })).toBeVisible();
});

test("hides the unit control when no unit encloses the hunk", async ({ page }) => {
  const conn = page.locator(connFile);
  // First hunk spans top-level items: the outline is empty.
  await conn.getByRole("button", { name: "Show the enclosing function or class" }).first().click();
  await expect(conn.getByRole("button", { name: "Show the enclosing function or class" })).toHaveCount(1);
});

test("headers still pin and code columns line up with expansion revealed", async ({ page }) => {
  const conn = page.locator(connFile);
  // Lines above and below the first hunk…
  await clickRowControl(conn, "Show 20 more lines", 0);
  await expect(conn.locator("tr[data-revealed]")).toHaveCount(20);
  // …and a fully revealed gap in another file.
  await scrollDiffToBottom(page);
  await page.getByText(/Hunks 1–2 of 3 hidden · imports/).click();
  const tconn = page.locator(tconnFile);
  // Issue #265: the gap's show-all rides both ends; the upper side's
  // (first in DOM order) keeps the old path here.
  await clickRowControl(tconn, "Show all 4 lines", 0);
  await expect(tconn.locator("tr[data-revealed]")).toHaveCount(4);
  // A revealed row scrolls under the pinned file + hunk headers. Scroll
  // to a line deep enough in the hunk that its header is genuinely stuck
  // at the slot (not merely sitting near it in normal flow — file-top
  // groups like the GitHub outdated threads legitimately move that).
  await scrollPaneTo(page, `[id="L-${CONN}-90"]`, 400);
  await expect.poll(async () => pinnedFile(page), { timeout: 5000 }).toBe("connection.py");
  await expect.poll(async () => pinnedHunk(page), { timeout: 5000 }).toContain("Hunk 1 of 2");
  // Code columns start at the same x across the file's hunk tables
  // (revealed rows ride the same tables, so they line up by construction).
  const xs: number[] = await page.evaluate((key: string) => {
    const file = document.querySelector(`[id="F-${key}"]`)!;
    return [...file.querySelectorAll(".dhunk table.diff")].map(
      (t) => (t.querySelector("td.c") as HTMLElement).getBoundingClientRect().x,
    );
  }, CONN);
  expect(xs.length).toBeGreaterThan(1);
  expect(new Set(xs.map((x) => Math.round(x))).size).toBe(1);
});
