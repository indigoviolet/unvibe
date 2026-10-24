/** J9 (#188 round 2): comment reply, edit, close/reopen, delete — stubbed gh. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import type { Locator, Page } from "@playwright/test";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { fileKeyForPath } from "@unvibe/shared";
import { apiJson, createScratchReview, createSeededDemoReview, makeScratchRepo, writeFakeGh } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const appKey = fileKeyForPath("src/app.py");

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

test.describe("J9 comment edges", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-repo-"));
    const repo = await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-bin-"));
    writeFakeGh(fakeBin, logDir, repo.headSha);
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, { extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` } });
    reviewId = await createScratchReview(svc, repoDir, { pr: 1 });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("reply, edit draft, close and reopen, then delete", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 60_000 });

    // Create, then reply in the thread.
    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    const slot = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
    await expect(slot).toBeVisible();
    await slot.locator("textarea").fill("First version of this note.");
    await slot.getByRole("button", { name: "Save" }).click();
    const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "First version of this note." });
    await expect(thread).toBeVisible({ timeout: 10_000 });
    await thread.getByPlaceholder("Reply…").fill("A reply to myself.");
    await thread.getByRole("button", { name: "Reply" }).click();
    await expect(thread).toContainText("A reply to myself.", { timeout: 10_000 });

    // Edit the Outbox draft on the menu's Outbox tab; it persists across reopen.
    await page.locator('#reviewbar [data-cm=""]').click();
    await page.locator('.cmenu [data-cmtab="outbox"]').click();
    const draft = page.locator(".cmenu textarea[id^='ob-']").first();
    await expect(draft).toBeVisible({ timeout: 10_000 });
    await draft.fill("Edited version of this note.");
    await page.waitForResponse(
      (r) => r.url().includes("/comments/") && r.request().method() === "PATCH" && r.ok(),
      { timeout: 10_000 },
    );
    await page.keyboard.press("Escape");
    await page.locator('#reviewbar [data-cm=""]').click();
    await page.locator('.cmenu [data-cmtab="outbox"]').click();
    await expect(page.locator(".cmenu textarea[id^='ob-']").first()).toHaveValue("Edited version of this note.");
    await page.keyboard.press("Escape");

    // Close leaves the thread; clicking the line reopens it.
    const openThread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "First version of this note." });
    await expect(openThread).toBeVisible({ timeout: 10_000 });
    await openThread.getByRole("button", { name: "Close" }).click();
    await expect(openThread).toHaveCount(0, { timeout: 10_000 });
    // Moved from comments.spec.ts (#258): closing leaves a comment icon
    // on the line number; clicking the line reopens the thread.
    await expect(page.locator(`[id="L-${appKey}-2"] td.n.hc`)).toBeVisible({ timeout: 10_000 });
    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    await expect(openThread).toBeVisible({ timeout: 10_000 });

    // Delete removes it for good.
    await openThread.getByRole("button", { name: "Delete" }).click();
    await expect(openThread).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "First version" })).toHaveCount(0);
  });

  test("gutter is digits + padding; added file drops the empty column (#261)", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 60_000 });
    const utilKey = fileKeyForPath("src/util.py");
    // Modified file keeps both columns, tightened; the new numbers keep
    // the comment affordance (click still opens the composer).
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const mod = await page.evaluate((key) => {
      const file = document.getElementById(`F-${key}`)!;
      const digits = Number.parseInt(file.style.getPropertyValue("--lnw"), 10) || 0;
      const sample = (file.querySelector("table.diff tbody > tr:not(.xsep) td.n") ?? file.querySelector("table.diff td.n"))!;
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
      const fcs = getComputedStyle(sample);
      probe.style.fontFamily = fcs.fontFamily;
      probe.style.fontSize = fcs.fontSize;
      probe.style.fontStyle = fcs.fontStyle;
      probe.style.fontWeight = fcs.fontWeight;
      probe.style.letterSpacing = fcs.letterSpacing;
      probe.textContent = "0123456789";
      document.body.appendChild(probe);
      const digitW = probe.getBoundingClientRect().width / 10;
      probe.remove();
      const cs = getComputedStyle(sample);
      const pad = (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0);
      let oldMax = 0;
      let nwMax = 0;
      for (const tr of file.querySelectorAll("table.diff:not(.split) tbody > tr")) {
        if (tr.classList.contains("xsep")) continue;
        const cells = [...tr.querySelectorAll(":scope > td.n")];
        if (cells.length === 2) {
          oldMax = Math.max(oldMax, cells[0].getBoundingClientRect().width);
          nwMax = Math.max(nwMax, cells[1].getBoundingClientRect().width);
        }
      }
      return { digits, digitW, pad, oldMax, nwMax };
    }, appKey);
    expect(mod.oldMax).toBeGreaterThan(0);
    expect(mod.oldMax).toBeLessThanOrEqual(mod.digits * mod.digitW + mod.pad + 18 + 3);
    expect(mod.nwMax).toBeLessThanOrEqual(mod.digits * mod.digitW + mod.pad + 14 + 3);
    await expect(page.locator(`[id="L-${appKey}-2"] td.n.new`)).toHaveAttribute("data-tip", /Comment on line 2/);
    // Added file: single number column.
    const added = await page.evaluate((key) => {
      const file = document.getElementById(`F-${key}`);
      if (!file) return null;
      const tables = [...file.querySelectorAll("table.diff:not(.split)")];
      const hideOld = tables.length > 0 && tables.every((t) => t.classList.contains("hide-old"));
      const counts: number[] = [];
      for (const tr of file.querySelectorAll("table.diff:not(.split) tbody > tr")) {
        if (tr.classList.contains("xsep")) continue;
        counts.push(tr.querySelectorAll(":scope > td.n").length);
      }
      return { hideOld, counts: [...new Set(counts)] };
    }, utilKey);
    expect(added).not.toBeNull();
    expect(added!.hideOld).toBe(true);
    expect(added!.counts).toEqual([1]);
  });
});

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


test.describe("J9 comment marker opens all (#205)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-205-data-"));
    reviewId = createSeededDemoReview(dataDir, "j9-205-seed");
    svc = await startService(dataDir, { agent: "replay" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("guide and description markers open all; a preview item opens just its own", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const snapRes = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const snap = snapRes.json as {
      pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[];
      description?: { html?: string };
    };
    const central = snap.pages?.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const firstBlock = central?.blocks[0]?.id;
    if (!firstBlock || !central) throw new Error("no guide block");
    // Qualified `card#block`: bare block ids repeat across cards.
    const blockId = `${central.id}#${firstBlock}`;
    const paraId = snap.description?.html?.match(/id="(d-[^"]+)"/)?.[1];
    if (!paraId) throw new Error("no description paragraph");

    // Three unquoted comments on one guide block (the bubble marker) and
    // three on one description paragraph.
    for (let i = 1; i <= 3; i++) {
      const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "block", blockId },
        quote: "",
        text: `Guide note ${i}`,
      });
      expect(made.status).toBe(201);
    }
    const descIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "description", paragraphId: paraId },
        quote: "",
        text: `Desc note ${i}`,
      });
      expect(made.status).toBe(201);
      const id = (made.json as { id: string }).id;
      descIds.push(id);
      // Description comments start open; close them so the marker shows.
      await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/comments/${id}`, { open: false });
    }

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Guide: clicking one preview item opens only that comment.
    const gMarker = page.locator("#C-central button.lk.cm[data-threads]");
    await expect(gMarker).toBeVisible({ timeout: 15_000 });
    await expect(gMarker).toContainText("3");
    await hoverFresh(page, gMarker);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#pop [data-open-thread]")).toHaveCount(3);
    await page.locator("#pop [data-open-thread]").nth(1).click();
    const gThread2 = page.locator("#C-central .ithread[data-thread]", { hasText: "Guide note 2" });
    await expect(gThread2).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#C-central .ithread[data-thread]", { hasText: "Guide note 1" })).toHaveCount(0);
    await expect(page.locator("#C-central .ithread[data-thread]", { hasText: "Guide note 3" })).toHaveCount(0);

    // Guide: close it, then the marker opens all three, stacked.
    await gThread2.getByRole("button", { name: "Close" }).click();
    await expect(gThread2).toHaveCount(0, { timeout: 10_000 });
    await gMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#C-central .ithread[data-thread]", { hasText: `Guide note ${i}` })).toBeVisible({ timeout: 15_000 });
    }

    // Description: same behaviour next to a paragraph.
    await page.locator('#right [role="tab"]').getByText(/description/i).click();
    const dMarker = page.locator("#right .desc button.lk.cm[data-threads]");
    await expect(dMarker).toBeVisible({ timeout: 15_000 });
    await expect(dMarker).toContainText("3");
    await hoverFresh(page, dMarker);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#pop [data-open-thread]")).toHaveCount(3);
    await page.locator("#pop [data-open-thread]").nth(0).click();
    const dThread1 = page.locator("#right .ithread[data-thread]", { hasText: "Desc note 1" });
    await expect(dThread1).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#right .ithread[data-thread]", { hasText: "Desc note 2" })).toHaveCount(0);
    await dThread1.getByRole("button", { name: "Close" }).click();
    await expect(dThread1).toHaveCount(0, { timeout: 10_000 });
    await dMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#right .ithread[data-thread]", { hasText: `Desc note ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    void descIds;
  });
});

test.describe("J262 comment marker is a toggle (#262)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j262-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("marker expands, collapses, mixed opens all; tooltip states the action", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const snapRes = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const snap = snapRes.json as {
      pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[];
      description?: { html?: string };
    };
    const central = snap.pages?.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const firstBlock = central?.blocks[0]?.id;
    if (!firstBlock || !central) throw new Error("no guide block");
    const blockId = `${central.id}#${firstBlock}`;
    const paraId = snap.description?.html?.match(/id="(d-[^"]+)"/)?.[1];
    if (!paraId) throw new Error("no description paragraph");

    for (let i = 1; i <= 3; i++) {
      const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "block", blockId },
        quote: "",
        text: `Toggle note ${i}`,
      });
      expect(made.status).toBe(201);
    }
    for (let i = 1; i <= 3; i++) {
      const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "description", paragraphId: paraId },
        quote: "",
        text: `Toggle desc ${i}`,
      });
      expect(made.status).toBe(201);
      const id = (made.json as { id: string }).id;
      await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/comments/${id}`, { open: false });
    }

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Guide: the marker starts as "Show comments".
    const gMarker = page.locator("#C-central button.lk.cm[data-threads]");
    await expect(gMarker).toBeVisible({ timeout: 15_000 });
    await expect(gMarker).toContainText("3");
    await expect(gMarker).toHaveAttribute("data-tip", "Show comments");

    // Expand from the marker: all three open, tooltip flips.
    await gMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#C-central .ithread[data-thread]", { hasText: `Toggle note ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    await expect(gMarker).toHaveAttribute("data-tip", "Hide comments");
    await page.locator("#C-central").screenshot({ path: `${SHOTS}/j262-guide-open.png` });

    // The tooltip states the collapse action.
    await hoverFresh(page, gMarker);
    await expect(page.locator("#tip")).toContainText("Hide comments", { timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/j262-guide-tip.png` });
    await page.keyboard.press("Escape");

    // Collapse from the marker: one click closes all three.
    await gMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#C-central .ithread[data-thread]", { hasText: `Toggle note ${i}` })).toHaveCount(0, { timeout: 15_000 });
    }
    await expect(gMarker).toHaveAttribute("data-tip", "Show comments");

    // Mixed case: one open via its preview item, the marker opens all.
    await hoverFresh(page, gMarker);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await page.locator("#pop [data-open-thread]").nth(1).click();
    const gThread2 = page.locator("#C-central .ithread[data-thread]", { hasText: "Toggle note 2" });
    await expect(gThread2).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#C-central .ithread[data-thread]", { hasText: "Toggle note 1" })).toHaveCount(0);
    await expect(gMarker).toHaveAttribute("data-tip", "Show comments");
    await gMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#C-central .ithread[data-thread]", { hasText: `Toggle note ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    await expect(gMarker).toHaveAttribute("data-tip", "Hide comments");

    // Per-thread Close still works, and the marker's state follows it.
    const gThread1 = page.locator("#C-central .ithread[data-thread]", { hasText: "Toggle note 1" });
    await gThread1.getByRole("button", { name: "Close" }).click();
    await expect(gThread1).toHaveCount(0, { timeout: 10_000 });
    await expect(gMarker).toHaveAttribute("data-tip", "Show comments");

    // Description: the same toggle next to a paragraph.
    await page.locator('#right [role="tab"]').getByText(/description/i).click();
    const dMarker = page.locator("#right .desc button.lk.cm[data-threads]");
    await expect(dMarker).toBeVisible({ timeout: 15_000 });
    await expect(dMarker).toContainText("3");
    await expect(dMarker).toHaveAttribute("data-tip", "Show comments");
    await dMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#right .ithread[data-thread]", { hasText: `Toggle desc ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    await expect(dMarker).toHaveAttribute("data-tip", "Hide comments");
    await page.locator("#right .desc").screenshot({ path: `${SHOTS}/j262-desc-open.png` });
    await dMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#right .ithread[data-thread]", { hasText: `Toggle desc ${i}` })).toHaveCount(0, { timeout: 15_000 });
    }
    await expect(dMarker).toHaveAttribute("data-tip", "Show comments");

    // Description mixed case: one open, the marker opens all.
    await hoverFresh(page, dMarker);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await page.locator("#pop [data-open-thread]").nth(0).click();
    const dThread1 = page.locator("#right .ithread[data-thread]", { hasText: "Toggle desc 1" });
    await expect(dThread1).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#right .ithread[data-thread]", { hasText: "Toggle desc 2" })).toHaveCount(0);
    await expect(dMarker).toHaveAttribute("data-tip", "Show comments");
    await dMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#right .ithread[data-thread]", { hasText: `Toggle desc ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    await expect(dMarker).toHaveAttribute("data-tip", "Hide comments");
  });
});
