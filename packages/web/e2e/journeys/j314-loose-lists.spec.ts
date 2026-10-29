/** J314 (#314): a loose numbered list renders as one <ol> numbered 1-4. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { createSeededDemoReview, stampDataFormat } from "./journey-helpers.js";
import { parseBlocks } from "@unvibe/shared";
import { fileURLToPath } from "node:url";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const SHOTS = fileURLToPath(new URL("../../visual-tour/314", import.meta.url));

test.describe("J314 loose numbered lists", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  const reviewId = "j314-seed";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j314-data-"));
    createSeededDemoReview(dataDir, reviewId);
    // Append a guide card whose body is a loose numbered list, parsed by
    // the real parser: blank lines between items must not split the list.
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as {
        snapshot: string;
      };
      const snapshot = JSON.parse(row.snapshot) as {
        pages: { id: string; cards: unknown[] }[];
      };
      const root = snapshot.pages.find((p) => p.id === "root");
      if (!root) throw new Error("seeded snapshot has no root page");
      root.cards.push({
        id: "loose-lists",
        pageId: "root",
        title: "Loose list",
        blocks: parseBlocks("1. First step\n\n2. Second step\n\n3. Third step\n\n4. Fourth step\n"),
        level: "standard",
        revision: 1,
        undoStack: [],
        collapsed: false,
      });
      db.prepare("UPDATE review_snapshots SET snapshot = ? WHERE review_id = ?").run(
        JSON.stringify(snapshot),
        reviewId,
      );
      // Raw-SQL seeds bypass the service's stamp-on-create (#311).
      stampDataFormat(db);
    } finally {
      db.close();
    }
    svc = await startService(dataDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a loose numbered list is one <ol> with items 1-4", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const card = page.locator("#C-loose-lists");
    await expect(card).toBeVisible({ timeout: 60_000 });

    // One <ol> (the bug made four, each rendering "1."), with four items.
    const lists = card.locator("ol.lst");
    await expect(lists).toHaveCount(1);
    const items = lists.first().locator(":scope > li");
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText("First step");
    await expect(items.nth(3)).toContainText("Fourth step");

    // No start override: native <ol> numbering renders these 1-4 (the
    // bug made four separate lists, each rendering "1.").
    await expect(lists.first()).not.toHaveAttribute("start", /./);

    await card.screenshot({ path: path.join(SHOTS, "loose-list.png") });
  });
});
