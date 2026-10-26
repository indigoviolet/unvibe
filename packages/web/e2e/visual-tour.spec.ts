/**
 * Visual tour against the REAL built service (owner: real testing
 * wherever possible). One spec, four passes (1440px and ~900px, light
 * and dark): the guide with a pinned card, a card opened from inside
 * a pinned card in the guide and in the diff, the diff in unified
 * and split, a deep-anchored card, every toolbar/file-tree menu, the
 * comments menu, every Settings tab, and the start page (Open-a-PR
 * row, PR list, Reviews list). Screenshots land in the
 * git-ignored `visual-tour/` folder for the owner to look at.
 *
 * At every step, generic checks (no per-feature asserts), including
 * the #225 layout check (`layout-check.ts`) on every scene:
 * - every open menu/popover is fully inside the viewport and topmost
 *   at its corners and centre;
 * - every open card's FULL box is inside the viewport horizontally
 *   and topmost across a grid (pinned headers excepted);
 * - no horizontal page overflow.
 *
 * Requires `mise run build` first. Run via `mise run visual-tour`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { selectDiffRows, selectText } from "./select-text.js";
import { cpuThrottleFromEnv } from "./cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import { checkLayout } from "./layout-check.js";
import { createScratchReview as createJourneyReview, git as journeyGit, makeGapRepo, makeScratchRepo, realGitPath, writeFakeGh, writeFakeGhTour, writeFakeGitOffline } from "./journeys/journey-helpers.js";

const exec = promisify(execFile);
const SHOTS = fileURLToPath(new URL("../visual-tour", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

// Full Chromium, not the headless shell (issue #196 review): the
// shell's font shaping inflates some families' glyph advances at text
// sizes (Nunito Sans "T" shaped 10px at 13px instead of its true
// 7.8px), which made Studio text look broken in tour screenshots
// while real Chrome renders it correctly. `channel: "chromium"` is
// Playwright's full build in the new headless mode.
test.use({ channel: "chromium" });

async function apiJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`, "-H", "content-type: application/json"];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

let dataDir = "";
let tourBin = "";
let tourLog = "";
let tourShellPath = "";
let svc: RunningService | null = null;
let reviewId = "";

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });
test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-data-"));
  // Hermetic service (AGENTS.md: tests never hit real GitHub): fake
  // `gh` (authenticated as a fake login, empty PR lists) and a `git`
  // wrapper that fails `ls-remote` instantly, so the GitHub-fetch
  // probe reports a deterministic offline warning — no real network.
  tourBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-bin-"));
  tourLog = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-gh-"));
  writeFakeGhTour(tourBin, tourLog);
  writeFakeGitOffline(tourBin, realGitPath());
  tourShellPath = path.join(tourBin, "fakeshell");
  writeFileSync(tourShellPath, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${tourBin}:$PATH"\n`, { mode: 0o755 });
  svc = await startService(dataDir, {
    agent: "replay",
    extraEnv: {
      SHELL: tourShellPath,
      PATH: `${tourBin}${path.delimiter}${process.env.PATH ?? ""}`,
      // Fake updater so the Settings → Version scene lists channels (#229).
      UNVIBE_UPDATER_BACKEND: "fake",
    },
  });
  const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as {
    review: { id: string };
  };
  reviewId = created.review.id;
  const deadline = Date.now() + 90_000;
  for (;;) {
    const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
      pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
    };
    const root = snap.pages.find((p) => p.id === "root");
    if (root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0) && root?.cards.some((c) => c.id === "central" && c.blocks.length > 0)) break;
    if (Date.now() > deadline) throw new Error("guide did not fill in time");
    await new Promise((r) => setTimeout(r, 1000));
  }
});

test.afterAll(async () => {
  await svc?.stop().catch(() => {});
  svc = null;
  for (const d of [dataDir, tourBin, tourLog]) rmSync(d, { recursive: true, force: true });
});

/**
 * Syntax-token contrast (issue #196 review): a string/comment token in
 * a diff row must read against its row background in every theme and
 * scheme. The light palette on a dark add row scores ~1-2, the correct
 * dark palette ~5+, so a ratio floor of 3 catches a mis-scoped palette.
 */
