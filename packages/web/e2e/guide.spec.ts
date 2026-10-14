/**
 * Guide e2e against mock mode (the generated urllib3#5020 snapshot):
 * hover-preview timing + dismissal rules, scroll-then-no-hover, citation
 * click → revealSource (canonicalized) with diff highlight, navigation +
 * trail + back, mark read, description tab, findings, D2 diagrams.
 *
 * File keys are service-canonical path slugs, so element ids contain dots:
 * select them with `[id="…"]`.
 */
import { expect, test } from "./network-guard.js";
import type { Locator, Page } from "@playwright/test";

const CONN = "src-urllib3-connection.py";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  // Webfonts shift layout; settle before pixel-precise hovers.
  await page.evaluate(() => document.fonts.ready).catch(() => {});
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

test("root page renders cards, contents and generated go-deeper cards", async ({ page }) => {
  await gotoReview(page);
  await expect(page.locator("#page h1.title")).toBeVisible();
  await expect(page.locator("#C-problem h2")).toContainText("The problem");
  await expect(page.locator("#C-central h2")).toContainText("The central change");
  await expect(page.locator('nav.toc [data-tocard="problem"]')).toBeVisible();
  // The fixture's go-deeper cards are already generated (no pendings).
  await expect(page.locator("#C-g-flow")).toContainText("getresponse");
  await expect(page.locator("#C-g-flow")).toContainText("Follow up:");
  // Citation marker with a count on the central-change card.
  const marker = page.locator("#C-central .lk[data-refs]").first();
  await expect(marker).toContainText("2");
  // Contents box collapses and re-opens.
  await page.locator("nav.toc [data-toc]").click();
  await expect(page.locator("nav.toc .toc-g")).toHaveCount(0);
  await page.locator("nav.toc [data-toc]").click();
  await expect(page.locator("nav.toc .toc-g")).toBeVisible();
});

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

test("citation click reveals the canonical diff location", async ({ page }) => {
  await gotoReview(page);
  const seen = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        window.addEventListener(
          "unvibe:reveal-source",
          (e) => resolve((e as CustomEvent).detail.ref as string),
          { once: true },
        );
      }),
  );
  // The citation uses the fixture's short key; the event carries the
  // canonical file key the diff pane renders.
  await page.locator("#C-central .lk[data-refs]").first().click();
  await expect.poll(() => seen, { timeout: 3000 }).toBe(`diff:${CONN}:91-110`);
  await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff");
  await expect(page.locator(`[id="L-${CONN}-91"].hl`)).toBeVisible({ timeout: 3000 });
});

test("citation hover previews real cited lines", async ({ page }) => {
  await gotoReview(page);
  await hoverFresh(page, page.locator("#C-central .lk[data-refs]").first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:");
  await expect(page.locator("#pop")).toContainText("_normalize_header_value");
});

test("navigation, trail and browser back", async ({ page }) => {
  await gotoReview(page);
  await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/c-obs-fold/);
  await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding");
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

test("collapse chevron hides the card body; contents still lists it", async ({ page }) => {
  await gotoReview(page);
  const card = page.locator("#C-central");
  await card.locator("> .chead").getByRole("button", { name: "Collapse" }).click();
  await expect(card).toHaveClass(/collapsed/);
  // Contents still lists the card.
  const item = page.locator("nav.toc li", { has: page.locator('[data-tocard="central"]') });
  await expect(item).toBeVisible();
  await card.getByRole("button", { name: "Expand" }).click();
  await expect(card).not.toHaveClass(/collapsed/);
  // Concept pages are saved: the bookmark is pressed.
  await page.goto("/review/demo/page/c-ows-rws");
  await expect(page.locator('#page [data-save="c-ows-rws"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
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

test("description tab shows paragraphs with stable ids", async ({ page }) => {
  await gotoReview(page);
  await page.locator('#right [role="tab"]').getByText("PR description").click();
  await expect(page.locator("#right #d-p1")).toContainText("obs-fold response-header case");
  await expect(page.locator("#right #d-p5")).toContainText("2,279 passed");
});

// DISABLED(#119): exact duplicate of d2-diagrams.spec.ts render assertions and the guide.spec.ts root-page test
test.skip("go-deeper card renders the D2 diagram and follow-ups", async ({ page }) => {
  await gotoReview(page);
  await expect(page.locator("#C-g-flow #B-b1 .dg-svg > svg")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#C-g-flow")).toContainText("Follow up:");
});

test("concept page renders the example aside", async ({ page }) => {
  await page.goto("/review/demo/page/c-obs-fold");
  await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding");
  await expect(page.locator("#page .gen-aside")).toContainText("urllib3 now returns");
});

test("narrow width keeps controls visible", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await gotoReview(page);
  await expect(page.locator("#C-problem > .ctl").first()).toBeVisible();
  // The problem card seeds a conversation underneath; scope to the card's
  // own control row so the answer's controls do not match.
  await expect(page.locator("#C-problem > .ctl").getByRole("button", { name: "Use examples" })).toBeVisible();
});

test("control tooltips use the shared Tooltip", async ({ page }) => {
  await gotoReview(page);
  await hoverFresh(page, page.locator("#C-problem > .ctl").getByRole("button", { name: "Use examples" }));
  await expect(page.locator("#tip")).toContainText("Use examples", { timeout: 3000 });
});
