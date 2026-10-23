/** J263: PR description tab reads like a guide card; card links + comments-menu jump keep working. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J263 PR description tab", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j263-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("description reads like a guide card with no Restated links", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await page.locator('#right [role="tab"]').getByText("PR description").click();
    await expect(page.locator("#right #d-p1")).toContainText("obs-fold response-header case", { timeout: 30_000 });

    // Paragraphs, a bullet list, a numbered list past 9 items, inline code.
    await expect(page.locator("#right #d-p2")).toContainText("HTTPHeaderDict");
    await expect(page.locator("#right ul#d-p5 li")).toHaveCount(6);
    await expect(page.locator("#right ol#d-p6 li")).toHaveCount(12);
    await expect(page.locator("#right ol#d-p6 li").nth(9)).toContainText("towncrier");
    expect(await page.locator("#right .desc code").count()).toBeGreaterThan(0);

    // No "Restated →" links remain: neither inline buttons nor list footers.
    await expect(page.locator("#right .desc button.back")).toHaveCount(0);
    await expect(page.locator("#right .desc")).not.toContainText("Restated →");

    // The shared Card carries normal margins, so the box never runs into
    // the pane edges; paragraphs and headings share one left edge; list
    // markers sit inside the content padding.
    const box = await page.locator("#right .ui-card.desc").evaluate((el) => {
      const cs = getComputedStyle(el);
      const h3 = el.querySelector("h3");
      const p = el.querySelector("p.para");
      const ul = el.querySelector("ul.para");
      const ol = el.querySelector("ol.para");
      const left = (node: Element | null): number | null =>
        node ? Math.round(node.getBoundingClientRect().left) : null;
      return {
        marginLeft: cs.marginLeft,
        h3: left(h3),
        p: left(p),
        ul: left(ul),
        ol: left(ol),
        ulPad: ul ? getComputedStyle(ul).paddingLeft : null,
        olPad: ol ? getComputedStyle(ol).paddingLeft : null,
      };
    });
    expect(parseFloat(box.marginLeft)).toBeGreaterThanOrEqual(14);
    expect(box.h3).not.toBeNull();
    expect(box.p).not.toBeNull();
    expect(box.h3).toBe(box.p);
    expect(box.ul).toBe(box.p);
    expect(box.ol).toBe(box.p);
    expect(parseFloat(box.ulPad ?? "0")).toBeGreaterThanOrEqual(22);
    expect(parseFloat(box.olPad ?? "0")).toBeGreaterThanOrEqual(22);
  });

  test("card links and the comments-menu jump keep working", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    // One guide-anchored thread, seeded like J9.
    const snapRes = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const snap = snapRes.json as {
      pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[];
    };
    const central = snap.pages?.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const firstBlock = central?.blocks[0]?.id;
    if (!central || !firstBlock) throw new Error("no central block");
    const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
      anchor: { where: "block", blockId: `${central.id}#${firstBlock}` },
      quote: "",
      text: "J263 guide note",
    });
    expect(made.status).toBe(201);
    const threadId = (made.json as { id: string }).id;

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Card link ("the problem" in the central card) jumps to the guide block.
    await page.locator('#C-central a.cx[data-link="card:problem#b1"]').click();
    await expect(page.locator("#B-b1.hl")).toBeVisible({ timeout: 15_000 });

    // Comments-menu row jumps to the guide thread (opens + scrolls to it).
    await page.locator("#page").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.locator('#reviewbar [data-cm=""]').click();
    await expect(page.locator(".cmenu")).toBeVisible({ timeout: 15_000 });
    // New comments land in the Outbox by default: the seeded guide note
    // rides the Outbox tab.
    await page.locator('.cmenu [data-cmtab="outbox"]').click();
    await expect(page.locator(`[data-cjump="${threadId}"]`)).toBeVisible({ timeout: 15_000 });
    await page.locator(`[data-cjump="${threadId}"]`).click();
    const thread = page.locator(`.ithread[data-thread="${threadId}"]`);
    await expect(thread).toBeVisible({ timeout: 15_000 });
    await expect(thread).toBeInViewport({ timeout: 15_000 });
  });
});
