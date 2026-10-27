/**
 * Sticky diff actions bar (issue #132) plus sticky file and hunk headers
 * (issue #140): the `.dtool` row (Files, Unified/Split, Hide uninteresting,
 * Fold all, Unfold all, Refresh) stays pinned directly under the source
 * pane's tab strip while the diff scrolls; below it the current file header
 * (`.dfile-h`) pins while its file scrolls and the current hunk header
 * (`.dhunk-h`) pins while its hunk scrolls, each replaced by the next file or
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
      hunkH: h(".dhunk-h"),
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

/**
 * After `expectPinned`, scroll a little further into the same file/hunk: a
 * header merely passing through the slot leaves it, a pinned one stays.
 * (Without this, scrolling a header exactly to its slot would read back
 * correctly even if nothing stuck.)
 */
async function expectStuck(page: Page, kind: "file" | "hunk", text: string): Promise<void> {
  await page.evaluate(() => document.getElementById("right")?.scrollBy(0, 120));
  await expect
    .poll(async () => (kind === "file" ? await pinnedFile(page) : await pinnedHunk(page)) ?? "", {
      timeout: 5000,
    })
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
    for (const el of pane.querySelectorAll(".dhunk-h")) {
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
  await expect(page.locator(`${connFile} table.diff.split`).first()).toBeVisible();
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
  await expectPinned(page, `[id="F-${CONN}"]`, s.fileTop + 400, "file", "connection.py");
  await expectStuck(page, "file", "connection.py");
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
    () => getComputedStyle(document.querySelector("#right .dhunk-h") as Element).position,
  );
  expect(hunkPos).toBe("sticky");
  const s = await stack(page);
  // Pin the first hunk of the first file at the hunk slot.
  await expectPinned(page, `[data-hunk="${CONN}:0"]`, s.hunkTop, "hunk", "Hunk 1 of");
  // Scroll on: the second hunk's header replaces the first at the slot.
  await expectPinned(page, `[data-hunk="${CONN}:1"]`, s.hunkTop, "hunk", "Hunk 2 of");
  await expectStuck(page, "hunk", "Hunk 2 of");
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
  await expectPinned(page, `[id="F-${CONN}"]`, s.fileTop + 400, "file", "connection.py");
  await page.locator(`[id="F-${CONN}"] .dfile-h`).getByRole("button", { name: "Collapse file" }).click();
  await expect(page.locator(`[id="F-${CONN}"] .dbody`)).toHaveCount(0);
  // The collapsed header still pins at the slot.
  expect(await pinnedFile(page)).toContain("connection.py");
  await page.locator(`[id="F-${CONN}"] .dfile-h`).getByRole("button", { name: "Expand file" }).click();
  await expect(page.locator(`[id="F-${CONN}"] .dbody`)).toHaveCount(1);
  // Fold the first hunk through its pinned header: the code hides and the
  // header chevron becomes the single unfold control (no placeholder row).
  await expectPinned(page, `[data-hunk="${CONN}:0"]`, s.hunkTop, "hunk", "Hunk 1 of");
  await page
    .locator(`[data-hunk="${CONN}:0"]`)
    .getByRole("button", { name: "Fold code", exact: true })
    .click();
  await expect(
    page.locator(`[data-hunk="${CONN}:0"]`).getByRole("button", { name: "Show code", exact: true }),
  ).toBeVisible();
  await expect(page.locator(`[id="F-${CONN}"]`).getByText("changed lines folded")).toHaveCount(0);
});

test("hidden-hunk rows scroll under the pinned headers instead of pinning", async ({ page }) => {
  const hid = page.locator("#right .dhid .hid").first();
  await expect(hid).toBeVisible();
  const y0 = (await hid.boundingBox())!.y;
  await page.evaluate(() => document.getElementById("right")?.scrollBy(0, 200));
  const y1 = (await hid.boundingBox())!.y;
  // Moves with the content (not stuck): delta matches the scroll.
  expect(Math.abs(y0 - y1 - 200)).toBeLessThan(30);
});

test("file and hunk headers pin in split view too", async ({ page }) => {
  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.locator(`${connFile} table.diff.split`).first()).toBeVisible();
  const s = await stack(page);
  await expectPinned(page, `[id="F-${CONN}"]`, s.fileTop + 400, "file", "connection.py");
  await expectPinned(page, `[data-hunk="${CONN}:1"]`, s.hunkTop, "hunk", "Hunk 2 of");
  await expectStuck(page, "hunk", "Hunk 2 of");
});

test("no vertical scroll container sits between a hunk header and the pane", async ({ page }) => {
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
  expect(bad).toEqual([]);
});

