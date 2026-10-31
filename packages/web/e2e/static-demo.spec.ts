/**
 * Static demo behaviour (issue #334): the `demo:build` output served from
 * a plain static file server, exercised through the real browser.
 *
 * Covers: the guide opens at `/`, citation hover previews real lines,
 * Explain on a recorded passage replays the recording, Ask with no
 * recording shows the honest install message, comments persist across
 * reload (Reset demo clears them), hunk summaries come from the
 * recordings, Submit is disabled with an install pointer, and Settings
 * are read-only — all with no request beyond the static origin.
 *
 * Needs `mise run demo:build` first (skipped without it).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./network-guard.js";
import type { Locator, Page } from "@playwright/test";
import { selectText } from "./select-text.js";
import { startStaticServer, type StaticServer } from "./static-server.js";

const DEMO_DIST = fileURLToPath(new URL("../dist-demo", import.meta.url));
const SHOTS = fileURLToPath(new URL("../test-results", import.meta.url));

test.skip(!existsSync(DEMO_DIST), "needs `mise run demo:build` first");

let demo: StaticServer | null = null;

test.beforeAll(async () => {
  demo = await startStaticServer(DEMO_DIST);
});

test.afterAll(async () => {
  await demo?.stop().catch(() => {});
  demo = null;
});

function origin(): string {
  if (!demo) throw new Error("static server not started");
  return demo.origin;
}

/** Fail on any request that is not same-origin with the static build. */
async function sameOriginOnly(page: Page): Promise<string[]> {
  const base = new URL(origin()).origin;
  const violations: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (!url.startsWith(`${base}/`) && url !== `${base}/`) violations.push(`${req.method()} ${url}`);
  });
  return violations;
}

async function gotoDemo(page: Page): Promise<void> {
  await page.goto(`${origin()}/`);
  await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
    timeout: 30_000,
  });
  await expect(page).toHaveURL(/#\/review\/demo/);
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
 * Deterministic hover (copied from `guide.spec.ts`): `hover()` may scroll
 * with the pointer already over the target, which the popover must ignore
 * — so scroll, settle, move the pointer in genuine steps, and verify the
 * cursor landed on the anchor's own line boxes.
 */
async function hoverFresh(page: Page, locator: Locator): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __lastScrollAt?: number; __scrollHook?: boolean };
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
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.waitForFunction(() => Date.now() - ((window as unknown as { __lastScrollAt?: number }).__lastScrollAt ?? 0) > 400, {
    polling: "raf",
    timeout: 10_000,
  });
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

test("the recorded guide opens at /", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  await expect(page.locator("#C-central")).toBeVisible();
  await expect(page.locator("#reviewbar")).toContainText("Reset demo");
  await page.screenshot({ path: `${SHOTS}/demo-guide.png` });
  expect(violations).toEqual([]);
});

test("citation hover previews real cited lines", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  await closeSeedCard(page);
  await hoverFresh(page, page.locator("#C-central .lk[data-refs]").first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:");
  await expect(page.locator("#pop")).toContainText("_normalize_header_value");
  expect(violations).toEqual([]);
});

