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
import { selectText } from "./select-text.js";
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
      const x0 = Math.max(r.left, 0);
      const x1 = Math.min(r.right, window.innerWidth);
      const y0 = Math.max(r.top, 0);
      const y1 = Math.min(r.bottom, window.innerHeight);
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
          // Another floating card over this one is by design (a child
          // floats above its parent).
          if (hit.closest(".card.child.floating")) continue;
          if (hit.closest(".dfile-h, .dhunk-h, .dtool, .rstick")) continue;
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
        if (hit.closest(".card.child.floating")) continue;
        return `reply input not topmost at ${Math.round(x)},${Math.round(y)}: ${hit.tagName}.${(hit as HTMLElement).className.toString().slice(0, 40)}`;
      }
      return null;
    });
    expect(bad, `${step}: reply box ${i} ${bad ?? ""}`).toBeNull();
  }
}

async function shot(page: Page, name: string, suffix: string, expectedText?: string): Promise<void> {
  // Never screenshot an empty or still-loading scene: each scene
  // names one piece of real content that must be visible first.
  if (expectedText) {
    await expect(page.getByText(expectedText).first(), `${name}: expected visible text "${expectedText}"`).toBeVisible({ timeout: 15_000 });
  }
  await page.screenshot({ path: path.join(SHOTS, `${name}-${suffix}.png`) });
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
  await checkCards(page, step);
  await checkReplyBoxes(page, step);
  await checkMenus(page, step);
}

for (const combo of [
  { name: "1440-light", width: 1440, dark: false },
  { name: "1440-dark", width: 1440, dark: true },
  { name: "900-light", width: 900, dark: false },
  { name: "900-dark", width: 900, dark: true },
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
    await guideChild.getByRole("button", { name: "Close" }).click({ timeout: 5_000 }).catch(() => {});
    await seedCard.getByRole("button", { name: "Close" }).click({ timeout: 5_000 }).catch(() => {});

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
    await diffChild.getByRole("button", { name: "Close" }).click({ timeout: 5_000 }).catch(() => {});
    await page.locator(".dhunk .card.child.floating").first().getByRole("button", { name: "Close" }).click({ timeout: 5_000 }).catch(() => {});

    // Deep-anchored card in the long socket-level hunk.
    const scope = '[id="F-test-with_dummyserver-test_socketlevel.py"]';
    await selectText(page, scope, 'msg["fold-mixed-repeated"]');
    await page.locator('#selbar [data-act="explain"]').click();
    await expect(page.locator(".dhunk .card.child.floating").first()).toBeVisible({ timeout: 15_000 });
    await stepChecks(page, "diff-deep");
    await shot(page, "diff-deep", suffix, "fold-mixed-repeated");
    await page.locator(".dhunk .card.child.floating").first().getByRole("button", { name: "Close" }).click({ timeout: 5_000 }).catch(() => {});

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

    // Settings → Version.
    await page.goto(`${svc!.origin}/settings?tab=version&token=${svc.token}`);
    await expect(page.getByRole("tab", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    await checkNoPageOverflow(page, "settings-version");
    await shot(page, "settings-version", suffix, "Installed:");
  });
}