test("hunk headers pin while long lines wrap instead of scrolling sideways", async ({ page }) => {
  // #274 soft-wrap: long code lines wrap, so no code table is wider than
  // the pane and there is nothing to scroll sideways.
  const overflow = await page.evaluate(() => {
    const pane = document.getElementById("right") as HTMLElement;
    return Math.max(
      0,
      ...[...pane.querySelectorAll(".dwrap")].map((w) => (w as HTMLElement).scrollWidth - (w as HTMLElement).clientWidth),
    );
  });
  expect(overflow).toBeLessThanOrEqual(2);
  // The headers still pin: scroll the pane down to a hunk. The header is
  // outside the (now never-scrolled) sideways scroller.
  const s = await stack(page);
  await expectPinned(page, `[data-hunk="${CONN}:1"]`, s.hunkTop, "hunk", "Hunk 2 of");
  await expectStuck(page, "hunk", "Hunk 2 of");
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
  expect(span).not.toBeNull();
  expect(Math.abs(span!.x - span!.paneX)).toBeLessThan(1.5);
  expect(Math.abs(span!.width - span!.paneWidth)).toBeLessThan(1.5);
});

test("hunk headers pin even if the code wrapper computes overflow-y:hidden", async ({ page }) => {
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
  const s = await stack(page);
  await expectPinned(page, `[data-hunk="${CONN}:1"]`, s.hunkTop, "hunk", "Hunk 2 of");
  await expectStuck(page, "hunk", "Hunk 2 of");
});

test("code columns start at the same x in every hunk of a file", async ({ page }) => {
  // Each hunk is its own table (#140), so the file shares one line-number
  // width (`--lnw`): 2-digit and 4-digit hunks must still line their code
  // columns up. Checked in unified and split.
  for (const view of ["unified", "split"] as const) {
    if (view === "split") {
      await page.getByRole("button", { name: "Split" }).click();
      await expect(page.locator(`${connFile} table.diff.split`).first()).toBeVisible();
    }
    const xs = await page.evaluate((key) => {
      const file = document.getElementById(`F-${key}`) as HTMLElement;
      return [...file.querySelectorAll(".dhunk")].map((sec) =>
        Math.round(sec.querySelector("td.c")?.getBoundingClientRect().x ?? -1),
      );
    }, CONN);
    expect(xs.length).toBeGreaterThan(1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1.5);
  }
});

test("gutter is digits + padding; added files drop the empty column (#261)", async ({ page }) => {
  // The demo's changelog file is a new file hidden by Hide-uninteresting:
  // reveal it first (the toggle persists only in this test's context).
  await page.getByRole("button", { name: "Hide uninteresting" }).click();
  await expect(page.locator('[id="F-changelog-1362.bugfix.rst"]')).toBeVisible();
  // Hunk bodies render lazily: scroll the added file into view so its
  // tables mount before measuring.
  await page.locator('[id="F-changelog-1362.bugfix.rst"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[id="F-changelog-1362.bugfix.rst"] table.diff')).toBeVisible();
  // Modified file: two number columns, each at most digits + padding +
  // exactly its affordance room (marker ~18px old, icon 14px new).
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const mod = await page.evaluate((key) => {
    const file = document.getElementById(`F-${key}`)!;
    const digits = Number.parseInt(file.style.getPropertyValue("--lnw"), 10) || 0;
    const sample = (file.querySelector("table.diff tbody > tr:not(.xsep) td.n") ?? file.querySelector("table.diff td.n"))!;
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
    const fcs = getComputedStyle(sample);
    probe.style.fontFamily = fcs.fontFamily;
    probe.style.fontSize = fcs.fontSize;
    probe.style.fontStyle = fcs.fontStyle;
    probe.style.fontWeight = fcs.fontWeight;
    probe.style.letterSpacing = fcs.letterSpacing;
    probe.textContent = "0123456789";
    document.body.appendChild(probe);
    const digitW = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const cs = getComputedStyle(sample);
    const pad = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
    let oldMax = 0;
    let nwMax = 0;
    for (const tr of file.querySelectorAll("table.diff:not(.split) tbody > tr")) {
      if (tr.classList.contains("xsep")) continue;
      const cells = [...tr.querySelectorAll(":scope > td.n")];
      if (cells.length === 2) {
        oldMax = Math.max(oldMax, cells[0].getBoundingClientRect().width);
        nwMax = Math.max(nwMax, cells[1].getBoundingClientRect().width);
      }
    }
    return { digits, digitW, pad, oldMax, nwMax };
  }, CONN);
  expect(mod.oldMax).toBeGreaterThan(0);
  expect(mod.nwMax).toBeGreaterThan(0);
  expect(mod.oldMax).toBeLessThanOrEqual(mod.digits * mod.digitW + mod.pad + 18 + 3);
  expect(mod.nwMax).toBeLessThanOrEqual(mod.digits * mod.digitW + mod.pad + 14 + 3);
  // Added file: the empty old column is gone (one number cell per row).
  const added = await page.evaluate(() => {
    const file = document.getElementById("F-changelog-1362.bugfix.rst");
    if (!file) return null;
    const tables = [...file.querySelectorAll("table.diff:not(.split)")];
    const hideOld = tables.length > 0 && tables.every((t) => t.classList.contains("hide-old"));
    const counts: number[] = [];
    for (const tr of file.querySelectorAll("table.diff:not(.split) tbody > tr")) {
      if (tr.classList.contains("xsep")) continue;
      counts.push(tr.querySelectorAll(":scope > td.n").length);
    }
    return { hideOld, counts: [...new Set(counts)] };
  });
  expect(added).not.toBeNull();
  expect(added!.hideOld).toBe(true);
  expect(added!.counts).toEqual([1]);
});
