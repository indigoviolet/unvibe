/**
 * L13 — Static demo (#363 package D, issue #334 + #357 Q6).
 *
 * The `demo:build` output served from a plain static file server,
 * exercised through the real browser.
 *
 * Covers: the guide opens at `/`, citation hover previews real lines,
 * Explain on a recorded passage replays the recording, Ask with no
 * recording shows the honest install message, comments persist across
 * reload (Reset demo clears them), hunk summaries come from the
 * recordings, Submit is disabled with an install pointer, and Settings
 * are read-only — all with no request beyond the static origin. Debug,
 * Version and Doctor stay hidden: no Settings tabs or routes for the
 * first two, no per-review debug page, no Doctor route or link. Plus the
 * demo banner geometry (own row at 1440, both demos; 960 in the full
 * matrix) and the sync
 * check (static build shows the same content as the real service in
 * replay mode: guide cards, one recorded Explain, one on-demand hunk
 * summary) — merged from demo-banner.spec.ts and static-demo-sync.spec.ts
 * (#357 Q6).
 *
 * Needs `mise run demo:build` first (skipped without it); the sync
 * describe additionally needs `mise run build` first.
 *
 * Absorbs: `static-demo.spec.ts` in full (including the demo-banner and
 * static-demo-sync merges).
 *
 * Guards kept: #334 (no request beyond the static origin —
 * `sameOriginOnly` on every test); #341 (Reset demo in the banner, not
 * the top bar; first central citation is the regex hunk); #339 (Outbox
 * toggle on the seeded thread); network privacy (static origin only).
 *
 * Frames removed (tour owns them; package D re-adds in
 * `e2e/tour/visual-tour-system.spec.ts`): demo-guide, demo-explain,
 * demo-install-message, static-demo-t-seed-outbox, demo-settings and
 * demo-settings-models. No `shot()`/`screenshot` lines remain in the
 * gate.
 *
 * Brittleness fixed here (#363 §4): the file-local `hoverFresh` copy
 * (B5 — the shared `e2e/hover-fresh.ts` helper); the banner geometry
 * reads stay scoped single-evaluates (#363 B1).
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { hoverFresh } from "../hover-fresh.js";
import type { Page } from "@playwright/test";
import { selectText } from "../select-text.js";
import { apiJson } from "./journey-helpers.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { startStaticServer, type StaticServer } from "../static-server.js";
import { tourCombos } from "../tour-matrix.js";

const DEMO_DIST = fileURLToPath(new URL("../../dist-demo", import.meta.url));

test.skip(!existsSync(DEMO_DIST), "needs `mise run demo:build` first");
test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

let demo: StaticServer | null = null;

test.beforeAll(async () => {
  // Mounted at /demo like Pages, so an absolute asset path fails here too.
  demo = await startStaticServer(DEMO_DIST, "/demo");
});

test.afterAll(async () => {
  await demo?.stop().catch(() => {});
  demo = null;
});

function origin(): string {
  if (!demo) throw new Error("static server not started");
  return demo.origin;
}

/** Fail on any request outside the static build's own path (`/demo/`). */
async function sameOriginOnly(page: Page): Promise<string[]> {
  const base = origin();
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


test("the recorded guide opens at /", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  await expect(page.locator("#C-central")).toBeVisible();
  // Issue #341: Reset demo lives in the demo banner, not the top bar.
  await expect(page.locator('[data-testid="demo-banner"]')).toContainText("Reset demo");
  await expect(page.locator("#reviewbar")).not.toContainText("Reset demo");
  expect(violations).toEqual([]);
});

test("citation hover previews real cited lines", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  await closeSeedCard(page);
  await hoverFresh(page, page.locator("#C-central .lk[data-refs]").first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:");
  // Issue #341: the first central citation is the 80-88 regex hunk now
  // (was the message-rewrite lines), so the popover previews that code.
  await expect(page.locator("#pop")).toContainText("_OBSOLETE_FOLD_RE");
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

  // Reset demo lives only in the demo banner.
  await page.locator('[data-testid="demo-banner"] button').click();
  await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
    timeout: 30_000,
  });
  await expect(page.locator("#C-central .ithread[data-thread]", { hasText: "A static-demo comment" })).toHaveCount(0);
  expect(violations).toEqual([]);
});

