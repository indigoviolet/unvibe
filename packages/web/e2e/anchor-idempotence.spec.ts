/**
 * Anchor-highlight idempotence (issue #15) over mock mode.
 *
 * The demo snapshot seeds an open expansion (`x-seed`, quote "raw CRLF")
 * and an open thread (`t-seed`, quote "fast path"): both highlighters are
 * active on page load. Streaming many no-op annotation patches through the
 * WS-patch path (the same path live updates use) must not nest marks, and
 * the user's text selection + focused reply box must survive.
 *
 * Keeps every behaviour the rest of the suite covers (open-expansion
 * styles, thread highlights); hover previews, click-to-expand and
 * fallbacks stay covered by interaction.spec.ts / guide.spec.ts.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await expect(page.locator('mark.anc.ex[data-jump="x-seed"]')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('mark.anc[data-thr="t-seed"]:not(.fnote)')).toBeVisible({ timeout: 8000 });
}

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

test("many snapshot patches leave mark depth 1; selection and reply focus survive", async ({
  page,
}) => {
  await gotoReview(page);

  const hasHook = await page.evaluate(
    () => typeof (window as unknown as { __streamPatches?: unknown }).__streamPatches,
  );
  expect(hasHook).toBe("function");
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
      const at = data.indexOf("fast path");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + "fast path".length);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      return sel?.toString() ?? "";
    }
    return "";
  });
  expect(selected).toBe("fast path");
  await stream();
  await page.waitForTimeout(1000);
  expect(await markDepth(page)).toBe(1);
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("fast path");

  // Phase B: a focused reply box with a draft (and its cursor) survives
  // patches. (Focusing the box natively drops the phase-A guide selection;
  // that is browser behaviour, not patch damage, so it is not asserted here.)
  const reply = page.locator("#ta-t-seed");
  await expect(reply).toBeVisible({ timeout: 5000 });
  await reply.focus();
  await reply.fill("draft that must survive many patches");
  const cursor = await page.evaluate(() => {
    const ta = document.getElementById("ta-t-seed") as HTMLTextAreaElement | null;
    return ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
  });
  await stream();
  await page.waitForTimeout(1000);

  // Marks: flat, one per quote, open-expansion style kept.
  expect(await markDepth(page)).toBe(1);
  expect(await page.locator('#page mark.anc.ex[data-jump="x-seed"]').count()).toBe(1);
  expect(await page.locator('#page mark.anc[data-thr="t-seed"]:not(.fnote)').count()).toBe(1);
  await expect(page.locator('mark.anc.ex[data-jump="x-seed"]').first()).toBeVisible();

  // Focused reply box, draft and cursor survive.
  expect(await page.evaluate(() => document.activeElement?.id ?? "")).toBe("ta-t-seed");
  await expect(reply).toHaveValue("draft that must survive many patches");
  expect(
    await page.evaluate(() => {
      const ta = document.getElementById("ta-t-seed") as HTMLTextAreaElement | null;
      return ta ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
    }),
  ).toEqual(cursor);
});
