/**
 * Shiki-highlight behaviour over mock mode (issue #23): token rows appear
 * without breaking selection → Explain / Ask / Note, anchor dotted-links,
 * citation reveal, or copy-paste.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { waitForDomQuiet } from "./dom-quiet.js";

declare global {
  interface Window {
    __revealSource?: (ref: string) => boolean;
  }
}

const CONN = "src-urllib3-connection.py";
const LOG = "changelog-1362.bugfix.rst";
const connFile = `[id="F-${CONN}"]`;

async function gotoReview(page: Page, query = ""): Promise<void> {
  await page.goto(`/review/demo${query}`);
  await expect(page.locator(connFile)).toBeVisible();
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/** Wait until Shiki token spans land in the demo Python file. */
async function waitForHighlight(page: Page): Promise<void> {
  await expect(page.locator(`${connFile} td.c .shk-kw`).first()).toBeVisible({ timeout: 15000 });
}

/**
 * Select `anchor` under `rootSelector` (token spans split the text across
 * many nodes, so locate it in the joined text first, then map back to
 * node+offset — the same approach as `anchor.ts`), then dispatch mouseup so
 * the toolbar reacts. Returns the snapped quote.
 */
async function selectSpanning(page: Page, rootSelector: string, anchor: string): Promise<string> {
  await page.evaluate((rootSelector) => {
    document.querySelector(rootSelector)?.scrollIntoView({ block: "center" });
  }, rootSelector);
  // No settle wait: the app has no smooth scrolling.
  const ok = await page.evaluate(
    ({ rootSelector, anchor }) => {
      const root = document.querySelector(rootSelector);
      if (!root) return false;
      // Scoped per code cell: joining the whole table would match across
      // line-number/code boundaries and anchor the selection in the gutter.
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
            // Boundary offsets prefer the next node (a range starting at
            // the end of one node behaves as starting in the gutter).
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

// DISABLED(#119): same assertions as render.test.tsx live-highlight test on the same fixture with real Shiki
test.skip("Python rows highlight; unshipped languages stay plain; ?nohl=1 stays plain", async ({ page }) => {
  await gotoReview(page);
  await waitForHighlight(page);
  // Keyword, string and comment spans in the fixture's Python hunks.
  await expect(page.locator(`${connFile} td.c .shk-kw`)).not.toHaveCount(0);
  await expect(page.locator(`${connFile} td.c .shk-str`)).not.toHaveCount(0);
  await expect(page.locator(`${connFile} td.c .shk-com`)).not.toHaveCount(0);
  // The .rst changelog is not a shipped language: unhide its hunk and
  // check the rows render plain, with no token spans.
  const logFile = `[id="F-${LOG}"]`;
  await expect(page.locator(logFile)).toBeVisible();
  await page.evaluate((log) => document.querySelector(`[id="F-${log}"]`)?.scrollIntoView(), LOG);
  await page.locator(`${logFile} button.hid`).click();
  await expect(page.locator(`${logFile} td.c`).first()).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(2000);
  await expect(page.locator(`${logFile} td.c [class*="shk-"]`)).toHaveCount(0);
});

test("?nohl=1 renders the plain first-paint state (no token spans)", async ({ page }) => {
  // Deterministic escape-hatch check: with ?nohl=1 the Shiki chunk must
  // never even load (not just "no spans yet", which passes vacuously when
  // highlighting is merely slow).
  const shikiRequests: string[] = [];
  await page.route("**/.vite/deps/shiki*", async (route) => {
    shikiRequests.push(route.request().url());
    await route.continue();
  });
  await gotoReview(page, "?nohl=1");
  await expect(page.locator(connFile)).toBeVisible();
  // One code table per hunk (#140), so scope visibility to the first.
  await expect(page.locator(`${connFile} table.diff`).first()).toBeVisible();
  expect(shikiRequests).toEqual([]);
  await expect(page.locator("table.diff td.c [class*='shk-']")).toHaveCount(0);
  // The pane itself is unaffected: files, hunks and line numbers render.
  await expect(page.locator(`${connFile} table.diff`).first()).toBeVisible();
});

test("selection across token spans snaps to words and Ask opens a composer", async ({ page }) => {
  await gotoReview(page);
  await waitForHighlight(page);
  // Spanning range across `…OBSOLETE_FOLD_RE.sub(…)` (several token spans).
  const quote = await selectSpanning(page, `${connFile} table.diff`, "_OBSOLETE_FOLD_RE.sub");
  expect(quote).toContain("OBSOLETE_FOLD_RE");
  await expect(page.locator("#selbar")).toBeVisible();
  await page.locator('#selbar [data-act="ask"]').click();
  const composer = page.locator(`${connFile} .ithread[data-pending-thread]`);
  await expect(composer).toBeVisible({ timeout: 5000 });
  await expect(composer.locator(".mq")).toContainText("OBSOLETE_FOLD_RE");
  await composer.locator("textarea").fill("Why this regex?");
  await composer.getByRole("button", { name: "Ask" }).click();
  // An Ask on diff code opens the usual conversation card under the line:
  // working state, then the answer with its question and reply box.
  const card = page.locator(`${connFile} [data-expansion]`, { hasText: "Why this regex?" });
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.locator(".working")).toBeVisible({ timeout: 3000 });
  await expect(card.locator(".ans-q").first()).toContainText("Why this regex?", { timeout: 8000 });
  await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 8000 });
});