async function checkTokenContrast(page: Page, step: string): Promise<void> {
  await page.waitForSelector("table.diff td.c .shk-str", { timeout: 15_000 });
  const found = await page.evaluate(() => {
    const lum = (rgb: string): number => {
      const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
      const f = (v: number): number => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(m[0] ?? 0) + 0.7152 * f(m[1] ?? 0) + 0.0722 * f(m[2] ?? 0);
    };
    const out: { cls: string; color: string; bg: string; ratio: number }[] = [];
    for (const cls of ["shk-str", "shk-com"]) {
      const el = document.querySelector(`table.diff td.c .${cls}`);
      if (!el) continue;
      const color = getComputedStyle(el).color;
      let bg = "rgba(0, 0, 0, 0)";
      let node: Element | null = el.closest("td");
      while (node) {
        const b = getComputedStyle(node).backgroundColor;
        if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") { bg = b; break; }
        node = node.parentElement;
      }
      const [hi, lo] = [lum(color), lum(bg)].sort((a, b) => b - a);
      out.push({ cls, color, bg, ratio: (hi + 0.05) / (lo + 0.05) });
    }
    return out;
  });
  expect(found.length, `${step}: no syntax tokens found`).toBeGreaterThan(0);
  for (const t of found) {
    expect(t.ratio, `${step}: ${t.cls} ${t.color} on ${t.bg} ratio ${t.ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
  }
}

/** Generic check: menus/popovers fully in the viewport and topmost. */
async function checkMenus(page: Page, step: string): Promise<void> {
  const menus = page.locator(".fmenu:visible, .cmenu:visible, #pop:visible");
  for (let i = 0; i < (await menus.count()); i++) {
    const bad = await menus.nth(i).evaluate((el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.right > window.innerWidth + 1 || r.top < -1 || r.bottom > window.innerHeight + 1) {
        return `outside viewport ${JSON.stringify({ l: r.left, r: r.right, t: r.top, b: r.bottom })}`;
      }
      const pts: [number, number][] = [
        [r.left + 5, r.top + 5],
        [r.right - 5, r.top + 5],
        [r.left + 5, r.bottom - 5],
        [r.right - 5, r.bottom - 5],
        [r.left + r.width / 2, r.top + r.height / 2],
      ];
      for (const [x, y] of pts) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) return `not topmost at ${Math.round(x)},${Math.round(y)}: ${hit ? hit.tagName + "." + (hit as HTMLElement).className : "nothing"}`;
      }
      return null;
    });
    expect(bad, `${step}: menu ${i} ${bad ?? ""}`).toBeNull();
  }
}

/** Generic check: open cards fully inside horizontally + topmost grid. */
async function checkCards(page: Page, step: string): Promise<void> {
  const cards = page.locator(".ui-card.child:visible");
  for (let i = 0; i < (await cards.count()); i++) {
    const bad = await cards.nth(i).evaluate((cardEl: Element) => {
      const r = cardEl.getBoundingClientRect();
      if (r.left < -1 || r.right > window.innerWidth + 1) {
        return `full box outside viewport horizontally: left=${Math.round(r.left)} right=${Math.round(r.right)} vw=${window.innerWidth}`;
      }
      let x0 = Math.max(r.left, 0);
      let x1 = Math.min(r.right, window.innerWidth);
      let y0 = Math.max(r.top, 0);
      let y1 = Math.min(r.bottom, window.innerHeight);
      // A card inside a scrolling pane is clipped by it: sample only
      // the part visible inside the pane, not the scrolled-away part
      // above it (which legitimately sits under the app's top bar).
      const col = cardEl.closest(".col");
      if (col) {
        const cr = col.getBoundingClientRect();
        x0 = Math.max(x0, cr.left);
        x1 = Math.min(x1, cr.right);
        y0 = Math.max(y0, cr.top);
        y1 = Math.min(y1, cr.bottom);
      }
      // Inset past the card's rounded corners (a corner sample would
      // legitimately hit whatever is underneath the cutout). Sample
      // the FULL box, parents included: the regular grid plus explicit
      // rows/columns at the bottom and right edges, so a code row
      // painted across a card's bottom strip (its reply box) is caught.
      const ys = new Set<number>();
      const xs = new Set<number>();
      if (y1 - y0 > 20) { ys.add(y0 + 14); ys.add(y1 - 8); }
      if (x1 - x0 > 20) { xs.add(x0 + 14); xs.add(x1 - 8); }
      for (let y = y0 + 14; y < y1 - 6; y += 40) ys.add(y);
      for (let x = x0 + 14; x < x1 - 6; x += 40) xs.add(x);
      for (const y of ys) {
        for (const x of xs) {
          const hit = document.elementFromPoint(x, y);
          if (!hit || cardEl.contains(hit)) continue;
          // The only allowed cover is a DESCENDANT card floating over
          // its ancestor (a child above its parent). An ancestor — or
          // any part of it, such as its sticky reply footer — covering
          // a descendant, or an unrelated card covering this one, fails.
          const hitCard = hit.closest(".ui-card.child");
          if (hitCard && cardEl.contains(hitCard)) continue;
          // A header may cover a card only while it is actually stuck
          // in its pinned slot at the top of the pane (its top equals
          // its sticky offset, ±1px). A header in place mid-pane — the
          // next hunk's or file's, where an overflowing card reaches —
          // must paint below the card, like its rows and gutters.
          if (hit.closest(".dband")) continue;
          // Pinned headers/bars (and the app top bar, over a header
          // scrolled out of its pane) slide over inline cards by design.
          if (hit.closest(".dfile-h, .dhunk-h, .dtool, .rstick, .rbar")) continue;
          return `not topmost at ${Math.round(x)},${Math.round(y)}: ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)} card=${cardEl.id} rect=${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`;
        }
      }
      return null;
    });
    expect(bad, `${step}: card ${i} ${bad ?? ""}`).toBeNull();
  }
}

/**
 * Generic check: every open card's reply input (if it has one) is
 * fully inside its card — never cut in half at the card's bottom edge —
 * and topmost at its centre and corners (a child card floating over
 * its parent is the one allowed cover, as in the grid check).
 */
async function checkReplyBoxes(page: Page, step: string): Promise<void> {
  const boxes = page.locator(".ui-card.child textarea:visible");
  for (let i = 0; i < (await boxes.count()); i++) {
    const bad = await boxes.nth(i).evaluate((ta: Element) => {
      const card = ta.closest(".ui-card.child");
      if (!card) return "reply input not inside a floating card";
      const r = ta.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      if (r.top < c.top - 1 || r.bottom > c.bottom + 1 || r.left < c.left - 1 || r.right > c.right + 1) {
        return `reply input clipped by its card: input=${Math.round(r.top)}-${Math.round(r.bottom)} card=${Math.round(c.top)}-${Math.round(c.bottom)}`;
      }
      if (r.left < -1 || r.right > window.innerWidth + 1) return "reply input outside viewport horizontally";
      // The footer must sit flush at the card's bottom: sample the
      // strip below the composer (if any) — answer content visible
      // there means scrolled text shows past the sticky footer.
      const composer = ta.closest(".composer");
      if (composer) {
        const f = composer.getBoundingClientRect();
        for (let y = f.bottom + 2; y < c.bottom - 1; y += 4) {
          for (let x = c.left + 16; x < c.right - 8; x += 60) {
            const hit = document.elementFromPoint(x, y);
            if (!hit) continue;
            if (composer.contains(hit) || hit === card) continue;
            // A descendant card over the strip is allowed; this
            // card's own answer content showing there is the bug.
            const hitCard: Element | null = hit.closest(".ui-card.child");
            if (hitCard && hitCard !== card && card.contains(hitCard)) continue;
            return `content below the reply footer at ${Math.round(x)},${Math.round(y)}: ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)} footer=${Math.round(f.bottom)} card=${Math.round(c.bottom)}`;
          }
        }
      }
      const pts: [number, number][] = [
        [r.left + 6, r.top + 6],
        [r.right - 6, r.top + 6],
        [r.left + 6, r.bottom - 6],
        [r.right - 6, r.bottom - 6],
        [r.left + r.width / 2, r.top + r.height / 2],
      ];
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        // A point on the viewport's bottom edge can hit nothing at
        // all (the input's last row is at the fold): out of view.
        if (!hit && y > window.innerHeight - 8) continue;
        if (!hit) return `nothing at reply input ${Math.round(x)},${Math.round(y)}`;
        if (ta.contains(hit) || (ta as HTMLElement).parentElement?.contains(hit)) continue;
        // Only a descendant card may cover this card's reply input;
        // an ancestor's footer (or anything else) over it fails.
        const hitCard = hit.closest(".ui-card.child");
        if (hitCard && card.contains(hitCard)) continue;
        return `reply input not topmost at ${Math.round(x)},${Math.round(y)}: ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)}`;
      }
      return null;
    });
    expect(bad, `${step}: reply box ${i} ${bad ?? ""}`).toBeNull();
  }
}

/**
 * Generic check: every open card's header row (its quote and its
 * Close button) is visible and topmost — sampled at the header's
 * left, centre and right and at the Close button's centre. The only
 * allowed cover is a descendant card, as in the grid check.
 */
async function checkCardHeaders(page: Page, step: string): Promise<void> {
  const cards = page.locator(".ui-card.child:visible");
  for (let i = 0; i < (await cards.count()); i++) {
    const bad = await cards.nth(i).evaluate((cardEl: Element) => {
      const header = cardEl.querySelector(":scope > .exp-h");
      if (!header) return null;
      const h = header.getBoundingClientRect();
      if (h.bottom < 0 || h.top > window.innerHeight) return null;
      // Only the header's visible part counts: a header scrolled out
      // of its own card's box is not covered, it is just scrolled away.
      const c = cardEl.getBoundingClientRect();
      // A pinned card does not scroll internally (#204): its header
      // row (quote, Open as page, Delete, Close) is in the flow; the
      // part inside the pane must be visible and topmost.
      let vt = Math.max(h.top, c.top);
      let vb = Math.min(h.bottom, c.bottom);
      let vl = Math.max(h.left, c.left);
      let vr = Math.min(h.right, c.right);
      // The card is clipped by its pane: the part above the pane's
      // top edge sits under the app's top bar, not under anything
      // the header check should blame.
      const col = cardEl.closest(".col");
      if (col) {
        const cr = col.getBoundingClientRect();
        vt = Math.max(vt, cr.top);
        vb = Math.min(vb, cr.bottom);
        vl = Math.max(vl, cr.left);
        vr = Math.min(vr, cr.right);
      }
      if (vb - vt < 4 || vr - vl < 24) {
        return null;
      }
      const midY = (vt + vb) / 2;
      const pts: [number, number][] = [
        [vl + 12, midY],
        [(vl + vr) / 2, midY],
        [vr - 12, midY],
      ];
      const close = header.querySelector('button[aria-label="Close"]');
      if (close) {
        const b = close.getBoundingClientRect();
        pts.push([b.left + b.width / 2, b.top + b.height / 2]);
      }
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit) return `nothing at header ${Math.round(x)},${Math.round(y)}`;
        if (cardEl.contains(hit)) {
          const hitCard = hit.closest(".ui-card.child");
          if (!hitCard || hitCard === cardEl || cardEl.contains(hitCard)) continue;
        }
        // The pinned top stack (and the app top bar) slides over
        // inline cards by design.
        if (hit.closest(".rstick, .dtool, .dband, .dfile-h.stuck, .dhunk-h.stuck, .rbar")) continue;
        return `header not topmost at ${Math.round(x)},${Math.round(y)}: ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)} card=${cardEl.id} hitCard=${hit.closest(".ui-card.child")?.id ?? "none"} html=${hit.outerHTML.slice(0, 120)} headerRect=${Math.round(h.left)},${Math.round(h.top)}-${Math.round(h.right)},${Math.round(h.bottom)}`;
      }
      return null;
    });
    expect(bad, `${step}: card header ${i} ${bad ?? ""}`).toBeNull();
  }
}

/**
 * Generic check (diff scenes): when diff rows are visible at the top
 * of the pane, the pinned slot must be occupied — the file header of
 * the file owning the first visible row, and that row's hunk header,
 * stuck at their sticky offsets and topmost there (a floating card
 * covering the stuck slot fails; pinned headers slide over cards).
 */
async function checkPinnedSlots(page: Page, step: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const pane = document.getElementById("right");
    if (!pane || !pane.querySelector("table.diff")) return null;
    const pv = pane.getBoundingClientRect();
    const hh = (sel: string): number => pane.querySelector(sel)?.getBoundingClientRect().height ?? 0;
    const strip = hh(".rstick");
    const bar = hh(".dtool");
    const fileSlot = pv.top + strip + bar;
    const hunkSlot = fileSlot + hh(".dfile-h");
    // First visible diff row below the actions bar: painted, not
    // merely laid out — a row hidden under a floating card does not
    // count, the first row the reader can actually see does.
    let firstRow: Element | null = null;
    let firstTop = Infinity;
    pane.querySelectorAll(".dfile table.diff tr").forEach((tr) => {
      const r = tr.getBoundingClientRect();
      if (r.bottom <= pv.top + strip + bar || r.top >= pv.bottom || r.top >= firstTop) return;
      const x = Math.min(Math.max(pv.left + pv.width / 2, r.left + 20), r.right - 20);
      const y = Math.min(Math.max((r.top + r.bottom) / 2, pv.top + strip + bar + 2), pv.bottom - 2);
      const hit = document.elementFromPoint(x, y);
      if (hit && tr.contains(hit)) {
        firstTop = r.top;
        firstRow = tr;
      }
    });
    if (!firstRow) return null;
    // Rows only reach the slot area once the pane has scrolled into
    // the file; before that the headers sit in place above the rows.
    const dfile = (firstRow as Element).closest(".dfile");
    const dhunk = (firstRow as Element).closest(".dhunk");
    const fh = dfile?.querySelector(".dfile-h");
    const kh = dhunk?.querySelector(".dhunk-h");
    if (!fh || !kh) return "first visible row has no file/hunk header";
    const fr = fh.getBoundingClientRect();
    const kr = kh.getBoundingClientRect();
    // Only once a header has scrolled up to its slot band must the
    // slot be occupied and topmost; a header still in place further
    // down (its hunk's tail visible under a card) is not there yet.
    if (fr.top > fileSlot + fr.height || kr.top > hunkSlot + kr.height) return null;
    if (Math.abs(fr.top - fileSlot) > fr.height) return `file header not in its slot: top=${Math.round(fr.top)} slot=${Math.round(fileSlot)}`;
    if (Math.abs(kr.top - hunkSlot) > kr.height) return `hunk header not in its slot: top=${Math.round(kr.top)} slot=${Math.round(hunkSlot)}`;
    for (const [el, r, what] of [[fh, fr, "file"], [kh, kr, "hunk"]] as const) {
      const x = Math.min(Math.max(pv.left + pv.width / 2, r.left + 20), r.right - 20);
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) {
        return `${what} header not topmost in its slot at ${Math.round(x)},${Math.round(y)}: ${hit ? hit.tagName + "." + (hit as HTMLElement).className.toString().slice(0, 40) : "nothing"}`;
      }
    }
    return null;
  });
  expect(bad, `${step}: pinned slot ${bad ?? ""}`).toBeNull();
}

/**
 * Generic check (diff scenes): the pinned band — from the actions
 * top edge to the hunk slot's bottom, across the pane width —
 * must never show a floating card. During a file hand-off the
 * outgoing and incoming headers together cover the band; card text
 * flickering through the strips around them fails. Sampled on a
 * horizontal line every 4px.
 */
async function checkPinnedBand(page: Page, step: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const pane = document.getElementById("right");
    if (!pane || !pane.querySelector("table.diff")) return null;
    const pv = pane.getBoundingClientRect();
    const hh = (sel: string): number => pane.querySelector(sel)?.getBoundingClientRect().height ?? 0;
    // The whole top stack, from the pane's top edge (just below the
    // app's top bar) to the band's bottom: the tab strip, the actions
    // bar and the band must be one opaque, gapless stack — a sliver
    // of card text in a seam between sticky layers fails.
    const bandTop = pv.top;
    const bandBottom = pv.top + hh(".rstick") + hh(".dtool") + hh(".dfile-h") + hh(".dhunk-h");
    for (let y = bandTop + 1; y < bandBottom - 1; y += 2) {
      for (let x = pv.left + 8; x < pv.right - 4; x += 40) {
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest(".ui-card.child")) {
          return `card in pinned band at ${Math.round(x)},${Math.round(y)}: ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)} band=${Math.round(bandTop)}-${Math.round(bandBottom)}`;
        }
      }
    }
    // Coverage test: the union of the opaque top-stack layers (tab
    // strip, actions bar, band backing) must cover the whole stack
    // interval with no sub-interval left open. A card behind an open
    // sub-interval shows through it as a sliver of text, even when
    // the gap is sub-pixel and hit sampling lands on a layer edge.
    const cover = [pane.querySelector(".rstick"), pane.querySelector(".dtool"), pane.querySelector(".dband")]
      .filter((el): el is Element => !!el)
      .map((el) => el.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    const cards = [...pane.querySelectorAll(".ui-card.child")].map((c) => c.getBoundingClientRect());
    let coveredTo = bandTop;
    for (const r of cover) {
      if (r.top > coveredTo + 0.2) {
        const hit = cards.find((c) => c.bottom > coveredTo && c.top < r.top);
        if (hit) return `uncovered seam in top stack at y=${Math.round(coveredTo)}-${Math.round(r.top)} with a card behind it`;
      }
      coveredTo = Math.max(coveredTo, r.bottom);
      if (coveredTo >= bandBottom) break;
    }
    if (coveredTo < bandBottom - 0.2) {
      const hit = cards.find((c) => c.bottom > coveredTo && c.top < bandBottom);
      if (hit) return `uncovered top-stack bottom at y=${Math.round(coveredTo)}-${Math.round(bandBottom)} with a card behind it`;
    }
    // Seam test: any positive gap between consecutive top-stack
    // layers (tab strip, actions bar, band backing) whose midpoint
    // lands in a card fails — a text line aligned with a sub-pixel
    // seam shows exactly that sliver, and 2px sampling can miss it.
    const layers = [pane.querySelector(".rstick"), pane.querySelector(".dtool"), pane.querySelector(".dband")]
      .filter((el): el is Element => !!el)
      .map((el) => el.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    for (let i = 0; i + 1 < layers.length; i++) {
      const gap = layers[i + 1].top - layers[i].bottom;
      if (gap <= 0.2) continue;
      const y = (layers[i].bottom + layers[i + 1].top) / 2;
      for (let x = pv.left + 8; x < pv.right - 4; x += 40) {
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest(".ui-card.child")) {
          return `card in top-stack seam at ${Math.round(x)},${y.toFixed(1)}: gap=${gap.toFixed(1)}px ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)}`;
        }
      }
    }
    return null;
  });
  expect(bad, `${step}: pinned band ${bad ?? ""}`).toBeNull();
}

/**
 * Generic check (diff scenes): every visible code row's line-number
 * cells sit inside the pane and are topmost at their centre — a hunk
 * scrolled sideways must keep its gutter (the #189 reopen marker
 * lives there). Floating cards and the pinned top stack may
 * legitimately cover the gutter; code rows may not.
 */
async function checkGutters(page: Page, step: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const pane = document.getElementById("right");
    if (!pane || !pane.querySelector("table.diff")) return null;
    const pv = pane.getBoundingClientRect();
    for (const cell of pane.querySelectorAll("table.diff td.n")) {
      const r = cell.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom <= pv.top || r.top >= pv.bottom) continue;
      const row = cell.closest("tr")?.id ?? "(no id)";
      // Opacity, not just position: `elementFromPoint` cannot see a
      // translucent cell, so assert the computed style directly —
      // a sticky gutter cell (its background and the cell as a whole)
      // must be fully opaque, or code shows through it while the
      // hunk is scrolled sideways.
      const cs = getComputedStyle(cell);
      const bgInner = cs.backgroundColor.match(/(?:rgba?|color)\(([^)]+)\)/)?.[1] ?? "";
      let bgAlpha = 1;
      if (bgInner.includes("/")) {
        const a = (bgInner.split("/").pop() ?? "1").trim();
        bgAlpha = a.endsWith("%") ? Number.parseFloat(a) / 100 : Number.parseFloat(a);
      } else if (bgInner.includes(",")) {
        bgAlpha = Number.parseFloat(bgInner.split(",").pop() ?? "1");
      }
      if (cs.backgroundColor === "transparent" || bgAlpha < 1) {
        return `line-number cell background not opaque: ${cs.backgroundColor} row=${row}`;
      }
      if (Number.parseFloat(cs.opacity) < 1) return `line-number cell translucent: opacity=${cs.opacity} row=${row}`;
      if (r.left < pv.left - 1 || r.right > pv.right + 1) {
        return `line-number cell outside the pane: left=${Math.round(r.left)} right=${Math.round(r.right)} pane=${Math.round(pv.left)}-${Math.round(pv.right)} row=${row}`;
      }
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      // Only a cell whose centre is inside the pane's visible band
      // counts; cells half under the top stack are the stack's.
      if (y < pv.top || y > pv.bottom) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || cell.contains(hit)) continue;
      if (hit.closest(".ui-card.child")) continue;
      if (hit.closest(".dfile-h, .dhunk-h, .dtool, .rstick, .dband, .fmenu, .cmenu, #pop")) continue;
      return `line-number cell not topmost at ${Math.round(x)},${Math.round(y)}: ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)} row=${row}`;
    }
    return null;
  });
  expect(bad, `${step}: gutter ${bad ?? ""}`).toBeNull();
}

/**
 * Issue #261: the unified gutter is at most digits + padding (+ exactly
 * the affordance room: 11px comment icon + 3px margin on the new side,
 * ~18px reopen marker on the old side). Added files drop the empty old
 * column; deleted files drop the new one. Returns the measured widths
 * (px) so the run logs before/after numbers.
 */
async function checkGutterWidth(page: Page, fileKey: string, step: string): Promise<{ old: number; nw: number; digits: number }> {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const info = await page.evaluate((key) => {
    const file = document.getElementById(`F-${key}`);
    if (!file) return null;
    const digits = Number.parseInt(file.style.getPropertyValue("--lnw"), 10) || 0;
    // Measure padding on a code-row number cell, not the `xsep` icon
    // cell (its left padding is 2px, code rows use 8px + 8px).
    const sample = file.querySelector("table.diff tbody > tr:not(.xsep) td.n") ?? file.querySelector("table.diff td.n");
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
    if (sample) {
      const cs = getComputedStyle(sample);
      probe.style.fontFamily = cs.fontFamily;
      probe.style.fontSize = cs.fontSize;
      probe.style.fontStyle = cs.fontStyle;
      probe.style.fontWeight = cs.fontWeight;
      probe.style.letterSpacing = cs.letterSpacing;
    }
    probe.textContent = "0123456789";
    document.body.appendChild(probe);
    const digitW = probe.getBoundingClientRect().width / 10;
    probe.remove();
    let pad = 16;
    if (sample) {
      const cs = getComputedStyle(sample);
      pad = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
    }
    let oldMax = 0;
    let nwMax = 0;
    for (const t of file.querySelectorAll("table.diff:not(.split)")) {
      const hideOld = t.classList.contains("hide-old");
      const hideNew = t.classList.contains("hide-new");
      for (const tr of t.querySelectorAll("tbody > tr")) {
        if (tr.classList.contains("xsep")) continue;
        if ((tr as HTMLElement).dataset.revealed !== undefined) continue;
        const cells = [...tr.querySelectorAll(":scope > td.n")];
        if (cells.length === 2 && !hideOld && !hideNew) {
          oldMax = Math.max(oldMax, cells[0].getBoundingClientRect().width);
          nwMax = Math.max(nwMax, cells[1].getBoundingClientRect().width);
        } else if (cells.length === 1 && (hideOld || hideNew)) {
          const w = cells[0].getBoundingClientRect().width;
          if (hideOld) nwMax = Math.max(nwMax, w);
          else oldMax = Math.max(oldMax, w);
        }
      }
    }
    return {
      digits,
      digitW,
      pad,
      oldMax,
      nwMax,
      hideOld: !!file.querySelector("table.diff.hide-old"),
      hideNew: !!file.querySelector("table.diff.hide-new"),
      isNew: file.classList.contains("is-new"),
      isDeleted: file.classList.contains("is-deleted"),
    };
  }, fileKey);
  expect(info, `${step}: missing #F-${fileKey}`).not.toBeNull();
  const { digits, digitW, pad, oldMax, nwMax, hideOld, hideNew, isNew } = info!;
  // Deleted files keep only the old column (no comment affordance there);
  // added files keep only the new one.
  if (isNew) expect(hideOld, `${step}: added file must hide the empty old column`).toBe(true);
  else expect(hideOld, `${step}: modified file must keep both number columns`).toBe(false);
  expect(hideNew, `${step}: this review has no deleted files`).toBe(false);
  const tol = 3;
  if (!hideOld) {
    expect(oldMax, `${step}: old gutter ${oldMax.toFixed(1)}px wider than ${digits} digits + padding + marker`).toBeLessThanOrEqual(digits * digitW + pad + 18 + tol);
    expect(oldMax, `${step}: no old number cells measured`).toBeGreaterThan(0);
  } else {
    expect(oldMax, `${step}: hidden old column must measure 0`).toBe(0);
  }
  expect(nwMax, `${step}: new gutter ${nwMax.toFixed(1)}px wider than ${digits} digits + padding + icon`).toBeLessThanOrEqual(digits * digitW + pad + 14 + tol);
  expect(nwMax, `${step}: no new number cells measured`).toBeGreaterThan(0);
  console.log(`gutter-261 ${step} ${fileKey}: digits=${digits} old=${oldMax.toFixed(1)}px new=${nwMax.toFixed(1)}px`);
  return { old: oldMax, nw: nwMax, digits };
}

