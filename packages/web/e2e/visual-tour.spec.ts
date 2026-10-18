/**
 * Visual tour against the REAL built service (owner: real testing
 * wherever possible). One spec, four passes (1440px and ~900px, light
 * and dark): the guide with a floating card, a card opened from inside
 * a floating card in the guide and in the diff, the diff in unified
 * and split, a deep-anchored card, every toolbar/file-tree menu, the
 * comments menu, and Settings → Version. Screenshots land in the
 * git-ignored `visual-tour/` folder for the owner to look at.
 *
 * At every step, three generic checks (no per-feature asserts):
 * - every open menu/popover is fully inside the viewport and topmost
 *   at its corners and centre;
 * - every open card's FULL box is inside the viewport horizontally
 *   and topmost across a grid (pinned headers excepted);
 * - no horizontal page overflow.
 *
 * Requires `mise run build` first. Run via `mise run visual-tour`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { selectDiffRows, selectText } from "./select-text.js";
import { cpuThrottleFromEnv } from "./cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";

const exec = promisify(execFile);
const SHOTS = fileURLToPath(new URL("../visual-tour", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

async function apiJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`, "-H", "content-type: application/json"];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

let dataDir = "";
let svc: RunningService | null = null;
let reviewId = "";

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });
test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour-data-"));
  svc = await startService(dataDir, { agent: "replay" });
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
  rmSync(dataDir, { recursive: true, force: true });
});

/** Generic check: no horizontal page overflow. */
async function checkNoPageOverflow(page: Page, step: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    return Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth;
  });
  expect(overflow, `${step}: horizontal page overflow ${overflow}px`).toBeLessThanOrEqual(1);
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
  const cards = page.locator(".card.child.floating:visible");
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
          const hitCard = hit.closest(".card.child.floating");
          if (hitCard && cardEl.contains(hitCard)) continue;
          // A header may cover a card only while it is actually stuck
          // in its pinned slot at the top of the pane (its top equals
          // its sticky offset, ±1px). A header in place mid-pane — the
          // next hunk's or file's, where an overflowing card reaches —
          // must paint below the card, like its rows and gutters.
          if (hit.closest(".dband")) continue;
          const hdr = hit.closest(".dfile-h, .dhunk-h, .dtool, .rstick");
          if (hdr) {
            const pane = document.getElementById("right");
            if (pane) {
              const pt = pane.getBoundingClientRect().top;
              const hh = (sel: string): number => pane.querySelector(sel)?.getBoundingClientRect().height ?? 0;
              const want = hdr.classList.contains("rstick")
                ? pt
                : hdr.classList.contains("dtool")
                  ? pt + hh(".rstick")
                  : hdr.classList.contains("dfile-h")
                    ? pt + hh(".rstick") + hh(".dtool")
                    : pt + hh(".rstick") + hh(".dtool") + hh(".dfile-h");
              // Within the header's own height of the slot counts as
              // in the slot: during the hand-off between files the
              // incoming header sits a few px short of sticking while
              // its rows already fill the pane.
              if (Math.abs(hdr.getBoundingClientRect().top - want) <= hdr.getBoundingClientRect().height) continue;
              return `unpinned header over card at ${Math.round(x)},${Math.round(y)}: ${hdr.className.toString().slice(0, 40)} top=${Math.round(hdr.getBoundingClientRect().top)} pinnedTop=${Math.round(want)} card=${cardEl.id}`;
            }
            continue;
          }
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
  const boxes = page.locator(".card.child.floating textarea:visible");
  for (let i = 0; i < (await boxes.count()); i++) {
    const bad = await boxes.nth(i).evaluate((ta: Element) => {
      const card = ta.closest(".card.child.floating");
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
            const hitCard: Element | null = hit.closest(".card.child.floating");
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
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit) return `nothing at reply input ${Math.round(x)},${Math.round(y)}`;
        if (ta.contains(hit) || (ta as HTMLElement).parentElement?.contains(hit)) continue;
        // Only a descendant card may cover this card's reply input;
        // an ancestor's footer (or anything else) over it fails.
        const hitCard = hit.closest(".card.child.floating");
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
  const cards = page.locator(".card.child.floating:visible");
  for (let i = 0; i < (await cards.count()); i++) {
    const bad = await cards.nth(i).evaluate((cardEl: Element) => {
      const header = cardEl.querySelector(":scope > .exp-h");
      if (!header) return null;
      const h = header.getBoundingClientRect();
      if (h.bottom < 0 || h.top > window.innerHeight) return null;
      // Only the header's visible part counts: a header scrolled out
      // of its own card's box is not covered, it is just scrolled away.
      const c = cardEl.getBoundingClientRect();
      // Issue #192: in a card scrolled internally, the header row
      // (quote, pin, close) must stay REACHABLE: it sticks at the
      // card's own top, and when that top slides under the pane's
      // pinned stack it rests just below the band instead. Either
      // way it must be visible inside the pane and topmost — never
      // merely present behind the stack.
      const scrollTop = (cardEl as HTMLElement).scrollTop;
      const scrolledCard = scrollTop > 4;
      if (scrolledCard && h.top < c.top - 1) {
        return `header scrolled away in a scrolled card: headerTop=${Math.round(h.top)} cardTop=${Math.round(c.top)} scrollTop=${Math.round(scrollTop)} card=${cardEl.id}`;
      }
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
        return scrolledCard
          ? `header not visible in a scrolled card: visiblePart=${Math.round(vb - vt)}px card=${cardEl.id} headerRect=${Math.round(h.left)},${Math.round(h.top)}-${Math.round(h.right)},${Math.round(h.bottom)} cardTop=${Math.round(c.top)}`
          : null;
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
          const hitCard = hit.closest(".card.child.floating");
          if (!hitCard || hitCard === cardEl || cardEl.contains(hitCard)) continue;
        }
        // The pinned top stack (tab strip, actions bar, band, and any
        // header stuck in its slot) slides over cards — but not over
        // a SCROLLED card's header: that header must have moved below
        // the band and be topmost itself (issue #192).
        if (!scrolledCard) {
          if (hit.closest(".rstick, .dtool, .dband")) continue;
          const stuckHdr = hit.closest(".dfile-h.stuck, .dhunk-h.stuck");
          if (stuckHdr) continue;
        }
        return `header not topmost at ${Math.round(x)},${Math.round(y)}: ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)} card=${cardEl.id} hitCard=${hit.closest(".card.child.floating")?.id ?? "none"} html=${hit.outerHTML.slice(0, 120)} headerRect=${Math.round(h.left)},${Math.round(h.top)}-${Math.round(h.right)},${Math.round(h.bottom)}`;
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
        if (hit && hit.closest(".card.child.floating")) {
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
    const cards = [...pane.querySelectorAll(".card.child.floating")].map((c) => c.getBoundingClientRect());
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
        if (hit && hit.closest(".card.child.floating")) {
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
      if (hit.closest(".card.child.floating")) continue;
      if (hit.closest(".dfile-h, .dhunk-h, .dtool, .rstick, .dband, .fmenu, .cmenu, #pop")) continue;
      return `line-number cell not topmost at ${Math.round(x)},${Math.round(y)}: ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)} row=${row}`;
    }
    return null;
  });
  expect(bad, `${step}: gutter ${bad ?? ""}`).toBeNull();
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
 * Close a floating card and wait until that exact card is gone.
 * Close is fire-and-forget (an async action; the card hides when the
 * snapshot patch lands), so a click alone guarantees nothing: on a
 * slow runner the previous card is still floating when the next one
 * opens, and `.first()` picks the wrong card (#195). Never swallow
 * the click — a card that will not close is a real failure here.
 */
async function closeFloating(page: Page, card: Locator): Promise<void> {
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
      [...document.querySelectorAll(".card.child.floating")].map((c) => {
        const r = c.getBoundingClientRect();
        return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      }).join("|"),
    );
    if (now === last && i > 0) break;
    last = now;
    await page.waitForTimeout(300);
  }
  await checkNoPageOverflow(page, step);
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

    // Guide with a floating card open (the seeded one).
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    // Open a floating card the way a reader does: select guide text
    // and Explain it.
    await selectText(page, "#C-problem", "used to let a server continue");
    await page.locator('#selbar [data-act="explain"]').click();
    const seedCard: Locator = page.locator("#page .card.child.floating").first();
    await expect(seedCard).toBeVisible({ timeout: 15_000 });
    await expect(seedCard.locator(".working")).toHaveCount(0, { timeout: 15_000 });
    await stepChecks(page, "guide-floating");
    await shot(page, "guide-floating", suffix, "HTTP/1.1 originally");

    // A card opened from inside the floating card (guide).
    await selectText(page, "#page .card.child.floating [data-answer]", "fold");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#page .ithread[data-pending-thread]");
    await expect(composer).toBeVisible();
    await composer.locator("textarea").fill("Why does this matter?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const guideChild = page.locator("#page [data-expansion]", { hasText: "Why does this matter?" }).last();
    await expect(guideChild).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "guide-nested");
    await shot(page, "guide-nested", suffix, "Why does this matter?");
    await closeFloating(page, guideChild);
    await closeFloating(page, seedCard);

    // Diff, unified.
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "diff-unified");
    await shot(page, "diff-unified", suffix, "_OBSOLETE_FOLD_RE");

    // Floating card + nested card in the diff.
    await selectText(page, "#right table.diff", "_OBSOLETE_FOLD_RE");
    await page.locator('#selbar [data-act="explain"]').click();
    await expect(page.locator(".dhunk .card.child.floating").first()).toBeVisible({ timeout: 15_000 });
    await selectText(page, ".dhunk .card.child.floating [data-answer]", "fold");
    await page.locator('#selbar [data-act="ask"]').click();
    const dComposer = page.locator(".dhunk .ithread[data-pending-thread]");
    await expect(dComposer).toBeVisible();
    await dComposer.locator("textarea").fill("Why is this here?");
    await dComposer.getByRole("button", { name: "Ask" }).click();
    const diffChild = page.locator(".dhunk [data-expansion]", { hasText: "Why is this here?" }).last();
    await expect(diffChild).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "diff-nested");
    await shot(page, "diff-nested", suffix, "Why is this here?");
    await closeFloating(page, diffChild);
    await closeFloating(page, page.locator(".dhunk .card.child.floating").first());
    // No floating diff card may survive into the next step: the long
    // card below is read through `.first()`, by DOM order.
    await expect(page.locator(".dhunk .card.child.floating")).toHaveCount(0, { timeout: 15_000 });

    // Top-level diff card with a LONG answer (the dedicated replay
    // recording), scrolled to its middle and then its bottom inside
    // the card: the gutter must not paint over it and no answer text
    // may show below its sticky reply footer.
    await selectText(page, "#right table.diff", "_normalize_header_values");
    await page.locator('#selbar [data-act="explain"]').click();
    const longCard = page.locator(".dhunk .card.child.floating").first();
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
    await closeFloating(page, longCard);

    // Same long card in split view, scrolled inside its card.
    await page.getByRole("button", { name: "Split" }).click();
    await selectText(page, "#right table.diff.split", "_normalize_header_values");
    await page.locator('#selbar [data-act="explain"]').click();
    const splitCard = page.locator(".dhunk .card.child.floating").first();
    await expect(splitCard).toBeVisible({ timeout: 15_000 });
    await expect(splitCard.locator(".working")).toHaveCount(0, { timeout: 15_000 });
    await splitCard.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(300);
    await splitCard.evaluate((el) => { el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2); });
    await stepChecks(page, "diff-long-split");
    await shot(page, "diff-long-split", suffix);
    await closeFloating(page, splitCard);
    await page.getByRole("button", { name: "Unified" }).click();

    // Long card anchored in the file's LAST hunk (the call site at
    // the end of connection.py), overflowing into the NEXT FILE's
    // section: its header and rows must paint below the card too.
    // The call site sits in the file's folded last hunk; unfold all.
    await page.getByRole("button", { name: "Unfold all" }).click({ timeout: 5_000 }).catch(() => {});
    await selectText(page, "#right", "_normalize_header_values(http");
    await page.locator('#selbar [data-act="explain"]').click();
    const fileCard = page.locator(".dhunk .card.child.floating").first();
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
    await closeFloating(page, fileCard);

    // Closed multi-line Explain keeps a visible reopen marker (#189):
    // select across three rows, Explain, close — the range stays
    // tinted with a gutter marker, and clicking it reopens the card.
    await page.getByRole("button", { name: "Unfold all" }).click({ timeout: 5_000 }).catch(() => {});
    await waitPaneQuiet(page);
    await selectDiffRows(page, "src-urllib3-connection.py", 86, 88);
    await page.locator('#selbar [data-act="explain"]').click();
    const mlCard = page.locator(".dhunk .card.child.floating").first();
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
    await closeFloating(page, mlCard);

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
    await expect(page.locator(".dhunk .card.child.floating").first()).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "diff-deep");
    await shot(page, "diff-deep", suffix, "fold-mixed-repeated");
    await closeFloating(page, page.locator(".dhunk .card.child.floating").first());

    // Split.
    await page.getByRole("button", { name: "Split" }).click();
    await stepChecks(page, "diff-split");
    await shot(page, "diff-split", suffix, "_OBSOLETE_FOLD_RE");
    await page.getByRole("button", { name: "Unified" }).click();

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

    // Comments menu.
    await page.getByRole("button", { name: /Comments/ }).first().click();
    await stepChecks(page, "menu-comments");
    await shot(page, "menu-comments", suffix, "Already on GitHub");
    await page.keyboard.press("Escape");

    // Debug page (#194): job timings in local time with durations.
    await page.goto(`${svc!.origin}/review/${reviewId}/debug?token=${svc.token}`);
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Queued", { timeout: 30_000 });
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Duration");
    await checkNoPageOverflow(page, "debug");
    await shot(page, "debug", suffix, "Queued");

    // Settings → Version.
    await page.goto(`${svc!.origin}/settings?tab=version&token=${svc.token}`);
    await expect(page.getByRole("tab", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    await checkNoPageOverflow(page, "settings-version");
    await shot(page, "settings-version", suffix, "Installed:");
  });
}