test("Explain then Close leaves one flat dotted anchor mark in highlighted code", async ({ page }) => {
  await gotoReview(page);
  await waitForHighlight(page);
  const quote = await selectSpanning(page, `${connFile} table.diff`, "header_items = message.items");
  expect(quote.length).toBeGreaterThanOrEqual(2);
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator(`${connFile} [data-expansion]`).first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.locator(".exp-b")).toContainText("Mock explanation", { timeout: 8000 });
  await expect(card.getByRole("button", { name: "Close" })).toBeVisible();
  await card.getByRole("button", { name: "Close" }).click();
  await expect(card).toHaveCount(0);
  // The dotted link sits inside highlighted code (token spans): one mark
  // per intersecting text node (anchor.ts design for multi-node quotes),
  // all flat and sharing one id — whatever order tokens and marks landed in.
  const mark = page.locator(`${connFile} td.c mark.anc.exl`).first();
  await expect(mark).toBeVisible({ timeout: 8000 });
  // Whatever order tokens and marks landed in: wait for the subtree to go
  // quiet instead of a fixed settle.
  await waitForDomQuiet(page, "#right");
  const marks = page.locator(`${connFile} td.c mark.anc.exl`);
  expect(await marks.count()).toBeGreaterThanOrEqual(1);
  expect(await page.locator("#right mark.anc mark.anc").count()).toBe(0);
  const jumps = await marks.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.jump));
  expect(new Set(jumps).size).toBe(1);
  // Click re-expands in place.
  await mark.click();
  await expect(page.locator(`${connFile} [data-expansion]`).first()).toBeVisible({ timeout: 5000 });
});

test("revealSource highlights lines that are also token-highlighted", async ({ page }) => {
  await gotoReview(page);
  await waitForHighlight(page);
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650-651`), CONN);
  expect(ok).toBe(true);
  const row = page.locator(`[id="L-${CONN}-650"].hl`);
  await expect(row).toBeVisible();
  await expect(page.locator(`[id="L-${CONN}-651"].hl`)).toBeVisible();
  // The reveal highlight and the token spans coexist in the same row.
  await expect(row.locator("td.c [class*='shk-']").first()).toBeVisible();
  // Same in split view: paired cells keep their own side's tokens.
  await page.getByRole("button", { name: "Split" }).click();
  const splitTable = page.locator(`${connFile} table.diff.split`).first();
  await expect(splitTable).toBeVisible();
  await expect(splitTable.locator("td.c [class*='shk-']").first()).toBeVisible();
});

test("highlighted rows copy as plain text without artefacts", async ({ page }) => {
  await gotoReview(page);
  await waitForHighlight(page);
  const text = await page.evaluate((key) => {
    const row = document.querySelector(`tr.add[id^="L-${key}-"] td.c`);
    return row?.textContent ?? null;
  }, CONN);
  expect(text).not.toBeNull();
  expect(text!.startsWith("+")).toBe(true);
  // No zero-width / object-replacement artefacts from the spans.
  expect(text!).not.toMatch(/(?:\u200B|\u200C|\u200D|\uFFFC)/u);
  expect(text!.length).toBeLessThan(2000);
});
