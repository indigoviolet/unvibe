/**
 * Full reader journey over the real service (M4 interaction, replay agent).
 *
 * One flow on the demo review (`UNVIBE_AGENT: "replay"`, no live agents):
 * open demo → guide streams in → Explain → expansion fills → depth +
 * (generated) then − (instant) → Use examples → Undo → Close → dotted-link
 * hover preview → click re-expands → Open as page → back → Ask with streamed
 * answer + citations → citation click reveals the diff → Go deeper
 * (generate when pending, else assert the filled card) → follow-up → mark
 * read → Contents shows read.
 *
 * Requires `mise run build` first. Skipped when the service isn't built.
 * Uses the network-guard fixture (no non-local requests, no CSP errors).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import type { Locator, Page } from "@playwright/test";

const exec = promisify(execFile);

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

async function apiJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`, "-H", "content-type: application/json"];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

async function selectText(page: Page, rootSelector: string, text: string): Promise<void> {
  // Select and wait in one polled step (same as interaction.spec.ts):
  // scrollIntoView can deliver its scroll event after the toolbar shows
  // when the loop is busy, and a late scroll dismisses the bar — so
  // select-then-assert flakes. Re-select until the bar sticks; a repeated
  // select is harmless (same range, same mouseup path) and converges once
  // the scroll lands.
  await expect
    .poll(
      async () => {
        await page.evaluate((sel: string) => {
          document.querySelector(sel)?.scrollIntoView({ block: "center" });
        }, rootSelector);
        // No settle wait: the app has no smooth scrolling.
        const found = await page.evaluate(
          ({ rootSelector, text }: { rootSelector: string; text: string }) => {
            const root = document.querySelector(rootSelector);
            if (!root) return false;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const data = (node as Text).data;
              const at = data.indexOf(text);
              if (at < 0) continue;
              const range = document.createRange();
              range.setStart(node, at);
              range.setEnd(node, at + text.length);
              const sel = getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
              (node as Text).parentElement?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
              return true;
            }
            return false;
          },
          { rootSelector, text },
        );
        if (!found) return "not-found";
        // Let a late scroll land before reading the bar.
        await page.waitForTimeout(150);
        return (await page.locator("#selbar").isVisible()) ? "shown" : "hidden-again";
      },
      { timeout: 15000 },
    )
    .toBe("shown");
}

/**
 * Hover an anchor deterministically. Playwright's `hover()` may scroll with
 * the pointer already over the target, and a scroll with a stationary
 * pointer must NOT open the popover (PRD §4.5) — so scroll, settle, move
 * the pointer in genuine steps, and never let `hover()` scroll again.
 *
 * Two extra guards for loaded runners (found when this flow failed on the
 * macOS CI leg while passing on Linux): webfonts swap layout after load,
 * and async diagram/font rendering can move the anchor between measuring
 * and arriving. So wait for fonts + scroll quiet, then aim at the anchor's
 * own line boxes (a wrapped anchor's union-box center can land on plain
 * text between the lines) until the cursor verifiably lands on it.
 */
