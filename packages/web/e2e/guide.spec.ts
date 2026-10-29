/**
 * Guide e2e against mock mode (the generated urllib3#5020 snapshot):
 * hover-preview timing + dismissal rules, scroll-then-no-hover, citation
 * hover previews, navigation + trail + back, findings, description tab,
 * D2 diagrams.
 *
 * (Pinned cards, Ask-in-pinned, the root page, citation click-to-reveal,
 * collapse and the description tab now live in J1/J2 against the real
 * service — #258.)
 *
 * File keys are service-canonical path slugs, so element ids contain dots:
 * select them with `[id="…"]`.
 */
import { expect, test } from "./network-guard.js";
import type { Locator, Page } from "@playwright/test";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  // Webfonts shift layout; settle before pixel-precise hovers.
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/**
 * Issue #167: the demo seeds an open pinned thread under C-problem that
 * overlays the controls below it — close it first, as a reader would.
 */
async function closeSeedCard(page: Page): Promise<void> {
  await page.locator('#C-problem section.ithread[data-thread]').getByRole("button", { name: "Close" }).first().click();
}

/**
 * Hover an anchor deterministically. Playwright's `hover()` may scroll with
 * the pointer already over the target, and a scroll with a stationary
 * pointer must NOT open the popover (PRD §4.5) — so scroll, settle, move
 * the pointer in genuine steps, and never let `hover()` scroll again.
 *
 * Two extra guards for loaded runners (the real-service journey failed on
 * the macOS CI leg while passing on Linux): webfonts swap layout after
 * load, and async rendering can move the anchor between measuring and
 * arriving. So wait for scroll quiet, then aim at the anchor's own line
 * boxes (a wrapped anchor's union-box center can land on plain text)
 * until the cursor verifiably lands on it.
 */
async function hoverFresh(page: Page, locator: Locator): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __lastScrollAt?: number; __scrollHook?: boolean };
    // Start at 0, not now: with no scrolling the quiet wait below passes
    // at once instead of costing 400 ms + a polling interval (issue #119).
    if (w.__lastScrollAt === undefined) w.__lastScrollAt = 0;
    if (!w.__scrollHook) {
      w.__scrollHook = true;
      document.addEventListener(
        "scroll",
        () => {
          w.__lastScrollAt = Date.now();
        },
        true,
      );
    }
  });
  await locator.scrollIntoViewIfNeeded();
  // Let a scroll register (two frames) before judging quiet.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.waitForFunction(
    () => Date.now() - ((window as unknown as { __lastScrollAt?: number }).__lastScrollAt ?? 0) > 400,
    { polling: "raf", timeout: 10_000 },
  );
  await page.mouse.move(8, 200);
  const measure = (): Promise<{ x: number; y: number; width: number; height: number }[]> =>
    locator.evaluate((target) => {
      const out: { x: number; y: number; width: number; height: number }[] = [];
      const rs = target.getClientRects();
      for (let i = 0; i < rs.length; i++) out.push({ x: rs[i].x, y: rs[i].y, width: rs[i].width, height: rs[i].height });
      return out;
    });
  for (let i = 0; i < 4; i++) {
    const rects = await measure();
    if (rects.length === 0) throw new Error("anchor has no rects");
    const r = rects[Math.min(i, rects.length - 1)];
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    await page.mouse.move(x, y, { steps: 5 });
    const onAnchor = await locator.evaluate(
      (target, p: { x: number; y: number }) => {
        const hit = document.elementFromPoint(p.x, p.y);
        return !!hit && (hit === target || target.contains(hit));
      },
      { x, y },
    );
    if (onAnchor) return;
  }
  throw new Error("hover missed the anchor after 4 aims (layout still shifting?)");
}

