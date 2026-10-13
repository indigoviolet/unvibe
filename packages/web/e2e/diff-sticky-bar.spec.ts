/**
 * Sticky diff actions bar (issue #132) plus sticky file and hunk headers
 * (issue #140): the `.dtool` row (Files, Unified/Split, Hide uninteresting,
 * Fold all, Unfold all, Refresh) stays pinned directly under the source
 * pane's tab strip while the diff scrolls; below it the current file header
 * (`.dfile-h`) pins while its file scrolls and the current hunk header
 * (`tr.ph`) pins while its hunk scrolls, each replaced by the next file or
 * hunk at the boundary. Reveals and file jumps land below the pinned rows;
 * the Files panel and the filter dropdown open fully visible; the bar spans
 * the full pane width sideways and stays one row at narrow widths.
 *
 * Runs against mock mode (no service needed); the Playwright config boots
 * its own Vite server.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __revealSource?: (ref: string) => boolean;
  }
}

const CONN = "src-urllib3-connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";
const connFile = `[id="F-${CONN}"]`;

test.beforeEach(async ({ page }) => {
  await page.goto("/review/demo");
  await expect(page.locator(connFile)).toBeVisible();
});

interface PaneGeometry {
  pane: { y: number; bottom: number; x: number; width: number };
  stickH: number;
  bar: { y: number; bottom: number; x: number; width: number; height: number };
  barTop: number;
}

async function geometry(page: Page): Promise<PaneGeometry | null> {
  return page.evaluate(() => {
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
      bar: { y: b.top, bottom: b.bottom, x: b.left, width: b.width, height: b.height },
      barTop: Number.parseFloat(getComputedStyle(bar).top),
    };
  });
}

async function scrollDiffToBottom(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("#right")?.scrollTo(0, 1e9));
}

/** The full four-row pinned stack (issue #140): heights plus sticky tops. */
interface PinnedStack {
  paneY: number;
  paneBottom: number;
  stripH: number;
  barH: number;
  fileH: number;
  hunkH: number;
  fileTop: number;
  hunkTop: number;
}

async function stack(page: Page): Promise<PinnedStack> {
  const s = await page.evaluate(() => {
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
      hunkH: h("tr.ph > td"),
      fileTop: num(css.getPropertyValue("--dfile-top")),
      hunkTop: num(css.getPropertyValue("--dhunk-top")),
    };
  });
  return s;
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

/**
 * Scroll `sel` to offset `at` and wait until the header pinned at its slot
 * shows `text`. Re-scrolls on every poll: switching views re-lays the
 * tables out after the click, which can move a just-scrolled header off its
 * slot again.
 */
async function expectPinned(
  page: Page,
  sel: string,
  at: number,
  kind: "file" | "hunk",
  text: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        await scrollPaneTo(page, sel, at);
        const v = kind === "file" ? await pinnedFile(page) : await pinnedHunk(page);
        return v ?? "";
      },
      { timeout: 5000 },
    )
    .toContain(text);
}

/** File name shown by the file header pinned at the file slot (if any).
 * During a replacement two headers share the slot for a frame; the later
 * one in DOM order is the incoming header, so the last match wins. */
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

/** Text of the hunk header pinned at the hunk slot (if any; last match wins). */
async function pinnedHunk(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const pane = document.getElementById("right") as HTMLElement;
    const p = pane.getBoundingClientRect();
    const slot = p.top + (Number.parseFloat(getComputedStyle(pane).getPropertyValue("--dhunk-top")) || 0);
    let found: string | null = null;
    for (const el of pane.querySelectorAll("tr.ph > td")) {
      if (Math.abs(el.getBoundingClientRect().top - slot) < 2.5) {
        found = (el.textContent ?? "").replace(/\s+/g, " ").slice(0, 60);
      }
    }
    return found;
  });
}

test("actions bar stays pinned under the tab strip while the diff scrolls", async ({ page }) => {
  await scrollDiffToBottom(page);
  const g = await geometry(page);
  expect(g).not.toBeNull();
  // position:sticky from CSS, with `top` tracking the live tab-strip height.
  await expect(page.locator("#right .dtool")).toBeVisible();
  const position = await page.evaluate(
    () => getComputedStyle(document.querySelector("#right .dtool") as Element).position,
  );
  expect(position).toBe("sticky");
  // Pinned directly under the strip: bar top == pane top + strip height.
  expect(Math.abs(g!.bar.y - (g!.pane.y + g!.stickH))).toBeLessThan(2.5);
  expect(Math.abs(g!.barTop - g!.stickH)).toBeLessThan(2.5);
  // Fully inside the pane vertically (opaque bar above scrolling content).
  expect(g!.bar.y).toBeGreaterThanOrEqual(g!.pane.y - 1);
  expect(g!.bar.bottom).toBeLessThanOrEqual(g!.pane.bottom + 1);
});

