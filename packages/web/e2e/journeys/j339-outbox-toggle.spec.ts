/** J339 (#339): the Outbox toggle works on an Ask-started thread once it
 * has a reviewer comment reply — no error toast, and only the comment
 * reaches the Outbox/Submit payload.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J339 outbox toggle on an Ask thread with a comment reply", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j339-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("Ask thread + reviewer comment toggles into the Outbox with only the comment", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Ask on guide text starts a new thread; its answer is the first reply.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();

    const thread = page.locator("#C-problem section.ithread[data-thread]").first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator('[data-reply][data-kind="ask"]').first()).toBeVisible({ timeout: 60_000 });
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();

    // Agent-only so far: no Outbox toggle (questions never reach the Outbox).
    await expect(thread.getByRole("button", { name: "Add to Outbox" })).toHaveCount(0);
    await expect(thread.getByRole("button", { name: "Remove from the Outbox" })).toHaveCount(0);

    // A reviewer comment reply lands on the same thread (the replies route).
    const replied = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments/${threadId}/replies`, {
      text: "Reviewer note on the answer",
    });
    expect(replied.status).toBe(200);

    // The toggle appears and works: no error toast, flips to marked.
    const toggle = thread.getByRole("button", { name: "Add to Outbox" });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await toggle.click();
    await expect(thread.getByRole("button", { name: "Remove from the Outbox" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#toast")).not.toContainText("Couldn't update the Outbox");

    // The comment is in the Outbox; the agent's answer text never posts.
    const outbox = await apiJson(svc, "GET", `/api/reviews/${reviewId}/outbox`);
    expect(outbox.status).toBe(200);
    expect((outbox.json as { count: number }).count).toBe(1);
    expect((outbox.json as { markdown: string }).markdown).toContain("Reviewer note on the answer");

    const preview = await apiJson(svc, "GET", `/api/reviews/${reviewId}/submit/preview`);
    expect(preview.status).toBe(200);
    const comments = (preview.json as { preview: { comments: { threadId: string; text: string }[] } }).preview.comments;
    const entry = comments.find((c) => c.threadId === threadId);
    expect(entry).toBeDefined();
    expect(entry?.text).toContain("Reviewer note on the answer");

    await page.screenshot({ path: "test-results/j339-outbox-toggle.png" });
  });
});