/**
 * Generic check (diff scenes, issue #191): on a settled pane nothing
 * animates forever. Any running infinite animation inside the diff
 * pane fails — unless a working indicator (the dots or a spinner) is
 * visible, meaning a job is genuinely running and motion is the
 * point. One-shot animations (a card rising into place) are not
 * continuous and never count.
 */
async function checkAnimations(page: Page, step: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const pane = document.getElementById("right");
    if (!pane || !pane.querySelector("table.diff")) return null;
    const working = [...pane.querySelectorAll(".dots, .spin")].some((el) => el.getBoundingClientRect().height > 0);
    if (working) return null;
    const running = document
      .getAnimations()
      .filter((a) => {
        if (a.playState !== "running") return false;
        const target = (a.effect as { target?: Element } | null)?.target;
        if (!target || !pane.contains(target)) return false;
        try {
          return a.effect?.getComputedTiming().iterations === Infinity;
        } catch {
          return false;
        }
      })
      .map((a) => {
        const target = (a.effect as { target?: Element } | null)?.target as Element;
        const name = (a as { animationName?: string }).animationName ?? "transition";
        return `${target.tagName}.${target.className.toString().slice(0, 40)}:${name}`;
      });
    return running.length > 0 ? `continuous animations on a settled pane: ${running.join(", ")}` : null;
  });
  expect(bad, `${step}: animations ${bad ?? ""}`).toBeNull();
}

/**
 * Generic check (diff scenes, issue #191): no empty block above a
 * file's first hunk. Every element between the file header and the
 * first hunk's content (and inside that hunk, before its summary or
 * table) must carry text or a control — a bare spacer taller than
 * 8px fails.
 */
async function checkEmptyAboveHunk(page: Page, step: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const pane = document.getElementById("right");
    if (!pane || !pane.querySelector("table.diff")) return null;
    // Issue #202: the pinned band backing (`.dband`) must never cover a
    // file or hunk header — a header under it reads as a blank band
    // above the first hunk, with no file header shown. (The filtered,
    // split and tab-switch cases are covered end to end in J19.)
    const band = pane.querySelector(".dband");
    if (band) {
      const br = band.getBoundingClientRect();
      for (const h of pane.querySelectorAll(".dfile-h, .dhunk-h")) {
        const r = h.getBoundingClientRect();
        if (r.bottom <= br.top || r.top >= br.bottom) continue;
        const hit = document.elementFromPoint(r.left + Math.min(200, r.width / 2), r.top + r.height / 2);
        if (hit && band.contains(hit)) {
          return `header covered by the pinned band backing in ${h.closest(".dfile")?.id ?? "?"}: ${h.className.toString().slice(0, 40)}`;
        }
      }
    }
    const isEmptyBlock = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.height <= 8 || r.width <= 40) return false;
      if ((el.textContent ?? "").trim() !== "") return false;
      if (el.querySelector("svg, img, button, input, textarea, select, a, mark")) return false;
      return true;
    };
    for (const file of pane.querySelectorAll(".dfile")) {
      const firstHunk = file.querySelector(".dhunk");
      if (!firstHunk) continue;
      for (const el of file.querySelectorAll(".dbody *")) {
        if (firstHunk.contains(el)) break;
        if (isEmptyBlock(el)) {
          return `empty block above the first hunk in ${file.id}: ${el.tagName}.${(el as HTMLElement).className.toString().slice(0, 40)} h=${Math.round(el.getBoundingClientRect().height)}`;
        }
      }
      const anchor = firstHunk.querySelector(".fwrap, table.diff, .fcard");
      if (anchor) {
        for (const el of firstHunk.children) {
          if (el === anchor || el.contains(anchor)) break;
          if (el.classList.contains("dhunk-h") || el.classList.contains("dhunk-float")) continue;
          if (isEmptyBlock(el)) {
            return `empty block above the first summary in ${file.id}: ${el.tagName}.${(el as HTMLElement).className.toString().slice(0, 40)} h=${Math.round(el.getBoundingClientRect().height)}`;
          }
        }
      }
    }
    return null;
  });
  expect(bad, `${step}: empty block ${bad ?? ""}`).toBeNull();
}

/**
 * Close a card and wait until that exact card is gone.
 * Close is fire-and-forget (an async action; the card hides when the
 * snapshot patch lands), so a click alone guarantees nothing: on a
 * slow runner the previous card is still open when the next one
 * opens, and `.first()` picks the wrong card (#195). Never swallow
 * the click — a card that will not close is a real failure here.
 */
async function closeCard(page: Page, card: Locator): Promise<void> {
  const id = await card.getAttribute("data-expansion");
  await card.getByRole("button", { name: "Close" }).click();
  const gone = id ? page.locator(`[data-expansion="${id}"]`) : card;
  await expect(gone).toBeHidden({ timeout: 15_000 });
}

async function shot(page: Page, name: string, suffix: string, expectedText?: string): Promise<void> {
  // Never screenshot an empty or still-loading scene: each scene
  // names one piece of real content that must be visible first.
  if (expectedText) {
    await expect(page.getByText(expectedText).first(), `${name}: expected visible text "${expectedText}"`).toBeVisible({ timeout: 15_000 });
  }
  await page.screenshot({ path: path.join(SHOTS, `${name}-${suffix}.png`) });
}

/**
 * Wait until the diff pane's scroll geometry is unchanged across two
 * samples. Selections made while the pane is still re-rendering
 * (Unfold all, cards arriving) lose their toolbar: any scroll after
 * the grace period dismisses it, so a busy pane starves the
 * select-then-Explain steps under load (#195).
 */
async function waitPaneQuiet(page: Page): Promise<void> {
  let last = "";
  for (let i = 0; i < 15; i++) {
    const now = await page.evaluate(() => {
      const p = document.getElementById("right");
      return p ? `${p.scrollTop}:${p.scrollHeight}:${p.querySelectorAll("table.diff tr").length}` : "";
    });
    if (now === last && i > 0) break;
    last = now;
    await page.waitForTimeout(300);
  }
}

async function stepChecks(page: Page, step: string): Promise<void> {
  // Let streamed answers and fixed-position sync settle: wait until
  // every open card's rect is unchanged across two samples.
  let last = "";
  for (let i = 0; i < 10; i++) {
    const now = await page.evaluate(() =>
      [...document.querySelectorAll(".ui-card.child")].map((c) => {
        const r = c.getBoundingClientRect();
        return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      }).join("|"),
    );
    if (now === last && i > 0) break;
    last = now;
    await page.waitForTimeout(300);
  }
  await checkLayout(page, step);
  await checkPinnedSlots(page, step);
  await checkPinnedBand(page, step);
  await checkGutters(page, step);
  await checkAnimations(page, step);
  await checkEmptyAboveHunk(page, step);
  await checkCards(page, step);
  await checkCardHeaders(page, step);
  await checkReplyBoxes(page, step);
  await checkMenus(page, step);
}

