/** J272 (#272): a fill that fails while its card is closed records the failure. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J272 closed-card failure is recorded", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j272-data-"));
    // Slow the replay stream so the follow-up is reliably mid-flight.
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
    });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("closed mid-answer, failed, reopened: banner and Retry, then a clean answer", async ({ page }) => {
    test.setTimeout(420_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Turn 1: Ask.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-problem .ui-card.child[data-expansion]", { hasText: "What is line folding?" }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
    const snap = (await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as {
      annotations?: { id: string; turns?: { question: string | null }[] }[];
    };
    const annotationId = (snap.annotations ?? []).find((a) => (a.turns ?? [])[0]?.question === "What is line folding?")?.id;
    if (!annotationId) throw new Error("ask card not found via API");

    // Turn 2: close the card while its answer fills, then kill mid-flight.
    const box = card.getByPlaceholder(/Ask a follow-up/);
    await expect(box).toBeVisible({ timeout: 15_000 });
    await box.fill("Does a cookie header change this?");
    await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
    const pending = card.locator(".ans").nth(1);
    await expect(pending.locator(".working")).toBeVisible({ timeout: 30_000 });
    // Kill only once the server-side turn is filling, so the restart
    // reliably marks it failed.
    await expect
      .poll(
        async () => {
          const s = (await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as {
            annotations?: { id: string; turns?: { question: string | null; working: string | null }[] }[];
          };
          const turns = (s.annotations ?? []).find((a) => a.id === annotationId)?.turns ?? [];
          return turns.some((t) => t.question === "Does a cookie header change this?" && t.working !== null);
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toBeHidden({ timeout: 15_000 });
    svc.killHard();
    await page.waitForTimeout(500);
    svc = await startService(dataDir, { agent: "replay" });

    // Reopen through the card's dotted mark: the failed turn shows the
    // banner with Retry — no stuck "Writing" indicator.
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
    await page.locator(`mark.anc.exl[data-jump="${annotationId}"]`).first().click();
    const after = page.locator("#C-problem .ui-card.child[data-expansion]", { hasText: "What is line folding?" }).first();
    await expect(after).toBeVisible({ timeout: 30_000 });
    const failed = after.locator(".ans").nth(1);
    await expect(failed.getByRole("alert")).toContainText("Couldn't get an answer", { timeout: 30_000 });
    await expect(after.locator(".working")).toHaveCount(0);
    await expect(failed.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 15_000 });

    // Retry gives a clean answer: no raw trailing block, no internal ids.
    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(failed.locator(".ctl")).toBeVisible({ timeout: 120_000 });
    const retried = after.locator(".exp-b").nth(1);
    await expect(retried).not.toBeEmpty({ timeout: 60_000 });
    await expect(retried).not.toContainText('{"contribute"');
    await expect(after).not.toContainText("no failed turn");
  });
});
