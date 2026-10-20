/**
 * Floating cards in the diff pane (issues #167, #140): a floating card
 * overlays the code below its anchor, and it must paint above the
 * line-number gutter and the code rows — while the pinned file/hunk
 * headers and the actions bar still slide over it.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { selectText } from "./select-text.js";

async function gotoDiff(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 8000 });
}

for (const mode of ["unified", "split"] as const) {
  test(`floating card opens at its anchored row deep in a hunk (${mode})`, async ({ page }) => {
    await gotoDiff(page);
    if (mode === "split") await page.getByRole("button", { name: "Split" }).click();
    // The socket-level hunk runs ~60 rows: pick a token near its end, far
    // below the hunk header, and Explain it.
    const scope = '[id="F-test-with_dummyserver-test_socketlevel.py"]';
    await selectText(page, scope, 'msg["fold-mixed-repeated"]');
    await page.locator('#selbar [data-act="explain"]').click();
    const card = page.locator(".dhunk .ui-card.child.floating").first();
    await expect(card).toBeVisible({ timeout: 8000 });

    // The card's top sits at the anchored row's bottom (within a few px),
    // not at the top of the hunk. Both rects move together on scroll, so
    // viewport coordinates compare directly without scrolling the card.
    const gap = await page.evaluate(() => {
      const cardEl = document.querySelector(".dhunk .ui-card.child.floating");
      if (!cardEl) return { ok: false, why: "no floating card" };
      let row: Element | null = null;
      for (const tr of document.querySelectorAll('tr[id^="L-test-with_dummyserver-test_socketlevel.py-"]')) {
        if ((tr.textContent ?? "").includes('msg["fold-mixed-repeated"]')) row = tr;
      }
      if (!row) return { ok: false, why: "no anchored row" };
      const cr = cardEl.getBoundingClientRect();
      const rr = (row as Element).getBoundingClientRect();
      const header = document.querySelector(".dhunk-h");
      const hr = header?.getBoundingClientRect();
      return {
        ok: Math.abs(cr.top - rr.bottom) <= 6 && (!hr || cr.top > hr.bottom + 100),
        why: `cardTop=${Math.round(cr.top)} rowBottom=${Math.round(rr.bottom)} headerBottom=${hr ? Math.round(hr.bottom) : "?"}`,
      };
    });
    expect(gap.ok, gap.why).toBe(true);
  });
}

test("selecting inside a floating card in the diff opens a floating child above it (#186)", async ({ page }) => {
  await gotoDiff(page);
  await selectText(page, "#right table.diff", "_OBSOLETE_FOLD_RE");
  await page.locator('#selbar [data-act="explain"]').click();
  const parent = page.locator(".dhunk .ui-card.child.floating").first();
  await expect(parent).toBeVisible({ timeout: 8000 });
  // Select the card's answer text: the toolbar appears inside the card,
  // and Comment works from it as it does from a pinned card.
  await selectText(page, ".dhunk .ui-card.child.floating [data-answer]", "Mock explanation");
  await page.locator('#selbar [data-act="note"]').click();
  const note = page.locator(".dhunk .ithread[data-pending-thread]").first();
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".dhunk .ithread[data-pending-thread]")).toHaveCount(0);
  await selectText(page, ".dhunk .ui-card.child.floating [data-answer]", "Mock explanation");
  await page.locator('#selbar [data-act="ask"]').click();
  const composer = page.locator(".dhunk .ithread[data-pending-thread]");
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill("Why is this here?");
  await composer.getByRole("button", { name: "Ask" }).click();
  const child = page.locator(".dhunk [data-expansion]", { hasText: "Why is this here?" }).last();
  await expect(child).toContainText("Mock explanation", { timeout: 8000 });
  await expect(child).toHaveClass(/floating/);
  await expect(parent).toHaveClass(/floating/);
  // Pinning the child inserts it inline inside the parent.
  await child.getByRole("button", { name: "Pin into the page" }).click();
  await expect(child).not.toHaveClass(/floating/);
  await expect(parent).toHaveClass(/floating/);
  // Closing it leaves the parent floating.
  await child.getByRole("button", { name: "Close" }).click();
  await expect(parent).toBeVisible();
  await expect(parent).toHaveClass(/floating/);
});

/**
 * Stacking, sampled properly: every 40px across the card's whole
 * visible box, `elementFromPoint` must land inside the card — never on
 * a gutter cell (either column), a code row or a slot row. Points
 * covered by a pinned header or the actions bar are the one allowed
 * exception (they slide over cards by design). This replaces the old
 * one-point gutter check, which only sampled the first gutter cell
 * under a top-level unified card and missed nested cards entirely.
 */
