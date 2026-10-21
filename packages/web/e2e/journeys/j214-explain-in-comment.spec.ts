/** J214: Explain on text inside a comment card anchors to that comment — replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

interface Ann {
  id: string;
  type: string;
  open?: boolean;
  anchor: { host: { kind: string; commentId?: string }; quotedText?: string };
  messages: { text?: string; suggested?: boolean; question?: boolean }[];
  turns?: { blocks: unknown[] }[];
  openQuestion?: unknown;
}

async function annotations(svc: RunningService, reviewId: string): Promise<Ann[]> {
  const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  return ((snap.json as { annotations?: Ann[] }).annotations ?? []) as Ann[];
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await fn();
    if (found) return found;
    if (Date.now() > deadline) throw new Error("timed out waiting for annotation");
    await new Promise((r) => setTimeout(r, 500));
  }
}

test.describe("J214 explain inside a comment", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j214-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
    // Wait for the suggested question (guide) and a suggested comment (diff).
    await waitFor(async () => {
      const anns = await annotations(svc!, reviewId);
      const q = anns.find((a) => a.openQuestion);
      const ai = anns.find((a) => a.type === "comment" && a.messages.some((m) => m.suggested && !m.question));
      return q && ai ? { q, ai } : null;
    });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("guide: explain inside a suggested-question comment anchors to that comment", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    const anns = await annotations(svc, reviewId);
    const q = anns.find((a) => a.openQuestion);
    if (!q) throw new Error("no suggested question");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Open the closed suggested-question comment from its block marker.
    const thread = page.locator(`.ithread[data-thread="${q.id}"]`);
    if ((await thread.count()) === 0 || !(await thread.isVisible().catch(() => false))) {
      await page.locator("#C-problem .lk.cm[data-threads]").first().click();
    }
    await expect(thread).toBeVisible({ timeout: 15_000 });
    await expect(thread).toContainText("Suggested question");

    await selectText(page, `[data-thread="${q.id}"] [data-comment="${q.id}"]`, "folded values");
    await page.locator('#selbar [data-act="explain"]').click();

    const conv = await waitFor(async () => {
      const list = await annotations(svc!, reviewId);
      return list.find((a) => a.type === "conversation" && a.anchor.host.kind === "comment" && a.anchor.host.commentId === q.id) ?? null;
    });
    const card = page.locator(`[data-expansion="${conv.id}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
    // Anchored under that comment: the thread comes before the card in
    // the same guide card, and the answer shows no internal ID.
    const order = await page.evaluate(
      ({ threadId, cardId }: { threadId: string; cardId: string }) => {
        const t = document.querySelector(`[data-thread="${threadId}"]`);
        const c = document.querySelector(`[data-expansion="${cardId}"]`);
        if (!t || !c) return "missing";
        return t.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : "before";
      },
      { threadId: q.id, cardId: conv.id },
    );
    expect(order).toBe("after");
    await expect(card).not.toContainText(/ct_\d+/);
    await expect(card.locator(".exp-b")).not.toContainText(/ct_\d+/);
  });

  test("diff: explain inside a suggested comment anchors to that comment", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    const anns = await annotations(svc, reviewId);
    const ai = anns.find(
      (a) => a.type === "comment" && a.messages.some((m) => m.suggested && !m.question && (m.text ?? "").includes("bare LF")),
    );
    if (!ai) throw new Error("no suggested comment");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const thread = page.locator(`.ithread[data-thread="${ai.id}"]`).first();
    await expect(thread).toBeVisible({ timeout: 60_000 });

    await selectText(page, `[data-thread="${ai.id}"] [data-comment="${ai.id}"]`, "bare LF");
    await page.locator('#selbar [data-act="explain"]').click();

    const conv = await waitFor(async () => {
      const list = await annotations(svc!, reviewId);
      return list.find((a) => a.type === "conversation" && a.anchor.host.kind === "comment" && a.anchor.host.commentId === ai.id) ?? null;
    });
    const card = page.locator(`[data-expansion="${conv.id}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
    const order = await page.evaluate(
      ({ threadId, cardId }: { threadId: string; cardId: string }) => {
        const t = document.querySelector(`[data-thread="${threadId}"]`);
        const c = document.querySelector(`[data-expansion="${cardId}"]`);
        if (!t || !c) return "missing";
        return t.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : "before";
      },
      { threadId: ai.id, cardId: conv.id },
    );
    expect(order).toBe("after");
    await expect(card).not.toContainText(/ct_\d+/);
    await expect(card.locator(".exp-b")).not.toContainText(/ct_\d+/);
  });
});
