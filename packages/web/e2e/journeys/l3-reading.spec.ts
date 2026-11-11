/**
 * L3 — Guide reading (#363 package B).
 *
 * The guide pane in usage order: dotted-link previews + popover rules,
 * citation previews, navigation/trail/back, on-demand concept + finding
 * pages, the example aside, hover/focus controls, Shiki highlighting +
 * selection, anchor stability under patches and highlight upgrades,
 * anchor-blink footnotes, thread/glossary/cross-node/list marks, select
 * popups, the critic → findings → go-deeper flow, and D2 diagram
 * behaviour (inline, overlay, multiline, on-demand over the service).
 *
 * Boots: none for the mock shell (Vite mock mode); ONE replay service
 * for every demo-backed step (seeded reviews for scroll/anchor/scores
 * shapes, fresh demo reviews per thread-creating step so journeys never
 * share mutable state); ONE agent:none service for the scratch file-tab
 * steps (j81/j317 reseed + restart it in-test); the two j14 D2 services
 * (with/without d2) for the on-demand diagram third.
 *
 * Absorbs: `guide.spec.ts` (10 tests), `shiki-highlight.spec.ts` (4
 * live; the DISABLED #119 python-vs-unknown test stays a unit test),
 * `anchor-idempotence.spec.ts`, `reload-anchored-review.spec.ts`,
 * `glossary-tour.spec.ts` (behaviour; frames → tour), `d2-diagram-inline`
 * (3 live; DISABLED zoom-buttons stays a unit test), `d2-diagram-overlay`
 * (expand/zoom/pan/reset/Esc, citation, theme swap, one 1440-wide fit),
 * `d2-diagram-multiline.spec.ts`, `j81`, `j317`, `j263`, `j252`, `j255`,
 * `j266`, `j20`, `j206`, `j302`, `j303`, `j305`, `j314`, `j306` (slimmed
 * to 1440-light; dark → tour-full), `j225-review-polish` (review-page
 * chrome; the file holds no start-page rows), and the diagram third of
 * `j14` (Add-diagram on-demand, no-d2 fallback, seeded endpoint/render).
 * `diff-pinned`'s ask-inside test belongs to package C and stays in its
 * file; the j2 toolbar half of #147/#319 lives in L4.
 *
 * Guards kept: #15 (idempotence under streamed patches), #101 (highlight
 * upgrade onto marked cells, no page error), #216/#240 (on-demand concept
 * pages, no bookmark control), #274 (controls by hover/focus, shared
 * Tooltip), #302/#304 (glossary label + compact chip), #302 (thread mark
 * vs glossary underline + pinned preview), #303 (cross-node quotes), #305
 * (list citations), #314 (loose lists), #306 (popups above cards), #81 +
 * #332 (code citations + bracket-path chip), #317 (file-tab scroll +
 * re-scroll with tokens), #263 (description card + comments-menu jump),
 * #252 (glossary hover + citation), #255 (python highlights, unknown
 * stays plain, comment places on code), #266 (scroll restore, no
 * self-scroll while filling), #20 (one critic job, findings, go-deeper
 * fills itself / waits for Generate), #206 (anchor blink: chip → open →
 * back → highlight), #341 (re-recorded anchors/copy), #342 (range-only
 * labels — asserted in L6's hide-level steps), #332 (bracket path chip).
 *
 * Brittleness fixed here (#363 §4): the `guide:163` 400 ms sleep (B2 —
 * an absence-watch poll instead: the popover must stay hidden for the
 * whole hover-delay window), `shiki:116`'s 2 s sleep (B2 — inside the
 * DISABLED test, dropped with it), `reload-anchored:41`'s 350 ms scroll
 * settle (B2 — dropped; the app has no smooth scrolling and the #selbar
 * assert is the gate) and `:101`'s 1.5 s stagger wait (B2 — token-span
 * polls on both files + `waitForDomQuiet`), `j206:102`'s 3 s blink watch
 * (B2 — observe only after jobs-quiet + subtree-quiet, then a 1 s
 * quiet-watch instead of a fixed 3 s), and the `hoverFresh` copies (B5 —
 * one shared helper in `../hover-fresh.ts`).
 *
 * Frames removed (tour owns them; package D re-adds): glossary-tour's
 * glossary-links/glossary-hover shots, j20's godeeper-opened /
 * concept-on-open / godeeper-off-generate frames, j306's six
 * select-popup shots, j314's loose-list shot, j81's /tmp bracket-chip
 * frame. No `shot()`/`screenshot` lines remain in the gate.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { hoverFresh } from "../hover-fresh.js";
import { waitForDomQuiet } from "../dom-quiet.js";
import { openPopup } from "../select.js";
import { selectText } from "../select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import {
  apiJson,
  createDemoReview,
  createSeededDemoReview,
  createScratchReview,
  git,
  makeScratchRepo,
  realGitPath,
  stampDataFormat,
  writeFakeGh,
  writeFakeGitOffline,
} from "./journey-helpers.js";
import {
  canonicalizeD2Source,
  diagramHash,
  D2_MIN_VERSION,
  parseReply,
  type DiagramBlock,
} from "@unvibe/shared";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

// ---------------------------------------------------------------------------
// Mock shell: no service boot. Every test below loads `/review/demo` in
// Vite mock mode and walks one guide behaviour in usage order.
// ---------------------------------------------------------------------------

/** Mock guide ready: title rendered, webfonts settled. */
async function gotoMockReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/** Issue #167: the demo seeds an open pinned thread under C-problem that
 * overlays the controls below it — close it first, as a reader would. */
async function closeSeedCard(page: Page): Promise<void> {
  await page.locator('#C-problem section.ithread[data-thread]').getByRole("button", { name: "Close" }).first().click();
}

async function openPopover(page: Page): Promise<void> {
  await hoverFresh(page, page.locator('#page a.cx[data-link="concept:obs-fold"]').first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
}

/** Token-aware selection: token spans split diff text across many nodes,
 * so locate the anchor in the joined per-cell text first, then map back
 * to node+offset — then dispatch mouseup so the toolbar reacts. Returns
 * the snapped quote. */
async function selectSpanning(page: Page, rootSelector: string, anchor: string): Promise<string> {
  await page.evaluate((rootSelector) => {
    document.querySelector(rootSelector)?.scrollIntoView({ block: "center" });
  }, rootSelector);
  // No settle wait: the app has no smooth scrolling.
  const ok = await page.evaluate(
    ({ rootSelector, anchor }) => {
      const root = document.querySelector(rootSelector);
      if (!root) return false;
      const cells = [...root.querySelectorAll("td.c")];
      const scopes = cells.length > 0 ? cells : [root];
      for (const scope of scopes) {
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
        const joined = nodes.map((n) => n.data).join("");
        const at = joined.indexOf(anchor);
        if (at < 0) continue;
        const end = at + anchor.length;
        const nodeAt = (offset: number): { node: Text; at: number } | null => {
          let acc = 0;
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const next = acc + n.data.length;
            if (offset < next) return { node: n, at: offset - acc };
            if (offset === next) {
              return i + 1 < nodes.length ? { node: nodes[i + 1], at: 0 } : { node: n, at: n.data.length };
            }
            acc = next;
          }
          return null;
        };
        const s = nodeAt(at);
        const e = nodeAt(end);
        if (!s || !e) continue;
        const range = document.createRange();
        try {
          range.setStart(s.node, s.at);
          range.setEnd(e.node, e.at);
        } catch {
          continue;
        }
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        (range.endContainer as Text).parentElement?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return true;
      }
      return false;
    },
    { rootSelector, anchor },
  );
  expect(ok).toBe(true);
  // Wait on the real condition (toolbar visible), not a fixed sleep: the
  // slower CI runner needs longer than 3s for the selection to settle and
  // the bar to render (#251). 10s matches the other specs' settle waits.
  await expect(page.locator("#selbar")).toBeVisible({ timeout: 10_000 });
  return (await page.evaluate(() => (getSelection()?.toString() ?? "").trim().replace(/\s+/g, " "))) ?? "";
}

declare global {
  interface Window {
    __revealSource?: (ref: string) => boolean;
  }
}

const CONN = "src-urllib3-connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";
const connFile = `[id="F-${CONN}"]`;
const D2_BLOCK = "#C-g-alt #B-b-demo-diagram-central";
const D2_DIALOG = '[role="dialog"][aria-label="Expanded diagram"]';