for (const combo of [
  { name: "1440-light", width: 1440, dark: false },
  { name: "1440-dark", width: 1440, dark: true },
  { name: "960-light", width: 960, dark: false },
  { name: "960-dark", width: 960, dark: true },
] as const) {
  test(`visual tour (${combo.name})`, async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(240_000);
    await page.setViewportSize({ width: combo.width, height: 900 });
    if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
    const suffix = combo.name;

    // Guide with a pinned card open (the seeded one).
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    // #242: the Plotlines card tops the guide root (two plotlines,
    // one building on the other) — capture it before scrolling on.
    await expect(page.locator(".plotlines")).toBeVisible({ timeout: 15_000 });
    await page.locator(".plotlines").scrollIntoViewIfNeeded();
    await stepChecks(page, "guide-plotlines");
    await shot(page, "guide-plotlines", suffix, "Plotlines");
    // Explain-first guide (#198): the build-up and decisions cards sit
    // after the central change in the settled reader order.
    await expect(page.locator("#C-buildup")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#C-decisions")).toBeVisible({ timeout: 15_000 });
    await page.locator("#C-decisions").scrollIntoViewIfNeeded();
    await stepChecks(page, "guide-decisions");
    await shot(page, "guide-decisions", suffix, "Decisions and questions");
    await page.locator("#C-problem").scrollIntoViewIfNeeded();
    // Open a pinned card the way a reader does: select guide text
    // and Explain it.
    await selectText(page, "#C-problem", "used to let a server continue");
    await page.locator('#selbar [data-act="explain"]').click();
    const seedCard: Locator = page.locator("#page .ui-card.child").first();
    await expect(seedCard).toBeVisible({ timeout: 15_000 });
    await expect(seedCard.locator(".working")).toHaveCount(0, { timeout: 15_000 });
    await expect(seedCard.locator(".ctl").first()).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "guide-pinned");
    await shot(page, "guide-pinned", suffix, "HTTP/1.1 originally");

    // A card opened from inside the pinned card (guide).
    await selectText(page, "#page .ui-card.child [data-answer]", "fold");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#page .ithread[data-pending-thread]");
    await expect(composer).toBeVisible();
    await composer.locator("textarea").fill("Why does this matter?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const guideChild = page.locator("#page [data-expansion]", { hasText: "Why does this matter?" }).last();
    await expect(guideChild).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "guide-nested");
    await shot(page, "guide-nested", suffix, "Why does this matter?");
    await closeCard(page, guideChild);
    await closeCard(page, seedCard);

    // PR description tab (#263): paragraphs, a bullet list, a numbered
    // list past 9 items and inline code, in the shared Card. No
    // "Restated →" links remain.
    await page.locator('#right [role="tab"]').getByText("PR description").click();
    await expect(page.locator("#right #d-p1")).toContainText("obs-fold response-header case", { timeout: 15_000 });
    await expect(page.locator("#right #d-p2")).toContainText("HTTPHeaderDict", { timeout: 15_000 });
    await expect(page.locator("#right ol#d-p6 li").nth(9)).toContainText("towncrier", { timeout: 15_000 });
    await expect(page.locator("#right ol#d-p6 li")).toHaveCount(12);
    await expect(page.locator("#right .desc button.back")).toHaveCount(0);
    await expect(page.locator("#right .desc")).not.toContainText("Restated →");
    await stepChecks(page, "desc-full");
    await shot(page, "desc-full", suffix, "Review checklist");

    // Scrolled to the end of the numbered list: two-digit numbers sit
    // inside the content padding like the single-digit ones.
    await page.locator("#right ol#d-p6 li").nth(11).scrollIntoViewIfNeeded();
    await stepChecks(page, "desc-checklist-end");
    await shot(page, "desc-checklist-end", suffix, "next request");

    // Diff, unified.
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "diff-unified");
    await checkTokenContrast(page, "diff-unified");
    await shot(page, "diff-unified", suffix, "_OBSOLETE_FOLD_RE");

    // Floating card + nested card in the diff.
    await selectText(page, "#right table.diff", "_OBSOLETE_FOLD_RE");
    await page.locator('#selbar [data-act="explain"]').click();
    await expect(page.locator(".dhunk .ui-card.child").first()).toBeVisible({ timeout: 15_000 });
    await selectText(page, ".dhunk .ui-card.child [data-answer]", "fold");
    await page.locator('#selbar [data-act="ask"]').click();
    const dComposer = page.locator(".dhunk .ithread[data-pending-thread]");
    await expect(dComposer).toBeVisible();
    await dComposer.locator("textarea").fill("Why is this here?");
    await dComposer.getByRole("button", { name: "Ask" }).click();
    const diffChild = page.locator(".dhunk [data-expansion]", { hasText: "Why is this here?" }).last();
    await expect(diffChild).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "diff-nested");
    await shot(page, "diff-nested", suffix, "Why is this here?");
    await closeCard(page, diffChild);
    await closeCard(page, page.locator(".dhunk .ui-card.child").first());
    // No diff card may survive into the next step: the long
    // card below is read through `.first()`, by DOM order.
    await expect(page.locator(".dhunk .ui-card.child")).toHaveCount(0, { timeout: 15_000 });

    // Top-level diff card with a LONG answer (the dedicated replay
    // recording), scrolled to its middle and then its bottom inside
    // the card: the gutter must not paint over it and no answer text
    // may show below its sticky reply footer.
    await selectText(page, "#right table.diff", "_normalize_header_values");
    await page.locator('#selbar [data-act="explain"]').click();
    const longCard = page.locator(".dhunk .ui-card.child").first();
    await expect(longCard).toBeVisible({ timeout: 15_000 });
    await expect(longCard.locator(".working")).toHaveCount(0, { timeout: 15_000 });
    await expect(longCard).toContainText("The tests around the helper mirror that split");
    // Frame the whole card in the pane (its footer included), as the
    // reader would scrolling to it, then scroll inside the card.
    await longCard.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    await longCard.evaluate((el) => { el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2); });
    await stepChecks(page, "diff-long-mid");
    await shot(page, "diff-long-mid", suffix);
    await longCard.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await stepChecks(page, "diff-long-bottom");
    await shot(page, "diff-long-bottom", suffix, "In short: read first");
    await closeCard(page, longCard);

    // Same long card in split view, scrolled inside its card.
    await page.getByRole("button", { name: "Split" }).click();
    await selectText(page, "#right table.diff.split", "_normalize_header_values");
    await page.locator('#selbar [data-act="explain"]').click();
    const splitCard = page.locator(".dhunk .ui-card.child").first();
    await expect(splitCard).toBeVisible({ timeout: 15_000 });
    await expect(splitCard.locator(".working")).toHaveCount(0, { timeout: 15_000 });
    await splitCard.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    await splitCard.evaluate((el) => { el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2); });
    await stepChecks(page, "diff-long-split");
    await shot(page, "diff-long-split", suffix);
    await closeCard(page, splitCard);
    await page.getByRole("button", { name: "Unified" }).click();

    // Long card anchored in the file's LAST hunk (the call site at
    // the end of connection.py), overflowing into the NEXT FILE's
    // section: its header and rows must paint below the card too.
    // The call site sits in the file's folded last hunk; unfold all.
    await page.getByRole("button", { name: "Unfold all" }).click({ timeout: 5_000 }).catch(() => {});
    await selectText(page, "#right", "_normalize_header_values(http");
    await page.locator('#selbar [data-act="explain"]').click();
    const fileCard = page.locator(".dhunk .ui-card.child").first();
    await expect(fileCard).toBeVisible({ timeout: 15_000 });
    await expect(fileCard.locator(".working")).toHaveCount(0, { timeout: 15_000 });
    await expect(fileCard).toContainText("The tests around the helper mirror that split");
    await fileCard.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    await fileCard.evaluate((el) => { el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2); });
    await stepChecks(page, "diff-long-file");
    await shot(page, "diff-long-file", suffix);
    // Two scroll offsets around the file boundary, mid hand-off.
    await page.evaluate(() => { const pane = document.getElementById("right"); if (pane) pane.scrollTop += 24; });
    await page.waitForTimeout(300);
    await stepChecks(page, "diff-long-file-h1");
    await shot(page, "diff-long-file-h1", suffix);
    await page.evaluate(() => { const pane = document.getElementById("right"); if (pane) pane.scrollTop += 48; });
    await page.waitForTimeout(300);
    await stepChecks(page, "diff-long-file-h2");
    await shot(page, "diff-long-file-h2", suffix);
    await closeCard(page, fileCard);

    // Closed multi-line Explain keeps a visible reopen marker (#189):
    // select across three rows, Explain, close — the range stays
    // tinted with a gutter marker, and clicking it reopens the card.
    await page.getByRole("button", { name: "Unfold all" }).click({ timeout: 5_000 }).catch(() => {});
    await waitPaneQuiet(page);
    await selectDiffRows(page, "src-urllib3-connection.py", 86, 88);
    await page.locator('#selbar [data-act="explain"]').click();
    const mlCard = page.locator(".dhunk .ui-card.child").first();
    await expect(mlCard).toBeVisible({ timeout: 15_000 });
    await expect(mlCard.locator(".working")).toHaveCount(0, { timeout: 15_000 });
    await mlCard.getByRole("button", { name: "Close" }).click();
    await expect(mlCard).toBeHidden({ timeout: 10_000 });
    const mlMarker = page.locator("mark.anc.range[data-jump]").first();
    await expect(mlMarker).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "diff-multiline-closed");
    await shot(page, "diff-multiline-closed", suffix, "↪");
    // One-shot DOM clicks, retried until the card is actually back:
    // the marker remounts when the card reopens, so a retried
    // Playwright click can land twice (open, then the retry toggles
    // it shut) and starve on detach under load (#195).
    await expect
      .poll(
        async () => {
          if (await mlCard.isVisible().catch(() => false)) return true;
          await mlMarker.evaluate((el) => (el as HTMLElement).click()).catch(() => {});
          return mlCard.isVisible().catch(() => false);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await closeCard(page, mlCard);

    // Sideways-scrolled hunk: the line-number gutter — and the #189
    // reopen marker in its first cell — sticks to the pane's left
    // edge instead of scrolling away with the code.
    await page.locator('[id="F-src-urllib3-connection.py"] .dwrap').first().evaluate((el) => {
      el.scrollLeft = 260;
    });
    await stepChecks(page, "diff-hscroll");
    await shot(page, "diff-hscroll", suffix, "↪");

    // Deep-anchored card in the long socket-level hunk.
    const scope = '[id="F-test-with_dummyserver-test_socketlevel.py"]';
    await selectText(page, scope, 'msg["fold-mixed-repeated"]');
    await page.locator('#selbar [data-act="explain"]').click();
    await expect(page.locator(".dhunk .ui-card.child").first()).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "diff-deep");
    await shot(page, "diff-deep", suffix, "fold-mixed-repeated");
    await closeCard(page, page.locator(".dhunk .ui-card.child").first());

    // Split.
    await page.getByRole("button", { name: "Split" }).click();
    await stepChecks(page, "diff-split");
    await shot(page, "diff-split", suffix, "_OBSOLETE_FOLD_RE");
    await page.getByRole("button", { name: "Unified" }).click();

    // Issue #261 gutter tour: a modified file and an added file in the
    // narrow pane (the 960 combos run the guide beside the diff, so the
    // diff pane is narrow with the source pane open), before and after a
    // sideways scroll (the sticky gutter must hold). Each frame runs the
    // generic layout checks plus the gutter-width assert.
    const MOD = "src-urllib3-connection.py";
    const ADDED = "changelog-1362.bugfix.rst";
    await page.locator(`[id="F-${MOD}"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`[id="F-${MOD}"] table.diff`).first()).toBeVisible();
    await stepChecks(page, "diff-gutter-modified");
    await checkGutterWidth(page, MOD, "diff-gutter-modified");
    await shot(page, "diff-gutter-modified", suffix, "_OBSOLETE_FOLD_RE");
    await page.locator(`[id="F-${MOD}"] .dwrap`).first().evaluate((el) => { el.scrollLeft = 260; });
    await stepChecks(page, "diff-gutter-modified-hscroll");
    await checkGutterWidth(page, MOD, "diff-gutter-modified-hscroll");
    await shot(page, "diff-gutter-modified-hscroll", suffix, "_OBSOLETE_FOLD_RE");
    await page.locator(`[id="F-${MOD}"] .dwrap`).first().evaluate((el) => { el.scrollLeft = 0; });
    // The added changelog file hides under Hide-uninteresting: reveal it
    // (later steps assert no hidden counts, so this is safe here).
    await page.getByRole("button", { name: "Hide uninteresting" }).click();
    await page.locator(`[id="F-${ADDED}"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`[id="F-${ADDED}"] table.diff`).first()).toBeVisible();
    await stepChecks(page, "diff-gutter-added");
    await checkGutterWidth(page, ADDED, "diff-gutter-added");
    await shot(page, "diff-gutter-added", suffix, "bugfix");
    await page.locator(`[id="F-${ADDED}"] .dwrap`).first().evaluate((el) => { el.scrollLeft = 260; });
    await stepChecks(page, "diff-gutter-added-hscroll");
    await checkGutterWidth(page, ADDED, "diff-gutter-added-hscroll");
    await shot(page, "diff-gutter-added-hscroll", suffix, "bugfix");
    await page.locator(`[id="F-${ADDED}"] .dwrap`).first().evaluate((el) => { el.scrollLeft = 0; });

    // Menus: file-type filter, then Reviewed/GitHub filter.
    await page.getByRole("button", { name: "Show file list" }).click({ timeout: 5_000 }).catch(() => {});
    await page.getByRole("button", { name: "File filters" }).click();
    await expect(page.getByRole("menu", { name: "File filters" })).toBeVisible();
    await stepChecks(page, "menu-file-filter");
    await shot(page, "menu-file-filter", suffix, "Generated");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Review filters" }).click();
    await expect(page.getByRole("menu", { name: "Review filters" })).toBeVisible();
    await stepChecks(page, "menu-review-filter");
    await shot(page, "menu-review-filter", suffix, "GitHub comments");
    await page.keyboard.press("Escape");

    // File tree (#227): no horizontal overflow in the panel, and every
    // row's change indicators sit inside its right edge.
    const treeBad = await page.locator(".flist").evaluate((el) => {
      if (el.scrollWidth > el.clientWidth + 1) return `tree scrolls sideways ${el.scrollWidth}>${el.clientWidth}`;
      const box = el.getBoundingClientRect();
      for (const ind of el.querySelectorAll(".fr.file .st, .fr.file .rv")) {
        const r = ind.getBoundingClientRect();
        if (r.left < box.left - 1 || r.right > box.right + 1) return "tree indicator outside the panel";
      }
      return null;
    });
    expect(treeBad, `file-tree: ${treeBad ?? ""}`).toBeNull();
    await stepChecks(page, "file-tree");
    await shot(page, "file-tree", suffix, "connection.py");

    // Comments menu, Comments tab: This review and On GitHub (#226, #236).
    await page.getByRole("button", { name: /Comments/ }).first().click();
    await expect(page.locator('.cmenu [data-cmtab="comments"]')).toBeVisible();
    await expect(page.locator('.cmenu [data-cmsec="review"]')).toContainText("This review");
    await expect(page.locator('.cmenu [data-cmsec="github"]')).toContainText("On GitHub");
    await expect(page.locator('.cmenu [data-cmsec="outbox"]')).toHaveCount(0);
    await stepChecks(page, "menu-comments");
    await shot(page, "menu-comments", suffix, "On GitHub");
    await page.keyboard.press("Escape");

    // Outbox section with the Markdown export box (#223): mark one
    // visible suggested comment, then open the menu — This review,
    // Outbox (with drafts + Copy box) and On GitHub all populated.
    // The four variants share one review, so an earlier variant may
    // already have marked every rendered comment (no "Add to Outbox"
    // left), and at 960 the diff threads can still be mounting when
    // this step starts. Wait (bounded, with a clear message) for a
    // toggle in either state, and only click when nothing is marked.
    const addToOutbox = page.getByRole("button", { name: "Add to Outbox" }).first();
    const inOutbox = page.getByRole("button", { name: "Remove from the Outbox" }).first();
    await expect
      .poll(async () => (await addToOutbox.count()) + (await inOutbox.count()), {
        timeout: 15_000,
        message: "menu-outbox: no comment Outbox toggle rendered yet (diff threads not mounted)",
      })
      .toBeGreaterThan(0);
    if ((await inOutbox.count()) === 0) {
      await addToOutbox.click({ timeout: 10_000 });
      await expect(inOutbox, "menu-outbox: marking a comment did not flip its toggle").toBeVisible({ timeout: 10_000 });
    }
    await page.getByRole("button", { name: /Comments/ }).first().click();
    await page.locator('.cmenu [data-cmtab="outbox"]').click();
    await expect(page.locator(".cmenu [data-outbox-md]")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.cmenu [data-cmsec="outbox"]')).not.toContainText("Nothing in the Outbox yet.");
    await expect(page.locator('.cmenu [data-cmsec="review"]')).toHaveCount(0);
    await expect(page.locator('.cmenu [data-cmsec="github"]')).toHaveCount(0);
    await stepChecks(page, "menu-outbox");
    await shot(page, "menu-outbox", suffix, "Copy");
    await page.keyboard.press("Escape");

    // Debug page (#194): job timings in local time with durations.
    await page.goto(`${svc!.origin}/review/${reviewId}/debug?token=${svc.token}`);
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Queued", { timeout: 30_000 });
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Duration");
    await checkLayout(page, "debug");
    await shot(page, "debug", suffix, "Queued");

    // Debug Output (#207): one view per job (no Prompt button); the
    // first job expanded, turn by turn, with its prompt, reply, tool
    // calls as one expandable line each in a bounded list, and the raw
    // usage payload. The row's Tools count expands the same way.
    await expect(page.getByRole("button", { name: "Prompt" })).toHaveCount(0);
    await page.getByRole("button", { name: "Output" }).first().click();
    await expect(page.locator('[data-testid="job-output"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="job-turn-tool"]').first()).toContainText("Read", { timeout: 15_000 });
    await page.locator('[data-testid="job-turn-tool"]').first().locator("summary").click();
    await expect(page.locator('[data-testid="job-turn-tool"]').first()).toContainText("Arguments", { timeout: 15_000 });
    // Frame the whole job row, header (kind/state) above Turn 1.
    await page.locator(".jobrow").first().scrollIntoViewIfNeeded();
    await checkLayout(page, "debug-output");
    await shot(page, "debug-output", suffix, "Raw usage");

    // Settings → every tab (#225): fields must fit the card at
    // every width. One scene per tab so the failure names the tab.
    for (const tab of [
      { id: "limits", name: "Limits", marker: "Write go-deeper cards automatically" },
      { id: "repositories", name: "Repos", marker: "Add by path" },
      { id: "models", name: "Models", marker: "Writes the guide" },
      { id: "environment", name: "Environment", marker: "Re-check" },
      { id: "version", name: "Version", marker: "Channels" },
      { id: "appearance", name: "Appearance", marker: "Theme" },
    ] as const) {
      await page.goto(`${svc!.origin}/settings?tab=${tab.id}&token=${svc.token}`);
      await expect(page.getByRole("tab", { name: tab.name })).toBeVisible({ timeout: 15_000 });
      if (tab.id === "version") {
        // #233 (with #229's horizontal alignment): enable the picker
        // (fake backend) and assert compact single-line rows sharing
        // the card's side padding with equal heights, and the Channels
        // label bottom-aligned with Refresh above the divider.
        const versionToggle = page.getByTestId("version-picker-toggle");
        if (!(await versionToggle.isChecked())) {
          await versionToggle.click();
          await expect(versionToggle).toBeChecked({ timeout: 15_000 });
        }
        await expect(page.locator('[data-testid="update-channel"]').first()).toBeVisible({ timeout: 30_000 });
        const vToggleBox = await versionToggle.boundingBox();
        const vLabelBox = await page.locator('.ver-toggle label[for="version-picker-toggle"]').boundingBox();
        expect(
          Math.abs(vToggleBox!.y + vToggleBox!.height / 2 - (vLabelBox!.y + vLabelBox!.height / 2)),
          "version: checkbox and label share one line",
        ).toBeLessThanOrEqual(2);
        // #246: the "Releases always listed." help text is gone.
        await expect(page.locator(".ver-toggle-hint")).toHaveCount(0);
        await expect(page.getByTestId("update-current-version")).toHaveCount(0);
        const vRows = page.locator('[data-testid="update-channel"]');
        expect(await vRows.locator(".ui-row-meta").count()).toBe(0);
        const vHeights = await vRows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
        expect(Math.max(...vHeights) - Math.min(...vHeights)).toBeLessThanOrEqual(1.5);
        const vHeadBox = await page.locator(".ver-listhead").boundingBox();
        const vFirstBox = await vRows.first().boundingBox();
        expect(Math.abs(vHeadBox!.x - vFirstBox!.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(vHeadBox!.x + vHeadBox!.width - (vFirstBox!.x + vFirstBox!.width))).toBeLessThanOrEqual(2);
        const vRefreshBox = await page.getByTestId("update-refresh").boundingBox();
        const vChannelsBox = await page.locator(".ver-listhead .hint").boundingBox();
        // Bottom-aligned (#233): the label's bottom and the button's
        // bottom sit the same distance above the divider (the first
        // row's top border), within 2px.
        const vDividerY = vFirstBox!.y;
        const vLabelAbove = vDividerY - (vChannelsBox!.y + vChannelsBox!.height);
        const vButtonAbove = vDividerY - (vRefreshBox!.y + vRefreshBox!.height);
        expect(Math.abs(vLabelAbove - vButtonAbove)).toBeLessThanOrEqual(2);
        const vActionBox = await vRows.locator("button").first().boundingBox();
        expect(Math.abs(vRefreshBox!.x + vRefreshBox!.width - (vActionBox!.x + vActionBox!.width))).toBeLessThanOrEqual(2);
        // Compact rows (#233): each row is at most the button height + 16px.
        const vBtnH = (await vRows.locator("button").first().boundingBox())!.height;
        for (const h of vHeights) {
          expect(h, "version: channel rows are compact").toBeLessThanOrEqual(vBtnH + 16);
        }
      }
      await checkLayout(page, `settings-${tab.id}`);
      await shot(page, `settings-${tab.id}`, suffix, tab.marker);
    }

    // Start page (#225): the "Open a PR" row and the Reviews list
    // share one width. (The PR list with its empty sub-groups needs
    // gh-loaded lists, unreachable in the tour sandbox: no repos, no
    // login. Rules 4b/4c cover it wherever it renders.)
    // Issue #231: stage a newer release (fake backend: installed older
    // than published on the same ref) so the top bar shows the update
    // icon from here on; the Version scene above already ran on the seed.
    {
      const upd = path.join(dataDir, "update");
      mkdirSync(upd, { recursive: true });
      const now = Date.now();
      writeFileSync(
        path.join(upd, "fake-channels.json"),
        JSON.stringify([
          {
            ref: "release",
            version: "0.0.2",
            commit: "tournew00000001",
            builtAt: new Date(now).toISOString(),
          },
        ]),
      );
      writeFileSync(
        path.join(upd, "fake-installed.json"),
        JSON.stringify({
          version: "0.0.1",
          commit: "tourold00000001",
          builtAt: new Date(now - 7 * 86400_000).toISOString(),
        }),
      );
      await apiJson(svc.origin, svc.token, "GET", "/api/update/channels?refresh=1");
    }
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    await page.getByText("Open a PR by URL or number").scrollIntoViewIfNeeded();
    await checkLayout(page, "start");
    await shot(page, "start", suffix, "Open a PR by URL or number");
    await page.getByRole("heading", { name: "Reviews" }).scrollIntoViewIfNeeded();
    await checkLayout(page, "start-reviews");
    await shot(page, "start-reviews", suffix, "Unfold obsolete folded response headers");
    // Issue #231: top bar with the update icon (tooltip names the release).
    await expect(page.getByTestId("update-available-icon")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("update-available-icon")).toHaveAttribute("title", "Update available: v0.0.2");
    await page.evaluate(() => window.scrollTo(0, 0));
    await checkLayout(page, "start-update-icon");
    await shot(page, "start-update-icon", suffix, "Open a PR by URL or number");
    // Issue #235: the full-access marker lives on the front-page top
    // bar (turned on here through settings, back off right after so no
    // later scene sees it).
    await apiJson(svc.origin, svc.token, "PUT", "/api/settings", {
      fullAccess: true,
      fullAccessAcknowledgedAt: Date.now(),
    });
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByTestId("full-access-marker")).toBeVisible({ timeout: 15_000 });
    await page.getByText("Open a PR by URL or number").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await checkLayout(page, "start-full-access");
    await shot(page, "start-full-access", suffix, "full access");
    await apiJson(svc.origin, svc.token, "PUT", "/api/settings", { fullAccess: false });
  });
}

