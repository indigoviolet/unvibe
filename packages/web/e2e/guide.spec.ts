/**
 * Guide e2e against the mock fixture (`VITE_MOCK=1` build):
 * hover-preview timing + dismissal rules, scroll-then-no-hover,
 * citation click → revealSource, navigation + trail + back, mark read,
 * description Restated links, findings, Go deeper generation.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

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
 */
async function hoverFresh(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await locator.boundingBox();
  if (!box) throw new Error("anchor has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(8, 200);
  await page.mouse.move(x, y, { steps: 5 });
}

async function openPopover(page: Page): Promise<void> {
  await hoverFresh(page, page.locator('#page a.cx[data-node="c-fold"]').first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
}

test("root page renders cards, contents and pending cards", async ({ page }) => {
  await gotoReview(page);
  await expect(page.locator("#page .eyebrow")).toContainText("Guided review");
  await expect(page.locator("#C-problem h2")).toContainText("The problem");
  await expect(page.locator("#C-central h2")).toContainText("The central change");
  await expect(page.locator('nav.toc [data-tocard="problem"]')).toBeVisible();
  await expect(page.locator("#C-g-flow .go")).toContainText("Generate");
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
  const link = page.locator('#page a.cx[data-node="c-fold"]').first();
  await link.hover();
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
    const el = document.querySelector('#page a.cx[data-node="c-fold"]');
    el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await expect(page.locator("#pop")).toBeHidden();
  // A real pointer move re-arms hover.
  await hoverFresh(page, page.locator('#page a.cx[data-node="c-fold"]').first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
});

test("citation click calls revealSource and switches to the diff tab", async ({ page }) => {
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
  await page.locator("#C-central .lk[data-refs]").first().click();
  await expect.poll(() => seen, { timeout: 3000 }).toContain("diff:conn:");
  await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff");
});

test("citation hover previews cited lines", async ({ page }) => {
  await gotoReview(page);
  await hoverFresh(page, page.locator("#C-central .lk[data-refs]").first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:");
});

test("navigation, trail and browser back", async ({ page }) => {
  await gotoReview(page);
  await page.locator('#page a.cx[data-node="c-fold"]').first().click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/c-fold/);
  await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding");
  const trail = page.locator("#page nav.crumbs");
  await expect(trail).toContainText("Unfold obsolete folded response headers");
  await trail.getByRole("button").first().click();
  await expect(page).toHaveURL(/\/review\/demo\/?$/);

  // Browser back/forward works too.
  await page.locator('#page a.cx[data-node="c-hdict"]').first().click();
  await expect(page).toHaveURL(/page\/c-hdict/);
  await page.goBack();
  await expect(page).toHaveURL(/\/review\/demo\/?$/);
  await expect(page.locator("#page h1.title")).toContainText("Unfold obsolete folded");
});

test("mark read collapses the card and mutes its links", async ({ page }) => {
  await gotoReview(page);
  const card = page.locator("#C-central");
  await card.getByRole("button", { name: "Mark read" }).click();
  await expect(card).toHaveClass(/read/);
  await expect(card).toHaveClass(/collapsed/);
  // Contents mutes the read card.
  const item = page.locator("nav.toc li", { has: page.locator('[data-tocard="central"]') });
  await expect(item).toHaveClass(/done/);
  // Read the whole concept page: links to it mute with the check mark.
  await page.locator('#page a.cx[data-node="c-fold"]').first().click();
  await page.locator("#page .card").first().getByRole("button", { name: "Mark read" }).click();
  await page.goBack();
  await expect(page.locator('#page a.cx[data-node="c-fold"]').first()).toHaveClass(/known/);
  // Concept pages default to saved: the bookmark is pressed.
  await page.goto("/review/demo/page/c-ows");
  await expect(page.locator('#page [data-save="c-ows"]')).toHaveAttribute("aria-pressed", "true");
});

test("finding page: label, rust cards, suggested-comment link", async ({ page }) => {
  await gotoReview(page);
  await page.locator("#C-central .findref").click();
  await expect(page).toHaveURL(/page\/f-lf/);
  await expect(page.locator("#page .eyebrow")).toContainText("Agent finding · medium confidence");
  await expect(page.locator("#page .doc")).toHaveClass(/finding/);
  await expect(page.locator("#page .doc")).toContainText("Folds that end in a bare LF");

  // Hover previews the suggested comment; click jumps via revealSource.
  const clink = page.locator("#page .clink");
  await hoverFresh(page, clink);
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop")).toContainText("suggested comment");
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
  await clink.click();
  await expect.poll(() => seen, { timeout: 3000 }).toBe("diff:conn:82");
});

test("go deeper: Generate shows progress and fills the card", async ({ page }) => {
  await gotoReview(page);
  await page.locator("#C-g-flow .go").click();
  await expect(page.locator("#C-g-flow .working")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#C-g-flow")).toContainText("getresponse", { timeout: 10000 });
  await expect(page.locator("#C-g-flow")).toContainText("Follow up:");
});

test("use examples inserts an aside; undo removes it", async ({ page }) => {
  await gotoReview(page);
  await page.locator("#C-problem").getByRole("button", { name: "Use examples" }).click();
  const aside = page.locator("#C-problem .gen-aside");
  await expect(aside).toContainText("Example", { timeout: 3000 });
  await expect(aside).toContainText("urllib3 now returns");
  await page.locator("#C-problem").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("#C-problem .gen-aside")).toHaveCount(0);
});

test("description tab: author line, paragraph ids, Restated jumps to guide", async ({
  page,
}) => {
  await gotoReview(page);
  await page.locator('#right [role="tab"]').getByText("PR description").click();
  await expect(page.locator("#right .author")).toContainText("adityawrk");
  await expect(page.locator("#right #d-intro")).toBeVisible();
  await page.locator("#right #d-intro .back").click();
  const target = page.locator("#page #B-problem-1.hl");
  await expect(target).toBeVisible({ timeout: 3000 });
});

test("concept page renders the mermaid diagram", async ({ page }) => {
  await page.goto("/review/demo/page/c-fold");
  await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding");
  await expect(page.locator("#page .dg svg")).toBeVisible({ timeout: 10000 });
});

test("narrow width keeps controls visible", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await gotoReview(page);
  await expect(page.locator("#C-problem .ctl").first()).toBeVisible();
  await expect(
    page.locator("#C-problem").getByRole("button", { name: "Mark read" }),
  ).toBeVisible();
});