test("Outbox toggle works on the seeded thread (#339)", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  await closeSeedCard(page);
  // t-seed is a type `thread` with one comment reply: the toggle used to
  // fail with "annotation t-seed is not a thread".
  const thread = page.locator('#C-central section.ithread[data-thread="t-seed"]');
  await expect(thread).toBeVisible({ timeout: 10_000 });
  await expect(thread.getByRole("button", { name: "Add to Outbox" })).toBeVisible({ timeout: 10_000 });
  await thread.getByRole("button", { name: "Add to Outbox" }).click();
  await expect(thread.getByRole("button", { name: "Remove from the Outbox" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#toast")).not.toContainText("Couldn't update the Outbox");
  expect(violations).toEqual([]);
});

test("hunk summaries come from the recordings", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  await gotoDemo(page);
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  const connFile = page.locator('[id="F-src-urllib3-connection.py"]');
  await expect(connFile.locator("table.diff").first()).toBeVisible({ timeout: 15_000 });
  // Issue #341: the first hunk carries the seeded one-liner, so the
  // first Summarize writes the re-recorded conn:1 text.
  await connFile.getByRole("button", { name: "Summarize" }).first().click();
  await expect(connFile.locator("p[data-hunksum]", { hasText: "Response headers now pass through" })).toBeVisible({ timeout: 30_000 });
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
  // A second section with the custom select: still read-only.
  await page.locator('[role="tablist"]').getByRole("tab", { name: "Models" }).click();
  await assertReadOnly();
  // The demo shows the real service defaults, never mock ids.
  await expect(page.getByText("Opus 5.5 (claude-opus-5-5)").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".settings-panel")).not.toContainText("mock-main");
  await expect(page.locator(".settings-panel")).not.toContainText("Mock Main");
  // No Debug or Version section in the demo: no nav entries, and either
  // tab redirects to the first section instead of falling back silently.
  const tabs = page.locator('[role="tablist"]');
  await expect(tabs.getByRole("tab", { name: "Debug" })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Version" })).toHaveCount(0);
  await page.goto(`${origin()}/#/settings?tab=debug`);
  await expect(page).toHaveURL(/#\/settings\?tab=appearance/);
  await expect(page.locator(".settings-title")).toContainText("Appearance");
  await page.goto(`${origin()}/#/settings?tab=version`);
  await expect(page).toHaveURL(/#\/settings\?tab=appearance/);
  await expect(page.locator(".settings-title")).toContainText("Appearance");
  await expect(tabs.getByRole("tab", { name: "Debug" })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Version" })).toHaveCount(0);
  expect(violations).toEqual([]);
});

test("debug page and doctor page are hidden in the demo", async ({ page }) => {
  const violations = await sameOriginOnly(page);
  // No Debug entry point on the review, and the route redirects back.
  await gotoDemo(page);
  await expect(page.getByRole("link", { name: "Debug" })).toHaveCount(0);
  await page.goto(`${origin()}/#/review/demo/debug`);
  await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
    timeout: 30_000,
  });
  await expect(page).toHaveURL(/#\/review\/demo/);
  // Doctor redirects to Settings, and Environment drops its Doctor link.
  await page.goto(`${origin()}/#/doctor`);
  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.getByText("Settings are read-only in the static demo")).toBeVisible({ timeout: 30_000 });
  await page.locator('[role="tablist"]').getByRole("tab", { name: "Environment" }).click();
  await expect(page.locator('[data-testid="env-git"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: "Doctor page" })).toHaveCount(0);
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

/**
 * Demo banner geometry (issue #341 follow-up; merged from
 * demo-banner.spec.ts): the banner must be a full, readable slim strip
 * that takes its own row in the layout — never overlapped by the
 * guide/source panes — in both demos (1440px; 960 in the full matrix).
 */
async function expectFullBanner(page: Page): Promise<void> {
  const banner = page.locator('[data-testid="demo-banner"]');
  await expect(banner).toBeVisible({ timeout: 15000 });
  await expect(banner).toContainText("Demo: a recorded Unvibe review of urllib3#5020");
  await expect(banner).toContainText("Install Unvibe");
  const box = await banner.boundingBox();
  if (!box) throw new Error("banner has no bounding box");
  // A readable strip, not a clipped sliver.
  expect(box.height).toBeGreaterThanOrEqual(24);
  // Nothing covers it: the element at its center belongs to the banner.
  const top = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? (el.closest('[data-testid="demo-banner"]') ? "banner" : el.tagName + "." + (el.className ?? "")) : "none";
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(top).toBe("banner");
  // The guide pane starts at or below the banner's bottom edge.
  const guideTop = await page.evaluate(() => document.querySelector("#page")?.getBoundingClientRect().top ?? -1);
  expect(guideTop).toBeGreaterThanOrEqual(Math.floor(box.y + box.height) - 1);
}

test.describe("demo banner takes its own row", () => {
  for (const combo of tourCombos("demoBanner", [
    { name: "1440", width: 1440 },
    { name: "960", width: 960 },
  ])) {
    test(`in-app demo at ${combo.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: combo.width, height: 900 });
      await page.goto("/review/demo");
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 30000,
      });
      await expectFullBanner(page);
    });
  }
});

test.describe("demo banner on the static demo", () => {
  for (const combo of tourCombos("demoBannerStatic", [
    { name: "1440", width: 1440 },
    { name: "960", width: 960 },
  ])) {
    test(`static demo at ${combo.width}px`, async ({ page }) => {
      await page.setViewportSize({ width: combo.width, height: 900 });
      await page.goto(`${origin()}/#/review/demo`);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 30000,
      });
      await expectFullBanner(page);
      await expect(page.locator('[data-testid="demo-banner"] button')).toContainText("Reset demo");
    });
  }
});

/**
 * Static-demo sync check (issue #334; merged from
 * static-demo-sync.spec.ts): the static build shows the same content as
 * the real service in replay mode. A fixture or UI change that breaks
 * the static demo fails here: the key screens are rendered against both
 * backends and compared as text — the guide cards (minus live threads),
 * one recorded Explain answer, and one on-demand hunk summary.
 */
test.describe("static-demo sync", () => {
  test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
  let syncDataDir = "";
  let syncSvc: RunningService | null = null;
  let syncReviewId = "";

  test.beforeAll(async () => {
    syncDataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-demo-sync-data-"));
    syncSvc = await startService(syncDataDir, { agent: "replay" });
    if (!syncSvc) throw new Error("no service");
    const created = await apiJson(syncSvc, "POST", "/api/reviews", { repoId: "demo" });
    syncReviewId = (created.json as { review: { id: string } }).review.id;
    const deadline = Date.now() + 120_000;
    for (;;) {
      const snap = await apiJson(syncSvc, "GET", `/api/reviews/${syncReviewId}`);
      const pages = (snap.json as { pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[] }).pages;
      const root = pages.find((p) => p.id === "root");
      if (
        root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0) &&
        root?.cards.some((c) => c.id === "central" && c.blocks.length > 0)
      )
        break;
      if (Date.now() > deadline) throw new Error("guide did not fill in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  test.afterAll(async () => {
    await syncSvc?.stop().catch(() => {});
    syncSvc = null;
    rmSync(syncDataDir, { recursive: true, force: true });
  });

  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

  /** Guide card texts with live threads removed (threads differ by backend by design). */
  async function guideCardTexts(pg: Page): Promise<Record<string, string>> {
    return pg.evaluate(() => {
      const out: Record<string, string> = {};
      for (const el of document.querySelectorAll('#page [id^="C-"]')) {
        const clone = el.cloneNode(true) as HTMLElement;
        for (const t of clone.querySelectorAll("section.ithread, [data-pending-thread], button.cm, button.rlink, div.suggest"))
          t.remove();
        for (const t of clone.querySelectorAll("svg, style")) t.remove();
        for (const m of clone.querySelectorAll("span.lo mark.anc")) m.remove();
        for (const m of clone.querySelectorAll("mark.anc")) m.replaceWith(...Array.from(m.childNodes));
        const id = (el as HTMLElement).id;
        if (id && !id.includes(" ")) out[id] = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      }
      return out;
    });
  }

  test("guide cards match between the static demo and the replay service", async ({ page }) => {
    test.setTimeout(240_000);
    if (!syncSvc) throw new Error("not started");
    const expandAll = async (): Promise<void> => {
      for (let i = 0; i < 12; i++) {
        const btn = page.locator("#page section.collapsed").getByRole("button", { name: "Expand" });
        if ((await btn.count()) === 0) return;
        await btn.first().click();
      }
    };
    await page.goto(`${syncSvc.origin}/review/${syncReviewId}?token=${syncSvc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 60_000,
    });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await expandAll();
    await expect
      .poll(
        async () => {
          const snap = await apiJson(syncSvc!, "GET", `/api/reviews/${syncReviewId}`);
          const pages = (snap.json as { pages: { id: string; cards: { id: string; blocks: unknown[]; pending?: unknown }[] }[] }).pages;
          const root = pages.find((p) => p.id === "root");
          return !!root && root.cards.length >= 8 && root.cards.every((c) => !c.pending && c.blocks.length > 0);
        },
        { timeout: 300_000 },
      )
      .toBe(true);
    const fromService = await guideCardTexts(page);
    await page.goto(`${origin()}/#/review/demo`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 60_000,
    });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await expandAll();
    const fromStatic = await guideCardTexts(page);
    expect(Object.keys(fromStatic).sort()).toEqual(Object.keys(fromService).sort());
    for (const id of Object.keys(fromService)) {
      expect(norm(fromStatic[id] ?? ""), `guide card ${id}`).toBe(norm(fromService[id]));
    }
  });

  test("a recorded Explain matches between the static demo and the replay service", async ({ page }) => {
    test.setTimeout(240_000);
    if (!syncSvc) throw new Error("not started");
    const answers: string[] = [];
    for (const base of [`${syncSvc.origin}/review/${syncReviewId}?token=${syncSvc.token}`, `${origin()}/#/review/demo`]) {
      await page.goto(base);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 60_000,
      });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await selectText(page, "#C-central", "optional whitespace");
      await page.locator('#selbar [data-act="explain"]').click();
      const first = page.locator("#C-central section.ithread[data-thread] .exp-b").first();
      await expect(first).toContainText(/obs-fold|RFC 9112/i, { timeout: 90_000 });
      await expect(page.locator("#C-central .working")).toHaveCount(0, { timeout: 60_000 });
      answers.push(norm(await first.innerText()));
    }
    expect(answers[1], "static demo explain").toBe(answers[0]);
  });

  test("an on-demand hunk summary matches between the static demo and the replay service", async ({ page }) => {
    test.setTimeout(240_000);
    if (!syncSvc) throw new Error("not started");
    const summaries: string[] = [];
    for (const base of [`${syncSvc.origin}/review/${syncReviewId}?token=${syncSvc.token}`, `${origin()}/#/review/demo`]) {
      await page.goto(base);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 60_000,
      });
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      const connFile = page.locator(`[id="F-src-urllib3-connection.py"]`);
      await expect(connFile.locator("table.diff").first()).toBeVisible({ timeout: 30_000 });
      // Scope every step to the first hunk: after the delete, a bare
      // `p[data-hunksum]` first() would match the next hunk's summary and
      // pass at once (the race CI hit on a slow runner).
      const hunk = connFile.locator(".dhunk").first();
      const idle = hunk.locator("p[data-hunksum]");
      await idle.click();
      const card = hunk.locator("[data-thread]").first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByRole("button", { name: "Delete thread" }).click();
      await expect(idle).toHaveCount(0, { timeout: 30_000 });
      await hunk.getByRole("button", { name: "Summarize" }).click();
      await expect(idle).toBeVisible({ timeout: 90_000 });
      summaries.push(norm(await idle.innerText()));
    }
    expect(summaries[1], "static demo hunk summary").toBe(summaries[0]);
  });
});