test.describe("L3 guide mock shell", () => {
  test("dotted links preview, popovers dismiss, scroll re-arms hover", async ({ page }) => {
    test.setTimeout(180_000);
    await test.step("dotted-link hover preview: timing and content", async () => {
      await gotoMockReview(page);
      const link = page.locator('#page a.cx[data-link="concept:obs-fold"]').first();
      await hoverFresh(page, link);
      // Not instant: opens after ~0.2 s.
      await expect.soft(page.locator("#pop")).toBeHidden({ timeout: 100 }).catch(() => {});
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 3000 });
      // #216: before the page is written, the preview is the link's own
      // label and Click to open — no stored summary or content.
      const label = (await link.innerText()).trim();
      await expect.soft(page.locator("#pop")).toContainText(label);
      await expect.soft(page.locator("#pop")).toContainText("Click to open");
      await expect.soft(page.locator("#pop")).not.toContainText("Mock concept page");
      // Open it, let the (mock) concept job write it, come back: now the
      // preview shows the written page's title and content.
      await link.click();
      await expect.soft(page.locator("#page h1.title")).toContainText("Obsolete line folding", { timeout: 15_000 });
      await page.locator("#page nav.crumbs button").first().click();
      await expect.soft(page.locator("#page h1.title")).toContainText("Unfold obsolete folded", { timeout: 15_000 });
      await hoverFresh(page, page.locator('#page a.cx[data-link="concept:obs-fold"]').first());
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 3000 });
      await expect.soft(page.locator("#pop")).toContainText("Obsolete line folding (obs-fold)");
      await expect.soft(page.locator("#pop")).toContainText("Click to open");
    });

    await test.step("popover closes on scroll, Escape, press outside and resize", async () => {
      await gotoMockReview(page);
      await openPopover(page);
      // Any scroll anywhere closes it.
      await page.evaluate(() => document.querySelector("#page")?.scrollTo(0, 200));
      await expect.soft(page.locator("#pop")).toBeHidden();

      await openPopover(page);
      await page.keyboard.press("Escape");
      await expect.soft(page.locator("#pop")).toBeHidden();

      await openPopover(page);
      await page.mouse.click(300, 20);
      await expect.soft(page.locator("#pop")).toBeHidden();

      await openPopover(page);
      await page.setViewportSize({ width: 1399, height: 900 });
      await expect.soft(page.locator("#pop")).toBeHidden();
    });

    await test.step("after a scroll, hover is ignored until the pointer moves", async () => {
      await gotoMockReview(page);
      await page.evaluate(() => document.querySelector("#page")?.scrollTo(0, 200));
      // Synthetic hover with no pointer movement: no popover. The absence
      // needs its window: poll that it stays hidden across the whole
      // hover-delay window (#363 B2) instead of a fixed sleep.
      const t0 = Date.now();
      await page.evaluate(() => {
        const el = document.querySelector('#page a.cx[data-link="concept:obs-fold"]');
        el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      });
      await expect
        .poll(async () => !(await page.locator("#pop").isVisible()) && Date.now() - t0 > 400, { timeout: 5000 })
        .toBe(true);
      // A real pointer move re-arms hover.
      await hoverFresh(page, page.locator('#page a.cx[data-link="concept:obs-fold"]').first());
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 3000 });
    });
  });

  test("citations preview real lines; pages, trail and back all work", async ({ page }) => {
    test.setTimeout(180_000);
    await test.step("citation hover previews real cited lines", async () => {
      await gotoMockReview(page);
      await closeSeedCard(page);
      await hoverFresh(page, page.locator("#C-central .lk[data-refs]").first());
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 3000 });
      await expect.soft(page.locator("#pop .cite .loc").first()).toContainText("connection.py:");
      await expect.soft(page.locator("#pop")).toContainText("_OBSOLETE_FOLD_RE");
    });

    await test.step("navigation, trail and browser back", async () => {
      await gotoMockReview(page);
      await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
      await expect.soft(page).toHaveURL(/\/review\/demo\/page\/c-obs-fold/);
      // #216: written on open; the title arrives with the written page.
      await expect.soft(page.locator("#page h1.title")).toContainText("Obsolete line folding", { timeout: 15_000 });
      const trail = page.locator("#page nav.crumbs");
      await expect.soft(trail).toContainText("Unfold obsolete folded response headers");
      await trail.getByRole("button").first().click();
      await expect.soft(page).toHaveURL(/\/review\/demo\/?$/);

      // Browser back/forward works too.
      await page.locator('#page a.cx[data-link="concept:http-headers"]').first().click();
      await expect.soft(page).toHaveURL(/page\/c-http-headers/);
      await page.goBack();
      await expect.soft(page).toHaveURL(/\/review\/demo\/?$/);
      await expect.soft(page.locator("#page h1.title")).toContainText("Unfold obsolete folded");
    });

    await test.step("on-demand concept page renders with no bookmark control (#216, #240)", async () => {
      await gotoMockReview(page);
      await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
      await expect.soft(page.locator("#page h1.title")).toContainText("Obsolete line folding", { timeout: 15_000 });
      await page.locator('#page a.cx[data-link="concept:ows-rws"]').first().click();
      await expect.soft(page).toHaveURL(/\/review\/demo\/page\/c-ows-rws/);
      // The on-demand concept page renders (mock and replay titles differ,
      // so assert non-empty, not exact text) with no bookmark control and
      // (#326) no collapse control in the title row — it lives in the top bar.
      await expect.soft(page.locator("#page h1.title")).not.toBeEmpty({ timeout: 15_000 });
      await expect.soft(page.locator("#page .title-row button")).toHaveCount(0);
      await expect.soft(page.getByRole("button", { name: "Collapse threads" })).toBeVisible();
    });

    await test.step("finding page carries its label and evidence", async () => {
      // Issue #341: no guide card links findings anymore, so open the bare-LF
      // finding page directly.
      await gotoMockReview(page);
      await page.goto("/review/demo/page/f-critic-2");
      await expect.soft(page).toHaveURL(/page\/f-critic-2/);
      await expect.soft(page.locator("#page .eyebrow")).toContainText("Agent finding · medium confidence");
      await expect.soft(page.locator("#page .doc")).toHaveClass(/finding/);
      await expect.soft(page.locator("#page .doc")).toContainText("Bare-LF folds are not unfolded");
      await expect.soft(page.locator("#page .doc")).toContainText("Evidence");
    });

    await test.step("concept page renders the example aside", async () => {
      // #216: the page is written when its link is opened, example included.
      await gotoMockReview(page);
      await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
      await expect.soft(page.locator("#page h1.title")).toContainText("Obsolete line folding", { timeout: 15_000 });
      await expect.soft(page.locator("#page .gen-aside")).toContainText("urllib3 now returns", { timeout: 15_000 });
    });
  });

  test("card controls reveal on hover or focus with the shared Tooltip (#274)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoMockReview(page);
    await test.step("the toolbar lives in the heading row and reveals on hover or focus", async () => {
      // The problem card seeds a conversation underneath; scope to the card's
      // own control row so the answer's controls do not match.
      const toolbar = page.locator("#C-problem .chead .ctl").first();
      const examples = toolbar.getByRole("button", { name: "Use examples" });
      await expect.soft(toolbar).toHaveCSS("opacity", "0");
      await page.locator("#C-problem").hover();
      await expect.soft(toolbar).toHaveCSS("opacity", "1");
      // Keyboard: focusing a control reveals the row via :focus-within.
      await page.mouse.move(0, 0);
      await examples.focus();
      await expect.soft(toolbar).toHaveCSS("opacity", "1");
      await expect.soft(examples).toBeEnabled();
    });

    await test.step("control tooltips use the shared Tooltip", async () => {
      await hoverFresh(page, page.locator('#C-problem .chead .ctl').getByRole("button", { name: "Use examples" }));
      await expect.soft(page.locator("#tip")).toContainText("Use examples", { timeout: 3000 });
    });
  });

  test("highlighting, selection, Explain/Close and revealSource coexist", async ({ page }) => {
    test.setTimeout(240_000);
    await test.step("?nohl=1 renders the plain first-paint state (no token spans)", async () => {
      // Deterministic escape-hatch check: with ?nohl=1 the Shiki chunk must
      // never even load (not just "no spans yet", which passes vacuously when
      // highlighting is merely slow).
      const shikiRequests: string[] = [];
      await page.route("**/.vite/deps/shiki*", async (route) => {
        shikiRequests.push(route.request().url());
        await route.continue();
      });
      await page.goto("/review/demo?nohl=1", { waitUntil: "domcontentloaded" });
      await expect.soft(page.locator(connFile)).toBeVisible();
      // One code table per hunk (#140), so scope visibility to the first.
      await expect.soft(page.locator(`${connFile} table.diff`).first()).toBeVisible();
      expect.soft(shikiRequests).toEqual([]);
      await expect.soft(page.locator("table.diff td.c [class*='shk-']")).toHaveCount(0);
      // The pane itself is unaffected: files, hunks and line numbers render.
      await expect.soft(page.locator(`${connFile} table.diff`).first()).toBeVisible();
      await page.unroute("**/.vite/deps/shiki*");
    });

    await test.step("selection across token spans snaps to words and Ask opens a composer", async () => {
      await gotoMockReview(page);
      await expect.soft(page.locator(`${connFile} td.c .shk-kw`).first()).toBeVisible({ timeout: 15000 });
      // Spanning range across `…OBSOLETE_FOLD_RE.sub(…)` (several token spans).
      const quote = await selectSpanning(page, `${connFile} table.diff`, "_OBSOLETE_FOLD_RE.sub");
      expect.soft(quote).toContain("OBSOLETE_FOLD_RE");
      await expect.soft(page.locator("#selbar")).toBeVisible();
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator(`${connFile} .ithread[data-pending-thread]`);
      await expect.soft(composer).toBeVisible({ timeout: 5000 });
      await expect.soft(composer.locator(".mq")).toContainText("OBSOLETE_FOLD_RE");
      await composer.locator("textarea").fill("Why this regex?");
      await composer.getByRole("button", { name: "Ask" }).click();
      // An Ask on diff code opens the usual thread under the line:
      // working state, then the answer with its question and reply box.
      const card = page.locator(`${connFile} section.ithread[data-thread]:has([data-reply][data-kind="ask"])`, { hasText: "Why this regex?" });
      await expect.soft(card).toBeVisible({ timeout: 5000 });
      await expect.soft(card.locator(".working")).toBeVisible({ timeout: 3000 });
      // Issue #293: the question is a reviewer entry, not a muted heading.
      await expect.soft(card.locator("[data-ask-question]").first()).toContainText("Why this regex?", { timeout: 8000 });
      await expect.soft(card.locator("[data-ask-answer] .ans-q")).toHaveCount(0);
      await expect.soft(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 8000 });
    });

    await test.step("Explain then Close leaves one flat dotted anchor mark in highlighted code", async () => {
      await gotoMockReview(page);
      await expect.soft(page.locator(`${connFile} td.c .shk-kw`).first()).toBeVisible({ timeout: 15000 });
      const quote = await selectSpanning(page, `${connFile} table.diff`, "header_items = message.items");
      expect.soft(quote.length).toBeGreaterThanOrEqual(2);
      await page.locator('#selbar [data-act="explain"]').click();
      const card = page.locator(`${connFile} section.ithread[data-thread]:has([data-reply][data-kind="explain"])`).first();
      await expect.soft(card).toBeVisible({ timeout: 5000 });
      await expect.soft(card.locator(".exp-b")).toContainText("Mock explanation", { timeout: 8000 });
      await expect.soft(card.getByRole("button", { name: "Close" })).toBeVisible();
      await card.getByRole("button", { name: "Close" }).click();
      await expect.soft(card).toHaveCount(0);
      // The dotted link sits inside highlighted code (token spans): one mark
      // per intersecting text node (anchor.ts design for multi-node quotes),
      // all flat and sharing one id — whatever order tokens and marks landed in.
      const mark = page.locator(`${connFile} td.c mark.anc.exl`).first();
      await expect.soft(mark).toBeVisible({ timeout: 8000 });
      // Whatever order tokens and marks landed in: wait for the subtree to go
      // quiet instead of a fixed settle.
      await waitForDomQuiet(page, "#right");
      const marks = page.locator(`${connFile} td.c mark.anc.exl`);
      expect.soft(await marks.count()).toBeGreaterThanOrEqual(1);
      expect.soft(await page.locator("#right mark.anc mark.anc").count()).toBe(0);
      const jumps = await marks.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.jump));
      expect.soft(new Set(jumps).size).toBe(1);
      // Click re-expands in place.
      await mark.click();
      await expect.soft(page.locator(`${connFile} section.ithread[data-thread]:has([data-reply][data-kind="explain"])`).first()).toBeVisible({ timeout: 5000 });
    });

    await test.step("revealSource highlights lines that are also token-highlighted", async () => {
      await gotoMockReview(page);
      await expect.soft(page.locator(`${connFile} td.c .shk-kw`).first()).toBeVisible({ timeout: 15000 });
      const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650-651`), CONN);
      expect.soft(ok).toBe(true);
      const row = page.locator(`[id="L-${CONN}-650"].hl`);
      await expect.soft(row).toBeVisible();
      await expect.soft(page.locator(`[id="L-${CONN}-651"].hl`)).toBeVisible();
      // The reveal highlight and the token spans coexist in the same row.
      await expect.soft(row.locator("td.c [class*='shk-']").first()).toBeVisible();
      // Same in split view: paired cells keep their own side's tokens.
      await page.getByRole("button", { name: "Split", exact: true }).click();
      const splitTable = page.locator(`${connFile} table.diff.split`).first();
      await expect.soft(splitTable).toBeVisible();
      await expect.soft(splitTable.locator("td.c [class*='shk-']").first()).toBeVisible();
    });

    await test.step("highlighted rows copy as plain text without artefacts", async () => {
      await gotoMockReview(page);
      // Steps share one browser context (the originals each got a fresh
      // one), so the Split view from the revealSource step above persists:
      // paired split rows carry no `add` class, so go back to unified.
      if ((await page.locator(`${connFile} table.diff.split`).count()) > 0) {
        await page.getByRole("button", { name: "Unified" }).click();
      }
      await expect.soft(page.locator(`${connFile} td.c .shk-kw`).first()).toBeVisible({ timeout: 15000 });
      const text = await page.evaluate((key) => {
        const row = document.querySelector(`tr.add[id^="L-${key}-"] td.c`);
        return row?.textContent ?? null;
      }, CONN);
      expect.soft(text).not.toBeNull();
      expect.soft(text!.startsWith("+")).toBe(true);
      // No zero-width / object-replacement artefacts from the spans.
      expect.soft(text!).not.toMatch(/(?:\u200B|\u200C|\u200D|\uFFFC)/u);
      expect.soft(text!.length).toBeLessThan(2000);
    });
  });

  test("anchor marks stay flat under patches and highlight upgrades (#15, #101)", async ({ page }) => {
    test.setTimeout(240_000);
    await test.step("many snapshot patches leave mark depth 1; selection and reply focus survive", async () => {
      await gotoMockReview(page);
      await expect.soft(page.locator('mark.anc.ex[data-jump="x-seed"]')).toBeVisible({ timeout: 8000 });
      await expect.soft(page.locator('mark.anc[data-thr="t-seed"]:not(.fnote)')).toBeVisible({ timeout: 8000 });
      const hasHook = await page.evaluate(
        () => typeof (window as unknown as { __streamPatches?: unknown }).__streamPatches,
      );
      expect.soft(hasHook).toBe("function");
      const stream = (): Promise<void> =>
        page.evaluate(() => {
          (window as unknown as { __streamPatches: (n: number) => void }).__streamPatches(25);
        });

      // Phase A: a guide-prose selection (inside the thread mark itself, the
      // hard case for offset-preserving re-highlighting) survives patches.
      // No focus changes here: __streamPatches never touches focus.
      const selected = await page.evaluate(() => {
        const root = document.querySelector("#C-central");
        if (!root) return "";
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const data = (node as Text).data;
          const at = data.indexOf("the original message");
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + "the original message".length);
          const sel = getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          return sel?.toString() ?? "";
        }
        return "";
      });
      expect.soft(selected).toBe("the original message");
      await stream();
      // The hook is synchronous: all patches are in the store when evaluate
      // returns; only the React commit and highlight effects are pending, so
      // wait for the subtree to go quiet instead of a fixed sleep.
      await waitForDomQuiet(page, "#page");
      expect.soft(await markDepth(page)).toBe(1);
      expect.soft(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("the original message");

      // Phase B: a focused reply box with a draft (and its cursor) survives
      // patches. (Focusing the box natively drops the phase-A guide selection;
      // that is browser behaviour, not patch damage, so it is not asserted here.)
      const reply = page.locator("#ta-t-seed");
      await expect.soft(reply).toBeVisible({ timeout: 5000 });
      await reply.focus();
      await reply.fill("draft that must survive many patches");
      const cursor = await page.evaluate(() => {
        const ta = document.getElementById("ta-t-seed") as HTMLTextAreaElement | null;
        return ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
      });
      await stream();
      await waitForDomQuiet(page, "#page");

      // Marks: flat, one per quote, open-expansion style kept.
      expect.soft(await markDepth(page)).toBe(1);
      expect.soft(await page.locator('#page mark.anc.ex[data-jump="x-seed"]').count()).toBe(1);
      expect.soft(await page.locator('#page mark.anc[data-thr="t-seed"]:not(.fnote)').count()).toBe(1);
      await expect.soft(page.locator('mark.anc.ex[data-jump="x-seed"]').first()).toBeVisible();

      // Focused reply box, draft and cursor survive.
      expect.soft(await page.evaluate(() => document.activeElement?.id ?? "")).toBe("ta-t-seed");
      await expect.soft(reply).toHaveValue("draft that must survive many patches");
      expect.soft(
        await page.evaluate(() => {
          const ta = document.getElementById("ta-t-seed") as HTMLTextAreaElement | null;
          return ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
        }),
      ).toEqual(cursor);
    });
  });

  test.describe("highlight upgrade onto marked cells", () => {
    // The app's service worker serves the Shiki chunks from its cache, which
    // bypasses request routing; block it here so the upgrade can be held back
    // deterministically (highlighting itself needs no worker).
    test.use({ serviceWorkers: "block" });

    test("highlight upgrade onto marked diff cells shows no page error (#101)", async ({ page }) => {
      test.setTimeout(240_000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));

      // Hold the Shiki library fetches (not the app's own `shiki.ts`
      // module, which the initial graph needs): the upgrade cannot land
      // until released.
      const held: (() => void)[] = [];
      let hold = true;
      await page.route("**/.vite/deps/shiki*", async (route) => {
        if (!hold) {
          await route.continue();
          return;
        }
        await new Promise<void>((release) => held.push(release));
        await route.continue();
      });

      // Held Shiki requests never settle, so `load` never fires: commit on
      // DOM parse and wait for the content explicitly instead.
      await page.goto("/review/demo", { waitUntil: "domcontentloaded" });
      await expect(page.locator(connFile)).toBeVisible();
      await page.evaluate(() => document.fonts.ready).catch(() => {});

      // Anchor an explanation on diff text; its quote is marked while the
      // upgrade is still held back. No scroll-settle sleep: the app has no
      // smooth scrolling, and the #selbar assert below is the gate.
      await page.evaluate(
        (file) => {
          document.querySelector(file)?.scrollIntoView({ block: "center" });
        },
        connFile,
      );
      await page.evaluate(
        ({ connFile, text }) => {
          const root = document.querySelector(connFile);
          if (!root) return false;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const data = (node as Text).data;
            const at = data.indexOf(text);
            if (at < 0) continue;
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + text.length);
            const sel = getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            (node as Text).parentElement?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            return true;
          }
          return false;
        },
        { connFile, text: "_normalize_header_value" },
      );
      // #251: the slower CI runner needs longer than 3s for the bar to render.
      await expect(page.locator("#selbar")).toBeVisible({ timeout: 10_000 });
      await page.locator('#selbar button[data-act="explain"]').click();
      await expect(page.locator('#right mark.anc[data-jump]').first()).toBeVisible({ timeout: 10000 });

      // Let the token upgrade land onto the marked cells. The unmarked
      // socketlevel file proves the upgrade landed even when the marked file
      // fails to render it.
      hold = false;
      for (const release of held.splice(0)) release();
      await expect(page.locator(`[id="F-${TSOCK}"] td.c .shk-kw`).first()).toBeVisible({ timeout: 15000 });
      // Late marking passes + patch convergence run to completion: wait for
      // the marked file's own tokens and subtree quiet, not a fixed 1.5 s.
      await expect(page.locator(`${connFile} td.c .shk-kw`).first()).toBeVisible({ timeout: 15000 });
      await waitForDomQuiet(page, "#right");

      expect(errors.filter((e) => /removeChild|NotFoundError/.test(e))).toEqual([]);
      expect(errors).toEqual([]);
      // The page is not white and no file fell back: guide and diff render.
      await expect(page.locator("#page .doc h1.title")).toBeVisible();
      await expect(page.locator(connFile)).toBeVisible();
      await expect(page.locator(`${connFile} td.c .shk-kw`).first()).toBeVisible();
      await expect(page.getByText("Couldn't show this file: something went wrong")).toHaveCount(0);
    });
  });

  test("inline diagrams fit, zoom, pan and cite without leaving the block", async ({ page }) => {
    test.setTimeout(240_000);
    const inlineTransform = (): Promise<string> =>
      page.locator(`${D2_BLOCK} .dg-doc`).evaluate((el) => (el as HTMLElement).style.transform);

    await test.step("wide diagram fits the block with no scrollbars, never above natural size", async () => {
      await gotoMockReview(page);
      await expect.soft(page.locator(`${D2_BLOCK} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
      const m = await page.locator(D2_BLOCK).evaluate((el) => {
        const dg = el.querySelector(".dg") as HTMLElement;
        const svg = el.querySelector(".dg-svg > svg") as SVGSVGElement;
        return {
          scroll: dg.scrollWidth - dg.clientWidth,
          svgW: svg.getBoundingClientRect().width,
        };
      });
      expect.soft(m.scroll).toBeLessThanOrEqual(1);
      expect.soft(m.svgW).toBeLessThanOrEqual(1379 + 1);
      await expect.soft(page.locator(`${D2_BLOCK} .dg-bar`)).toContainText("100%");
    });

    await test.step("Ctrl+wheel zooms but a plain wheel scrolls the page instead", async () => {
      await gotoMockReview(page);
      await expect.soft(page.locator(`${D2_BLOCK} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
      const svg = page.locator(`${D2_BLOCK} .dg-svg > svg`);
      await svg.scrollIntoViewIfNeeded();
      // Park the diagram mid-viewport so a wheel has somewhere to scroll to.
      await page.evaluate(() => {
        document.querySelector("#C-g-alt #B-b-demo-diagram-central")?.scrollIntoView({ block: "center" });
      });
      // Instant (no smooth scrolling in the app): one frame, not 400 ms.
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
      const box = await svg.boundingBox();
      if (!box) throw new Error("diagram svg has no box");
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      const scrolledFrom = await page.evaluate(() => document.querySelector("#page")?.scrollTop ?? 0);
      await page.mouse.wheel(0, 300);
      // The plain wheel scrolls the page (and never zooms): poll the scroll
      // position instead of sleeping a fixed 300 ms.
      await expect
        .poll(() => page.evaluate(() => document.querySelector("#page")?.scrollTop ?? 0), { timeout: 5000 })
        .toBeGreaterThan(scrolledFrom);
      expect.soft(await inlineTransform()).toBe("translate(0px, 0px) scale(1)");
      const scrolledTo = await page.evaluate(() => document.querySelector("#page")?.scrollTop ?? 0);
      expect.soft(scrolledTo).toBeGreaterThan(scrolledFrom);
      // With Ctrl held the same gesture zooms around the pointer instead
      // (re-aim: the scroll above moved the diagram; re-center it first so
      // the two-bar header cannot cover the aim point — main-rc).
      await page.evaluate(() => {
        document.querySelector("#C-g-alt #B-b-demo-diagram-central")?.scrollIntoView({ block: "center" });
      });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
      const box2 = await svg.boundingBox();
      if (!box2) throw new Error("diagram svg has no box");
      await page.keyboard.down("Control");
      await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
      await page.mouse.wheel(0, -240);
      await page.keyboard.up("Control");
      await expect.poll(() => inlineTransform(), { timeout: 5000 }).not.toBe("translate(0px, 0px) scale(1)");
    });

    await test.step("drag pans once zoomed and Reset restores; citations click after zoom", async () => {
      await gotoMockReview(page);
      await expect.soft(page.locator(`${D2_BLOCK} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
      await page.locator(`${D2_BLOCK} .dg-bar`).getByRole("button", { name: "Zoom in" }).click();
      const view = page.locator(`${D2_BLOCK} .dg-view`);
      const box = await view.boundingBox();
      if (!box) throw new Error("inline viewport has no box");
      const before = await inlineTransform();
      await page.mouse.move(box.x + 200, box.y + 60);
      await page.mouse.down();
      await page.mouse.move(box.x + 280, box.y + 60 + 40, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => inlineTransform(), { timeout: 5000 }).not.toBe(before);
      // A cited shape still reveals in the diff without changing the URL.
      const urlBefore = page.url();
      await page.locator(`${D2_BLOCK} .dg-svg a[data-refs]`).first().click();
      expect.soft(page.url()).toBe(urlBefore);
      await expect.soft(page.locator('[id="L-src-urllib3-connection.py-650"].hl')).toBeVisible({
        timeout: 5000,
      });
      await page.locator(`${D2_BLOCK} .dg-bar`).getByRole("button", { name: "Reset view" }).click();
      expect.soft(await inlineTransform()).toBe("translate(0px, 0px) scale(1)");
    });

    await test.step("source closed: the block breaks out past the column without clipping", async () => {
      await gotoMockReview(page);
      await expect.soft(page.locator(`${D2_BLOCK} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
      const toggle = page.locator("#toggleRight");
      const sourceOpen = async (open: boolean): Promise<void> => {
        if ((await toggle.getAttribute("aria-pressed")) !== String(open)) {
          await toggle.click();
        }
        await expect(toggle).toHaveAttribute("aria-pressed", String(open));
      };
      await sourceOpen(true);
      const open = await page.locator(D2_BLOCK).evaluate((el) => {
        const dg = el.querySelector(".dg") as HTMLElement;
        const blk = el.closest(".blk") as HTMLElement;
        const cap = el.querySelector(".dg-cap") as HTMLElement;
        return {
          dgW: dg.getBoundingClientRect().width,
          blkW: blk.getBoundingClientRect().width,
          capW: cap ? cap.getBoundingClientRect().width : 0,
        };
      });
      await sourceOpen(false);
      const closed = await page.evaluate(() => {
        const blk = document.querySelector("#C-g-alt #B-b-demo-diagram-central") as HTMLElement;
        const dg = blk.querySelector(".dg") as HTMLElement;
        const svg = blk.querySelector(".dg-svg > svg") as SVGSVGElement;
        const cap = blk.querySelector(".dg-cap") as HTMLElement;
        const pane = document.querySelector("#page") as HTMLElement;
        const pcs = getComputedStyle(pane);
        const padR = Number.parseFloat(pcs.paddingRight) || 0;
        const paneRect = pane.getBoundingClientRect();
        const svgRect = svg.getBoundingClientRect();
        return {
          dgW: dg.getBoundingClientRect().width,
          blkW: blk.getBoundingClientRect().width,
          capW: cap ? cap.getBoundingClientRect().width : 0,
          // The whole svg stays inside the pane: not clipped…
          clipped: svgRect.right - (paneRect.right - padR),
          // …and the pane never scrolls sideways.
          paneScroll: pane.scrollWidth - pane.clientWidth,
        };
      });
      // Meaningfully wider than with the source open, and past the column…
      expect.soft(closed.dgW).toBeGreaterThan(open.dgW + 50);
      expect.soft(closed.dgW).toBeGreaterThan(closed.blkW + 10);
      // …but not clipped, with no sideways scroll, and the caption (like the
      // text) stays column-aligned.
      expect.soft(closed.clipped).toBeLessThanOrEqual(1);
      expect.soft(closed.paneScroll).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(closed.capW - closed.blkW)).toBeLessThanOrEqual(2);
    });
  });

  test("expanded overlay locks, zooms, pans, cites and theme-swaps", async ({ page }) => {
    test.setTimeout(240_000);
    const overlayTransform = (): Promise<string> =>
      page.locator(".dg-ov-doc").evaluate((el) => (el as HTMLElement).style.transform);
    const openOverlay = async (): Promise<void> => {
      await gotoMockReview(page);
      await page.locator(`${D2_BLOCK} .dg-expand`).click();
      await expect(page.locator(D2_DIALOG)).toBeVisible();
      await expect(page.locator(`${D2_DIALOG} .dg-ov-doc .dg-svg > svg`)).toBeVisible({
        timeout: 15000,
      });
    };

    await test.step("expand opens the overlay and locks the page behind it", async () => {
      await gotoMockReview(page);
      await expect.soft(page.locator(`${D2_BLOCK} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
      await page.locator(`${D2_BLOCK} .dg-expand`).click();
      const dialog = page.locator(D2_DIALOG);
      await expect.soft(dialog).toBeVisible();
      await expect.soft(dialog).toBeFocused();
      await expect.soft(page.evaluate(() => document.body.style.overflow)).resolves.toBe("hidden");
      await page.keyboard.press("Escape");
      await expect.soft(dialog).toBeHidden();
    });

    await test.step("zoom buttons, wheel zoom, drag pan, reset, Esc close", async () => {
      await openOverlay();
      const zoom = page.locator(`${D2_DIALOG} .dg-zoom`);
      // The overlay opens fitted: the whole 1379-wide diagram is visible.
      const fitLabel = (await zoom.textContent()) ?? "";
      expect.soft(fitLabel).toMatch(/^\d+%$/);
      const fit = await overlayTransform();
      expect.soft(fit).not.toBe("translate(0px, 0px) scale(1)");

      // Buttons zoom around the viewport center.
      await page.locator(`${D2_DIALOG} button[aria-label="Zoom in"]`).click();
      await expect.poll(() => overlayTransform(), { timeout: 5000 }).not.toBe(fit);
      const zoomedLabel = (await zoom.textContent()) ?? "";
      expect.soft(Number.parseInt(zoomedLabel, 10)).toBeGreaterThan(Number.parseInt(fitLabel, 10));

      // Wheel zooms further (around the pointer).
      const view = page.locator(`${D2_DIALOG} .dg-ov-view`);
      const box = await view.boundingBox();
      if (!box) throw new Error("overlay viewport has no box");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const zoomed = await overlayTransform();
      await page.mouse.wheel(0, -240);
      await expect.poll(() => overlayTransform(), { timeout: 5000 }).not.toBe(zoomed);

      // Drag pans (a real mouse drag fires pointer events, like touch).
      const before = await overlayTransform();
      await page.mouse.move(box.x + 300, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(box.x + 420, box.y + 360, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => overlayTransform(), { timeout: 5000 }).not.toBe(before);

      // Reset restores the fitted view.
      await page.locator(`${D2_DIALOG} button[aria-label="Reset view"]`).click();
      await expect.soft(zoom).toContainText(fitLabel);
      expect.soft(await overlayTransform()).toBe(fit);

      // Esc closes and focus returns to the Expand control.
      await page.keyboard.press("Escape");
      await expect.soft(page.locator(D2_DIALOG)).toBeHidden();
      await expect.soft(page.locator(`${D2_BLOCK} .dg-expand`)).toBeFocused();
    });

    await test.step("citation hover and click keep working inside the overlay", async () => {
      await openOverlay();
      const anchor = page.locator(`${D2_DIALOG} .dg-ov-doc .dg-svg a[data-refs]`).first();
      await hoverFresh(page, anchor);
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 3000 });
      await expect.soft(page.locator("#pop .cite .loc").first()).toContainText("connection.py:647–651");
      const before = page.url();
      await anchor.click();
      expect.soft(page.url()).toBe(before);
      await expect.soft(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff");
      await expect.soft(page.locator('[id="L-src-urllib3-connection.py-650"].hl')).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step("theme switch while expanded swaps the render", async () => {
      await openOverlay();
      const host = page.locator(`${D2_DIALOG} .dg-ov-doc .dg-svg`);
      await expect.soft(host).toContainText("HTTPMessage");
      const lightHtml = await host.innerHTML();
      expect.soft(lightHtml).toContain("#FFFFFF");
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await expect.poll(() => host.innerHTML(), { timeout: 10000 }).toContain("1E1E2E");
      // The swapped render keeps its size (no blank overlay).
      const box = await page.locator(`${D2_DIALOG} .dg-ov-doc .dg-svg > svg`).boundingBox();
      expect.soft(box).not.toBeNull();
      expect.soft(box!.width).toBeGreaterThan(500);
      // Close still works after the swap.
      await page.keyboard.press("Escape");
      await expect.soft(page.locator(D2_DIALOG)).toBeHidden();
    });

    await test.step("fit centers the whole wide diagram at 1440x1000", async () => {
      // One viewport-first behaviour stays in the gate (#363 §3a); the
      // other three viewport/target combos move to the tour (same file,
      // `fit centers the whole …`).
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openOverlay();
      await expect.poll(() => isFitted(page), { timeout: 10000 }).toBe(true);
      // Zoom + pan away, then Reset returns to the same fitted state.
      await page.locator(`${D2_DIALOG} button[aria-label="Zoom in"]`).click();
      const view = page.locator(`${D2_DIALOG} .dg-ov-view`);
      const viewBox = await view.boundingBox();
      if (!viewBox) throw new Error("overlay viewport has no box");
      await page.mouse.move(viewBox.x + 200, viewBox.y + 200);
      await page.mouse.down();
      await page.mouse.move(viewBox.x + 320, viewBox.y + 260, { steps: 8 });
      await page.mouse.up();
      await page.locator(`${D2_DIALOG} button[aria-label="Reset view"]`).click();
      await expect.poll(() => isFitted(page), { timeout: 10000 }).toBe(true);
      await page.keyboard.press("Escape");
      await expect.soft(page.locator(D2_DIALOG)).toBeHidden();
    });
  });

  test("multi-line labels stack inline and expanded, in light and dark", async ({ page }) => {
    test.setTimeout(180_000);
    const BLOCK = "#C-g-alt #B-b-mock-d2-multiline";
    // One flow instead of three page loads (issue #119): inline light,
    // flip to dark, expand, measure dark, flip back, measure light.
    await gotoMockReview(page);
    await expect(page.locator(`${BLOCK} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
    // Inline, light.
    expect.soft(stacked(await lineTops(page, BLOCK))).toBe(true);
    await expectMaskIntact(page, BLOCK);
    // Inline, dark.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect
      .poll(() => page.locator(`${BLOCK} .dg-svg`).innerHTML(), { timeout: 10000 })
      .toContain('data-mock-theme="dark"');
    expect.soft(stacked(await lineTops(page, BLOCK))).toBe(true);
    await expectMaskIntact(page, BLOCK);
    // Expanded, dark.
    await page.locator(`${BLOCK} .dg-expand`).click();
    await expect.soft(page.locator(D2_DIALOG)).toBeVisible();
    await expect.soft(page.locator(`${D2_DIALOG} .dg-ov-doc .dg-svg > svg`)).toBeVisible({
      timeout: 15000,
    });
    expect.soft(stacked(await lineTops(page, D2_DIALOG))).toBe(true);
    await expectMaskIntact(page, D2_DIALOG);
    // Expanded, light again.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await expect
      .poll(() => page.locator(`${D2_DIALOG} .dg-ov-doc .dg-svg`).innerHTML(), { timeout: 10000 })
      .not.toContain('data-mock-theme="dark"');
    expect.soft(stacked(await lineTops(page, D2_DIALOG))).toBe(true);
    await expectMaskIntact(page, D2_DIALOG);
    await page.keyboard.press("Escape");
    await expect.soft(page.locator(D2_DIALOG)).toBeHidden();
  });
});

/** Deepest nesting of `mark.anc` under #page (1 = flat). */
async function markDepth(page: Page): Promise<number> {
  return page.evaluate(() => {
    let depth = 0;
    for (const mark of document.querySelectorAll("#page mark.anc")) {
      let d = 1;
      let el: Element | null = mark.parentElement;
      while (el) {
        if (el.tagName === "MARK" && el.classList.contains("anc")) d++;
        el = el.parentElement;
      }
      if (d > depth) depth = d;
    }
    return depth;
  });
}

/** Vertical centers of every tspan line, grouped per label. */
async function lineTops(page: Page, scope: string): Promise<number[][]> {
  return page.locator(`${scope} .dg-svg > svg`).evaluate((svg) => {
    const groups: number[][] = [];
    for (const text of svg.querySelectorAll("text")) {
      const spans = [...text.querySelectorAll("tspan")];
      if (spans.length < 2) continue;
      groups.push(
        spans.map((t) => {
          const r = (t as SVGGraphicsElement).getBoundingClientRect();
          return r.top + r.height / 2;
        }),
      );
    }
    return groups;
  });
}

function stacked(groups: number[][]): boolean {
  // The two- and three-line shapes from the mock block.
  if (groups.length !== 2 || groups[0].length !== 2 || groups[1].length !== 3) return false;
  for (const lines of groups) {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] - lines[i - 1] <= 5) return false;
    }
  }
  return true;
}

async function expectMaskIntact(page: Page, scope: string): Promise<void> {
  const mask = await page.locator(`${scope} .dg-svg > svg`).evaluate((svg) => {
    const mask = svg.querySelector("mask");
    const path = svg.querySelector("path[mask]");
    return {
      units: mask?.getAttribute("maskUnits"),
      maskId: mask?.getAttribute("id"),
      pathMask: path?.getAttribute("mask"),
    };
  });
  // The edge label clears the line behind it via a userSpaceOnUse mask;
  // the path's url must name the surviving (namespaced) mask id.
  expect.soft(mask.units).toBe("userSpaceOnUse");
  expect.soft(mask.maskId).not.toBeNull();
  expect.soft(mask.pathMask).toBe(`url(#${mask.maskId})`);
}

interface FitBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function overlayFit(page: Page): Promise<{ content: FitBox; box: FitBox; zoomPct: number }> {
  return page.evaluate(() => {
    const view = document.querySelector(".dg-ov-view") as HTMLElement;
    const svg = document.querySelector(".dg-ov-doc .dg-svg > svg") as SVGSVGElement;
    const cs = getComputedStyle(view);
    const padL = Number.parseFloat(cs.paddingLeft);
    const padR = Number.parseFloat(cs.paddingRight);
    const padT = Number.parseFloat(cs.paddingTop);
    const padB = Number.parseFloat(cs.paddingBottom);
    const v = view.getBoundingClientRect();
    const content: FitBox = {
      left: v.left + view.clientLeft + padL,
      top: v.top + view.clientTop + padT,
      right: v.left + view.clientLeft + view.clientWidth - padR,
      bottom: v.top + view.clientTop + view.clientHeight - padB,
    };
    // Union the svg box with the badge overflow (appendix icons paint
    // outside the svg element box even with overflow: visible).
    const r = svg.getBoundingClientRect();
    let l = r.left;
    let t = r.top;
    let rr = r.right;
    let b = r.bottom;
    for (const g of svg.querySelectorAll("g.appendix-icon")) {
      const gr = (g as SVGGraphicsElement).getBoundingClientRect();
      l = Math.min(l, gr.left);
      t = Math.min(t, gr.top);
      rr = Math.max(rr, gr.right);
      b = Math.max(b, gr.bottom);
    }
    const zoomText = document.querySelector(".dg-zoom")?.textContent ?? "0%";
    return { content, box: { left: l, top: t, right: rr, bottom: b }, zoomPct: Number.parseInt(zoomText, 10) };
  });
}

function fittedOk(fit: { content: FitBox; box: FitBox; zoomPct: number }): boolean {
  const { content, box, zoomPct } = fit;
  if (zoomPct > 100) return false;
  if (box.left < content.left - 0.5 || box.right > content.right + 0.5) return false;
  if (box.top < content.top - 0.5 || box.bottom > content.bottom + 0.5) return false;
  const marginL = box.left - content.left;
  const marginR = content.right - box.right;
  const marginT = box.top - content.top;
  const marginB = content.bottom - box.bottom;
  return Math.abs(marginL - marginR) <= 2 && Math.abs(marginT - marginB) <= 2;
}

/** Poll-friendly fitted check (assertion failures become retries). */
async function isFitted(page: Page): Promise<boolean> {
  try {
    return fittedOk(await overlayFit(page));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Demo-backed guide: one replay service (seeded + fresh demo reviews).
// Thread-creating steps get their own review so journeys never share
// mutable state; read-only steps share one.
// ---------------------------------------------------------------------------

test.describe("L3 demo guide reading", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let readReview = "";
  let askReview = "";
  let explainReview = "";
  let commentReview = "";
  let criticReview = "";
  let diagramReview = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l3-data-"));
    createSeededDemoReview(dataDir, "j266-seed");
    createSeededDemoReview(dataDir, "j206-seed");
    createSeededDemoReview(dataDir, "j225-seed");
    createSeededDemoReview(dataDir, "j314-seed");
    // j314's loose numbered list: the real parser must keep one <ol>
    // across blank lines — append the card to the seeded snapshot.
    {
      const { parseBlocks } = await import("@unvibe/shared");
      const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
      try {
        const row = db.prepare("SELECT snapshot FROM review_snapshots WHERE review_id = ?").get("j314-seed") as {
          snapshot: string;
        };
        const snapshot = JSON.parse(row.snapshot) as {
          pages: { id: string; cards: unknown[] }[];
        };
        const root = snapshot.pages.find((p) => p.id === "root");
        if (!root) throw new Error("seeded snapshot has no root page");
        root.cards.push({
          id: "loose-lists",
          pageId: "root",
          title: "Loose list",
          blocks: parseBlocks("1. First step\n\n2. Second step\n\n3. Third step\n\n4. Fourth step\n"),
          level: "standard",
          revision: 1,
          undoStack: [],
          collapsed: false,
        });
        db.prepare("UPDATE review_snapshots SET snapshot = ? WHERE review_id = ?").run(
          JSON.stringify(snapshot),
          "j314-seed",
        );
        // Raw-SQL seeds bypass the service's stamp-on-create (#311).
        stampDataFormat(db);
      } finally {
        db.close();
      }
    }
    svc = await startService(dataDir, { agent: "replay", label: "l3demo" });
    readReview = await createDemoReview(svc);
    askReview = await createDemoReview(svc);
    explainReview = await createDemoReview(svc);
    commentReview = await createDemoReview(svc);
    criticReview = await createDemoReview(svc);
    diagramReview = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function openReview(page: Page, reviewId: string): Promise<void> {
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  }

  test("glossary terms link, preview and label; thread marks read differently", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    if (!s) throw new Error("no service");

    await test.step("hovering a linked term shows its definition and citation (j252)", async () => {
      await openReview(page, readReview);
      const link = page.locator("#C-central a.gx[data-glossary]").first();
      await expect.soft(link).toBeVisible({ timeout: 30_000 });
      const name = await link.getAttribute("data-glossary");
      expect.soft(name).toBeTruthy();
      // B5: hover only after scroll quiet, or the popover ignores the
      // stationary pointer and nothing re-triggers it (throttle flake).
      await hoverFresh(page, link);
      // Issue #341: the re-recorded glossary redefines the terms; the first
      // central link is obs-fold now ("headers view" is gone).
      await expect.soft(page.locator("#pop")).toContainText("Obsolete HTTP header line folding", { timeout: 30_000 });
      // Citation button inside the popover reveals the source.
      await expect.soft(page.locator("#pop [data-src]")).toHaveCount(1);
    });

    await test.step("glossary preview carries a label and a compact chip that opens the source (#302, #304)", async () => {
      await openReview(page, readReview);
      const link = page.locator("#C-central a.gx[data-glossary]").first();
      await expect.soft(link).toBeVisible({ timeout: 30_000 });
      await hoverFresh(page, link);
      const pop = page.locator("#pop");
      // Issue #341: see above — first central link is obs-fold now.
      await expect.soft(pop).toContainText("Obsolete HTTP header line folding", { timeout: 30_000 });
      // Issue #302: a small Glossary label above the term.
      await expect.soft(pop.locator(".pv-label", { hasText: "Glossary" })).toBeVisible();
      // Issue #304: the citation is the compact prose chip (line range),
      // never a code snippet.
      const chip = pop.locator("button.lk[data-src]");
      await expect.soft(chip).toHaveCount(1);
      await expect.soft(chip).toContainText(/^L\d+([–-]\d+)?$/);
      await expect.soft(pop.locator(".cite .snip, .cite")).toHaveCount(0);
      // Clicking the chip lands on the source in the diff.
      const target = (await chip.getAttribute("data-src")) ?? "";
      const m = target.match(/^diff:(.+):(\d+)/);
      expect.soft(m).toBeTruthy();
      await chip.click();
      const row = page.locator(`[id="L-${m![1]}-${m![2]}"]`);
      await expect.soft(row).toBeVisible({ timeout: 30_000 });
    });

    await test.step("glossary tour: links, hover preview and layout (frames → tour)", async () => {
      await openReview(page, readReview);
      await expect.soft(page.locator("#C-central a.gx[data-glossary]").first()).toBeVisible({ timeout: 30_000 });
      await page.locator("#C-central").scrollIntoViewIfNeeded();
      await checkLayout(page, "glossary-links");
      // Deterministic hover: the shared-context scroll above can park the
      // pointer over the link, and a no-op hover() would never re-arm it.
      const link = page.locator('#C-central a.gx[data-glossary="HTTPHeaderDict"]').first();
      if ((await link.count()) > 0) {
        await hoverFresh(page, link);
      } else {
        await hoverFresh(page, page.locator("#C-central a.gx[data-glossary]").first());
      }
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 30_000 });
      await checkLayout(page, "glossary-hover");
    });

    await test.step("a collapsed thread shows a highlighted mark with a glyph, and a pinned-style preview (#302)", async () => {
      await openReview(page, askReview);
      await expect.soft(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
      // Ask on guide text starts a thread; closing it leaves a collapsed mark.
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("What is line folding?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const thread = page.locator("#C-problem section.ithread[data-thread]").first();
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      const threadId = await thread.getAttribute("data-thread");
      expect.soft(threadId).toBeTruthy();
      await expect.soft(thread.locator("[data-ask-answer] .exp-b").first()).not.toBeEmpty({ timeout: 90_000 });
      await thread.getByRole("button", { name: "Close" }).click();
      await expect.soft(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, {
        timeout: 15_000,
      });

      // The collapsed mark: soft highlight, one thread glyph, no dotted underline.
      const mark = page.locator(`#C-problem mark.anc.exl[data-jump="${threadId}"]`).first();
      await expect.soft(mark).toBeVisible({ timeout: 15_000 });
      await expect.soft(mark.locator("svg.thg")).toHaveCount(1);
      const decoration = await mark.evaluate((el) => getComputedStyle(el).textDecorationLine);
      expect.soft(decoration).toBe("none");
      const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect.soft(bg).not.toBe("rgba(0, 0, 0, 0)");

      // Hovering previews the thread as pinned: kind badge, AI avatar, reply count.
      // B5: hover only after scroll quiet (throttle flake).
      await hoverFresh(page, mark);
      const pop = page.locator("#pop");
      await expect.soft(pop.locator(".pv-thr")).toBeVisible({ timeout: 15_000 });
      await expect.soft(pop.locator(".pv-thr .kind-ask")).toContainText("ask");
      await expect.soft(pop.locator(".pv-thr .av.ai")).toBeVisible();
      await expect.soft(pop.locator(".pv-thr")).toContainText(/1 reply|2 replies/);
      await expect.soft(pop).toContainText("Click to pin here");
    });

    await test.step("a glossary term keeps the dotted underline and a labelled preview (#302)", async () => {
      await openReview(page, readReview);
      const link = page.locator("#C-central a.gx[data-glossary]").first();
      await expect.soft(link).toBeVisible({ timeout: 30_000 });
      // Glossary keeps the light dotted underline — never the thread highlight.
      const decoration = await link.evaluate((el) => getComputedStyle(el).textDecorationStyle);
      expect.soft(decoration).toBe("dotted");
      await expect.soft(link.locator("svg.thg")).toHaveCount(0);
      // B5: hover only after scroll quiet (throttle flake — see above).
      await hoverFresh(page, link);
      const pop = page.locator("#pop");
      await expect.soft(pop.locator(".pv-label", { hasText: "Glossary" })).toBeVisible({ timeout: 30_000 });
    });
  });

  test("cross-node, list and loose-list marks; select popups paint above cards", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    if (!s) throw new Error("no service");

    await test.step("a quote spanning code and text marks the phrase, with no fallback chip (#303)", async () => {
      await openReview(page, explainReview);
      await expect.soft(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
      // Select from the start of an inline-code span to a few words past
      // it — the same Range a drag across the code boundary makes.
      const codeWord = await page.evaluate((sel: string) => {
        const root = document.querySelector(sel);
        if (!root) throw new Error(`no card ${sel}`);
        for (const p of [...root.querySelectorAll("p.sel")]) {
          for (const code of [...p.querySelectorAll("code")].filter((c) => (c.textContent ?? "").trim() !== "")) {
            const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
            const texts: Text[] = [];
            for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
            const startIdx = texts.findIndex((t) => code.contains(t));
            if (startIdx < 0) continue;
            const after = texts.slice(startIdx + 1).filter((t) => !code.contains(t) && t.data.trim() !== "");
            if (after.length === 0) continue;
            const endText = after[Math.min(after.length - 1, 2)]!;
            const endOffset = Math.min(12, endText.data.length);
            const range = document.createRange();
            range.setStart(texts[startIdx]!, 0);
            range.setEnd(endText, endOffset);
            const selection = window.getSelection();
            if (!selection) throw new Error("no selection");
            selection.removeAllRanges();
            selection.addRange(range);
            p.scrollIntoView({ block: "center" });
            p.setAttribute("data-j303-para", "1");
            (endText.parentElement ?? document).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            return (code.textContent ?? "").trim().split(/\s+/)[0] ?? "";
          }
        }
        throw new Error("no code span with following text in guide card");
      }, "#C-problem");
      expect.soft(codeWord.length).toBeGreaterThan(0);
      await expect.soft(page.locator("#selbar")).toBeVisible({ timeout: 15_000 });
      // Explain fires immediately (no composer; Ask opens one): the thread
      // lands with a placeholder, then the replay agent fills the answer.
      await page.locator('#selbar [data-act="explain"]').click();

      const thread = page.locator("#C-problem section.ithread[data-thread]").first();
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      const threadId = await thread.getAttribute("data-thread");
      expect.soft(threadId).toBeTruthy();
      await expect.soft(thread.locator('[data-reply][data-kind="explain"] .exp-b').first()).not.toBeEmpty({
        timeout: 90_000,
      });
      await thread.getByRole("button", { name: "Close" }).click();
      await expect.soft(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, {
        timeout: 15_000,
      });

      // The mark covers the phrase across the code boundary (mark text holds
      // both the code word and the following words).
      const mark = page.locator(`#C-problem mark.anc.exl[data-jump="${threadId}"]:not(.fnote)`).first();
      await expect.soft(mark).toBeVisible({ timeout: 15_000 });
      await expect.soft(mark).toContainText(codeWord);
      // …and no duplicate fallback chip appears on the citations line.
      await expect.soft(page.locator(`#C-problem [data-fallback="${threadId}"]:visible`)).toHaveCount(0, {
        timeout: 15_000,
      });
      // …nor a comment-thread chip for the agent thread (issue #303: the
      // `.th` chips belong to GuideThreads, which only tracks threads with
      // a reviewer comment — an agent thread must not show twice).
      await expect.soft(page.locator(`#C-problem [data-tfallback="${threadId}"]:visible`)).toHaveCount(0, {
        timeout: 15_000,
      });
    });

    await test.step("cited lists keep their chips inside items, with no row below the list (#305)", async () => {
      await openReview(page, readReview);
      await expect.soft(page.locator("#page .doc h1.title")).toBeVisible({ timeout: 60_000 });
      // Every list block: no citation row of its own below the list …
      const lists = page.locator("#page .blk:has(ul.lst, ol.lst)");
      const n = await lists.count();
      expect.soft(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const blk = lists.nth(i);
        await expect.soft(blk.locator(":scope > .lo-row button.lk")).toHaveCount(0);
      }
      // … and at least one cited list shows its chips inside items.
      const chips = page.locator('#page .blk ul.lst li button.lk, #page .blk ol.lst li button.lk');
      await expect.soft(chips.first()).toBeVisible({ timeout: 30_000 });
      // Each chip sits inside an `li`, inline after the item text — one
      // synchronous read (#363 B1).
      const within = await chips.first().evaluate((chip) => {
        const li = chip.closest("li");
        if (!li) return null;
        const c = chip.getBoundingClientRect();
        const l = li.getBoundingClientRect();
        return { cy: c.y, cb: c.y + c.height, ly: l.y, lb: l.y + l.height };
      });
      expect.soft(within).not.toBeNull();
      expect.soft(within!.cy).toBeGreaterThanOrEqual(within!.ly);
      expect.soft(within!.cb).toBeLessThanOrEqual(within!.lb + 1);
    });

    await test.step("a loose numbered list is one <ol> with items 1-4 (#314)", async () => {
      const url = `${s.origin}/review/j314-seed?token=${s.token}`;
      await page.goto(url);
      const card = page.locator("#C-loose-lists");
      await expect.soft(card).toBeVisible({ timeout: 60_000 });
      // One <ol> (the bug made four, each rendering "1."), with four items.
      const lists = card.locator("ol.lst");
      await expect.soft(lists).toHaveCount(1);
      const items = lists.first().locator(":scope > li");
      await expect.soft(items).toHaveCount(4);
      await expect.soft(items.nth(0)).toContainText("First step");
      await expect.soft(items.nth(3)).toContainText("Fourth step");
      // No start override: native <ol> numbering renders these 1-4 (the
      // bug made four separate lists, each rendering "1.").
      await expect.soft(lists.first()).not.toHaveAttribute("start", /./);
    });

    await test.step("every shared select popup paints above cards (#306)", async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 30_000 }).catch(() => {});
      await openReview(page, readReview);
      const popupTopmost = async (what: string, overCard = true): Promise<void> => {
        const popup = openPopup(page);
        await expect.soft(popup, `${what}: popup is open`).toBeVisible({ timeout: 15_000 });
        const box = await popup.boundingBox();
        expect.soft(box, `${what}: popup has a box`).not.toBeNull();
        const cx = box!.x + box!.width / 2;
        const cy = box!.y + box!.height / 2;
        const probe = await page.evaluate(
          ([x, y]: readonly [number, number]) => {
            const els = document.elementsFromPoint(x, y);
            const first = els[0];
            return {
              topInPopup: first ? first.closest(".ui-select-popup") !== null : false,
              topDesc: first ? `${first.tagName}.${String(first.className).slice(0, 60)}` : "none",
              overCard: els.some(
                (e) => e.classList.contains("ui-card") || e.getAttribute("data-testid") === "pr-block",
              ),
              stack: els.slice(0, 5).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`),
            };
          },
          [cx, cy] as const,
        );
        if (overCard) {
          expect.soft(
            probe.overCard,
            `${what}: popup centre stack reaches a card (stack: ${probe.stack.join(" | ")})`,
          ).toBe(true);
        }
        expect.soft(
          probe.topInPopup,
          `${what}: popup is topmost at its centre (top: ${probe.topDesc}; stack: ${probe.stack.join(" | ")})`,
        ).toBe(true);
      };
      const closePopup = async (): Promise<void> => {
        await page.keyboard.press("Escape");
        await expect.soft(openPopup(page)).toHaveCount(0, { timeout: 10_000 });
      };
      // Settings pickers (shared Select) inside cards. The start-page
      // repo/author popups need PR data, so they are not exercised here;
      // every popup below shares the same portal + positioner classes.
      await page.goto(`${s.origin}/settings?token=${s.token}`);
      await expect.soft(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("tab", { name: "Models" }).click();
      // Issue #379: Models keeps only the small picker (same shared
      // Select, same popup coverage as before).
      await expect.soft(page.locator("#model-small")).toBeVisible({ timeout: 30_000 });
      await page.locator("#prov-small").click();
      await popupTopmost("settings provider select");
      await closePopup();
      await page.locator("#model-small").click();
      await popupTopmost("settings model select");
      await closePopup();
      await page.locator("#effort-small").click();
      await popupTopmost("settings effort select");
      await closePopup();
      // Settings theme picker (shared Select) on Appearance.
      await page.getByRole("tab", { name: "Appearance" }).click();
      const themeSelect = page.locator('[data-testid="ui-theme"]');
      await expect.soft(themeSelect).toBeVisible({ timeout: 15_000 });
      await themeSelect.click();
      await popupTopmost("settings theme select");
      await closePopup();
    });
  });

  test("description reads like a guide card; comments-menu jump works (#263)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");

    await test.step("description reads like a guide card with no Restated links", async () => {
      await openReview(page, readReview);
      await page.locator('#right [role="tab"]').getByText("PR description").click();
      await expect.soft(page.locator("#right #d-p1")).toContainText("obs-fold response-header case", { timeout: 30_000 });

      // Paragraphs, a bullet list, a numbered list past 9 items, inline code.
      await expect.soft(page.locator("#right #d-p2")).toContainText("HTTPHeaderDict");
      await expect.soft(page.locator("#right ul#d-p5 li")).toHaveCount(6);
      await expect.soft(page.locator("#right ol#d-p6 li")).toHaveCount(12);
      await expect.soft(page.locator("#right ol#d-p6 li").nth(9)).toContainText("towncrier");
      expect.soft(await page.locator("#right .desc code").count()).toBeGreaterThan(0);

      // No "Restated →" links remain: neither inline buttons nor list footers.
      await expect.soft(page.locator("#right .desc button.back")).toHaveCount(0);
      await expect.soft(page.locator("#right .desc")).not.toContainText("Restated →");

      // The shared Card carries normal margins, so the box never runs into
      // the pane edges; headings and paragraphs start at exactly the same
      // text x; list blocks share the same left edge with markers inside
      // the content padding.
      const box = await page.locator("#right .ui-card.desc").evaluate((el) => {
        const textX = (node: Element | null): number | null => {
          if (!node) return null;
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let text: Node | null = null;
          while ((text = walker.nextNode())) {
            if (text.nodeValue && text.nodeValue.trim() !== "") break;
            text = null;
          }
          if (!text || !text.nodeValue) return null;
          const range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 1);
          return Math.round(range.getBoundingClientRect().left);
        };
        const rectLeft = (node: Element | null): number | null =>
          node ? Math.round(node.getBoundingClientRect().left) : null;
        const cs = getComputedStyle(el);
        const h3 = el.querySelector("h3");
        const p = el.querySelector("p.para");
        const ul = el.querySelector("ul.para");
        const ol = el.querySelector("ol.para");
        return {
          marginLeft: cs.marginLeft,
          h3Text: textX(h3),
          pText: textX(p),
          pBox: rectLeft(p),
          ulBox: rectLeft(ul),
          olBox: rectLeft(ol),
          firstLiText: textX(ul?.querySelector("li") ?? null),
          tenthLiText: textX(ol?.querySelectorAll("li")?.[9] ?? null),
          ulPad: ul ? getComputedStyle(ul).paddingLeft : null,
          olPad: ol ? getComputedStyle(ol).paddingLeft : null,
        };
      });
      expect.soft(parseFloat(box.marginLeft)).toBeGreaterThanOrEqual(14);
      expect.soft(box.h3Text).not.toBeNull();
      expect.soft(box.pText).not.toBeNull();
      // Headings and paragraphs start at exactly the same x (±1px for
      // subpixel rounding); list blocks share the same box edge.
      expect.soft(Math.abs(box.h3Text! - box.pText!)).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(box.ulBox! - box.pBox!)).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(box.olBox! - box.pBox!)).toBeLessThanOrEqual(1);
      // Bullets and numbers sit inside the content padding: item text is
      // indented from the paragraph edge, with room for two-digit numbers.
      expect.soft(box.firstLiText! - box.pText!).toBeGreaterThanOrEqual(16);
      expect.soft(box.tenthLiText! - box.pText!).toBeGreaterThanOrEqual(16);
      expect.soft(parseFloat(box.ulPad ?? "0")).toBeGreaterThanOrEqual(22);
      expect.soft(parseFloat(box.olPad ?? "0")).toBeGreaterThanOrEqual(22);
    });

    await test.step("comments-menu jump keeps working", async () => {
      // One guide-anchored thread, seeded like J9.
      const snapRes = await apiJson(s, "GET", `/api/reviews/${commentReview}`);
      const snap = snapRes.json as {
        pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[];
      };
      const central = snap.pages?.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
      const firstBlock = central?.blocks[0]?.id;
      if (!central || !firstBlock) throw new Error("no central block");
      const made = await apiJson(s, "POST", `/api/reviews/${commentReview}/comments`, {
        anchor: { where: "block", blockId: `${central.id}#${firstBlock}` },
        quote: "",
        text: "J263 guide note",
      });
      expect.soft(made.status).toBe(201);
      const threadId = (made.json as { id: string }).id;

      await openReview(page, commentReview);
      // Comments-menu row jumps to the guide thread (opens + scrolls to it).
      await page.locator("#page").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.locator('#reviewbar [data-cm=""]').click();
      await expect.soft(page.locator(".cmenu")).toBeVisible({ timeout: 15_000 });
      // New comments land in the Outbox by default: the seeded guide note
      // rides the Outbox tab.
      await page.locator('.cmenu [data-cmtab="outbox"]').click();
      await expect.soft(page.locator(`[data-cjump="${threadId}"]`)).toBeVisible({ timeout: 15_000 });
      await page.locator(`[data-cjump="${threadId}"]`).click();
      const thread = page.locator(`.ithread[data-thread="${threadId}"]`);
      await expect.soft(thread).toBeVisible({ timeout: 15_000 });
      await expect.soft(thread).toBeInViewport({ timeout: 15_000 });
    });
  });

  test("scroll restores across pages; filling never scrolls on its own (#266)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");

    await test.step("scroll, open page, back restores position", async () => {
      await openReview(page, "j266-seed");
      await expect.soft(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 30_000,
      });
      // Open a thread as a page so Contents lists it under linked pages.
      // ("optional whitespace" is card-unique; "fast path" also appears in
      // the seeded thread text, which would route in-thread under #273.)
      const beforeIds = ((await apiJson(s, "GET", `/api/reviews/j266-seed`)).json as { annotations: { id: string }[] }).annotations.map((a) => a.id);
      await selectText(page, "#C-central", "optional whitespace");
      await page.locator('#selbar [data-act="explain"]').click();
      let threadId: string | null = null;
      {
        const deadline = Date.now() + 60_000;
        for (;;) {
          const res = await apiJson(s, "GET", `/api/reviews/j266-seed`);
          const ids = ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
          threadId = ids.find((id) => !beforeIds.includes(id)) ?? null;
          if (threadId || Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!threadId) throw new Error("new thread did not appear");
      const card = page.locator(`#C-central [data-thread="${threadId}"]`).first();
      await expect.soft(card.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });
      await card.getByRole("button", { name: "Open as page" }).click();
      await expect.soft(page).toHaveURL(/\/page\/p-/, { timeout: 15_000 });
      await expect.soft(page.locator("#page nav.crumbs")).toContainText("Unfold obsolete", { timeout: 10_000 });
      const pageId = page.url().match(/page\/([^?#]+)/)?.[1] ?? "";
      await page.goBack();
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 15_000 });
      const link = page.locator(`nav.toc [data-node="${pageId}"]`);
      await expect.soft(link).toBeVisible({ timeout: 5000 });

      // Same wait as interaction test 7 (#266): the scroll must stick before
      // navigating — re-issue until it reads back, as a reader's wheel would.
      await link.scrollIntoViewIfNeeded();
      // Same sticking wait: re-issue until the settled position reads back.
      await expect
        .poll(() => page.locator("#page").evaluate((el) => el.scrollTop), { timeout: 5000 })
        .toBeGreaterThanOrEqual(0);
      const before: number = await page.locator("#page").evaluate((el) => el.scrollTop);
      // Loud premise: the click below must not move the scroll itself. The
      // link must already sit inside #page's visible area (viewport
      // coordinates would ignore the review bar above the pane).
      const vis = await page.evaluate((sel) => {
        const pane = document.getElementById("page");
        const target = pane?.querySelector(sel);
        if (!pane || !target) return null;
        const p = pane.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        return { top: b.y - p.y, bottom: b.y + b.height - p.y, height: p.height };
      }, `nav.toc [data-node="${pageId}"]`);
      expect.soft(vis?.top).toBeGreaterThanOrEqual(0);
      expect.soft(vis?.bottom).toBeLessThanOrEqual(vis?.height ?? 0);
      await link.click();
      await expect.soft(page).toHaveURL(new RegExp(`page/${pageId}`));
      await page.goBack();
      await expect
        .poll(() => page.locator("#page").evaluate((el) => el.scrollTop), { timeout: 5000 })
        .toBe(before);
    });

    await test.step("filling never scrolls the page on its own", async () => {
      await openReview(page, "j266-seed");
      // A previous test may have threaded this exact quote (same hazard):
      // delete those threads through the API first (threads are comments)
      // so the selection summons the toolbar.
      {
        const snapRes = await apiJson(s, "GET", `/api/reviews/j266-seed`);
        const anns = (
          (snapRes.json as { annotations?: { id: string; anchor?: { quotedText?: string } }[] }).annotations ?? []
        );
        const seeded = new Set(["x-seed", "t-seed", "t-sglf", "t-sgperf", "t-diff"]);
        for (const a of anns) {
          if (!seeded.has(a.id) && (a.anchor?.quotedText ?? "").includes("optional whitespace")) {
            const del = await apiJson(s, "DELETE", `/api/reviews/j266-seed/comments/${a.id}`);
            expect.soft(del.status, `delete thread ${a.id}`).toBe(200);
          }
        }
      }
      await selectText(page, "#C-central", "optional whitespace");
      const scroller = page.locator("#page");
      await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
      const top = await scroller.evaluate((el) => el.scrollTop);
      await page.locator('#selbar [data-act="explain"]').click();
      const exp = page.locator('#C-central section.ithread[data-thread]:has([data-reply][data-kind="explain"])').first();
      await expect.soft(exp.locator(".exp-b").first()).not.toBeEmpty({ timeout: 90_000 });
      expect.soft(await scroller.evaluate((el) => el.scrollTop)).toBe(top);
    });
  });

  test("one critic job, findings, on-demand pages and go-deeper (j20)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    type Snap = {
      pages: { id: string; kind: string; title: string; cards: { id: string; pending?: unknown; blocks: unknown[]; collapsed?: boolean; why?: string }[] }[];
    };
    type JobRow = { kind: string; state: string; priority: number; cardId?: string };
    const snapshot = async (id: string): Promise<Snap> =>
      (await apiJson(s, "GET", `/api/reviews/${id}`)).json as Snap;
    const jobs = async (id: string): Promise<JobRow[]> =>
      ((await apiJson(s, "GET", `/api/jobs?review=${id}`)).json as { jobs: JobRow[] }).jobs;
    const poll = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 90_000): Promise<T> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const v = await fn();
        if (ok(v)) return v;
        if (Date.now() > deadline) throw new Error("poll timed out");
        await new Promise((r) => setTimeout(r, 250));
      }
    };

    await test.step("one critic job makes the findings; no concept pages until a link is opened; go-deeper fills itself", async () => {
      // #217 (default on): every go-deeper card fills without a click, in
      // the background; #215: one critic job; #216: no concept pages yet.
      const snap = await poll(
        () => snapshot(criticReview),
        (sn) => {
          const root = sn.pages.find((p) => p.id === "root");
          return !!root && root.cards.length >= 8 && root.cards.every((c) => !c.pending);
        },
      );
      const root = snap.pages.find((p) => p.id === "root")!;
      expect.soft(root.cards.every((c) => !c.pending)).toBe(true);
      expect.soft(snap.pages.filter((p) => p.kind === "finding")).toHaveLength(2);
      expect.soft(snap.pages.filter((p) => p.kind === "concept")).toHaveLength(0);
      const js = await poll(
        () => jobs(criticReview),
        (list) => list.filter((j) => j.kind === "critic").length >= 1 && list.filter((j) => j.kind === "go-deeper").length >= 4,
      );
      expect.soft(js.filter((j) => j.kind === "critic")).toHaveLength(1);
      const gd = js.filter((j) => j.kind === "go-deeper");
      expect.soft(gd.length).toBeGreaterThanOrEqual(4);
      expect.soft(gd.every((j) => j.priority === 10)).toBe(true);
      expect.soft(js.filter((j) => j.kind === "concept")).toHaveLength(0);

      // #217 follow-up: auto-written go-deeper cards stay collapsed
      // (title + why-line) until opened; opening shows the written
      // content instantly and starts no new job.
      const filledGd = root.cards.filter((c) => c.id.startsWith("g-"));
      expect.soft(filledGd.length).toBeGreaterThanOrEqual(4);
      expect.soft(filledGd.every((c) => c.collapsed)).toBe(true);
      expect.soft(filledGd.every((c) => !!c.why)).toBe(true);
      const gdJobsBefore = (await jobs(criticReview)).filter((j) => j.kind === "go-deeper").length;

      // Findings show in the guide; open a go-deeper card (issue #341:
      // the re-recorded reader's pending cards are g-alt/g-regex/
      // g-tests/g-reach). It stays collapsed until opened (#217);
      // opening shows the written content instantly and starts no job.
      await openReview(page, criticReview);
      const gdCard = page.locator("#C-g-alt");
      await gdCard.scrollIntoViewIfNeeded();
      await expect.soft(gdCard).toHaveClass(/collapsed/);
      await expect.soft(gdCard.locator(".why")).toContainText("rewriting the http.client message");
      await expect.soft(gdCard).not.toContainText("delete and re-add");
      await gdCard.getByRole("button", { name: "Expand" }).click();
      await expect.soft(gdCard).toContainText("delete and re-add", { timeout: 10_000 });
      expect.soft((await jobs(criticReview)).filter((j) => j.kind === "go-deeper")).toHaveLength(gdJobsBefore);
      // The bare-LF finding page renders directly (issue #341: no guide
      // card links findings anymore, so navigate to the page itself).
      await page.goto(`${s.origin}/review/${criticReview}/page/f-critic-2?token=${s.token}`);
      await expect.soft(page.locator("#page .doc h1.title")).toContainText("Bare-LF", { timeout: 60_000 });

      // #216: opening a concept page writes it, then shows it (issue #341:
      // the re-recorded guide carries no concept links, so fire the
      // concept action for obs-fold via API, then open the page).
      const acted = await apiJson(s, "POST", `/api/reviews/${criticReview}/actions`, {
        kind: "concept",
        slug: "obs-fold",
      });
      if (acted.status !== 200) throw new Error(`concept action failed: ${acted.status}`);
      await page.goto(`${s.origin}/review/${criticReview}/page/c-obs-fold?token=${s.token}`);
      await expect.soft(page.locator("#page .doc h1.title")).not.toHaveText("Guide", { timeout: 60_000 });
      await poll(
        () => snapshot(criticReview),
        (sn) => sn.pages.filter((p) => p.kind === "concept").length === 1,
        60_000,
      );
      const after = await snapshot(criticReview);
      expect.soft(after.pages.filter((p) => p.kind === "concept")).toHaveLength(1);
      expect.soft((await jobs(criticReview)).filter((j) => j.kind === "concept")).toHaveLength(1);
    });

    await test.step("with the setting off in Settings, go-deeper cards wait for Generate", async () => {
      // Toggle off in Settings (Limits tab) before the review exists.
      await page.goto(`${s.origin}/settings?token=${s.token}`);
      await expect.soft(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("tab", { name: "Limits" }).click();
      const toggle = page.locator('[data-testid="auto-go-deeper-toggle"]');
      await expect.soft(toggle).toBeChecked({ timeout: 30_000 });
      // Subscribe before clicking: the localhost save can answer before
      // the click resolves, so a wait started after the click can miss it
      // and time out (#251; same race #225A fixed in J11).
      const saved = page.waitForResponse(
        (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
        { timeout: 15_000 },
      );
      await toggle.click();
      await saved;
      await expect.soft(toggle).not.toBeChecked();

      const reviewId = await createDemoReview(s);
      await poll(
        () => jobs(reviewId),
        (list) => list.some((j) => j.kind === "reader" && j.state === "done"),
      );
      await new Promise((r) => setTimeout(r, 500));
      expect.soft((await jobs(reviewId)).filter((j) => j.kind === "go-deeper")).toHaveLength(0);
      const snap = await snapshot(reviewId);
      const root = snap.pages.find((p) => p.id === "root")!;
      expect.soft(root.cards.some((c) => c.pending)).toBe(true);

      // Generate on click still writes the card.
      await openReview(page, reviewId);
      const generate = page.locator("button[data-gen]").first();
      await expect.soft(generate).toBeVisible({ timeout: 30_000 });
      const cardId = await generate.getAttribute("data-gen");
      await generate.click();
      const filledSnap = await poll(
        () => snapshot(reviewId),
        (sn) => {
          const r = sn.pages.find((p) => p.id === "root");
          const card = r?.cards.find((c) => c.id === cardId);
          return !!card && !card.pending && card.blocks.length > 0;
        },
        60_000,
      );
      // A Generate click is an explicit open: its card lands expanded.
      const manual = filledSnap.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === cardId)!;
      expect.soft(manual.collapsed).toBe(false);
    });
  });

  test("placed highlights stay stable; unplaced anchors chip, reopen and restore (#206)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");

    await test.step("a placed highlight stays stable while another anchor cannot be placed", async () => {
      await openReview(page, "j206-seed");
      await expect.soft(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

      // One Explain on the problem card (via API, avoiding thread-text
      // selection ambiguity): this anchor becomes unplaceable when its host
      // card is collapsed below.
      const mk1 = await apiJson(s, "POST", `/api/reviews/j206-seed/actions`, {
        kind: "explain",
        quote: "folded",
        anchor: { where: "block", blockId: "problem#b2" },
      });
      const stuckId = (mk1.json as { annotationId: string }).annotationId;
      expect.soft(stuckId).toBeTruthy();
      const stuck = page.locator(`#C-problem [data-thread="${stuckId}"]`).first();
      await expect.soft(stuck).toBeVisible({ timeout: 15_000 });
      await expect.soft(stuck.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

      // One Explain on the central card (via API): this anchor places fine
      // and its highlight must then stay put.
      const mk2 = await apiJson(s, "POST", `/api/reviews/j206-seed/actions`, {
        kind: "explain",
        // Issue #341: "helper" is gone with the re-record; anchor on a
        // word the re-recorded central#b1 still carries.
        quote: "unfolds",
        anchor: { where: "block", blockId: "central#b1" },
      });
      const placedId = (mk2.json as { annotationId: string }).annotationId;
      expect.soft(placedId).toBeTruthy();
      const placed = page.locator(`#C-central [data-thread="${placedId}"]`).first();
      await expect.soft(placed).toBeVisible({ timeout: 15_000 });
      await expect.soft(placed.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

      // Wait for the demo pipeline to settle: while snapshot patches keep
      // landing, each one legitimately re-arms the bounded retry (#206's
      // bound is per change), so give-up can only happen once it is quiet.
      await expect
        .poll(
          async () => {
            const res = await apiJson(s, "GET", `/api/reviews/j206-seed`);
            const jobs = (res.json as { jobs?: { state?: string }[] }).jobs ?? [];
            return jobs.filter((j) => ["queued", "running", "backing-off"].includes(j.state ?? "")).length;
          },
          { timeout: 120_000 },
        )
        .toBe(0);

      // Collapse the problem card: its blocks leave the page, so the
      // first anchor can never be placed on this page again.
      await page.locator("#C-problem").getByRole("button", { name: "Collapse" }).click();
      await expect.soft(page.locator("#C-problem.collapsed")).toBeVisible({ timeout: 15_000 });

      // Watch the placed mark (and every footnote chip) for DOM churn —
      // starting only once the pipeline is quiet, so legitimate fill
      // churn is never counted.
      await waitForDomQuiet(page, "#page");
      await page.evaluate((id) => {
        const w = window as unknown as { __blink: { mark: number; chip: number; any: number } };
        w.__blink = { mark: 0, chip: 0, any: 0 };
        const pageEl = document.getElementById("page")!;
        const touches = (n: Node): boolean => {
          const el = n instanceof Element ? n : n.parentElement;
          return !!el?.closest?.(`mark.anc[data-jump="${id}"], mark.anc[data-thr], [data-fallback], [data-tfallback]`);
        };
        const obs = new MutationObserver((records) => {
          for (const r of records) {
            w.__blink.any++;
            const nodes = [r.target, ...r.addedNodes, ...r.removedNodes];
            if (nodes.some(touches)) {
              if ([...r.addedNodes, ...r.removedNodes].some((n) => (n instanceof Element ? n : n.parentElement)?.closest?.("mark.anc"))) w.__blink.mark++;
              else w.__blink.chip++;
            }
          }
        });
        obs.observe(pageEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
      }, placedId);
      // Quiet-watch, not a fixed sleep: resolves once the subtree holds
      // still for a full second (#363 B2).
      await waitForDomQuiet(page, "#page", 1000);
      const blink = await page.evaluate(
        () => (window as unknown as { __blink: { mark: number; chip: number; any: number } }).__blink,
      );
      // The placed mark is still there, and nothing re-marked or toggled
      // a chip while we watched (the unplaced anchor shows its chip once
      // and then everything is quiet).
      await expect.soft(page.locator(`#C-central mark.anc[data-jump="${placedId}"]`)).toHaveCount(1);
      expect.soft(blink.mark, `placed mark churned: ${JSON.stringify(blink)}`).toBe(0);
      expect.soft(blink.chip, `footnote chip toggled: ${JSON.stringify(blink)}`).toBe(0);

      // The unplaced anchor is recorded on the Debug page, with its reason.
      // Reach it the way the owner does (the Debug link, no reload): the
      // record is client-side and a full page load would wipe it.
      await page.getByRole("link", { name: "Debug", exact: true }).click();
      const section = page.locator("[data-unplaced-anchors]");
      await expect.soft(section).toBeVisible({ timeout: 30_000 });
      await expect.soft(section).toContainText(stuckId!, { timeout: 15_000 });
      await expect.soft(section).toContainText("host not on the page");
    });

    await test.step("closed explanation → deep → chip → open → back → highlight", async () => {
      await openReview(page, "j206-seed");
      await expect.soft(page.locator("#C-g-alt")).toBeVisible({ timeout: 30_000 });

      // Create a closed expansion on g-alt#b1 with a standard-only phrase.
      // Issue #341: the re-recorded deep expansions restate their card, so
      // no central standard phrase orphans at deep (and raw-HTML staleness
      // can't span markup). g-alt's deep omits this b1 span, so a
      // standard→deep step orphans it.
      const created = await apiJson(s, "POST", `/api/reviews/j206-seed/actions`, {
        kind: "explain",
        quote: "The fix has to reach two copies of",
        anchor: { where: "block", blockId: "g-alt#b1" },
      });
      const annId = (created.json as { annotationId: string }).annotationId;
      if ((created.json as { jobId?: string }).jobId) {
        const deadline = Date.now() + 60_000;
        for (;;) {
          const cur = await apiJson(s, "GET", `/api/reviews/j206-seed`);
          const ann = ((cur.json as { annotations: { id: string; replies?: { blocks: unknown[] }[] }[] }).annotations ?? []).find(
            (a) => a.id === annId,
          );
          if ((ann?.replies?.[0]?.blocks.length ?? 0) > 0) break;
          if (Date.now() > deadline) throw new Error("conversation did not fill in time");
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      // Close it so only the dotted highlight remains.
      await apiJson(s, "POST", `/api/reviews/j206-seed/actions`, {
        kind: "close",
        annotationId: annId,
      });
      await page.reload();
      await expect.soft(page.locator("#C-g-alt")).toBeVisible({ timeout: 30_000 });

      // At standard the dotted highlight lands and the footnote stays hidden.
      const mark = page.locator(`#C-g-alt mark.anc.exl[data-jump="${annId}"]:not(.fnote)`).first();
      await expect.soft(mark).toBeVisible({ timeout: 15_000 });
      const chip = page.locator(`#C-g-alt .lo mark.fnote.exl[data-jump="${annId}"]`);
      await expect.soft(chip).toBeHidden({ timeout: 10_000 });

      // Step to deep (stored levels: instant, no agent). The phrase is gone,
      // so the highlight drops and the chip appears on the citations line.
      // The toolbar reveals on card hover (#274).
      await page.locator("#C-g-alt").hover();
      await page.locator("#C-g-alt > .chead .ctl").getByRole("button", { name: "Deeper" }).click();
      await expect.soft(page.locator(`#C-g-alt mark.anc.exl[data-jump="${annId}"]:not(.fnote)`)).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect.soft(chip).toBeVisible({ timeout: 15_000 });
      // The chip shares the citations row, not a full-width stub: the chip's
      // closest `.lo` also holds the <> citations chip.
      const sameRow = await chip.evaluate((el) => {
        const lo = el.closest(".lo");
        return !!lo && !!lo.querySelector("button.lk[data-refs]");
      });
      expect.soft(sameRow).toBe(true);
      await expect.soft(page.locator("#C-g-alt .linkstub")).toHaveCount(0);

      // Clicking the chip re-opens the explanation in place.
      await chip.click();
      const expCard = page.locator(`#C-g-alt [data-thread="${annId}"]`).first();
      await expect.soft(expCard).toBeVisible({ timeout: 15_000 });

      // Close it again so the return trip asserts the closed highlight path.
      await expCard.getByRole("button", { name: "Close" }).click();
      await expect.soft(page.locator(`#C-g-alt [data-thread="${annId}"]`)).toHaveCount(0, { timeout: 10_000 });

      // Switching back restores the highlight and hides the chip.
      await page.locator("#C-g-alt").hover();
      await page.locator("#C-g-alt > .chead .ctl").getByRole("button", { name: "Simpler" }).click();
      await expect.soft(page.locator(`#C-g-alt mark.anc.exl[data-jump="${annId}"]:not(.fnote)`).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect.soft(chip).toBeHidden({ timeout: 10_000 });
    });
  });

  test("a python block highlights, an unknown block stays plain, comment places (#255)", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    if (!s) throw new Error("no service");

    await test.step("a python block highlights, an unknown block stays plain, and a code comment places (#255)", async () => {
      const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l3-j255-repo-"));
      try {
        await makeScratchRepo(repoDir);
        await git(repoDir, "update-ref", "refs/remotes/origin/main", "HEAD");
        const added = await apiJson(s, "POST", "/api/repos", { path: repoDir });
        expect.soft(added.status).toBe(200);
        const repoId = (added.json as { repos: { id: string; localPath: string }[] }).repos.find(
          (r) => r.localPath === repoDir,
        )!.id;

        const MARKDOWN = [
          "# Highlight demo",
          "",
          "A paragraph before the code.",
          "",
          "```python",
          "def greet(name):",
          "    # say hello",
          '    return "hi " + name',
          "```",
          "",
          "```mysterylang",
          "some plain text here",
          "```",
          "",
        ].join("\n");
        const created = await apiJson(s, "POST", "/api/reviews", {
          kind: "document",
          markdown: MARKDOWN,
          contextRepos: [{ repoId, source: "local" }],
        });
        expect.soft(created.status).toBe(201);
        const reviewId = (created.json as { review: { id: string } }).review.id;

        await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
        await expect.soft(page.getByTestId("document-view")).toBeVisible({ timeout: 30_000 });
        const blocks = page.locator("#C-document pre.code");
        await expect.soft(blocks).toHaveCount(2);

        // The python block upgrades from plain text to token spans; the text
        // itself never changes (offsets for anchoring are preserved).
        const py = blocks.nth(0);
        const before = (await py.textContent()) ?? "";
        expect.soft(before).toContain("say hello");
        await expect
          .poll(async () => py.locator("[class*='shk-']").count(), { timeout: 20_000 })
          .toBeGreaterThan(0);
        expect.soft(((await py.textContent()) ?? "").replace(/\s+/g, " ").trim()).toBe(
          before.replace(/\s+/g, " ").trim(),
        );

        // The unknown language block stays plain text (today's render).
        const mystery = blocks.nth(1);
        expect.soft(await mystery.locator("[class*='shk-']").count()).toBe(0);
        await expect.soft(mystery).toContainText("some plain text here");

        // Select text inside the highlighted block and comment: the anchor
        // mark must land inside the `pre` — the comment places on the code.
        await selectText(page, "#C-document pre.code", "say hello");
        await page.locator('#selbar [data-act="note"]').click();
        const composer = page.locator("#C-document .ithread[data-pending-thread]");
        await expect.soft(composer).toBeVisible({ timeout: 10_000 });
        await composer.locator("textarea").fill("Please explain this line.");
        await composer.getByRole("button", { name: /comment|save/i }).first().click();
        const thread = page.locator("#C-document .ithread", { hasText: "Please explain this line." });
        await expect.soft(thread.first()).toBeVisible({ timeout: 15_000 });
        await expect.soft(page.locator("#C-document pre.code mark.anc[data-thr]").first()).toBeVisible({
          timeout: 15_000,
        });
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });
  });

  test("review-page polish: no shared-context line, action-only tooltips (j225)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    await openReview(page, "j225-seed");

    await test.step("no shared-context line on the review page", async () => {
      // No shared-context line on the review page (#225).
      await expect.soft(page.locator("[data-shared-indicator]")).toHaveCount(0);
      await expect.soft(page.getByText(/kept \d+ notes? from your conversations/)).toHaveCount(0);
      await checkLayout(page, "j225-guide");
    });

    await test.step("diff toolbar tooltips are action-only with filter/fold icons", async () => {
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      await expect.soft(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });

      const fold = page.getByRole("button", { name: "Fold all", exact: true });
      const unfold = page.getByRole("button", { name: "Unfold all", exact: true });
      await expect.soft(fold).toHaveAttribute("data-tip", "Fold the code");
      await expect.soft(unfold).toHaveAttribute("data-tip", "Unfold the code");
      // Mirrored pair: the two buttons render different icons.
      const foldSvg = await fold.locator("svg").innerHTML();
      const unfoldSvg = await unfold.locator("svg").innerHTML();
      expect.soft(foldSvg).not.toBe(unfoldSvg);

      await expect.soft(page.getByRole("button", { name: /Hide level:/ })).toHaveAttribute(
        "data-tip",
        /^Hiding \d+ of \d+ hunks/,
      );
      // #241: Refresh lives in the review top bar now (next to the status
      // icon), tooltip exactly "Refresh" — and no longer in the diff toolbar.
      const refresh = page.locator("#reviewbar").getByRole("button", { name: "Refresh" });
      await expect.soft(refresh).toHaveAttribute("data-tip", "Refresh");
      await expect.soft(page.locator(".dtool").getByRole("button", { name: "Refresh" })).toHaveCount(0);

      // Review filter: funnel icon, action-only tooltip, active dot.
      // (#296: new reviews hide existing GitHub comments by default, so the
      // filter starts active — pressed with its dot — not idle.)
      const reviewFilter = page.getByRole("button", { name: "Review filters" });
      await expect.soft(reviewFilter).toHaveAttribute("data-tip", "Reviewed and GitHub comment filters");
      await expect.soft(reviewFilter).toHaveAttribute("aria-pressed", "true");
      await expect.soft(reviewFilter.locator("[data-filter-active]")).toHaveCount(1);
      await reviewFilter.click();
      const menu = page.getByRole("menu", { name: "Review filters" });
      await expect.soft(menu).toBeVisible();
      await menu.getByRole("menuitemcheckbox", { name: /GitHub comments/ }).click();
      await expect.soft(reviewFilter).toHaveAttribute("aria-pressed", "false");
      await expect.soft(reviewFilter.locator("[data-filter-active]")).toHaveCount(0);
      await expect.soft(reviewFilter).toHaveAttribute("data-tip", "Reviewed and GitHub comment filters");
      await page.keyboard.press("Escape");

      // No toolbar tooltip carries agent/summary/state commentary.
      const tips = await page.locator(".dtool [data-tip]").evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-tip") ?? ""),
      );
      for (const tip of tips) {
        expect.soft(tip).not.toMatch(/agent|summar|\(|;/i);
      }

      await checkLayout(page, "j225-diff");
    });
  });

  test("card copies its Markdown to the clipboard (#377)", async ({ page, context }) => {
    test.setTimeout(180_000);
    const s = service();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await openReview(page, readReview);

    await test.step("the toolbar carries a Copy as Markdown control with a tooltip", async () => {
      const button = page.locator('#C-central [data-copy-card="central"]');
      await page.locator("#C-central").hover();
      await expect.soft(button).toBeVisible();
      await hoverFresh(page, button);
      await expect.soft(page.locator("#tip")).toContainText("Copy as Markdown", { timeout: 10_000 });
    });

    await test.step("clicking it copies the card as portable Markdown", async () => {
      await page.locator('#C-central [data-copy-card="central"]').click();
      await expect.soft(page.locator("#toast")).toContainText("Copied as Markdown", { timeout: 10_000 });
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
      expect.soft(clip.startsWith("## ")).toBe(true);
      expect.soft(clip).not.toContain("[[");
      // The demo is a PR review: cited ranges are head-commit permalinks.
      type SnapProbe = {
        pages: { cards: { id: string; blocks: { citations?: { target?: string }[] }[] }[] }[];
      };
      const snap = await apiJson(s, "GET", `/api/reviews/${readReview}`);
      const cards = ((snap.json as unknown as SnapProbe).pages ?? []).flatMap((p) => p.cards);
      const cites = (cards.find((c) => c.id === "central")?.blocks ?? []).flatMap((b) => b.citations ?? []);
      if (cites.length > 0) {
        expect.soft(clip).toContain("https://github.com/urllib3/urllib3/blob/");
      }
    });
  });

  test("a diagram in the guide renders on demand; without d2 the fallback links Settings", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");

    await test.step("a diagram in the guide renders as SVG", async () => {
      await openReview(page, diagramReview);
      // Issue #341: no page embeds a diagram anymore — fire the on-demand
      // diagram action for central (replay serves the diagram-central
      // recording), then the SVG (or the no-d2 fallback) appears there.
      await page.locator("#C-central").getByRole("button", { name: "Add diagram" }).click();
      const svg = page.locator("#C-central .dg-svg svg").first();
      const fallback = page.locator("#C-central .dg-fallback").first();
      await expect.soft(svg.or(fallback)).toBeVisible({ timeout: 90_000 });
      if ((await svg.count()) > 0) {
        await expect.soft(svg).toBeVisible();
      } else {
        // No d2 on this machine: the source fallback must say where to fix it.
        await expect.soft(fallback).toContainText(/Settings/);
      }
    });

    await test.step("without d2 an unseeded diagram shows the source fallback with a Settings link", async () => {
      const badData = mkdtempSync(path.join(os.tmpdir(), "unvibe-l3-badd2-"));
      let bad: RunningService | null = null;
      try {
        // Seed the fixture review plus one diagram whose hash has no
        // pre-rendered SVG: without d2 it cannot render, so the fallback
        // is the user-visible path.
        const { readFileSync } = await import("node:fs");
        const fixtureDir = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));
        const snapshot = JSON.parse(readFileSync(path.join(fixtureDir, "snapshot.json"), "utf8")) as {
          rev: number; review: { id: string };
          pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
        };
        const meta = JSON.parse(readFileSync(path.join(fixtureDir, "meta.json"), "utf8")) as { keyAliases: Record<string, string> };
        let json = JSON.stringify(snapshot);
        for (const [a, r] of Object.entries(meta.keyAliases)) json = json.split(`diff:${a}:`).join(`diff:${r}:`);
        const seeded = JSON.parse(json) as typeof snapshot;
        seeded.review.id = "l3-d2-seed";
        const card = seeded.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "g-alt");
        if (!card) throw new Error("fixture has no g-alt card");
        const source = ['probe: "probe source" {link: "diff:src-urllib3-connection.py:80-82"}', 'probe2: "probe target"', 'probe -> probe2: "probe edge"'].join("\n");
        card.blocks.push({
          type: "diagram", id: "b-l3-extra", source,
          citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
          render: { hash: diagramHash(canonicalizeD2Source(source), D2_MIN_VERSION), status: "pending" },
        });
        const db = new DatabaseSync(path.join(badData, "unvibe.db"));
        try {
          db.exec(`CREATE TABLE IF NOT EXISTS review_snapshots (review_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, snapshot JSON NOT NULL, updated_at INTEGER NOT NULL);`);
          db.prepare("INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot")
            .run("l3-d2-seed", seeded.rev, JSON.stringify(seeded), Date.now());
          stampDataFormat(db);
        } finally { db.close(); }
        bad = await startService(badData, { agent: "replay", extraEnv: { UNVIBE_D2_BIN: "/nonexistent-d2" } });
        await page.goto(`${bad.origin}/review/l3-d2-seed?token=${bad.token}`);
        await expect.soft(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
        const fallback = page.locator(".dg-fallback").first();
        await expect.soft(fallback).toBeVisible({ timeout: 90_000 });
        await expect.soft(fallback).toContainText(/Settings/);
      } finally {
        await bad?.stop().catch(() => {});
        rmSync(badData, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Scratch file-tab steps (j81/j317): agent:none service, reseeded +
// restarted in-test like the originals.
// ---------------------------------------------------------------------------

test.describe("L3 scratch file tabs", () => {
  let repo81 = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let review81 = "";
  let repo317 = "";
  let review317 = "";

  async function start(): Promise<RunningService> {
    const fakeShell = path.join(fakeBin, "fakeshell");
    return startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
  }

  test.beforeAll(async () => {
    // j81 repo: helper/app + a bracket-path route file (issue #332).
    repo81 = mkdtempSync(path.join(os.tmpdir(), "unvibe-l3-j81-repo-"));
    await git(repo81, "init", "-b", "main");
    await git(repo81, "config", "user.email", "t@example.com");
    await git(repo81, "config", "user.name", "T");
    writeFileSync(path.join(repo81, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
    writeFileSync(path.join(repo81, "app.py"), "def main():\n    return 1\n");
    await git(repo81, "add", ".");
    await git(repo81, "commit", "-m", "base");
    await git(repo81, "checkout", "-b", "feature");
    writeFileSync(path.join(repo81, "app.py"), "def main():\n    return 2\n");
    await git(repo81, "add", ".");
    await git(repo81, "commit", "-m", "feature work");
    const pageFile = path.join(repo81, "src", "app", "(group)", "items", "[id]", "page.tsx");
    mkdirSync(path.dirname(pageFile), { recursive: true });
    writeFileSync(
      pageFile,
      "export default function Page({ params }: { params: { id: string } }) {\n  return <h1>Item {params.id}</h1>;\n}\n",
    );
    await git(repo81, "add", ".");
    await git(repo81, "commit", "-m", "route with group and segment");
    const head81 = (await git(repo81, "rev-parse", "HEAD")).trim();
    // j317 repo: one 3000-line non-diff file.
    repo317 = mkdtempSync(path.join(os.tmpdir(), "unvibe-l3-j317-repo-"));
    await git(repo317, "init", "-b", "main");
    await git(repo317, "config", "user.email", "t@example.com");
    await git(repo317, "config", "user.name", "T");
    const lines: string[] = [];
    for (let i = 1; i <= 3000; i++) lines.push(`value_${i} = compute_${i}(seed)  # row ${i}`);
    writeFileSync(path.join(repo317, "big.py"), lines.join("\n") + "\n");
    writeFileSync(path.join(repo317, "app.py"), "def main():\n    return 1\n");
    await git(repo317, "add", ".");
    await git(repo317, "commit", "-m", "base");
    await git(repo317, "checkout", "-b", "feature");
    writeFileSync(path.join(repo317, "app.py"), "def main():\n    return 2\n");
    await git(repo317, "add", ".");
    await git(repo317, "commit", "-m", "feature work");
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l3-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l3-bin-"));
    writeFakeGh(fakeBin, logDir, head81);
    writeFakeGitOffline(fakeBin, realGitPath());
    writeFileSync(path.join(fakeBin, "fakeshell"), `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l3-scratch-data-"));
    svc = await start();
    review81 = await createScratchReview(svc, repo81);
    review317 = await createScratchReview(svc, repo317);
    // Wait for both ingests to really land before the tests reseed over
    // them (stopping over a snapshot that still says "loading" lets boot
    // recovery re-ingest on the restart and replace the seeded guide).
    for (const id of [review81, review317]) {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const res = await apiJson(svc, "GET", `/api/reviews/${id}`);
        const snap = res.json as unknown as {
          version: { headSha: string };
          ingest?: { status: string };
          jobs?: { state: string }[];
        };
        const active = (snap.jobs ?? []).some((j) => j.state === "queued" || j.state === "running" || j.state === "backing-off");
        if (snap.version.headSha !== "" && snap.ingest?.status === "ready" && !active) break;
        if (Date.now() > deadline) throw new Error("scratch ingest did not settle");
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repo81, repo317, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  test("code citations outside the diff hover, open a file tab and comment (#81, #332)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    type SnapProbe = {
      version: { headSha: string };
      files: { path: string }[];
      ingest?: { status: string };
      jobs?: { state: string }[];
      pages: { id: string; cards: { id: string }[] }[];
    };
    const before = (await apiJson(s, "GET", `/api/reviews/${review81}`)).json as unknown as SnapProbe;
    const head = before.version.headSha;
    expect.soft(before.files.some((f) => f.path === "helper.py")).toBe(false);

    await test.step("seed verified outside-diff, past-the-end and missing citations", async () => {
      // Seed guide cards: a verified outside-diff citation, a past-the-end
      // one (valid under #81: no length check), and a missing file.
      await svc!.stop();
      const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
      try {
        const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(review81) as
          | { rev: number; snapshot: string }
          | undefined;
        if (!row) throw new Error("no snapshot row to seed");
        const snap = JSON.parse(row.snapshot) as {
          pages: { id: string; kind: string; title: string; cards: unknown[] }[];
          pipeline?: { stages: Record<string, string> };
          ingest?: { status: string };
        };
        // Keep boot recovery from re-ingesting over the seed.
        snap.ingest = { status: "ready" };
        snap.pipeline = {
          stages: { reader: "done", base: "done", critic: "done", "hunk-pass": "done", "go-deeper": "done" },
        };
        let root = snap.pages.find((p) => p.id === "root");
        if (!root) {
          root = { id: "root", kind: "root", title: "Guide", cards: [] };
          snap.pages.unshift(root);
        }
        const card = (id: string, text: string, target: string, unverified?: boolean): unknown => ({
          id,
          pageId: "root",
          title: id,
          level: "standard",
          collapsed: false,
          revision: 1,
          blocks: [
            {
              type: "paragraph",
              id: `b-${id}`,
              text: { standard: text },
              citations: [{ target, ...(unverified ? { unverified: true } : {}) }],
            },
          ],
          undoStack: [],
        });
        root.cards.push(
          card("c-beta", "Uses the helper beta value.", `code:helper.py:2@${head}`),
          card("c-past", "Cites past the end.", `code:helper.py:2-99@${head}`),
          card("c-missing", "Cites a missing file.", "code:nope.py:1@deadbeef", true),
          // Issue #332: a bracket-path file outside the diff renders a
          // working chip that opens the file tab.
          card(
            "c-brackets",
            "Route group page shows the item.",
            `code:src/app/(group)/items/[id]/page.tsx:2@${head}`,
          ),
        );
        db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
          row.rev + 1,
          JSON.stringify(snap),
          review81,
        );
        stampDataFormat(db);
      } finally {
        db.close();
      }
      svc = await start();

      // The restarted service must actually serve the seeded guide
      // before the browser opens it (poll the served state, not a timer).
      await expect
        .poll(
          async () => {
            const res = await apiJson(service(), "GET", `/api/reviews/${review81}`);
            const snap = res.json as unknown as SnapProbe;
            return snap.pages.some((p) => p.cards.some((c) => c.id === "c-beta"));
          },
          { timeout: 60_000 },
        )
        .toBe(true);
    });

    await test.step("hover previews, click opens a closable file tab, selection comments on the code host", async () => {
      const cur = service();
      await page.goto(`${cur.origin}/review/${review81}?token=${cur.token}`);
      await expect.soft(page.getByText("Uses the helper beta value.")).toBeVisible({ timeout: 60_000 });
      // Past-the-end is verified now; a missing file gets no marker at all
      // (#264): the surrounding text stays plain text.
      await expect.soft(page.locator("#C-c-past .lk.unverified")).toHaveCount(0);
      await expect.soft(page.locator("#C-c-missing .lk.unverified")).toHaveCount(0);
      await expect.soft(page.locator("#C-c-missing .lk")).toHaveCount(0);
      await expect.soft(page.locator("#C-c-missing")).toContainText("Cites a missing file.");

      // Hover previews the cited lines at the commit.
      // B5: hover only after scroll quiet (throttle flake).
      await hoverFresh(page, page.locator("#C-c-beta .lk[data-refs]"));
      await expect.soft(page.locator("#pop")).toContainText("beta = 2", { timeout: 30_000 });

      // Click opens the file tab at the cited lines.
      await page.locator("#C-c-beta .lk[data-refs]").click();
      await expect.soft(page.getByRole("tab", { name: "helper.py" })).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator(".codefile")).toContainText("beta = 2");
      await expect.soft(page.locator('.codefile [data-code-line="2"]')).toHaveClass(/cited/);

      // A past-the-end citation reuses the same tab and clamps the highlight.
      await page.locator("#C-c-past .lk[data-refs]").click();
      await expect.soft(page.getByRole("tab", { name: "helper.py" })).toHaveCount(1);
      await expect.soft(page.locator('.codefile [data-code-line="3"]')).toHaveClass(/cited/);

      // Selecting cited text and commenting anchors to the code host.
      await page.evaluate(() => {
        const row = document.querySelector('.codefile [data-code-line="2"] .cf-c');
        if (!row?.firstChild) throw new Error("no cited row");
        const range = document.createRange();
        range.setStart(row.firstChild, 0);
        range.setEnd(row.firstChild, 4);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await expect.soft(page.locator("#selbar")).toBeVisible({ timeout: 30_000 });
      await page.locator('#selbar [data-act="note"]').click();
      const composer = page.locator(".codefile textarea");
      await expect.soft(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill("Is beta still the right default?");
      await page.locator(".codefile").getByRole("button", { name: "Save", exact: true }).click();
      const deadline = Date.now() + 30_000;
      for (;;) {
        const snap = await apiJson(service(), "GET", `/api/reviews/${review81}`);
        const anns = (snap.json as unknown as { annotations: { type: string; anchor: { host: { kind: string; path?: string } }; replies?: { kind?: string }[] }[] }).annotations;
        const thread = anns.find((a) => a.type === "thread" && a.anchor.host.kind === "code" && (a.replies ?? []).some((r) => r.kind === "comment"));
        if (thread) {
          expect.soft(thread.anchor.host.path).toBe("helper.py");
          break;
        }
        if (Date.now() > deadline) throw new Error("code-host comment not stored");
        await new Promise((r) => setTimeout(r, 250));
      }
      await expect.soft(page.locator(".codefile")).toContainText("Is beta still the right default?", { timeout: 30_000 });

      // The tab closes; the Diff tab remains.
      await page.getByRole("button", { name: "Close helper.py" }).click();
      await expect.soft(page.locator(".codefile")).toHaveCount(0);
      await expect.soft(page.getByRole("tab", { name: "Diff" })).toBeVisible();
    });

    await test.step("bracket-path citation renders a chip and opens the file tab (#332)", async () => {
      const cur = service();
      await page.goto(`${cur.origin}/review/${review81}?token=${cur.token}`);
      await expect.soft(page.locator("#C-c-brackets")).toContainText("Route group page shows the item.", {
        timeout: 60_000,
      });

      // A chip, not raw [[code:…]] text, and verified (no unverified marker).
      const chip = page.locator("#C-c-brackets .lk[data-refs]");
      await expect.soft(chip).toHaveCount(1, { timeout: 30_000 });
      await expect.soft(page.locator("#C-c-brackets .lk.unverified")).toHaveCount(0);
      await expect.soft(page.locator("#C-c-brackets")).not.toContainText("[[code:");

      // Hover previews the cited line.
      // B5: hover only after scroll quiet (throttle flake).
      await hoverFresh(page, chip);
      await expect.soft(page.locator("#pop")).toContainText("Item", { timeout: 30_000 });

      // Click opens the file tab at the cited line.
      await chip.click();
      await expect.soft(page.getByRole("tab", { name: "page.tsx" })).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator(".codefile")).toContainText("Item");
      await expect.soft(page.locator('.codefile [data-code-line="2"]')).toHaveClass(/cited/);
    });
  });

  test("a citation into a big non-diff file scrolls, highlights and re-scrolls (#317)", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    if (!s) throw new Error("no service");
    type SnapProbe = {
      version: { headSha: string };
      ingest?: { status: string };
      jobs?: { state: string }[];
      pages: { id: string; cards: { id: string }[] }[];
    };

    await test.step("seed deep + near citations into the 3000-line file", async () => {
      let head = "";
      const settleDeadline = Date.now() + 90_000;
      for (;;) {
        const res = await apiJson(s, "GET", `/api/reviews/${review317}`);
        const snap = res.json as unknown as SnapProbe;
        const active = (snap.jobs ?? []).some((j) => j.state === "queued" || j.state === "running" || j.state === "backing-off");
        if (snap.version.headSha !== "" && snap.ingest?.status === "ready" && !active) { head = snap.version.headSha; break; }
        if (Date.now() > settleDeadline) throw new Error("scratch ingest did not settle");
        await new Promise((r) => setTimeout(r, 250));
      }

      await svc!.stop();
      const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
      try {
        const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(review317) as { rev: number; snapshot: string } | undefined;
        if (!row) throw new Error("no snapshot row to seed");
        const snap = JSON.parse(row.snapshot) as {
          pages: { id: string; kind: string; title: string; cards: unknown[] }[];
          pipeline?: { stages: Record<string, string> };
          ingest?: { status: string };
        };
        snap.ingest = { status: "ready" };
        snap.pipeline = { stages: { reader: "done", base: "done", critic: "done", "hunk-pass": "done", "go-deeper": "done" } };
        let root = snap.pages.find((p) => p.id === "root");
        if (!root) { root = { id: "root", kind: "root", title: "Guide", cards: [] }; snap.pages.unshift(root); }
        const card = (id: string, text: string, target: string): unknown => ({
          id, pageId: "root", title: id, level: "standard", collapsed: false, revision: 1,
          blocks: [{ type: "paragraph", id: `b-${id}`, text: { standard: text }, citations: [{ target }] }],
          undoStack: [],
        });
        root.cards.push(
          card("c-deep", "Deep in the big file.", `code:big.py:2500-2502@${head}`),
          card("c-near", "Near the top of the big file.", `code:big.py:120-121@${head}`),
        );
        db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(row.rev + 1, JSON.stringify(snap), review317);
        stampDataFormat(db);
      } finally { db.close(); }
      svc = await start();
      await expect.poll(async () => {
        const res = await apiJson(service(), "GET", `/api/reviews/${review317}`);
        return (res.json as unknown as SnapProbe).pages.some((p) => p.cards.some((c) => c.id === "c-deep"));
      }, { timeout: 60_000 }).toBe(true);
    });

    await test.step("first citation scrolls the cited range into view with syntax tokens", async () => {
      const cur = service();
      await page.goto(`${cur.origin}/review/${review317}?token=${cur.token}`);
      await expect.soft(page.getByText("Deep in the big file.")).toBeVisible({ timeout: 60_000 });

      // First citation: far down a 3000-line non-diff file.
      const t0 = Date.now();
      await page.locator("#C-c-deep .lk[data-refs]").click();
      await expect.soft(page.getByRole("tab", { name: "big.py" })).toBeVisible({ timeout: 30_000 });
      const tPaint = Date.now() - t0;
      await expect.soft(page.locator('.codefile [data-code-line="2500"]')).toHaveClass(/cited/, { timeout: 30_000 });
      await expect.poll(() => rowInPane(page, 2500), { timeout: 30_000 }).toBe(true);
      await expect.poll(() => rangeCentred(page, 2500, 2502), { timeout: 30_000 }).toBe(true);
      const tScroll = Date.now() - t0;
      console.log(`J317 timing: tab-visible=${tPaint}ms cited-in-view=${tScroll}ms`);
      const top1 = await page.evaluate(() => document.getElementById("right")?.scrollTop ?? -1);
      expect.soft(top1).toBeGreaterThan(0);
      // Syntax tokens inside the cited rows (diff highlighter, shiki classes).
      await expect.poll(async () => page.locator('.codefile [data-code-line="2500"] [class*="shk-"]').count(), { timeout: 30_000 }).toBeGreaterThan(0);
    });

    await test.step("a second citation into the same open tab re-scrolls to the new range", async () => {
      const top1 = await page.evaluate(() => document.getElementById("right")?.scrollTop ?? -1);
      await page.locator("#C-c-near .lk[data-refs]").click();
      await expect.soft(page.getByRole("tab", { name: "big.py" })).toHaveCount(1);
      await expect.soft(page.locator('.codefile [data-code-line="120"]')).toHaveClass(/cited/, { timeout: 30_000 });
      await expect.poll(() => rowInPane(page, 120), { timeout: 30_000 }).toBe(true);
      await expect.poll(() => rangeCentred(page, 120, 121), { timeout: 30_000 }).toBe(true);
      const top2 = await page.evaluate(() => document.getElementById("right")?.scrollTop ?? -1);
      expect.soft(top2).toBeLessThan(top1);
      await expect.poll(async () => page.locator('.codefile [data-code-line="120"] [class*="shk-"]').count(), { timeout: 30_000 }).toBeGreaterThan(0);
    });
  });
});

/** True when the row's box sits inside the #right pane's box. */
async function rowInPane(page: Page, line: number): Promise<boolean> {
  return page.evaluate((n) => {
    const row = document.querySelector(`.codefile [data-code-line="${n}"]`);
    const pane = document.getElementById("right");
    if (!row || !pane) return false;
    const r = row.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    return r.top >= p.top && r.bottom <= p.bottom && r.height > 0;
  }, line);
}

/** True when the range's centre is within 20% of the pane's centre. */
async function rangeCentred(page: Page, start: number, end: number): Promise<boolean> {
  return page.evaluate(([s, e]) => {
    const first = document.querySelector(`.codefile [data-code-line="${s}"]`);
    const last = document.querySelector(`.codefile [data-code-line="${e}"]`);
    const pane = document.getElementById("right");
    if (!first || !last || !pane) return false;
    const p = pane.getBoundingClientRect();
    const rangeCentre = (first.getBoundingClientRect().top + last.getBoundingClientRect().bottom) / 2;
    const paneCentre = (p.top + p.bottom) / 2;
    return Math.abs(rangeCentre - paneCentre) <= 0.2 * p.height;
  }, [start, end]);
}

// ---------------------------------------------------------------------------
// Seeded D2 diagrams over the real service (j14 diagram third): endpoint
// serving, on-demand render vs 409, theme switching, hover previews,
// click-to-reveal, and the pipeline-emitted block.
// ---------------------------------------------------------------------------

const D2_FIXTURE_DIR = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));
const D2_SEED_REVIEW_ID = "d2-seed";
// Issue #341: the re-recorded on-demand diagram (diagram-central).
const D2_SEED_HASH = "8d6ea4e980ea839e";

interface D2ApiResult {
  status: number;
  contentType: string;
  text: string;
}

/** Authenticated HTTP without subprocesses (review snapshots exceed execFile's buffer caps). */
async function d2Api(
  origin: string,
  token: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<D2ApiResult> {
  const res = await fetch(`${origin}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text: await res.text(),
  };
}

function d2ApiJson(text: string): unknown {
  return text === "" ? null : (JSON.parse(text) as unknown);
}

/** Extra diagram block: valid cites, but a hash no pre-rendered seed has. */
const D2_EXTRA_SOURCE = [
  'd2seedprobe: "probe source" {link: "diff:src-urllib3-connection.py:80-82"}',
  'd2seedprobe2: "probe target"',
  'd2seedprobe -> d2seedprobe2: "probe edge"',
].join("\n");

const D2_EXTRA_HASH = diagramHash(canonicalizeD2Source(D2_EXTRA_SOURCE), D2_MIN_VERSION);

/** Lifted #286 features in one bundled-demo-safe sample (no icons: the
 * real service must not fetch from the network in tests): a container, a
 * markdown label, and a redeclared edge-style line. */
const D2_LIFTED_SOURCE = [
  "direction: right",
  "parser: {",
  '  msg: "HTTPMessage" {link: "diff:src-urllib3-connection.py:80-82"}',
  '  norm: |md **unfold** values | {link: "diff:src-urllib3-connection.py:91-110"}',
  '  msg -> norm: unfold {link: "diff:src-urllib3-connection.py:650-651"}',
  "}",
  'hdict: "HTTPHeaderDict"',
  'parser -> hdict: sync {link: "diff:src-urllib3-connection.py:650-651"}',
  "parser -> hdict: {style: {stroke-dash: 4}}",
].join("\n");

const D2_LIFTED_HASH = diagramHash(canonicalizeD2Source(D2_LIFTED_SOURCE), D2_MIN_VERSION);
// Issue #341: the re-recorded fixture pre-renders two on-demand diagrams.
const D2_SEEDED_HASHES = new Set([D2_SEED_HASH, "22365f71688744f3"]);

function seedD2Review(dataDir: string): void {
  const snapshot = JSON.parse(readFileSync(path.join(D2_FIXTURE_DIR, "snapshot.json"), "utf8")) as {
    rev: number;
    review: { id: string };
    pages: { id: string; cards: { id: string; blocks: DiagramBlock[] }[] }[];
  };
  const meta = JSON.parse(readFileSync(path.join(D2_FIXTURE_DIR, "meta.json"), "utf8")) as {
    keyAliases: Record<string, string>;
  };
  let json = JSON.stringify(snapshot);
  for (const [alias, real] of Object.entries(meta.keyAliases)) {
    json = json.split(`diff:${alias}:`).join(`diff:${real}:`);
  }
  const seeded = JSON.parse(json) as typeof snapshot;
  seeded.review.id = D2_SEED_REVIEW_ID;
  // Issue #341: the re-recorded fixture embeds no diagram, so the seed
  // carries the recorded on-demand diagram (diagram-central) itself —
  // same source, same hash, same pre-rendered SVGs the endpoint serves.
  const card = seeded.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "g-alt");
  if (!card) throw new Error("fixture has no root g-alt card");
  const centralText = readFileSync(path.join(D2_FIXTURE_DIR, "recordings", "diagram-central.md"), "utf8");
  const centralDg = parseReply(centralText).blocks.find((b) => b.type === "diagram") as unknown as DiagramBlock | undefined;
  if (!centralDg) throw new Error("diagram-central recording has no diagram block");
  card.blocks.unshift({
    type: "diagram",
    id: "b-seed-central",
    source: centralDg.source,
    caption: centralDg.caption,
    citations: centralDg.citations,
    render: { hash: diagramHash(canonicalizeD2Source(centralDg.source), D2_MIN_VERSION), status: "ok" },
  } as DiagramBlock);
  card.blocks.push({
    type: "diagram",
    id: "b-seed-extra",
    source: D2_EXTRA_SOURCE,
    citations: [{ target: "diff:src-urllib3-connection.py:80-82" }],
    render: { hash: D2_EXTRA_HASH, status: "unavailable" },
  } as DiagramBlock);
  card.blocks.push({
    type: "diagram",
    id: "b-seed-lifted",
    source: D2_LIFTED_SOURCE,
    citations: [
      { target: "diff:src-urllib3-connection.py:80-82" },
      { target: "diff:src-urllib3-connection.py:91-110" },
      { target: "diff:src-urllib3-connection.py:650-651" },
    ],
    render: { hash: D2_LIFTED_HASH, status: "unavailable" },
  } as DiagramBlock);
  // From d2-diagrams.spec.ts (#357 #130): a block whose source never
  // compiles, for the failed-compile fallback.
  card.blocks.push({
    type: "diagram",
    id: "b-seed-broken",
    source: "this is not d2 ::: {",
    citations: [],
    render: {
      hash: diagramHash(canonicalizeD2Source("this is not d2 ::: {"), D2_MIN_VERSION),
      status: "unavailable",
    },
  } as DiagramBlock);
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS review_snapshots (
        review_id TEXT PRIMARY KEY,
        rev INTEGER NOT NULL,
        snapshot JSON NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
    );
    db.prepare(
      "INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot",
    ).run(D2_SEED_REVIEW_ID, seeded.rev, JSON.stringify(seeded), Date.now());
    db.exec(
      `CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
        local_path TEXT NOT NULL, last_opened INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, repo_id TEXT NOT NULL REFERENCES repos(id),
        branch TEXT NOT NULL, pr_number INTEGER, current_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, data JSON NOT NULL DEFAULT '{}'
      );`,
    );
    db.prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO NOTHING",
    ).run("seed-repo", "seed", "repo", "/tmp", Date.now());
    db.prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO NOTHING",
    ).run(D2_SEED_REVIEW_ID, "seed-repo", "main", 5020, 1, Date.now(), JSON.stringify({}));
    stampDataFormat(db);
  } finally {
    db.close();
  }
}

for (const mode of [
  { name: "with d2", extraEnv: {} as Record<string, string>, expectBinary: true },
  { name: "without d2", extraEnv: { UNVIBE_D2_BIN: "/nonexistent" } as Record<string, string>, expectBinary: false },
]) {
  test.describe(`L3 D2 diagrams over the real service (${mode.name})`, () => {
    let dataDir = "";
    let svc: RunningService | null = null;
    let demoReviewId = "";

    test.beforeAll(async () => {
      test.setTimeout(240_000);
      expect(D2_SEEDED_HASHES.has(D2_EXTRA_HASH)).toBe(false);
      expect(D2_SEEDED_HASHES.has(D2_LIFTED_HASH)).toBe(false);
      dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l3-d2-data-"));
      seedD2Review(dataDir);
      svc = await startService(dataDir, {
        agent: "replay",
        extraEnv: mode.extraEnv,
        label: mode.expectBinary ? "l3-d2-with" : "l3-d2-without",
      });
      if (!svc) throw new Error("service not running");
      // The d2 readiness check proves which binary situation this suite runs in.
      const readiness = await d2Api(svc.origin, svc.token, "GET", "/api/readiness");
      expect(readiness.status).toBe(200);
      const checks = (
        d2ApiJson(readiness.text) as {
          checks: { id: string; status: string; summary: string }[];
        }
      ).checks;
      const d2 = checks.find((c) => c.id === "d2");
      expect(d2, "merged service must report a d2 readiness check").toBeTruthy();
      if (mode.expectBinary) {
        expect(d2!.status).toBe("ok");
        expect(d2!.summary).not.toContain("UNVIBE_D2_BIN");
      } else {
        expect(d2!.status).toBe("warning");
        expect(d2!.summary).toContain("UNVIBE_D2_BIN");
      }
      const created = await d2Api(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" });
      expect(created.status).toBe(201);
      demoReviewId = (d2ApiJson(created.text) as { review: { id: string } }).review.id;
      expect(demoReviewId).toMatch(/^rv_[0-9a-f]+$/);
    });

    test.afterAll(async () => {
      await svc?.stop().catch(() => {});
      svc = null;
      rmSync(dataDir, { recursive: true, force: true });
    });

    function running(): RunningService {
      if (!svc) throw new Error("service not running");
      return svc;
    }

    async function openReview(page: Page, reviewId: string): Promise<void> {
      const s = running();
      await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
      await expect(page.locator("#page .doc h1.title")).toContainText(
        "Unfold obsolete folded response headers",
        { timeout: 30_000 },
      );
    }

    test("endpoint serves seeded light + dark SVG and 404s unknown hashes", async () => {
      test.setTimeout(60_000);
      const s = running();
      const dia = (hash: string, theme: string): Promise<D2ApiResult> =>
        d2Api(s.origin, s.token, "GET", `/api/reviews/${D2_SEED_REVIEW_ID}/diagrams/${hash}?theme=${theme}`);
      const light = await dia(D2_SEED_HASH, "light");
      expect(light.status).toBe(200);
      expect(light.contentType).toContain("image/svg+xml");
      expect(light.text).toContain("<svg");
      // Contract anchors survive the service sanitiser.
      expect(light.text).toContain("data-refs");
      expect(light.text).toContain("data-src");
      expect(light.text).not.toContain("<script");
      const dark = await dia(D2_SEED_HASH, "dark");
      expect(dark.status).toBe(200);
      expect(dark.contentType).toContain("image/svg+xml");
      expect(dark.text).toContain("<svg");
      expect(dark.text).not.toBe(light.text);
      expect((await dia("deadbeefdeadbeef", "light")).status).toBe(404);
      const badReview = await d2Api(
        s.origin,
        s.token,
        "GET",
        `/api/reviews/rv_nonexistent/diagrams/${D2_SEED_HASH}?theme=light`,
      );
      expect(badReview.status).toBe(404);
    });

    test("fresh diagram renders on demand with d2, 409s without", async () => {
      test.setTimeout(120_000);
      const s = running();
      const urlPath = `/api/reviews/${D2_SEED_REVIEW_ID}/diagrams/${D2_EXTRA_HASH}?theme=light`;
      const got = await d2Api(s.origin, s.token, "GET", urlPath);
      if (mode.expectBinary) {
        expect(got.status).toBe(200);
        expect(got.contentType).toContain("image/svg+xml");
        expect(got.text).toContain("<svg");
        expect(got.text).toContain("data-refs");
        // On-demand success heals the stored block to ok.
        const snap = await d2Api(s.origin, s.token, "GET", `/api/reviews/${D2_SEED_REVIEW_ID}`);
        expect(snap.status).toBe(200);
        const blocks = (d2ApiJson(snap.text) as { pages: { cards: { blocks: DiagramBlock[] }[] }[] }).pages.flatMap(
          (p) => p.cards.flatMap((c) => c.blocks),
        );
        const extra = blocks.find((b) => b.type === "diagram" && b.id === "b-seed-extra");
        expect(extra?.render?.status).toBe("ok");
      } else {
        expect(got.status).toBe(409);
        expect((d2ApiJson(got.text) as { status: string }).status).toBe("unavailable");
      }
    });

    test("lifted #286 features render on demand with d2, 409 without", async () => {
      test.setTimeout(120_000);
      const s = running();
      const urlPath = `/api/reviews/${D2_SEED_REVIEW_ID}/diagrams/${D2_LIFTED_HASH}?theme=light`;
      const got = await d2Api(s.origin, s.token, "GET", urlPath);
      if (mode.expectBinary) {
        expect(got.status).toBe(200);
        expect(got.contentType).toContain("image/svg+xml");
        expect(got.text).toContain("<svg");
        // Container, markdown label and edge style all survived.
        expect(got.text).toContain("data-refs");
        expect(got.text).not.toContain("foreignObject");
        // On-demand success heals the stored block to ok.
        const snap = await d2Api(s.origin, s.token, "GET", `/api/reviews/${D2_SEED_REVIEW_ID}`);
        expect(snap.status).toBe(200);
        const blocks = (d2ApiJson(snap.text) as { pages: { cards: { blocks: DiagramBlock[] }[] }[] }).pages.flatMap(
          (p) => p.cards.flatMap((c) => c.blocks),
        );
        const lifted = blocks.find((b) => b.type === "diagram" && b.id === "b-seed-lifted");
        expect(lifted?.render?.status).toBe("ok");
      } else {
        expect(got.status).toBe(409);
        expect((d2ApiJson(got.text) as { status: string }).status).toBe("unavailable");
      }
    });

    test("seeded diagram renders in light and dark, hover previews, click reveals", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openReview(page, D2_SEED_REVIEW_ID);
      // Issue #341: the seed carries the recorded diagram-central block.
      const host = "#C-g-alt #B-b-seed-central .dg-svg > svg";
      await expect(page.locator(host)).toBeVisible({ timeout: 30_000 });
      const lightHtml = await page.locator("#C-g-alt #B-b-seed-central .dg-svg").innerHTML();
      expect(lightHtml).toContain("#FFFFFF");
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await expect
        .poll(async () => page.locator("#C-g-alt #B-b-seed-central .dg-svg").innerHTML(), { timeout: 15_000 })
        .toContain("1E1E2E");
      await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));

      const anchor = page.locator("#C-g-alt #B-b-seed-central .dg-svg a[data-refs]").first();
      await hoverFresh(page, anchor);
      await expect(page.locator("#pop")).toBeVisible({ timeout: 5000 });
      await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:647");
      const before = page.url();
      await anchor.click();
      expect(before).toBe(page.url());
      await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff");
      await expect(page.locator('[id="L-src-urllib3-connection.py-647"].hl')).toBeVisible({
        timeout: 10_000,
      });
      // From d2-diagrams.spec.ts (#357): keyboard Enter on a cited
      // shape reveals without changing the URL.
      await anchor.focus();
      await expect(anchor).toBeFocused();
      await page.keyboard.press("Enter");
      expect(before).toBe(page.url());
      await expect(page.locator('[id="L-src-urllib3-connection.py-647"].hl')).toBeVisible({
        timeout: 10_000,
      });
    });

    test("fresh diagram shows SVG with d2, source fallback without", async ({ page }) => {
      test.setTimeout(120_000);
      await openReview(page, D2_SEED_REVIEW_ID);
      if (mode.expectBinary) {
        await expect(page.locator("#B-b-seed-extra .dg-svg > svg")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#B-b-seed-extra .dg-svg a[data-refs]")).toHaveCount(1);
      } else {
        const fallback = page.locator("#B-b-seed-extra .dg-fallback");
        await expect(fallback).toBeVisible({ timeout: 30_000 });
        await expect(fallback.locator("pre.code")).toContainText("d2seedprobe");
        await expect(fallback).toContainText("Diagrams need");
        const link = fallback.getByRole("link", { name: /Settings → Environment/ });
        await expect(link).toHaveAttribute("href", "/settings?tab=environment");
      }
    });

    test("lifted #286 diagram shows SVG with d2, source fallback without", async ({ page }) => {
      test.setTimeout(120_000);
      await openReview(page, D2_SEED_REVIEW_ID);
      if (mode.expectBinary) {
        await expect(page.locator("#B-b-seed-lifted .dg-svg > svg")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#B-b-seed-lifted .dg-svg a[data-refs]")).toHaveCount(4);
      } else {
        const fallback = page.locator("#B-b-seed-lifted .dg-fallback");
        await expect(fallback).toBeVisible({ timeout: 30_000 });
        await expect(fallback.locator("pre.code")).toContainText("parser");
      }
    });

    // From d2-diagrams.spec.ts (#357 #130): a failed compile shows a
    // plain note with a retry and no zoom controls.
    test("failed compile shows a plain note with a retry and no zoom controls (#130)", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openReview(page, D2_SEED_REVIEW_ID);
      const fallback = page.locator("#B-b-seed-broken .dg-fallback");
      await expect(fallback).toBeVisible({ timeout: 30_000 });
      if (mode.expectBinary) {
        await expect(fallback).toContainText("Couldn't draw this diagram.");
        // The raw compiler message never reaches the reader.
        await expect(fallback).not.toContainText("Diagrams need");
        // No zoom, Reset or Expand controls under a diagram that did
        // not render — only the retry.
        await expect(page.locator("#B-b-seed-broken .dg-bar")).toHaveCount(0);
        await expect(fallback.getByRole("button", { name: "Retry" })).toBeVisible();
      } else {
        await expect(fallback).toContainText("Diagrams need");
      }
    });

    test("fresh demo review serves its on-demand diagram from seed", async () => {
      test.setTimeout(240_000);
      const s = running();
      // Issue #341: diagrams are on-demand fills now — fire the action for
      // central (replay serves the diagram-central recording), then the
      // endpoint serves the pre-rendered seed for its hash.
      const acted = await d2Api(s.origin, s.token, "POST", `/api/reviews/${demoReviewId}/actions`, {
        kind: "diagram",
        cardId: "central",
      });
      expect(acted.status).toBe(200);
      let hash = "";
      const deadline = Date.now() + 150_000;
      for (;;) {
        const snap = await d2Api(s.origin, s.token, "GET", `/api/reviews/${demoReviewId}`);
        expect(snap.status).toBe(200);
        const blocks = (
          d2ApiJson(snap.text) as { pages: { cards: { blocks: DiagramBlock[] }[] }[] }
        ).pages.flatMap((p) => p.cards.flatMap((c) => c.blocks));
        const found = blocks.find((b) => b.type === "diagram" && b.render?.hash);
        if (found?.render) {
          hash = found.render.hash;
          break;
        }
        if (Date.now() > deadline) throw new Error("diagram action produced no diagram block in time");
        await new Promise((r) => setTimeout(r, 2000));
      }
      expect(hash).toBe(D2_SEED_HASH);
      const got = await d2Api(s.origin, s.token, "GET", `/api/reviews/${demoReviewId}/diagrams/${hash}?theme=light`);
      expect(got.status).toBe(200);
      expect(got.contentType).toContain("image/svg+xml");
    });

    test("fresh demo review renders its diagram in the guide", async ({ page }) => {
      test.setTimeout(240_000);
      await openReview(page, demoReviewId);
      // The on-demand diagram was added to the central card above, which
      // is expanded by default; the SVG renders once the fill lands.
      await expect(page.locator("#C-central .dg-svg > svg")).toBeVisible({ timeout: 120_000 });
    });
  });
}