async function hoverFresh(page: Page, locator: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.evaluate(() => {
    const w = window as unknown as { __lastScrollAt?: number; __scrollHook?: boolean };
    w.__lastScrollAt = Date.now();
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
  await page.waitForFunction(
    () => Date.now() - ((window as unknown as { __lastScrollAt?: number }).__lastScrollAt ?? 0) > 400,
    { polling: 250, timeout: 10_000 },
  );
  await page.mouse.move(8, 200);
  // Aim at the anchor's own line boxes, not the union-box center: when the
  // anchor wraps across lines, the union center can land on plain text
  // between the lines (topmost element is then the paragraph, no mouseover
  // ever fires). Measure fresh each attempt and walk the line boxes until
  // the cursor verifiably lands on the anchor.
  const measure = (): Promise<{ x: number; y: number; width: number; height: number }[]> =>
    locator.evaluate((target) => {
      const out: { x: number; y: number; width: number; height: number }[] = [];
      const rs = target.getClientRects();
      for (let i = 0; i < rs.length; i++) out.push({ x: rs[i].x, y: rs[i].y, width: rs[i].width, height: rs[i].height });
      return out;
    });
  let last: { x: number; y: number } = { x: -1, y: -1 };
  for (let i = 0; i < 4; i++) {
    const rects = await measure();
    if (rects.length === 0) throw new Error("anchor has no rects");
    const r = rects[Math.min(i, rects.length - 1)];
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    last = { x, y };
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
  // Diagnose the miss with the covering stack instead of guessing: what is
  // topmost at the aim point, and what (if anything) is actually hovered.
  const diag = await page.evaluate((p: { x: number; y: number }) => {
    const stack = document
      .elementsFromPoint(p.x, p.y)
      .slice(0, 5)
      .map((el) => {
        const h = el as HTMLElement;
        const r = h.getBoundingClientRect();
        const cls = typeof h.className === "string" && h.className ? `.${h.className.trim().split(/\s+/).join(".")}` : "";
        return `${el.tagName.toLowerCase()}${h.id ? `#${h.id}` : ""}${cls} @(${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)})`;
      });
    const hovered = [...document.querySelectorAll(":hover")].map((el) => el.tagName.toLowerCase()).join(",");
    return { stack, hovered, scrollY: Math.round(window.scrollY), inner: `${window.innerWidth}x${window.innerHeight}` };
  }, last);
  throw new Error(
    `hover missed the anchor at (${last.x},${last.y}): top=[${diag.stack.join(" < ") || "(none)"}] ` +
      `:hover=[${diag.hovered || "(none)"}] scrollY=${diag.scrollY} viewport=${diag.inner}`,
  );
}

test.describe("reader journey over the real service (replay)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-journey-data-"));
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
      const ready =
        root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0) &&
        root?.cards.some((c) => c.id === "central" && c.blocks.length > 0);
      if (ready) break;
      if (Date.now() > deadline) throw new Error("guide did not fill in time");
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function openReview(page: Page): Promise<void> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 30_000,
    });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  }

  test("the whole reader journey in one flow", async ({ page }) => {
    test.setTimeout(240_000);
    await openReview(page);

    // Explain selected guide text; the expansion fills with streamed text.
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const exp = page.locator('#C-central [data-expansion]').first();
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });

    // Depth + on the fresh expansion generates via the agent: the body
    // text is rewritten, so wait for it to change (persistent state, not
    // the transient working indicator, which a slow round-trip can miss,
    // and not the pips, which expansions render without i.on).
    const expBody = exp.locator(".exp-b");
    const explained = await expBody.innerText();
    await exp.getByRole("button", { name: "Deeper" }).click();
    await expect.poll(async () => expBody.innerText(), { timeout: 60_000 }).not.toBe(explained);
    await expect(exp.locator(".working")).toHaveCount(0, { timeout: 60_000 });
    await expect(expBody).not.toBeEmpty({ timeout: 10_000 });
    // Simpler rewrites again: the text changes back (a real check that the
    // step did something, not just a re-read of a nonempty body).
    const deepened = await expBody.innerText();
    await exp.getByRole("button", { name: "Simpler" }).click();
    await expect.poll(async () => expBody.innerText(), { timeout: 60_000 }).not.toBe(deepened);
    await expect(expBody).not.toBeEmpty();

    // Use examples, then Undo.
    // The explain fill already carries an Example aside, so examples is
    // saturated here (reused, no job): the count must not grow.
    const asides = exp.locator(".gen-aside");
    await expect(asides.first()).toBeVisible({ timeout: 30_000 });
    const asidesBefore = await asides.count();
    await exp.getByRole("button", { name: "Use examples" }).click();
    await expect(asides).toHaveCount(asidesBefore, { timeout: 10_000 });
    // Undo reverts the Simpler step: the deeper text returns.
    await exp.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => expBody.innerText(), { timeout: 30_000 }).toBe(deepened);

    // Close → dotted link → hover preview → click re-expands.
    await exp.getByRole("button", { name: "Close" }).click();
    await expect(page.locator('#C-central [data-expansion]').first()).toHaveCount(0, { timeout: 10_000 });
    const mark = page.locator("#C-central mark.anc.exl").first();
    await expect(mark).toBeVisible({ timeout: 10_000 });
    await hoverFresh(page, mark);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await mark.click();
    await expect(page.locator('#C-central [data-expansion]').first()).toBeVisible({ timeout: 10_000 });

    // Open as page, then back.
    await page.locator('#C-central [data-expansion]').first().getByRole("button", { name: "Open as page" }).click();
    await expect(page).toHaveURL(/\/page\/p-/, { timeout: 15_000 });
    await expect(page.locator("#page nav.crumbs")).toContainText("Unfold obsolete", { timeout: 10_000 });
    await page.goBack();
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 15_000 });

    // Ask on another block; the answer arrives as blocks with citations;
    // clicking one reveals the diff with a highlight.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-problem .card.child[data-expansion]", { hasText: "What is line folding?" });
    await expect(card.first()).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".ans-q").first()).toContainText("What is line folding?", { timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
    const marker = card.locator(".lk[data-refs]");
    await expect(marker.first()).toBeVisible({ timeout: 30_000 });
    await marker.first().click();
    await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff", { timeout: 10_000 });

    // Go deeper: generate when a placeholder is still pending, else assert
    // the filled card; then use a follow-up suggestion.
    const pendings = page.locator("#page .card.pend");
    if ((await pendings.count()) > 0) {
      await pendings.first().getByRole("button", { name: "Generate" }).click();
      await expect(pendings.first().locator(".working").first()).toBeVisible({ timeout: 15_000 });
      await expect(pendings.first()).toHaveCount(0, { timeout: 90_000 });
    }
    const follow = page.locator("#page .follow button").first();
    await expect(follow).toBeVisible({ timeout: 15_000 });
    const label = await follow.innerText();
    await follow.click();
    await expect(page.locator("#page .follow", { hasText: label })).toHaveCount(0, { timeout: 30_000 });

    // Collapse the card; Contents still lists it.
    await page.locator("#C-central > .chead").getByRole("button", { name: "Collapse" }).click();
    await expect(page.locator("#C-central")).toHaveClass(/collapsed/, { timeout: 10_000 });
    await expect(page.locator('nav.toc li [data-tocard="central"]')).toBeVisible();
    const item = page.locator("nav.toc li", { has: page.locator('[data-tocard="central"]') });
    await expect(item).toBeVisible({ timeout: 10_000 });
  });
});