test("a revealed line lands below the bar, not under it", async ({ page }) => {
  await scrollDiffToBottom(page);
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650`), CONN);
  expect(ok).toBe(true);
  const line = page.locator(`[id="L-${CONN}-650"].hl`);
  await expect(line).toBeVisible();
  const g = await geometry(page);
  const lineBox = await line.boundingBox();
  expect(g).not.toBeNull();
  expect(lineBox).not.toBeNull();
  // The line's top is at or below the pinned bar's bottom.
  expect(lineBox!.y).toBeGreaterThanOrEqual(g!.bar.bottom - 1);
  // ... and inside the pane viewport.
  expect(lineBox!.y).toBeGreaterThanOrEqual(g!.pane.y - 1);
  expect(lineBox!.y).toBeLessThanOrEqual(g!.pane.bottom);
});

test("a file jump from the Files list lands the header below the bar", async ({ page }) => {
  await scrollDiffToBottom(page);
  await page.getByRole("button", { name: "Show file list" }).click();
  await page.getByRole("button", { name: /test_socketlevel\.py/ }).click();
  const header = page.locator(`[id="F-${TSOCK}"]`);
  await expect(header).toBeVisible();
  const g = await geometry(page);
  const fileBox = await header.boundingBox();
  expect(g).not.toBeNull();
  expect(fileBox).not.toBeNull();
  // The file section's top (its header) sits below the pinned bar.
  expect(fileBox!.y).toBeGreaterThanOrEqual(g!.bar.bottom - 2);
});

test("Files panel opened while scrolled is fully visible, with its dropdown", async ({ page }) => {
  await scrollDiffToBottom(page);
  await page.getByRole("button", { name: "Show file list" }).click();
  const files = page.locator("#right .files");
  await expect(files).toBeVisible();
  const g = await geometry(page);
  expect(g).not.toBeNull();
  const filesBox = await files.boundingBox();
  expect(filesBox).not.toBeNull();
  // The whole panel (filter, progress, list) sits inside the pane viewport.
  expect(filesBox!.y).toBeGreaterThanOrEqual(g!.pane.y - 1);
  expect(filesBox!.y + filesBox!.height).toBeLessThanOrEqual(g!.pane.bottom + 1);
  await expect(page.getByLabel("Filter files by name")).toBeVisible();
  // The filter dropdown opens above the diff content and inside the viewport.
  await page.getByRole("button", { name: "File filters" }).click();
  const menu = page.getByRole("menu", { name: "File filters" });
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
});

test("bar spans the full pane width in split view and after sideways scrolling", async ({ page }) => {
  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.locator(`${connFile} table.diff.split`)).toBeVisible();
  await scrollDiffToBottom(page);
  // Sideways-scroll every file body that can scroll; the bar must not move
  // with the content or leave a gap.
  await page.evaluate(() => {
    for (const w of document.querySelectorAll("#right .dwrap")) w.scrollTo(9999, 0);
  });
  const g = await geometry(page);
  expect(g).not.toBeNull();
  expect(Math.abs(g!.bar.x - g!.pane.x)).toBeLessThan(1.5);
  expect(Math.abs(g!.bar.width - g!.pane.width)).toBeLessThan(1.5);
});

test("bar stays one row at narrow widths, scrolling sideways instead of wrapping", async ({ page }) => {
  const wrap = await page.evaluate(
    () => getComputedStyle(document.querySelector("#right .dtool") as Element).flexWrap,
  );
  const overflowX = await page.evaluate(
    () => getComputedStyle(document.querySelector("#right .dtool") as Element).overflowX,
  );
  expect(wrap).toBe("nowrap");
  expect(overflowX).toBe("auto");
  // Narrow window: the source pane becomes the overlay; the bar is still a
  // single row spanning it.
  await page.setViewportSize({ width: 700, height: 800 });
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650`), CONN);
  expect(ok).toBe(true);
  await expect(page.locator(`[id="L-${CONN}-650"].hl`)).toBeVisible();
  const g = await geometry(page);
  expect(g).not.toBeNull();
  // One row of pill buttons (~40px); two wrapped rows would be ~70px.
  expect(g!.bar.height).toBeLessThan(60);
  expect(Math.abs(g!.bar.width - g!.pane.width)).toBeLessThan(1.5);
  expect(Math.abs(g!.bar.y - (g!.pane.y + g!.stickH))).toBeLessThan(2.5);
});