test("Explain on a recorded passage replays the recording", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  await closeSeedCard(page);
  await selectText(page, "#C-central", "optional whitespace");
  await page.locator('#selbar [data-act="explain"]').click();
  const thread = page.locator('#C-central section.ithread[data-thread] .exp-b');
  // Passage-scoped matching (quote + host block): the card unfolds, so the
  // obs-fold recording answers — the same one the service replays.
  await expect(thread.first()).toContainText(/obs-fold|RFC 9112/i, { timeout: 30_000 });
  await expect(thread.first()).not.toContainText("The demo only has recorded answers");
  await expect(page.locator("#C-central .working")).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/demo-explain.png` });
  expect(violations).toEqual([]);
});

test("Ask with no recording shows the install message", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  // Plain first paint keeps diff code in whole text nodes for selection.
  await page.goto(`${origin()}/?nohl=1#/review/demo`);
  await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
    timeout: 30_000,
  });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  const file = '[id="F-src-urllib3-connection.py"]';
  await expect(page.locator(`${file} table.diff`).first()).toBeVisible({ timeout: 15_000 });
  await selectText(page, `${file} table.diff`, "_normalize_header_value");
  await page.locator('#selbar [data-act="ask"]').click();
  const composer = page.locator(`${file} .ithread[data-pending-thread]`);
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.locator("textarea").fill("What color is a ripe banana?");
  await composer.getByRole("button", { name: "Ask" }).click();
  const card = page.locator(`${file} section.ithread[data-thread]`, {
    hasText: "What color is a ripe banana?",
  });
  await expect(card.first()).toBeVisible({ timeout: 30_000 });
  await expect(card.first()).toContainText("The demo only has recorded answers", { timeout: 30_000 });
  const install = card.first().getByRole("link", { name: "Install Unvibe" });
  await expect(install).toHaveAttribute("href", "https://unvibe.xyz/#install");
  await expect(page.locator(`${file} .working`)).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/demo-install-message.png` });
  expect(violations).toEqual([]);
});

test("comments persist across reload; Reset demo clears them", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  await closeSeedCard(page);
  await selectText(page, "#C-central", "optional");
  await page.locator('#selbar [data-act="note"]').click();
  const composer = page.locator("#C-central .ithread[data-pending-thread]");
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.locator("textarea").fill("A static-demo comment");
  await composer.getByRole("button", { name: "Save" }).click();
  const thread = page.locator("#C-central .ithread[data-thread]", { hasText: "A static-demo comment" });
  await expect(thread).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
    timeout: 30_000,
  });
  await expect(page.locator("#C-central .ithread[data-thread]", { hasText: "A static-demo comment" })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
    timeout: 30_000,
  });
  await expect(page.locator("#C-central .ithread[data-thread]", { hasText: "A static-demo comment" })).toHaveCount(0);
  expect(violations).toEqual([]);
});

test("hunk summaries come from the recordings", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  const connFile = page.locator('[id="F-src-urllib3-connection.py"]');
  await expect(connFile.locator("table.diff").first()).toBeVisible({ timeout: 15_000 });
  // The second hunk has no seeded summary: summarizing it writes the
  // recording's text, not canned copy.
  await connFile.getByRole("button", { name: "Summarize" }).first().click();
  await expect(connFile.locator("p[data-hunksum]", { hasText: "getresponse" })).toBeVisible({ timeout: 30_000 });
  expect(violations).toEqual([]);
});

test("submit is visibly disabled with the reason in its tooltip", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  const submit = page.locator("#submitSlot [data-submit]");
  await expect(submit).toBeDisabled({ timeout: 10_000 });
  await expect(submit).toHaveAttribute(
    "title",
    "The static demo can't post to GitHub — install Unvibe to submit your own reviews.",
  );
  expect(violations).toEqual([]);
});

test("settings are read-only in the demo", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await page.goto(`${origin()}/#/settings`);
  await expect(page.getByText("Settings are read-only in the static demo")).toBeVisible({ timeout: 30_000 });
  // One shared mechanism: a disabled fieldset around every section.
  const assertReadOnly = async (): Promise<void> => {
    const fs = page.locator(".settings-panel fieldset[disabled]");
    await expect(fs).toBeVisible({ timeout: 10_000 });
    const controls = fs.locator("button, input, select, textarea");
    const n = await controls.count();
    expect(n, "expected form controls on the read-only page").toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await expect(controls.nth(i)).toBeDisabled({ timeout: 10_000 });
  };
  await assertReadOnly();
  await page.screenshot({ path: `${SHOTS}/demo-settings.png` });
  // A second section with the custom select: still read-only.
  await page.locator('[role="tablist"]').getByRole("tab", { name: "Models" }).click();
  await assertReadOnly();
  // The demo shows the real service defaults, never mock ids.
  await expect(page.getByText("Opus 5.5 (claude-opus-5-5)").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".settings-panel")).not.toContainText("mock-main");
  await expect(page.locator(".settings-panel")).not.toContainText("Mock Main");
  await page.screenshot({ path: `${SHOTS}/demo-settings-models.png` });
  expect(violations).toEqual([]);
});

test("bundle stays reasonable (size report)", async () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
  const files = walk(DEMO_DIST);
  let total = 0;
  const rows = files
    .map((f) => ({ f: path.relative(DEMO_DIST, f), bytes: statSync(f).size }))
    .sort((a, b) => b.bytes - a.bytes);
  for (const r of rows) total += r.bytes;
  console.log(`demo bundle: ${(total / 1024 / 1024).toFixed(2)} MB in ${files.length} files (largest: ${rows[0]?.f} ${(rows[0]?.bytes ?? 0) / 1024 | 0} kB)`);
  // 4.2 MB today (Shiki grammars + bundled fonts); 10 MB leaves headroom
  // without letting a dependency accident slip through.
  expect(total).toBeLessThan(10_000_000);
});