async function expectCardOnTop(page: Page, card: import("@playwright/test").Locator, label: string): Promise<void> {
  const handle = await card.elementHandle();
  if (!handle) throw new Error(`no card for ${label}`);
  const bad = await handle.evaluate((cardEl: Element) => {
    const r = cardEl.getBoundingClientRect();
    const x0 = Math.max(r.left, 0);
    const x1 = Math.min(r.right, window.innerWidth);
    const y0 = Math.max(r.top, 0);
    const y1 = Math.min(r.bottom, window.innerHeight);
    const out: string[] = [];
    for (let y = y0 + 8; y < y1; y += 40) {
      for (let x = x0 + 8; x < x1; x += 40) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || cardEl.contains(hit)) continue;
        if (hit.closest(".dfile-h, .dhunk-h, .dtool")) continue;
        out.push(
          `${Math.round(x)},${Math.round(y)} -> ${hit.tagName.toLowerCase()}.${(hit as HTMLElement).className.toString().slice(0, 40)}`,
        );
      }
    }
    return out.slice(0, 12);
  });
  expect(bad, `${label}: ${bad.join(" | ")}`).toEqual([]);
}

async function openExplainCard(page: Page): Promise<void> {
  await selectText(page, "#right table.diff", "_OBSOLETE_FOLD_RE");
  await page.locator('#selbar [data-act="explain"]').click();
  await expect(page.locator(".dhunk .ui-card.child.floating").first()).toBeVisible({ timeout: 8000 });
}

for (const mode of ["unified", "split"] as const) {
  test(`no gutter or row paints over a floating card (${mode}, top-level)`, async ({ page }) => {
    await gotoDiff(page);
    if (mode === "split") await page.getByRole("button", { name: "Split" }).click();
    await openExplainCard(page);
    await expectCardOnTop(page, page.locator(".dhunk .ui-card.child.floating").first(), `${mode} top-level`);
  });

  test(`no gutter or row paints over a card opened inside a floating card (${mode}, nested)`, async ({ page }) => {
    await gotoDiff(page);
    if (mode === "split") await page.getByRole("button", { name: "Split" }).click();
    await openExplainCard(page);
    await selectText(page, ".dhunk .ui-card.child.floating [data-answer]", "Mock explanation");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator(".dhunk .ithread[data-pending-thread]");
    await composer.locator("textarea").fill("Why is this here?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const child = page.locator(".dhunk [data-expansion]", { hasText: "Why is this here?" }).last();
    await expect(child).toContainText("Mock explanation", { timeout: 8000 });
    await expectCardOnTop(page, child, `${mode} nested`);
  });
}

test("no gutter or row paints over a deep-anchored card (split, narrow)", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await gotoDiff(page);
  await page.getByRole("button", { name: "Split" }).click();
  const scope = '[id="F-test-with_dummyserver-test_socketlevel.py"]';
  await selectText(page, scope, 'msg["fold-mixed-repeated"]');
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator(".dhunk .ui-card.child.floating").first();
  await expect(card).toBeVisible({ timeout: 8000 });
  await expectCardOnTop(page, card, "deep split narrow");
});
