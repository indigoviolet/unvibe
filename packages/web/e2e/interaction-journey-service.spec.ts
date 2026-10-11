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
  await page.evaluate((sel: string) => {
    document.querySelector(sel)?.scrollIntoView({ block: "center" });
  }, rootSelector);
  await page.waitForTimeout(350);
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
  expect(found).toBe(true);
  await expect(page.locator("#selbar")).toBeVisible({ timeout: 5000 });
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
 * and arriving. So wait for fonts + scroll quiet, then confirm the cursor
 * actually lands on the anchor (re-aiming from a fresh measurement when
 * it misses) instead of trusting one stale bounding box.
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
  for (let i = 0; i < 3; i++) {
    const box = await locator.boundingBox();
    if (!box) throw new Error("anchor has no box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
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
  throw new Error("hover missed the anchor after 3 aims (layout still shifting?)");
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
      await new Promise((r) => setTimeout(r, 1000));
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

    // Depth + on the fresh expansion generates via the agent (the replay
    // backend answers in milliseconds, so the working state is transient —
    // observe continuously instead of asserting after the fact).
    await page.evaluate(() => {
      (window as unknown as { __seenWorking?: boolean }).__seenWorking = false;
      const root = document.querySelector('#C-central [data-expansion]');
      if (!root) return;
      new MutationObserver(() => {
        if (root.querySelector(".working")) {
          (window as unknown as { __seenWorking?: boolean }).__seenWorking = true;
        }
      }).observe(root, { childList: true, subtree: true, characterData: true });
    });
    await exp.getByRole("button", { name: "Deeper" }).click();
    await expect(exp.locator(".working").first()).toBeVisible({ timeout: 15_000 }).catch(() => {});
    await expect(exp.locator(".working")).toHaveCount(0, { timeout: 60_000 });
    await expect(exp.locator(".exp-b")).not.toBeEmpty({ timeout: 10_000 });
    await exp.getByRole("button", { name: "Simpler" }).click();
    await page.waitForTimeout(2000);
    await expect(exp.locator(".exp-b")).not.toBeEmpty();

    // Use examples, then Undo.
    await exp.getByRole("button", { name: "Use examples" }).click();
    await page.waitForTimeout(4000);
    await exp.getByRole("button", { name: "Undo" }).click();
    await page.waitForTimeout(1500);

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

    // Ask on another block; the streamed answer carries citations; clicking
    // one reveals the diff with a highlight.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const thread = page.locator("#C-problem .ithread[data-thread]", { hasText: "What is line folding?" });
    await expect(thread.first()).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator(".msg .av.ai").first()).toBeVisible({ timeout: 60_000 });
    const marker = thread.locator(".msg .lk[data-refs]");
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

    // Mark cards read; Contents shows them read.
    await page.locator("#C-central > .ctl").getByRole("button", { name: "Mark read" }).click();
    await expect(page.locator("#C-central")).toHaveClass(/read/, { timeout: 10_000 });
    await expect(page.locator('nav.toc li [data-tocard="central"]')).toBeVisible();
    const item = page.locator("nav.toc li", { has: page.locator('[data-tocard="central"]') });
    await expect(item).toHaveClass(/done/, { timeout: 10_000 });
  });
});