test("file header pins under the bar while its file scrolls, then the next file replaces it", async ({
  page,
}) => {
  const s = await stack(page);
  const filePos = await page.evaluate(() => getComputedStyle(document.querySelector("#right .dfile-h") as Element).position);
  expect(filePos).toBe("sticky");
  // Midway through the first file: its header is pinned at the file slot.
  await expectPinned(page, `[id="F-${CONN}"] .dwrap`, s.fileTop + 200, "file", "connection.py");
  // Scroll on: the second file's header arrives and replaces the first.
  await scrollDiffToBottom(page);
  const name = await pinnedFile(page);
  expect(name).not.toContain("connection.py");
  expect(name).not.toBeNull();
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
  expect(atSlot).toBe(1);
});

test("hunk header pins under the file header while its hunk scrolls, then the next hunk replaces it", async ({
  page,
}) => {
  const hunkPos = await page.evaluate(
    () => getComputedStyle(document.querySelector("#right tr.ph > td") as Element).position,
  );
  expect(hunkPos).toBe("sticky");
  const s = await stack(page);
  // Pin the first hunk of the first file at the hunk slot.
  await expectPinned(page, `[data-hunk="${CONN}:0"]`, s.hunkTop, "hunk", "Hunk 1 of");
  // Scroll on: the second hunk's header replaces the first at the slot.
  await expectPinned(page, `[data-hunk="${CONN}:1"]`, s.hunkTop, "hunk", "Hunk 2 of");
});

test("a revealed line lands below the whole pinned stack, not under a header", async ({ page }) => {
  await scrollDiffToBottom(page);
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650`), CONN);
  expect(ok).toBe(true);
  const line = page.locator(`[id="L-${CONN}-650"].hl`);
  await expect(line).toBeVisible();
  const s = await stack(page);
  const lineBox = await line.boundingBox();
  expect(lineBox).not.toBeNull();
  // Below all four pinned rows: the hunk header's bottom is the lowest.
  const stackBottom = s.paneY + s.stripH + s.barH + s.fileH + s.hunkH;
  expect(lineBox!.y).toBeGreaterThanOrEqual(stackBottom - 2);
  expect(lineBox!.y).toBeLessThanOrEqual(s.paneBottom);
});

test("the pinned headers' controls keep working: collapse the file, fold the hunk", async ({
  page,
}) => {
  const s = await stack(page);
  // Pin the first file's header, then collapse the file through it.
  await expectPinned(page, `[id="F-${CONN}"] .dwrap`, s.fileTop + 200, "file", "connection.py");
  await page.locator(`[id="F-${CONN}"] .dfile-h`).getByRole("button", { name: "Collapse file" }).click();
  await expect(page.locator(`[id="F-${CONN}"] .dwrap`)).toHaveCount(0);
  // The collapsed header still pins at the slot.
  expect(await pinnedFile(page)).toContain("connection.py");
  await page.locator(`[id="F-${CONN}"] .dfile-h`).getByRole("button", { name: "Expand file" }).click();
  await expect(page.locator(`[id="F-${CONN}"] .dwrap`)).toHaveCount(1);
  // Fold the first hunk through its pinned header.
  await expectPinned(page, `[data-hunk="${CONN}:0"]`, s.hunkTop, "hunk", "Hunk 1 of");
  await page
    .locator(`[data-hunk="${CONN}:0"]`)
    .getByRole("button", { name: "Fold code", exact: true })
    .click();
  await expect(
    page.locator(`[id="F-${CONN}"]`).getByRole("button", { name: /changed lines folded/ }).first(),
  ).toBeVisible();
});

test("hidden-hunk rows scroll under the pinned headers instead of pinning", async ({ page }) => {
  const hid = page.locator("#right .pin.hid").first();
  await expect(hid).toBeVisible();
  const y0 = (await hid.boundingBox())!.y;
  await page.evaluate(() => document.getElementById("right")?.scrollBy(0, 200));
  const y1 = (await hid.boundingBox())!.y;
  // Moves with the content (not stuck): delta matches the scroll.
  expect(Math.abs(y0 - y1 - 200)).toBeLessThan(30);
});

test("file and hunk headers pin in split view too", async ({ page }) => {
  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.locator(`${connFile} table.diff.split`)).toBeVisible();
  const s = await stack(page);
  await expectPinned(page, `[id="F-${CONN}"] .dwrap`, s.fileTop + 200, "file", "connection.py");
  await expectPinned(page, `[data-hunk="${CONN}:1"]`, s.hunkTop, "hunk", "Hunk 2 of");
});