// Issue #265: expanding up lands in the clicked hunk. The demo's worktree
// pads every line outside the hunks blank, so expansion cannot run there;
// these frames use a scratch repo with one two-hunk file over a real gap
// (the J265 journey asserts the placement against the same shape).
test.describe("visual tour diff expansion up (#265)", () => {
  let dir265 = "";
  let data265 = "";
  let svc265: RunningService | null = null;
  let review265 = "";
  let gapLen265 = 0;
  let gapEnd265 = 0;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    dir265 = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-265-repo-"));
    await makeGapRepo(dir265);
    data265 = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-265-data-"));
    svc265 = await startService(data265, { agent: "none" });
    review265 = await createJourneyReview(svc265, dir265);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = (await apiJson(svc265.origin, svc265.token, "GET", `/api/reviews/${review265}`)) as {
        files: { path: string; hunks: { newStart: number; newEnd: number }[] }[];
      };
      const file = snap.files?.find((f) => f.path === "src/big.py");
      if (file && file.hunks.length === 2) {
        gapEnd265 = file.hunks[1].newStart - 1;
        gapLen265 = gapEnd265 - file.hunks[0].newEnd;
        break;
      }
      if (Date.now() > deadline) throw new Error("gap review diff did not land");
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test.afterAll(async () => {
    await svc265?.stop().catch(() => {});
    svc265 = null;
    for (const d of [dir265, data265]) rmSync(d, { recursive: true, force: true });
  });

  test("visual tour diff expansion up (#265)", async ({ page }) => {
    if (!svc265) throw new Error("expansion service not running");
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const suffix = "1440-light";
    const BIG = "src-big.py";
    await page.goto(`${svc265.origin}/review/${review265}?token=${svc265.token}`);
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });
    const file = page.locator(`[id="F-${BIG}"]`);
    await expect(file.getByText("Hunk 2 of 2")).toBeVisible({ timeout: 30_000 });
    const second = file.locator(".dhunk").nth(1);
    // ^ on the second hunk: the tail reads atop its own code.
    await second.getByRole("button", { name: "Show 20 more lines" }).click();
    await expect(second.locator("tr[data-revealed]")).toHaveCount(20, { timeout: 30_000 });
    await page.mouse.move(20, 400);
    await file.getByText("Hunk 2 of 2").scrollIntoViewIfNeeded();
    await stepChecks(page, "diff-expand-up");
    await shot(page, "diff-expand-up", suffix, "Hunk 2 of 2");
    // ⇞ to the previous hunk: the whole gap reads once, into the
    // hunk's first line (20 lines already revealed above).
    await second.getByRole("button", { name: `Show all ${gapLen265 - 20} lines` }).click();
    await expect(second.locator("tr[data-revealed]")).toHaveCount(gapLen265, { timeout: 60_000 });
    await page.mouse.move(20, 400);
    await page.locator(`[id="L-${BIG}-${gapEnd265}"]`).scrollIntoViewIfNeeded();
    await stepChecks(page, "diff-expand-full-gap");
    await shot(page, "diff-expand-full-gap", suffix, "Hunk 2 of 2");
  });
});

// Studio and Console themes (issues #196/#164): one scene set per
// theme in light and dark at 1440px, applied before first paint
// through the boot script's localStorage mirror. The default theme's
// scenes are the four passes above.
for (const combo of [
  { theme: "studio", name: "studio-1440-light", dark: false },
  { theme: "studio", name: "studio-1440-dark", dark: true },
  { theme: "console", name: "console-1440-light", dark: false },
  { theme: "console", name: "console-1440-dark", dark: true },
] as const) {
  test(`visual tour theme (${combo.name})`, async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
    // Persist the theme server-side (the source of truth) and mirror
    // it locally, exactly as Settings -> Appearance leaves the browser.
    await apiJson(svc.origin, svc.token, "PUT", "/api/settings", { uiTheme: combo.theme });
    await page.addInitScript((theme) => {
      try {
        localStorage.setItem("unvibe:ui-theme", theme);
      } catch {
        // Boot falls back to the default theme; the assert below fails.
      }
    }, combo.theme);
    const suffix = combo.name;
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("data-ui-theme", combo.theme);
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    // The theme's bundled fonts actually render (issue #196): each
    // family the theme names must be loaded, not fallen back.
    const fontFamilies =
      combo.theme === "studio" ? ["Fraunces", "Nunito Sans", "DM Mono"] : ["Fira Sans", "Fira Code"];
    for (const family of fontFamilies) {
      const loaded = await page.evaluate(async (f) => {
        try {
          await document.fonts.load(`16px "${f}"`);
          await document.fonts.load(`600 16px "${f}"`);
        } catch { /* check below reports it */ }
        return document.fonts.check(`16px "${f}"`);
      }, family);
      expect(loaded, `${combo.name}: font ${family} loaded`).toBe(true);
    }
    // Shaped advances must match the font's true metrics (issue #196
    // review): under the headless shell, Nunito Sans shaped "T" at
    // 0.77em instead of 0.60em and "The" ran 9% wider than the stack's
    // fallback. Full Chromium shapes the true advances.
    const sansFamily = combo.theme === "studio" ? "Nunito Sans" : "Fira Sans";
    const shaped = await page.evaluate((fam) => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return { tPerEm: 99, theRatio: 99 };
      ctx.font = `13px "${fam}"`;
      const t = ctx.measureText("T").width;
      const the = ctx.measureText("The").width;
      ctx.font = `13px "IBM Plex Sans"`;
      const fallbackThe = ctx.measureText("The").width;
      return { tPerEm: t / 13, theRatio: the / fallbackThe };
    }, sansFamily);
    expect(shaped.tPerEm, `${combo.name}: shaped T advance per em`).toBeLessThanOrEqual(0.68);
    expect(shaped.theRatio, `${combo.name}: "The" width vs fallback`).toBeLessThanOrEqual(1.05);
    await checkLayout(page, `theme-${combo.theme}-guide`);
    await shot(page, `theme-${combo.theme}-guide`, suffix, "Unfold obsolete folded response headers");

    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });
    await checkLayout(page, `theme-${combo.theme}-diff`);
    await checkTokenContrast(page, `theme-${combo.theme}-diff`);
    await shot(page, `theme-${combo.theme}-diff`, suffix, "_OBSOLETE_FOLD_RE");
    // Styling-only theme variables (issue #196): Console's hatched
    // empty cells and thin scrollbars, Studio's none/auto.
    await page.getByRole("button", { name: "Split" }).click();
    await page.waitForSelector("table.diff.split td.empty", { timeout: 15_000 }).catch(() => {});
    const styling = await page.evaluate(() => {
      const empty = document.querySelector("table.diff td.empty");
      return {
        hatch: empty ? getComputedStyle(empty).backgroundImage : "(no empty cell)",
        scrollbar: getComputedStyle(document.documentElement).scrollbarWidth,
      };
    });
    if (combo.theme === "console") {
      expect(styling.hatch, `${combo.name}: hatched empty cells`).toContain("repeating-linear-gradient");
      expect(styling.scrollbar, `${combo.name}: thin scrollbars`).toBe("thin");
    } else {
      expect(styling.hatch, `${combo.name}: no hatching`).toBe("none");
      expect(styling.scrollbar, `${combo.name}: default scrollbars`).toBe("auto");
    }
    await page.getByRole("button", { name: "Unified" }).click();

    await page.goto(`${svc.origin}/settings?tab=appearance&token=${svc.token}`);
    await expect(page.getByRole("tab", { name: "Appearance" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="ui-theme"]')).toContainText(combo.theme === "studio" ? "Studio" : "Console", { timeout: 15_000 });
    await checkLayout(page, `theme-${combo.theme}-settings`);
    await shot(page, `theme-${combo.theme}-settings`, suffix, "Theme");
    await apiJson(svc.origin, svc.token, "PUT", "/api/settings", { uiTheme: "default" });
  });
}

// Issue #281 (variant A Watermark): the start screen in Studio, light
// and dark, at 1440 and 960 (the default theme's start scenes run in the
// four main passes above). One frame per combo: the wordmark top-bar
// logo plus the faint centred ball behind the lists. Resets the theme
// to default, like the theme loop above.
for (const combo of [
  { width: 1440, dark: false },
  { width: 1440, dark: true },
  { width: 960, dark: false },
  { width: 960, dark: true },
] as const) {
  const suffix = `studio-${combo.width}-${combo.dark ? "dark" : "light"}`;
  test(`visual tour start studio (${suffix})`, async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: combo.width, height: 900 });
    if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
    await apiJson(svc.origin, svc.token, "PUT", "/api/settings", { uiTheme: "studio" });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("unvibe:ui-theme", "studio");
      } catch {
        // Boot falls back to the default theme; the assert below fails.
      }
    });
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "studio");
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    await page.getByText("Open a PR by URL or number").scrollIntoViewIfNeeded();
    await checkLayout(page, `start-${suffix}`);
    await shot(page, "start", suffix, "Open a PR by URL or number");
    await apiJson(svc.origin, svc.token, "PUT", "/api/settings", { uiTheme: "default" });
  });
}

