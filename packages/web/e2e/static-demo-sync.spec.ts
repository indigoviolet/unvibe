/**
 * Static-demo sync check (issue #334): the static build shows the same
 * content as the real service in replay mode.
 *
 * A fixture or UI change that breaks the static demo fails here: the key
 * screens are rendered against both backends and compared as text — the
 * guide cards (minus live threads), one recorded Explain answer, and one
 * on-demand hunk summary. Identical recordings + the shared matcher mean
 * identical answers; any drift on either side fails the comparison.
 *
 * Needs `mise run build` (service + web) and `mise run demo:build`.
 * Runs in `test:slow` via `mise run demo:sync`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { selectText } from "./select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import { startStaticServer, type StaticServer } from "./static-server.js";

const exec = promisify(execFile);

const DEMO_DIST = fileURLToPath(new URL("../dist-demo", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY) || !existsSync(DEMO_DIST), "needs `mise run build` and `mise run demo:build` first");

const CONN = "src-urllib3-connection.py";

let dataDir = "";
let svc: RunningService | null = null;
let reviewId = "";
let demo: StaticServer | null = null;

async function apiJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`, "-H", "content-type: application/json"];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-demo-sync-data-"));
  svc = await startService(dataDir, { agent: "replay" });
  const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as {
    review: { id: string };
  };
  reviewId = created.review.id;
  const deadline = Date.now() + 120_000;
  for (;;) {
    const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
      pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
    };
    const root = snap.pages.find((p) => p.id === "root");
    if (root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0) && root?.cards.some((c) => c.id === "central" && c.blocks.length > 0)) break;
    if (Date.now() > deadline) throw new Error("guide did not fill in time");
    await new Promise((r) => setTimeout(r, 1000));
  }
  demo = await startStaticServer(DEMO_DIST);
});

test.afterAll(async () => {
  await svc?.stop().catch(() => {});
  svc = null;
  await demo?.stop().catch(() => {});
  demo = null;
  rmSync(dataDir, { recursive: true, force: true });
});

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Guide card texts with live threads removed (threads differ by backend by design). */
async function guideCardTexts(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const el of document.querySelectorAll('#page [id^="C-"]')) {
      const clone = el.cloneNode(true) as HTMLElement;
      // Threads and pending contributions differ by backend by design
      // (live critic suggestions vs fixture seeds): strip their UI, keep
      // the card body text. textContent, not innerText: the clone is
      // detached, and innerText needs layout. Anchor marks wrap real card
      // words, so they unwrap instead of removing.
      for (const t of clone.querySelectorAll("section.ithread, [data-pending-thread], button.cm, button.rlink, div.suggest"))
        t.remove();
      // Rendered diagram internals (SVG + injected style) differ by
      // renderer, not by content: presence of the diagram is asserted
      // separately below, its pixels are not compared.
      for (const t of clone.querySelectorAll("svg, style")) t.remove();
      // Anchor flags in the marker row duplicate the quoted words (thread
      // UI); inline highlights wrap real card words, so they unwrap.
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
  if (!svc || !demo) throw new Error("not started");
  // Equivalent states: go-deeper cards start collapsed on a live review
  // (#217) but expanded in the fixture the demo bakes in — open every
  // collapsed guide card on both sides before comparing.
  const expandAll = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) {
      const btn = page.locator('#page section.collapsed').getByRole("button", { name: "Expand" });
      if ((await btn.count()) === 0) return;
      await btn.first().click();
    }
  };

  await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
  await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
    timeout: 60_000,
  });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await expandAll();
  // Go-deeper cards fill after the reader (J20 polls the same way): wait
  // for every root card non-pending with blocks, then for the flow
  // diagram's rendered SVG (not an icon) before comparing.
  if (!svc) throw new Error("not started");
  const svcOrigin = svc.origin;
  const svcToken = svc.token;
  await expect
    .poll(
      async () => {
        const snap = (await apiJson(svcOrigin, svcToken, "GET", `/api/reviews/${reviewId}`)) as {
          pages: { id: string; cards: { id: string; blocks: unknown[]; pending?: unknown }[] }[];
        };
        const root = snap.pages.find((p) => p.id === "root");
        return !!root && root.cards.length >= 8 && root.cards.every((c) => !c.pending && c.blocks.length > 0);
      },
      { timeout: 300_000 },
    )
    .toBe(true);
  // The diagram settles to a rendered SVG or, without d2, the source
  // fallback — either way the card is comparable after this.
  await expect(page.locator("#C-g-flow .dg-svg svg, #C-g-flow .dg-fallback").first()).toBeVisible({
    timeout: 180_000,
  });
  const fromService = await guideCardTexts(page);

  await page.goto(`${demo.origin}/#/review/demo`);
  await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
    timeout: 60_000,
  });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await expandAll();
  await expect(page.locator("#C-g-flow .dg-svg svg").first()).toBeVisible({ timeout: 60_000 });
  const fromStatic = await guideCardTexts(page);

  expect(Object.keys(fromStatic).sort()).toEqual(Object.keys(fromService).sort());
  for (const id of Object.keys(fromService)) {
    expect(norm(fromStatic[id] ?? ""), `guide card ${id}`).toBe(norm(fromService[id]));
  }
});

test("a recorded Explain matches between the static demo and the replay service", async ({ page }) => {
  test.setTimeout(240_000);
  if (!svc || !demo) throw new Error("not started");
  const answers: string[] = [];
  for (const base of [`${svc.origin}/review/${reviewId}?token=${svc.token}`, `${demo.origin}/#/review/demo`]) {
    await page.goto(base);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 60_000,
    });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await selectText(page, "#C-central", "optional whitespace");
    await page.locator('#selbar [data-act="explain"]').click();
    const first = page.locator('#C-central section.ithread[data-thread] .exp-b').first();
    // Passage-scoped matching (quote + host block): the card unfolds, so
    // both backends replay the obs-fold recording.
    await expect(first).toContainText(/obs-fold|RFC 9112/i, { timeout: 90_000 });
    await expect(page.locator("#C-central .working")).toHaveCount(0, { timeout: 60_000 });
    answers.push(norm(await first.innerText()));
  }
  expect(answers[1], "static demo explain").toBe(answers[0]);
});

test("an on-demand hunk summary matches between the static demo and the replay service", async ({ page }) => {
  test.setTimeout(240_000);
  if (!svc || !demo) throw new Error("not started");
  const summaries: string[] = [];
  for (const base of [`${svc.origin}/review/${reviewId}?token=${svc.token}`, `${demo.origin}/#/review/demo`]) {
    await page.goto(base);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 60_000,
    });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const connFile = page.locator(`[id="F-${CONN}"]`);
    await expect(connFile.locator("table.diff").first()).toBeVisible({ timeout: 30_000 });
    // Delete the first idle summary, then restore it on demand: both sides
    // rewrite it from the same hunk recording (the seeded idle text and
    // the service's hunk-pass text are not comparable directly).
    await connFile.locator("p[data-hunksum]").first().click();
    const card = connFile.locator(".dhunk [data-thread]").first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "Delete" }).click();
    await connFile.getByRole("button", { name: "Summarize" }).first().click();
    const idle = connFile.locator("p[data-hunksum]").first();
    await expect(idle).toBeVisible({ timeout: 90_000 });
    summaries.push(norm(await idle.innerText()));
  }
  expect(summaries[1], "static demo hunk summary").toBe(summaries[0]);
});