async function openPopover(page: Page): Promise<void> {
  await hoverFresh(page, page.locator('#page a.cx[data-link="concept:obs-fold"]').first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
}

test("dotted-link hover preview: timing and content", async ({ page }) => {
  await gotoReview(page);
  const link = page.locator('#page a.cx[data-link="concept:obs-fold"]').first();
  // Deterministic hover (the plotlines box can leave the link below the
  // fold, and a plain hover() would scroll with the pointer already over
  // the target — which the popover must ignore).
  await hoverFresh(page, link);
  // Not instant: opens after ~0.2 s.
  await expect(page.locator("#pop")).toBeHidden({ timeout: 100 }).catch(() => {});
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  // #216: before the page is written, the preview is the link's own
  // label and Click to open — no stored summary or content.
  const label = (await link.innerText()).trim();
  await expect(page.locator("#pop")).toContainText(label);
  await expect(page.locator("#pop")).toContainText("Click to open");
  await expect(page.locator("#pop")).not.toContainText("Mock concept page");
  // Open it, let the (mock) concept job write it, come back: now the
  // preview shows the written page's title and content.
  await link.click();
  await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding", { timeout: 15_000 });
  await page.locator("#page nav.crumbs button").first().click();
  await expect(page.locator("#page h1.title")).toContainText("Unfold obsolete folded", { timeout: 15_000 });
  await hoverFresh(page, page.locator('#page a.cx[data-link="concept:obs-fold"]').first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop")).toContainText("Obsolete line folding (obs-fold)");
  await expect(page.locator("#pop")).toContainText("Click to open");
});

test("popover closes on scroll, Escape, press outside and resize", async ({ page }) => {
  await gotoReview(page);
  await openPopover(page);

  // Any scroll anywhere closes it.
  await page.evaluate(() => document.querySelector("#page")?.scrollTo(0, 200));
  await expect(page.locator("#pop")).toBeHidden();

  await openPopover(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#pop")).toBeHidden();

  await openPopover(page);
  await page.mouse.click(300, 20);
  await expect(page.locator("#pop")).toBeHidden();

  await openPopover(page);
  await page.setViewportSize({ width: 1399, height: 900 });
  await expect(page.locator("#pop")).toBeHidden();
});

test("after a scroll, hover is ignored until the pointer moves", async ({ page }) => {
  await gotoReview(page);
  await page.evaluate(() => document.querySelector("#page")?.scrollTo(0, 200));
  // Synthetic hover with no pointer movement: no popover.
  await page.evaluate(() => {
    const el = document.querySelector('#page a.cx[data-link="concept:obs-fold"]');
    el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await expect(page.locator("#pop")).toBeHidden();
  // A real pointer move re-arms hover.
  await hoverFresh(page, page.locator('#page a.cx[data-link="concept:obs-fold"]').first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
});

test("citation hover previews real cited lines", async ({ page }) => {
  await gotoReview(page);
  await closeSeedCard(page);
  await hoverFresh(page, page.locator("#C-central .lk[data-refs]").first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:");
  await expect(page.locator("#pop")).toContainText("_normalize_header_value");
});

test("navigation, trail and browser back", async ({ page }) => {
  await gotoReview(page);
  await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/c-obs-fold/);
  // #216: written on open; the title arrives with the written page.
  await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding", { timeout: 15_000 });
  const trail = page.locator("#page nav.crumbs");
  await expect(trail).toContainText("Unfold obsolete folded response headers");
  await trail.getByRole("button").first().click();
  await expect(page).toHaveURL(/\/review\/demo\/?$/);

  // Browser back/forward works too.
  await page.locator('#page a.cx[data-link="concept:http-headers"]').first().click();
  await expect(page).toHaveURL(/page\/c-http-headers/);
  await page.goBack();
  await expect(page).toHaveURL(/\/review\/demo\/?$/);
  await expect(page.locator("#page h1.title")).toContainText("Unfold obsolete folded");
});

test("on-demand concept page renders with no bookmark control (#216, #240)", async ({ page }) => {
  await gotoReview(page);
  await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
  await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding", { timeout: 15_000 });
  await page.locator('#page a.cx[data-link="concept:ows-rws"]').first().click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/c-ows-rws/);
  // The on-demand concept page renders (mock and replay titles differ,
  // so assert non-empty, not exact text) with no bookmark control —
  // only the #273 collapse-all control lives in the title row.
  await expect(page.locator("#page h1.title")).not.toBeEmpty({ timeout: 15_000 });
  await expect(page.locator("#page .title-row button")).toHaveCount(1);
  await expect(page.locator('#page .title-row [data-testid="collapse-threads"]')).toBeVisible();
});

test("finding page carries its label and evidence", async ({ page }) => {
  await gotoReview(page);
  await page.locator("#C-central .findref").click();
  await expect(page).toHaveURL(/page\/f-lf/);
  await expect(page.locator("#page .eyebrow")).toContainText("Agent finding · medium confidence");
  await expect(page.locator("#page .doc")).toHaveClass(/finding/);
  await expect(page.locator("#page .doc")).toContainText("Folds that end in a bare LF");
  await expect(page.locator("#page .doc")).toContainText("Follow up:");
});

test("concept page renders the example aside", async ({ page }) => {
  // #216: the page is written when its link is opened, example included.
  await gotoReview(page);
  await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
  await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding", { timeout: 15_000 });
  await expect(page.locator("#page .gen-aside")).toContainText("urllib3 now returns", { timeout: 15_000 });
});

test("narrow width keeps controls reachable by hover or focus (#274)", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await gotoReview(page);
  // The toolbar lives in the heading row and reveals on hover or focus.
  // The problem card seeds a conversation underneath; scope to the card's
  // own control row so the answer's controls do not match.
  const toolbar = page.locator("#C-problem .chead .ctl").first();
  const examples = toolbar.getByRole("button", { name: "Use examples" });
  await expect(toolbar).toHaveCSS("opacity", "0");
  await page.locator("#C-problem").hover();
  await expect(toolbar).toHaveCSS("opacity", "1");
  // Keyboard: focusing a control reveals the row via :focus-within.
  await page.mouse.move(0, 0);
  await examples.focus();
  await expect(toolbar).toHaveCSS("opacity", "1");
  await expect(examples).toBeEnabled();
});

test("control tooltips use the shared Tooltip", async ({ page }) => {
  await gotoReview(page);
  await hoverFresh(page, page.locator("#C-problem .chead .ctl").getByRole("button", { name: "Use examples" }));
  await expect(page.locator("#tip")).toContainText("Use examples", { timeout: 3000 });
});