// Issue #232 preparing states: while a review is being prepared both
// panes share one modest loading state — the processing indicator plus a
// short label at body size ("Building the guide" / "Loading the diff"),
// inside the pane's normal content padding. Two scenes, every theme ×
// scheme (the default theme at both widths, Studio/Console at 1440px per
// #259), each with checkLayout:
// - ingest loading: the guide shows "Building the guide" and the diff
//   shows "Loading the diff". The ingest is held open on a sleeping fake
//   `gh pr view` (sleeper PIDs recorded for cleanup, so afterAll kills
//   only what this test started);
// - guide building after a finished ingest: the guide still shows
//   "Building the guide" (a seeded running pipeline stage with no pages,
//   stable under agent=none) while the diff is ready.
test.describe("visual tour review preparing (#232)", () => {
  let dir232 = "";
  let bin232 = "";
  let log232 = "";
  let repo232 = "";
  let svc232: RunningService | null = null;
  let loadingId = "";
  let buildingId = "";

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    dir232 = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-232-data-"));
    bin232 = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-232-bin-"));
    log232 = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-232-gh-"));
    // Scratch repo (branch `feature` over `main`): the PR review hangs
    // its ingest on the sleeping fake `gh`; the branch review ingests
    // for real and is then seeded into the building state.
    repo232 = path.join(os.tmpdir(), `unvibe-tour-232-${Date.now()}-demo-app`);
    await exec("git", ["init", "-b", "main", repo232]);
    const g = async (...args: string[]): Promise<void> => {
      await exec("git", args, { cwd: repo232 });
    };
    await g("config", "user.email", "t@example.com");
    await g("config", "user.name", "T");
    writeFileSync(path.join(repo232, "app.py"), "def main():\n    return 1\n");
    await g("add", ".");
    await g("commit", "-m", "base");
    await g("checkout", "-b", "feature");
    writeFileSync(path.join(repo232, "app.py"), "def main():\n    return 2\n");
    await g("add", ".");
    await g("commit", "-m", "feature work");
    const { stdout: headOut } = await exec("git", ["rev-parse", "HEAD"], { cwd: repo232 });
    const head = headOut.trim();
    writeFileSync(
      path.join(bin232, "gh"),
      `#!/bin/sh
LOG="${log232}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo "tour-host: Logged in to github.com account tour-reviewer (e2e stub)"
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo 'tour-reviewer'; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo '[]'; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  sleep 150 & echo $! >> "$LOG/sleep.pids"
  wait
  cat <<EOF
{"title":"Tour preparing PR","body":"First paragraph.","author":{"login":"author"},"state":"OPEN","isDraft":false,"baseRefName":"main","headRefName":"feature","headRefOid":"${head}"}
EOF
  exit 0
fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`,
      { mode: 0o755 },
    );
    writeFakeGitOffline(bin232, realGitPath());
    const fakeShell = path.join(bin232, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${bin232}:$PATH"\n`, { mode: 0o755 });
    const extraEnv = {
      SHELL: fakeShell,
      PATH: `${bin232}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    svc232 = await startService(dir232, { agent: "none", extraEnv, label: "tour232" });
    // PR review: ingest hangs on the sleeping `gh`, staying loading.
    const repos = (await apiJson(svc232.origin, svc232.token, "POST", "/api/repos", { path: repo232 })) as {
      repos: { id: string; localPath: string }[];
    };
    const registered = repos.repos.find((r) => r.localPath === repo232);
    if (!registered) throw new Error("scratch repo not registered");
    const createdLoading = (await apiJson(svc232.origin, svc232.token, "POST", "/api/reviews", {
      repoId: registered.id,
      pr: 1,
    })) as { review: { id: string } };
    loadingId = createdLoading.review.id;
    // Branch review: ingests for real, then seeded into building below.
    const createdBuilding = (await apiJson(svc232.origin, svc232.token, "POST", "/api/reviews", {
      repoId: registered.id,
      branch: "feature",
    })) as { review: { id: string } };
    buildingId = createdBuilding.review.id;
    const readyDeadline = Date.now() + 90_000;
    for (;;) {
      const snap = (await apiJson(svc232.origin, svc232.token, "GET", `/api/reviews/${buildingId}`)) as {
        ingest?: { status?: string };
      };
      if (snap.ingest?.status === "ready") break;
      if (Date.now() > readyDeadline) throw new Error("branch ingest did not finish");
      await new Promise((r) => setTimeout(r, 500));
    }
    // Seed the building state: finished ingest with a real diff, no
    // guide pages, one finished stage with the rest pending (the
    // about-to-queue gap). Stable under agent=none (no pipeline to
    // mutate it); a `running` stage with no live jobs would now read as
    // idle, since running is keyed to live jobs (#247), which agent=none
    // can never provide. The loading review resumes its held ingest on
    // the restart below and stays loading.
    await svc232.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dir232, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(buildingId) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const seeded = JSON.parse(row.snapshot) as {
        pages: unknown[];
        pipeline?: { stages: Record<string, string> };
        jobs: unknown[];
      };
      seeded.pages = [];
      seeded.pipeline = { stages: { reader: "done", base: "pending" } };
      seeded.jobs = [];
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(seeded),
        buildingId,
      );
    } finally {
      db.close();
    }
    svc232 = await startService(dir232, { agent: "none", extraEnv, label: "tour232" });
  });

  test.afterAll(async () => {
    // Wake the held ingests by killing only this test's recorded sleepers.
    try {
      const { readFileSync } = await import("node:fs");
      const pids = readFileSync(path.join(log232, "sleep.pids"), "utf8").split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), "SIGKILL");
        } catch {
          // Already gone.
        }
      }
    } catch {
      // No sleepers recorded.
    }
    await svc232?.stop().catch(() => {});
    svc232 = null;
    for (const d of [dir232, bin232, log232]) rmSync(d, { recursive: true, force: true });
    rmSync(repo232, { recursive: true, force: true });
  });

// Issue #259: non-default themes keep one representative width. The
// loading scenes below assert label alignment and pane padding — not
// narrow-layout behaviour — so the keeper is the widest (1440px).
// Narrow-viewport coverage stays via the default theme's 960px passes.
  for (const combo of [
    { theme: "default", width: 1440, dark: false },
    { theme: "default", width: 1440, dark: true },
    { theme: "default", width: 960, dark: false },
    { theme: "default", width: 960, dark: true },
    { theme: "studio", width: 1440, dark: false },
    { theme: "studio", width: 1440, dark: true },
    { theme: "console", width: 1440, dark: false },
    { theme: "console", width: 1440, dark: true },
  ] as const) {
    const suffix = `${combo.theme}-${combo.width}-${combo.dark ? "dark" : "light"}`;
    test(`visual tour review preparing (${suffix})`, async ({ page }) => {
      if (!svc232) throw new Error("preparing service not running");
      test.setTimeout(120_000);
      await page.setViewportSize({ width: combo.width, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      // Persist the theme server-side (the source of truth) and mirror
      // it locally, exactly as Settings -> Appearance leaves the browser.
      await apiJson(svc232.origin, svc232.token, "PUT", "/api/settings", { uiTheme: combo.theme });
      await page.addInitScript((theme) => {
        try {
          localStorage.setItem("unvibe:ui-theme", theme);
        } catch {
          // Boot falls back to the default theme; the assert below fails.
        }
      }, combo.theme);
      await page.goto(`${svc232.origin}/review/${loadingId}?token=${svc232.token}`);
      await expect(page.locator("html")).toHaveAttribute("data-ui-theme", combo.theme);
      await expect(page.getByTestId("review-loading")).toContainText("Building the guide", { timeout: 30_000 });
      await expect(page.getByTestId("diff-loading")).toContainText("Loading the diff", { timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      // #232 nit: both panes share one padding, so the two labels sit
      // at the same height — their vertical centres match within 2px.
      const labelDy = await page.evaluate(() => {
        const centres = ["review-loading", "diff-loading"].map((t) => {
          const r = document.querySelector(`[data-testid="${t}"] .pane-loading`)?.getBoundingClientRect();
          return r ? (r.top + r.bottom) / 2 : null;
        });
        if (centres[0] === null || centres[1] === null) return null;
        return Math.abs((centres[0] as number) - (centres[1] as number));
      });
      expect(labelDy, `review-preparing-${suffix}: labels misaligned`).not.toBeNull();
      expect(labelDy as number, `review-preparing-${suffix}: labels misaligned`).toBeLessThanOrEqual(2);
      await checkLayout(page, `review-preparing-${suffix}`);
      await shot(page, "review-preparing", suffix, "Loading the diff");
    });
    test(`visual tour guide building (${suffix})`, async ({ page }) => {
      if (!svc232) throw new Error("preparing service not running");
      test.setTimeout(120_000);
      await page.setViewportSize({ width: combo.width, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      await apiJson(svc232.origin, svc232.token, "PUT", "/api/settings", { uiTheme: combo.theme });
      await page.addInitScript((theme) => {
        try {
          localStorage.setItem("unvibe:ui-theme", theme);
        } catch {
          // Boot falls back to the default theme; the assert below fails.
        }
      }, combo.theme);
      await page.goto(`${svc232.origin}/review/${buildingId}?token=${svc232.token}`);
      await expect(page.locator("html")).toHaveAttribute("data-ui-theme", combo.theme);
      await expect(page.getByTestId("guide-empty")).toContainText("Building the guide", { timeout: 30_000 });
      await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await checkLayout(page, `guide-building-${suffix}`);
      await shot(page, "guide-building", suffix, "Building the guide");
    });
  }
});
// Issue #222: the start page's New document review form and a document
// review (rendered blocks, an Explain answer, an Ask answer, a comment,
// and a `code:` citation opening the second context repo's file) in the
// default theme at 1440 light. The context repos are throwaway git
// checkouts registered with the tour's own service.
test("visual tour document review (#222)", async ({ page }) => {
  if (!svc) throw new Error("service not running");
  test.setTimeout(240_000);
  const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-doc222-"));
  const repo2Dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-doc222-b-"));
  try {
    const git = async (...args: string[]): Promise<void> => {
      await exec("git", args, { cwd: repoDir });
    };
    await git("init", "-b", "main");
    await git("config", "user.email", "tour@example.com");
    await git("config", "user.name", "Tour");
    writeFileSync(path.join(repoDir, "README.md"), "# Widget\n\nA widget library.\n");
    mkdirSync(path.join(repoDir, "src"));
    writeFileSync(path.join(repoDir, "src", "widget.ts"), "export const widget = 1;\n");
    await git("add", ".");
    await git("commit", "-m", "init");
    const added = (await apiJson(svc.origin, svc.token, "POST", "/api/repos", { path: repoDir })) as {
      repos: { id: string; localPath: string }[];
    };
    expect(added.repos.some((r) => r.localPath === repoDir)).toBe(true);
    const repoId = added.repos.find((r) => r.localPath === repoDir)!.id;
    // Second context repo: same path, different line, so the cited sha
    // decides whose bytes the file tab shows.
    const git2 = async (...args: string[]): Promise<void> => {
      await exec("git", args, { cwd: repo2Dir });
    };
    await git2("init", "-b", "main");
    await git2("config", "user.email", "tour@example.com");
    await git2("config", "user.name", "Tour");
    writeFileSync(path.join(repo2Dir, "README.md"), "# Widget two\n");
    mkdirSync(path.join(repo2Dir, "src"));
    writeFileSync(path.join(repo2Dir, "src", "widget.ts"), "export const widget = 2; // second repo\n");
    await git2("add", ".");
    await git2("commit", "-m", "init two");
    await git2("remote", "add", "origin", "https://github.com/acme/widget-two.git");
    const added2 = (await apiJson(svc.origin, svc.token, "POST", "/api/repos", { path: repo2Dir })) as {
      repos: { id: string; localPath: string }[];
    };
    const repo2Id = added2.repos.find((r) => r.localPath === repo2Dir)!.id;

    await page.setViewportSize({ width: 1440, height: 900 });

    // Start page: the top bar carries the Documents icon (tooltip
    // "Documents") next to the Unvibe home link; the page itself holds no
    // Document section.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("link", { name: "Documents" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "New document review" })).toHaveCount(0);
    await checkLayout(page, "start-topbar-documents");
    await shot(page, "start-topbar-documents", "1440-light", "Reviews");

    // Documents screen: the New document review form, filled in.
    await page.getByRole("link", { name: "Documents" }).click();
    await page.waitForURL(/\/documents/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "New document review" })).toBeVisible({ timeout: 15_000 });
    await checkLayout(page, "documents-screen");
    await shot(page, "documents-screen", "1440-light", "No documents yet");
    await page.getByRole("button", { name: "New document review" }).click();
    await page.getByTestId("doc-markdown").fill(
      "# Design note\n\nThe widget folds obsolete headers before parsing.\n\nIt keeps the fast path for modern responses.\n\n## Details\n\n- Folding runs before parsing\n- The fast path skips folding\n",
    );
    await page.getByTestId("doc-repo-select-0").selectOption(repoId);
    await page.getByRole("button", { name: "Add another context repo" }).click();
    await page.getByTestId("doc-repo-select-1").selectOption(repo2Id);
    await checkLayout(page, "start-document-form");
    await shot(page, "start-document-form", "1440-light", "Paste the document's Markdown");

    await page.getByRole("button", { name: "Create document review" }).click();
    await page.waitForURL(/\/review\//, { timeout: 30_000 });
    const docReviewId = page.url().split("/review/")[1].split(/[/?#]/)[0];

    // The document, rendered with its blocks.
    await expect(page.getByTestId("document-view")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("document-context")).toContainText("local copy");
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await checkLayout(page, "document-review");
    await shot(page, "document-review", "1440-light", "folds obsolete headers");

    // An Explain answer on document text.
    await selectText(page, "#C-document", "folds obsolete headers");
    await page.locator('#selbar [data-act="explain"]').click();
    const exp = page.locator("#C-document [data-expansion]").first();
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
    await expect(exp.locator(".ctl").first()).toBeVisible({ timeout: 60_000 });
    await checkLayout(page, "document-explain");
    await shot(page, "document-explain", "1440-light", "folds obsolete headers");
    await closeCard(page, exp);

    // An Ask answer on document text.
    await selectText(page, "#C-document", "fast path for modern responses");
    await page.locator('#selbar [data-act="ask"]').click();
    const askComposer = page.locator("#C-document .ithread[data-pending-thread]");
    await expect(askComposer).toBeVisible({ timeout: 10_000 });
    await askComposer.locator("textarea").fill("Why does it keep a fast path?");
    await askComposer.getByRole("button", { name: "Ask" }).click();
    const askCard = page.locator("#C-document [data-expansion]", { hasText: "Why does it keep a fast path?" });
    await expect(askCard.first()).toBeVisible({ timeout: 30_000 });
    await expect(askCard.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
    await expect(askCard.locator(".ctl").first()).toBeVisible({ timeout: 60_000 });
    await checkLayout(page, "document-ask");
    await shot(page, "document-ask", "1440-light", "Why does it keep a fast path?");

    // A local comment on document text.
    await selectText(page, "#C-document", "Folding runs before parsing");
    await page.locator('#selbar [data-act="note"]').click();
    const composer = page.locator("#C-document .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("Please expand this part.");
    await composer.getByRole("button", { name: /comment|save/i }).first().click();
    await expect(page.locator("#C-document .ithread", { hasText: "Please expand this part." }).first()).toBeVisible({
      timeout: 15_000,
    });
    await checkLayout(page, "document-comment");
    await shot(page, "document-comment", "1440-light", "Please expand this part.");

    // A document answer citing the second repo's file (#81): seed the
    // answer (the J81/J222 pattern), click its citation, and frame the
    // file tab showing the second repo's bytes.
    const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${docReviewId}`)) as {
      contextRepos: { repoId: string; sha?: string }[];
    };
    const sha2 = snap.contextRepos.find((c) => c.repoId === repo2Id)?.sha ?? "";
    expect(sha2).toMatch(/^[0-9a-f]{40}$/);
    await svc.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(docReviewId) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const seeded = JSON.parse(row.snapshot) as { annotations: unknown[] };
      seeded.annotations.push({
        id: "ann-doc-cite",
        type: "conversation",
        anchor: {
          host: { kind: "block", blockId: "document#p2" },
          quotedText: "folds obsolete headers",
          prefix: "The widget ",
          suffix: " before parsing.",
          position: 11,
          version: 1,
        },
        open: true,
        pinned: true,
        messages: [],
        post: false,
        turns: [
          {
            question: null,
            blocks: [
              {
                type: "paragraph",
                id: "b-cite",
                text: { standard: "The widget constant lives in the second repo." },
                citations: [{ target: `code:src/widget.ts:1@${sha2}` }],
              },
            ],
          },
        ],
      });
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(seeded),
        docReviewId,
      );
    } finally {
      db.close();
    }
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: { SHELL: tourShellPath, PATH: `${tourBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    await page.goto(`${svc.origin}/review/${docReviewId}?token=${svc.token}`);
    const cited = page.locator("#C-document [data-expansion]", { hasText: "The widget constant lives in the second repo." });
    await expect(cited.first()).toBeVisible({ timeout: 30_000 });
    await cited.first().getByRole("button", { name: "Source" }).click();
    await expect(page.getByRole("tab", { name: "widget.ts" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".codefile")).toContainText("second repo");
    await checkLayout(page, "document-citation");
    await shot(page, "document-citation", "1440-light", "second repo");

    // The document comment on the Outbox tab (#223, #226, #236), with
    // its export box — and no GitHub side on a document, either tab.
    await page.getByRole("button", { name: /Comments/ }).first().click();
    await expect(page.locator('.cmenu [data-cmsec="github"]')).toHaveCount(0);
    await page.locator('.cmenu [data-cmtab="outbox"]').click();
    await expect(page.locator('.cmenu [data-cmsec="github"]')).toHaveCount(0);
    await expect(page.locator("[data-outbox-md]")).toContainText("## Design note › p5", { timeout: 15_000 });
    await stepChecks(page, "document-outbox");
    await shot(page, "document-outbox", "1440-light", "Please expand this part.");
    await page.keyboard.press("Escape");
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(repo2Dir, { recursive: true, force: true });
  }
});

// Issue #203 writing state, on a slow replay (like J6): the fast tour
// replay answers before a writing frame can be captured, so this scene
// runs its own throttled service and screenshots the card mid-answer —
// header and writing state only, no answer toolbar, no reply box. It
// then waits for the answer and screenshots the same card completed.
test("visual tour writing state (slow replay)", async ({ page }) => {
  test.setTimeout(240_000);
  const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-writing-"));
  const slow = await startService(dir, {
    agent: "replay",
    extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
  });
  try {
    const created = (await apiJson(slow.origin, slow.token, "POST", "/api/reviews", { repoId: "demo" })) as {
      review: { id: string };
    };
    const rid = created.review.id;
    await expect
      .poll(
        async () => {
          const snap = (await apiJson(slow.origin, slow.token, "GET", `/api/reviews/${rid}`)) as {
            pages?: { cards?: { id: string }[] }[];
          };
          return (snap.pages ?? []).some((p) => (p.cards ?? []).some((c) => c.id === "central"));
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${slow.origin}/review/${rid}?token=${slow.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const card = page.locator("#C-central [data-expansion]").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator(".working")).toBeVisible({ timeout: 15_000 });
    // While writing: no answer toolbar, no reply box (#203), pinned (#204).
    await expect(card).not.toHaveClass(/floating/);
    await expect(card.locator(".ctl")).toHaveCount(0);
    await expect(card.locator("textarea")).toHaveCount(0);
    mkdirSync(SHOTS, { recursive: true });
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await checkLayout(page, "guide-writing");
    await page.screenshot({ path: path.join(SHOTS, "guide-writing-1440-light.png") });
    // Once the answer arrives, the toolbar and reply box appear.
    await expect(card.locator(".ctl").first()).toBeVisible({ timeout: 120_000 });
    await expect(card.locator("textarea")).toBeVisible({ timeout: 30_000 });
    await checkLayout(page, "guide-writing-done");
    await page.screenshot({ path: path.join(SHOTS, "guide-writing-done-1440-light.png") });
  } finally {
    await slow.stop().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

// Issue #270: a failed Ask follow-up shows the banner with Retry, and
// the retry lands a clean answer (no raw trailing block, no cut-off
// start). Own service lifecycle like the writing-state scene above:
// slow replay, killed mid-answer, restarted fast.
test("visual tour ask retry (#270)", async ({ page }) => {
  test.setTimeout(420_000);
  const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-askretry-"));
  let svc: RunningService | null = await startService(dir, {
    agent: "replay",
    extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
  });
  try {
    const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as {
      review: { id: string };
    };
    const rid = created.review.id;
    await expect
      .poll(
        async () => {
          const snap = (await apiJson(svc!.origin, svc!.token, "GET", `/api/reviews/${rid}`)) as {
            pages?: { cards?: { id: string }[] }[];
          };
          return (snap.pages ?? []).some((p) => (p.cards ?? []).some((c) => c.id === "central"));
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    // One fresh Ask card per theme, so the two kill/restart cycles never
    // share turn state.
    for (const [theme, host, sel, first, followUp] of [
      ["light", "#C-problem", "folded", "What is line folding?", "Does a cookie header change this?"],
      ["dark", "#C-central", "fast path", "What is the fast path?", "What about ordering?"],
    ] as const) {
      if (theme === "dark") {
        await page.emulateMedia({ colorScheme: "dark" });
        // Slow the stream again (the light cycle restarted fast): the
        // follow-up must still be mid-flight at the kill. killHard only —
        // a graceful stop mid-cycle is not what this scene exercises.
        svc.killHard();
        await page.waitForTimeout(500);
        svc = await startService(dir, {
          agent: "replay",
          extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
        });
      }
      await page.goto(`${svc.origin}/review/${rid}?token=${svc.token}`);
      await expect(page.locator(host)).toBeVisible({ timeout: 60_000 });
      await selectText(page, host, sel);
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator(`${host} .ithread[data-pending-thread]`);
      await expect(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill(first);
      await composer.getByRole("button", { name: "Ask" }).click();
      const card = page.locator(`${host} .ui-card.child[data-expansion]`, { hasText: first }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      // Fail the follow-up mid-answer, then restart on the same data dir.
      const box = card.getByPlaceholder(/Ask a follow-up/);
      await expect(box).toBeVisible({ timeout: 30_000 });
      await box.fill(followUp);
      await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
      const turn = card.locator(".ans").last();
      await expect(turn.locator(".working")).toBeVisible({ timeout: 30_000 });
      svc.killHard();
      await page.waitForTimeout(500);
      svc = await startService(dir, { agent: "replay" });
      await page.goto(`${svc.origin}/review/${rid}?token=${svc.token}`);
      await expect(page.locator(host)).toBeVisible({ timeout: 60_000 });
      const shotCard = page.locator(`${host} .ui-card.child[data-expansion]`, { hasText: first }).first();
      await expect(shotCard).toBeVisible({ timeout: 30_000 });
      const failed = shotCard.locator(".ans").last();
      await expect(failed.getByRole("alert")).toContainText("Couldn't get an answer", { timeout: 30_000 });
      await shotCard.scrollIntoViewIfNeeded().catch(() => {});
      mkdirSync(SHOTS, { recursive: true });
      await shot(page, "ask-failed", `1440-${theme}`, "Couldn't get an answer");
      // Retry lands the clean answer.
      await failed.getByRole("button", { name: "Retry" }).click();
      await expect(failed.locator(".ctl")).toBeVisible({ timeout: 120_000 });
      const retried = shotCard.locator(".exp-b").last();
      await expect(retried).not.toBeEmpty({ timeout: 60_000 });
      await expect(retried).not.toContainText('{"contribute"');
      await shotCard.scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, "ask-retried", `1440-${theme}`, followUp);
      if (theme === "dark") await page.emulateMedia({ colorScheme: "light" });
    }
  } finally {
    await svc?.stop().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

// Issue #271: while a follow-up answer is pending, the reply box stays
// visible and editable (Send disabled with the reason as its tooltip)
// and the indicator carries the plain label. One frame per theme: the
// pending turn with a typed draft in the box.
test("visual tour ask pending draft (#271)", async ({ page }) => {
  test.setTimeout(420_000);
  const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-askpending-"));
  const svc: RunningService | null = await startService(dir, {
    agent: "replay",
    extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
  });
  try {
    const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as {
      review: { id: string };
    };
    const rid = created.review.id;
    await expect
      .poll(
        async () => {
          const snap = (await apiJson(svc!.origin, svc!.token, "GET", `/api/reviews/${rid}`)) as {
            pages?: { cards?: { id: string }[] }[];
          };
          return (snap.pages ?? []).some((p) => (p.cards ?? []).some((c) => c.id === "central"));
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [theme, host, sel, first, followUp] of [
      ["light", "#C-problem", "folded", "What is line folding?", "Does a cookie header change this?"],
      ["dark", "#C-central", "fast path", "What is the fast path?", "What about ordering?"],
    ] as const) {
      if (theme === "dark") await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`${svc.origin}/review/${rid}?token=${svc.token}`);
      await expect(page.locator(host)).toBeVisible({ timeout: 60_000 });
      await selectText(page, host, sel);
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator(`${host} .ithread[data-pending-thread]`);
      await expect(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill(first);
      await composer.getByRole("button", { name: "Ask" }).click();
      const card = page.locator(`${host} .ui-card.child[data-expansion]`, { hasText: first }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      const box = card.getByPlaceholder(/Ask a follow-up/);
      await expect(box).toBeVisible({ timeout: 30_000 });
      await box.fill(followUp);
      await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
      const turn = card.locator(".ans").last();
      await expect(turn.locator(".working")).toBeVisible({ timeout: 30_000 });
      await expect(turn.locator(".working")).toHaveText("Writing answer");
      // The box stays through the fill: type the next question already.
      const draft = card.getByPlaceholder(/Ask a follow-up/);
      await expect(draft).toBeVisible();
      await draft.fill("And then?");
      const send = card.getByRole("button", { name: "Reply" });
      await expect(send).toBeDisabled();
      await expect(send).toHaveAttribute("data-tip", "Wait for the answer");
      await card.scrollIntoViewIfNeeded().catch(() => {});
      mkdirSync(SHOTS, { recursive: true });
      await shot(page, "ask-pending", `1440-${theme}`, "And then?");
      // Let the answer land so the next theme starts settled.
      await expect(turn.locator(".ctl")).toBeVisible({ timeout: 120_000 });
      if (theme === "dark") await page.emulateMedia({ colorScheme: "light" });
    }
  } finally {
    await svc?.stop().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

// Issue #81 file tab. The demo review's commits resolve in no checkout,
// so its files cannot be read; these frames use a scratch repo (three
// small files written here, nothing external) on an agent-less service,
// the same way the J81 journey reads real content. Seeded guide cards
// cite files outside the diff; one seeded file-tab comment, marked for
// posting, shows the Submit preview's review-body permalink.
test.describe("visual tour file tab (#81)", () => {
  let ftRepo = "";
  let ftData = "";
  let ftBin = "";
  let ftLog = "";
  let ftSvc: RunningService | null = null;
  let ftReview = "";
  let ftHead = "";

  async function ftGit(...args: string[]): Promise<void> {
    await exec("git", args, { cwd: ftRepo });
  }

  // Stubbed `gh` only (AGENTS.md: tests never hit real GitHub): the
  // fake answers `api user` as "author" and records every call.
  async function ftStart(): Promise<RunningService> {
    const fakeShell = path.join(ftBin, "fakeshell");
    return startService(ftData, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${ftBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
  }

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    // Name the checkout so its registered repo reads local/<name>.
    ftRepo = path.join(os.tmpdir(), `unvibe-tour-ft-${Date.now()}-demo-app`);
    await exec("git", ["init", "-b", "main", ftRepo]);
    await ftGit("config", "user.email", "t@example.com");
    await ftGit("config", "user.name", "T");
    writeFileSync(path.join(ftRepo, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
    writeFileSync(path.join(ftRepo, "other.py"), "red = 1\ngreen = 2\n");
    writeFileSync(path.join(ftRepo, "app.py"), "def main():\n    return 1\n");
    await ftGit("add", ".");
    await ftGit("commit", "-m", "base");
    await ftGit("checkout", "-b", "feature");
    writeFileSync(path.join(ftRepo, "app.py"), "def main():\n    return 2\n");
    await ftGit("add", ".");
    await ftGit("commit", "-m", "feature work");
    const { stdout: headOut } = await exec("git", ["rev-parse", "HEAD"], { cwd: ftRepo });
    ftBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-ft-bin-"));
    ftLog = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-ft-gh-"));
    writeFakeGh(ftBin, ftLog, headOut.trim());
    writeFileSync(
      path.join(ftBin, "fakeshell"),
      `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${ftBin}:$PATH"\n`,
      { mode: 0o755 },
    );
    ftData = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-ft-data-"));
    ftSvc = await ftStart();
    const repos = (await apiJson(ftSvc.origin, ftSvc.token, "POST", "/api/repos", { path: ftRepo })) as {
      repos: { id: string; localPath: string }[];
    };
    const registered = repos.repos.find((r) => r.localPath === ftRepo);
    if (!registered) throw new Error("scratch repo not registered");
    const created = (await apiJson(ftSvc.origin, ftSvc.token, "POST", "/api/reviews", {
      repoId: registered.id,
      branch: "feature",
    })) as { review: { id: string } };
    ftReview = created.review.id;
    // Let ingest settle before seeding: the head SHA must have landed
    // (citations pin to it), and a job still queued at shutdown resumes
    // on the next boot and would replace the seeded snapshot.
    const settleDeadline = Date.now() + 90_000;
    let before: { version: { headSha: string }; files: { path: string }[] } | null = null;
    for (;;) {
      const snap = (await apiJson(ftSvc.origin, ftSvc.token, "GET", `/api/reviews/${ftReview}`)) as {
        version: { headSha: string };
        files: { path: string }[];
        jobs?: { state: string }[];
      };
      const active = (snap.jobs ?? []).some((j) => j.state === "queued" || j.state === "running" || j.state === "backing-off");
      if (snap.version.headSha !== "" && !active) {
        before = snap;
        break;
      }
      if (Date.now() > settleDeadline) throw new Error("scratch ingest did not settle");
      await new Promise((r) => setTimeout(r, 500));
    }
    ftHead = before.version.headSha;
    if (before.files.some((f) => f.path === "helper.py")) throw new Error("helper.py must sit outside the diff");

    await ftSvc.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(ftData, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(ftReview) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const snap = JSON.parse(row.snapshot) as {
        pages: { id: string; kind: string; title: string; cards: unknown[] }[];
        annotations: unknown[];
        pipeline?: { stages: Record<string, string> };
        ingest?: { status: string };
      };
      // Mark the ingest ready and every stage done: a snapshot still
      // saying "loading" is re-ingested on boot, which would replace
      // the seeded guide with an empty one.
      snap.ingest = { status: "ready" };
      snap.pipeline = {
        stages: { reader: "done", base: "done", critic: "done", "hunk-pass": "done", "go-deeper": "done" },
      };
      let root = snap.pages.find((p) => p.id === "root");
      if (!root) {
        root = { id: "root", kind: "root", title: "Guide", cards: [] };
        snap.pages.unshift(root);
      }
      const card = (id: string, text: string, target: string): unknown => ({
        id,
        pageId: "root",
        title: id,
        level: "standard",
        collapsed: false,
        revision: 1,
        blocks: [{ type: "paragraph", id: `b-${id}`, text: { standard: text }, citations: [{ target }] }],
        undoStack: [],
      });
      root.cards.push(
        card("c-beta", "Uses the helper beta value.", `code:helper.py:2@${ftHead}`),
        card("c-past", "Cites past the end.", `code:helper.py:2-99@${ftHead}`),
        card("c-other", "Also see the other file.", `code:other.py:1@${ftHead}`),
      );
      snap.annotations = [
        ...(snap.annotations ?? []),
        {
          id: "ft-comment",
          type: "comment",
          anchor: {
            host: { kind: "code", path: "helper.py", commit: ftHead, line: 2, endLine: 3 },
            quotedText: "beta = 2\ngamma = 3",
            prefix: "",
            suffix: "",
            position: 2,
            version: 1,
          },
          open: true,
          pinned: false,
          messages: [{ who: "you", text: "Is beta still the right default?" }],
          post: true,
        },
      ];
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(snap),
        ftReview,
      );
      // Give the review a PR number so the Submit preview lists the
      // comments instead of the no-PR notice (preview is read-only;
      // nothing posts).
      db.prepare("UPDATE reviews SET pr_number = 7 WHERE id = ?").run(ftReview);
    } finally {
      db.close();
    }
    ftSvc = await ftStart();
  });

  test.afterAll(async () => {
    await ftSvc?.stop().catch(() => {});
    rmSync(ftRepo, { recursive: true, force: true });
    rmSync(ftData, { recursive: true, force: true });
    rmSync(ftBin, { recursive: true, force: true });
    rmSync(ftLog, { recursive: true, force: true });
  });

  for (const combo of [
    { name: "1440-light", width: 1440, dark: false },
    { name: "1440-dark", width: 1440, dark: true },
    { name: "960-light", width: 960, dark: false },
    { name: "960-dark", width: 960, dark: true },
  ] as const) {
    test(`visual tour file tab (${combo.name})`, async ({ page }) => {
      if (!ftSvc) throw new Error("file-tab service not running");
      test.setTimeout(240_000);
      await page.setViewportSize({ width: combo.width, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      const suffix = combo.name;
      await page.goto(`${ftSvc.origin}/review/${ftReview}?token=${ftSvc.token}`);
      await expect(page.getByText("Uses the helper beta value.")).toBeVisible({ timeout: 60_000 });

      // Hover preview of the cited lines at the cited commit.
      await page.locator("#C-c-beta .lk[data-refs]").hover();
      await expect(page.locator("#pop")).toContainText("beta = 2", { timeout: 30_000 });
      await stepChecks(page, "file-hover");
      await shot(page, "file-hover", suffix, "beta = 2");

      // Open tab; a past-the-end citation reuses it, clamped to line 3.
      await page.locator("#C-c-beta .lk[data-refs]").click();
      await expect(page.locator("#right .codefile")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.codefile [data-code-line="2"]')).toHaveClass(/cited/);
      await page.locator("#C-c-past .lk[data-refs]").click();
      await expect(page.getByRole("tab", { name: "helper.py" })).toHaveCount(1);
      await expect(page.locator('.codefile [data-code-line="3"]')).toHaveClass(/cited/);
      await stepChecks(page, "file-tab");
      await shot(page, "file-tab", suffix, "helper.py");

      // A second file opens a second tab; both show close buttons.
      await page.locator("#C-c-other .lk[data-refs]").click();
      await expect(page.getByRole("tab", { name: "other.py" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: /^Close / })).toHaveCount(2);
      await stepChecks(page, "file-tabs");
      await shot(page, "file-tabs", suffix, "other.py");

      // Submit preview: the file-tab comment sits in the review body
      // with its permalink.
      await page.locator("[data-submit]").click();
      const panel = page.locator(".submit");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel).toContainText("goes in the review body", { timeout: 30_000 });
      await expect(panel).toContainText("github.com/local/", { timeout: 30_000 });
      await expect(panel).toContainText("beta = 2", { timeout: 30_000 });
      await expect(panel).toContainText("Is beta still the right default?", { timeout: 30_000 });
      await expect(panel).toContainText("Submit as author", { timeout: 30_000 });
      await stepChecks(page, "file-submit");
      await shot(page, "file-submit", suffix, "review body");
    });
  }
});

