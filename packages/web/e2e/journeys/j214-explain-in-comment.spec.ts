/** J214 (reworked #273): Explain inside a thread appends a reply there — replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

interface Reply {
  id: string;
  kind: string;
  blocks: unknown[];
}

interface Ann {
  id: string;
  type: string;
  open?: boolean;
  anchor: { host: { kind: string; commentId?: string }; quotedText?: string };
  replies: Reply[];
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

test.describe("J214 explain inside a thread", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j214-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
    await waitFor(async () => {
      const anns = await annotations(svc!, reviewId);
      const q = anns.find((a) => a.openQuestion);
      const ai = anns.find((a) => a.replies.some((r) => (r as { suggested?: boolean }).suggested === true));
      return q && ai ? { q, ai } : null;
    });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("guide: explain inside a thread appends a reply in the same thread", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    const anns = await annotations(svc, reviewId);
    const q = anns.find((a) => a.openQuestion);
    if (!q) throw new Error("no suggested question");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    const thread = page.locator(`section.ithread[data-thread="${q.id}"]`);
    if ((await thread.count()) === 0 || !(await thread.isVisible().catch(() => false))) {
      await page.locator("#C-problem .lk.cm[data-threads]").first().click();
    }
    await expect(thread).toBeVisible({ timeout: 15_000 });
    await expect(thread).toContainText("Suggested question");

    // Select text inside the thread's comment reply and Explain.
    const body = thread.locator('[data-reply][data-kind="comment"]').first();
    const word = await body.evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{4,}/)?.[0] ?? "folded");
    await selectText(page, `[data-thread="${q.id}"] [data-reply][data-kind="comment"]`, word);
    await page.locator('#selbar [data-act="explain"]').click();

    // No nested box: the same thread gains an Explain reply.
    await expect
      .poll(async () => (await annotations(svc!, reviewId)).find((a) => a.id === q.id)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBeGreaterThanOrEqual(2);
    const updated = (await annotations(svc!, reviewId)).find((a) => a.id === q.id)!;
    expect(updated.replies.some((r) => r.kind === "explain")).toBe(true);
    // Still one thread on the page for this anchor (flat, never nested).
    await expect(page.locator(`section.ithread[data-thread="${q.id}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-thread="${q.id}"] [data-expansion]`)).toHaveCount(0);
    await expect(thread.locator('[data-reply][data-kind="explain"] .exp-b')).not.toBeEmpty({ timeout: 60_000 });
  });

  test("diff: explain inside a suggested thread appends a reply there", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    const anns = await annotations(svc, reviewId);
    const ai = anns.find((a) => a.replies.some((r) => (r as { suggested?: boolean }).suggested === true));
    if (!ai) throw new Error("no suggested comment");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const thread = page.locator(`section.ithread[data-thread="${ai.id}"]`).first();
    await expect(thread).toBeVisible({ timeout: 60_000 });

    const body = thread.locator('[data-reply][data-kind="comment"]').first();
    const word = await body.evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{4,}/)?.[0] ?? "bare");
    await selectText(page, `[data-thread="${ai.id}"] [data-reply][data-kind="comment"]`, word);
    await page.locator('#selbar [data-act="explain"]').click();

    await expect
      .poll(async () => (await annotations(svc!, reviewId)).find((a) => a.id === ai.id)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBeGreaterThanOrEqual(2);
    const updated = (await annotations(svc!, reviewId)).find((a) => a.id === ai.id)!;
    expect(updated.replies.some((r) => r.kind === "explain")).toBe(true);
    await expect(page.locator(`section.ithread[data-thread="${ai.id}"]`)).toHaveCount(1);
  });
});
