/**
 * Shared text-selection helper (issue #147).
 *
 * Select the first occurrence of `text` under `rootSelector` and wait for
 * the selection toolbar (`#selbar`), as if the user dragged. The
 * `scrollIntoView` below can deliver its scroll event after the toolbar
 * shows when the loop is busy (a late scroll dismisses the bar), so
 * select-then-assert flakes: re-select until the bar sticks. A repeated
 * select is harmless (same range, same mouseup path) and converges once
 * the scroll lands.
 *
 * Two in-page strategies, in order: a single text-node match (guide
 * prose, with optional partial offsets inside the matched node), then a
 * joined-text match per code cell (highlight token spans split diff code
 * across many nodes; joining per `td.c` keeps the anchor out of the
 * gutter — issue #23). Returns the normalized quote the toolbar computed
 * (after its whole-word snap).
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Select diff code from the first text of row `fromLine`'s code cell to
 * the last text of row `toLine`'s code cell (issue #189: multi-line and
 * cross-hunk selections), then wait for `#selbar` like `selectText`.
 * A real mouse drag over far-apart rows is not reliable headless, so
 * this builds the same Range a drag would and fires the same mouseup.
 */
export async function selectDiffRows(page: Page, fileKey: string, fromLine: number, toLine: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const found = await page.evaluate(
          ({ fileKey, fromLine, toLine }) => {
            const startCell = document.querySelector(`[id="L-${fileKey}-${fromLine}"] td.c`);
            const endCell = document.querySelector(`[id="L-${fileKey}-${toLine}"] td.c`);
            if (!startCell || !endCell) return false;
            startCell.scrollIntoView({ block: "center" });
            const edgeText = (root: Element, last: boolean): Text | null => {
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
              let found: Text | null = null;
              for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if ((node as Text).data.trim() === "") continue;
                found = node as Text;
                if (!last) break;
              }
              return found;
            };
            const s = edgeText(startCell, false);
            const e = edgeText(endCell, true);
            if (!s || !e) return false;
            const range = document.createRange();
            try {
              range.setStart(s, 0);
              range.setEnd(e, e.data.length);
            } catch {
              return false;
            }
            const sel = getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            endCell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            return true;
          },
          { fileKey, fromLine, toLine },
        );
        if (!found) return "not-found";
        await page.waitForTimeout(150);
        return (await page.locator("#selbar").isVisible()) ? "shown" : "hidden-again";
      },
      { timeout: 15000 },
    )
    .toBe("shown");
}

export async function selectText(
  page: Page,
  rootSelector: string,
  text: string,
  startIn = 0,
  endIn?: number,
): Promise<string> {
  let lastQuote = "";
  await expect
    .poll(
      async () => {
        await page.evaluate((sel: string) => {
          document.querySelector(sel)?.scrollIntoView({ block: "center" });
        }, rootSelector);
        // No settle wait: the app has no smooth scrolling.
        const found = await page.evaluate(
          ({ rootSelector, text, startIn, endIn }) => {
            const root = document.querySelector(rootSelector);
            if (!root) return false;
            const select = (range: Range): void => {
              const sel = getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
              (range.endContainer as Text).parentElement?.dispatchEvent(
                new MouseEvent("mouseup", { bubbles: true }),
              );
            };
            // Single text node first (node-relative offsets).
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const data = (node as Text).data;
              const at = data.indexOf(text);
              if (at < 0) continue;
              const range = document.createRange();
              try {
                range.setStart(node, at + startIn);
                range.setEnd(node, at + (endIn ?? text.length));
              } catch {
                continue;
              }
              select(range);
              return true;
            }
            // Joined text per scope (offsets relative to the match start).
            const cells = [...root.querySelectorAll("td.c")];
            const scopes = cells.length > 0 ? cells : [root];
            for (const scope of scopes) {
              const inner = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
              const nodes: Text[] = [];
              for (let node = inner.nextNode(); node; node = inner.nextNode()) {
                nodes.push(node as Text);
              }
              const joined = nodes.map((n) => n.data).join("");
              const match = joined.indexOf(text);
              if (match < 0) continue;
              const nodeAt = (offset: number): { node: Text; at: number } | null => {
                let acc = 0;
                for (let i = 0; i < nodes.length; i++) {
                  const n = nodes[i];
                  const next = acc + n.data.length;
                  // Boundary offsets prefer the next node (a range starting
                  // at the end of one node behaves as starting in the gutter).
                  if (offset < next) return { node: n, at: offset - acc };
                  if (offset === next) {
                    return i + 1 < nodes.length
                      ? { node: nodes[i + 1], at: 0 }
                      : { node: n, at: n.data.length };
                  }
                  acc = next;
                }
                return null;
              };
              const s = nodeAt(match + startIn);
              const e = nodeAt(match + (endIn ?? text.length));
              if (!s || !e) continue;
              const range = document.createRange();
              try {
                range.setStart(s.node, s.at);
                range.setEnd(e.node, e.at);
              } catch {
                continue;
              }
              select(range);
              return true;
            }
            return false;
          },
          { rootSelector, text, startIn, endIn },
        );
        if (!found) return "not-found";
        // Let a late scroll land before reading the bar.
        await page.waitForTimeout(150);
        if (!(await page.locator("#selbar").isVisible())) return "hidden-again";
        // Re-read after the toolbar snapped the live selection to whole words.
        lastQuote =
          (await page.evaluate(() =>
            (getSelection()?.toString() ?? "").trim().replace(/\s+/g, " "),
          )) ?? "";
        return "shown";
      },
      { timeout: 15000 },
    )
    .toBe("shown");
  return lastQuote;
}