/**
 * Remove-confirm popover (#225, #234) on the worst-case Reviews row:
 * decision + new commits (open has no icon). Own service (agent-less) with a scratch repo
 * and a fake `gh` whose PR view resolves the branch head at call time,
 * so a commit added after open is picked up by refresh and the row gains
 * its new-commits tag. The popover is asserted not to move the row's title
 * or meta and not to cover them, then cancelled with Escape.
 */
test.describe("visual tour remove-confirm (#225)", () => {
  let rcRepo = "";
  let rcData = "";
  let rcBin = "";
  let rcLog = "";
  let rcSvc: RunningService | null = null;
  let rcReview = "";

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    rcRepo = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-rc-repo-"));
    await makeScratchRepo(rcRepo);
    rcData = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-rc-data-"));
    rcLog = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-rc-gh-"));
    rcBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-rc-bin-"));
    writeFileSync(
      path.join(rcBin, "gh"),
      `#!/bin/sh
mkdir -p "${rcLog}"
printf '%s\\n' "$*" >> "${rcLog}/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  HEAD=$(git -C "${rcRepo}" rev-parse feature 2>/dev/null || echo none)
  cat <<EOF
{"title":"Tour remove PR","body":"First paragraph.","author":{"login":"author"},"state":"OPEN","isDraft":false,"reviewDecision":"CHANGES_REQUESTED","baseRefName":"main","headRefName":"feature","headRefOid":"$HEAD"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo 'author'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as author"; exit 0; fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`,
      { mode: 0o755 },
    );
    writeFakeGitOffline(rcBin, realGitPath());
    const fakeShell = path.join(rcBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${rcBin}:$PATH"\n`, { mode: 0o755 });
    rcSvc = await startService(rcData, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${rcBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    rcReview = await createJourneyReview(rcSvc, rcRepo, { pr: 1 });
    await expect
      .poll(
        async () =>
          ((await apiJson(rcSvc!.origin, rcSvc!.token, "GET", `/api/reviews/${rcReview}`)) as { ingest?: { status?: string } })
            .ingest?.status,
        { timeout: 120_000 },
      )
      .toBe("ready");
    writeFileSync(path.join(rcRepo, "src", "util.py"), "VALUE = 43\n");
    await journeyGit(rcRepo, "add", ".");
    await journeyGit(rcRepo, "commit", "-m", "bump value");
    await expect
      .poll(
        async () =>
          ((await apiJson(rcSvc!.origin, rcSvc!.token, "GET", `/api/reviews/${rcReview}`)) as { ingest?: { status?: string } })
            .ingest?.status,
        { timeout: 120_000 },
      )
      .toBe("ready");
    // The tour's apiJson always sends a JSON content-type, which Fastify
    // rejects on a bodiless POST; the refresh route ignores its body.
    const refreshed = (await apiJson(rcSvc.origin, rcSvc.token, "POST", `/api/reviews/${rcReview}/refresh`, {})) as {
      newVersion?: boolean;
    };
    expect(refreshed.newVersion).toBe(true);
    await expect
      .poll(async () => {
        const s = (await apiJson(rcSvc!.origin, rcSvc!.token, "GET", "/api/reviews")) as {
          reviews: { id: string; stale?: boolean }[];
        };
        return s.reviews.find((r) => r.id === rcReview)?.stale;
      }, { timeout: 60_000 })
      .toBe(true);
  });

  test.afterAll(async () => {
    await rcSvc?.stop().catch(() => {});
    rcSvc = null;
    for (const d of [rcRepo, rcData, rcBin, rcLog]) rmSync(d, { recursive: true, force: true });
  });

  for (const combo of [
    { name: "1440-light", width: 1440, dark: false },
    { name: "960-light", width: 960, dark: false },
  ] as const) {
    test(`remove-confirm popover on the worst-case row (${combo.name})`, async ({ page }) => {
      if (!rcSvc) throw new Error("remove-confirm service not running");
      test.setTimeout(240_000);
      await page.setViewportSize({ width: combo.width, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      const suffix = combo.name;
      await page.goto(`${rcSvc.origin}/?token=${rcSvc.token}`);
      await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
      const row = page.locator(`[data-testid="session-${rcReview}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      // The most badges a row can have (#234: open has no icon):
      // decision + new commits.
      await expect(row.getByRole("img", { name: "Changes requested" })).toBeVisible();
      await expect(row.getByRole("img", { name: "Open" })).toHaveCount(0);
      await expect(row).toContainText("new commits");
      // Readiness callouts mount above the list after first paint; pin
      // their final state (present here: the hermetic gh stub always
      // fails the fetch probe) before measuring.
      await expect(
        page.locator('[aria-label="Environment problems"]').or(page.getByTestId("readiness-ready")),
      ).toBeVisible({ timeout: 30_000 });
      // Boxes are read atomically (one evaluate per snapshot): the old
      // sequential boundingBox awaits could straddle a layout shift from
      // a late-mounting callout, mixing boxes from two layouts in one
      // "before" set — the 87px CI flake. Settle first (fonts, then
      // identical snapshots across two animation frames), then measure.
      interface RowBox { x: number; y: number; width: number; height: number }
      const readLayout = (): Promise<{ row: RowBox | null; title: RowBox | null; meta: RowBox | null; pop: RowBox | null }> =>
        page.evaluate((id: string) => {
          const rect = (el: Element | null): RowBox | null => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          const rowEl = document.querySelector(`[data-testid="session-${id}"]`);
          const popEl = document.querySelector(".confirm-pop");
          return {
            row: rect(rowEl),
            title: rect(rowEl?.querySelector(".cx2") ?? null),
            meta: rect(rowEl?.querySelector(".cj > .hint") ?? null),
            pop: popEl ? rect(popEl) : null,
          };
        }, rcReview);
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await expect
        .poll(
          async () => {
            const first = await readLayout();
            await page.evaluate(
              () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
            );
            const second = await readLayout();
            return JSON.stringify(first) === JSON.stringify(second) ? "stable" : "settling";
          },
          { timeout: 15_000 },
        )
        .toBe("stable");
      // The row keeps its size and the title/meta keep their size and
      // position relative to it; the popover covers neither. Each side
      // is one atomic snapshot, so a layout shift can never mix boxes
      // from two layouts into one comparison.
      const before = await readLayout();
      expect(before.row).not.toBeNull();
      expect(before.title).not.toBeNull();
      expect(before.meta).not.toBeNull();
      await row.getByRole("button", { name: "Remove this review" }).click();
      const pop = page.locator(".confirm-pop");
      await expect(pop).toContainText("Remove this review?");
      await expect(pop.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
      await expect(pop.getByRole("button", { name: "Cancel" })).toBeVisible();
      const after = await readLayout();
      const sizeOf = (b: { width: number; height: number }): { width: number; height: number } => ({ width: b.width, height: b.height });
      const offsetOf = (
        inner: { x: number; y: number },
        outer: { x: number; y: number },
      ): { dx: number; dy: number } => ({ dx: inner.x - outer.x, dy: inner.y - outer.y });
      expect(sizeOf(after.row!)).toEqual(sizeOf(before.row!));
      expect(sizeOf(after.title!)).toEqual(sizeOf(before.title!));
      expect(sizeOf(after.meta!)).toEqual(sizeOf(before.meta!));
      expect(offsetOf(after.title!, after.row!)).toEqual(offsetOf(before.title!, before.row!));
      expect(offsetOf(after.meta!, after.row!)).toEqual(offsetOf(before.meta!, before.row!));
      const overlaps = (
        a: { x: number; y: number; width: number; height: number },
        b: { x: number; y: number; width: number; height: number },
      ): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlaps(after.pop!, after.title!)).toBe(false);
      expect(overlaps(after.pop!, after.meta!)).toBe(false);
      await checkLayout(page, "start-remove-confirm");
      await shot(page, "start-remove-confirm", suffix, "Remove this review?");
      await page.keyboard.press("Escape");
      await expect(pop).toHaveCount(0);
      await expect(row).toBeVisible();
    });
  }
});
