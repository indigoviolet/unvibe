/** J271 (#271): the follow-up box stays while an answer is pending. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J271 pending follow-up keeps its input", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j271-data-"));
    // Slow the replay stream so the follow-up is reliably still pending
    // while the test types into its box.
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

  test("input stays while pending, sends the kept draft once the answer lands", async ({ page }) => {
    test.setTimeout(420_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Reply 1: Ask.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });

    // Reply 2: while it is pending, the indicator carries the plain
    // label (no stacked ellipsis) and the box stays: editable, with
    // Send disabled and the reason as its tooltip.
    const box = card.getByPlaceholder(/Ask a follow-up/);
    await expect(box).toBeVisible({ timeout: 15_000 });
    await box.fill("Does a cookie header change this?");
    await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
    const pending = card.locator("[data-reply]").nth(1);
    await expect(pending.locator(".working")).toBeVisible({ timeout: 30_000 });
    await expect(pending.locator(".working")).toHaveText("Writing answer");
    const draft = card.getByPlaceholder(/Ask a follow-up/);
    await expect(draft).toBeVisible();
    await draft.fill("What about ordering?");
    await expect(draft).toHaveValue("What about ordering?");
    const send = card.getByRole("button", { name: "Ask" }).last();
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute("data-tip", "Wait for the answer");
    // The pending turn has no toolbar of its own.
    await expect(pending.locator(".ctl")).toHaveCount(0);

    // Once the answer lands, the kept draft sends as the next turn.
    await expect(pending.locator(".ctl")).toBeVisible({ timeout: 120_000 });
    await expect(send).toBeEnabled({ timeout: 30_000 });
    await send.click();
    const third = card.locator("[data-reply]").nth(2);
    await expect(third).toContainText("What about ordering?", { timeout: 60_000 });
    await expect(card.locator(".exp-b").nth(2)).not.toBeEmpty({ timeout: 60_000 });
  });

  test("a draft typed while pending survives a failure and its retry", async ({ page }) => {
    test.setTimeout(420_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Its own Ask card (independent of the first test's card).
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-central .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("Does the fast path still catch a fold?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-central section.ithread[data-thread]", { hasText: "Does the fast path still catch a fold" }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });

    // A follow-up whose answer is killed mid-flight; the next question
    // is already typed while the answer is pending.
    const box = card.getByPlaceholder(/Ask a follow-up/);
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.fill("And a bare LF?");
    await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
    const pending = card.locator("[data-reply]").last();
    await expect(pending.locator(".working")).toBeVisible({ timeout: 30_000 });
    const draft = card.getByPlaceholder(/Ask a follow-up/);
    await expect(draft).toBeVisible();
    await draft.fill("One more thing about folds?");
    // The client shows working at once; kill only once the server-side
    // turn is filling AND the typed draft has reached the server (the
    // box debounces its persist), so the restart reliably marks the
    // turn failed with the draft stored.
    await expect
      .poll(
        async () => {
          const snap = (await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as {
            annotations?: {
              reply?: string;
              replies?: { question: string | null; working: string | null }[];
            }[];
          };
          const anns = snap.annotations ?? [];
          const filling = anns
            .flatMap((a) => a.replies ?? [])
            .some((t) => t.question === "And a bare LF?" && t.working !== null);
          const drafted = anns.some((a) => (a as { followupDraft?: string }).followupDraft === "One more thing about folds?");
          return filling && drafted;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    svc.killHard();
    await page.waitForTimeout(500);
    svc = await startService(dataDir, { agent: "replay" });

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
    const after = page.locator("#C-central section.ithread[data-thread]", { hasText: "Does the fast path still catch a fold" }).first();
    await expect(after).toBeVisible({ timeout: 30_000 });
    // Failed: the banner with Retry governs, and the box stays hidden.
    const failed = after.locator("[data-reply]").last();
    await expect(failed.getByRole("alert")).toContainText("Couldn't get an answer", { timeout: 30_000 });
    await expect(after.getByPlaceholder(/Ask a follow-up/)).toHaveCount(0);
    // Retry lands the answer; the box comes back with the kept draft.
    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(failed.locator(".ctl")).toBeVisible({ timeout: 120_000 });
    const kept = after.getByPlaceholder(/Ask a follow-up/);
    await expect(kept).toBeVisible({ timeout: 30_000 });
    await expect(kept).toHaveValue("One more thing about folds?", { timeout: 30_000 });
  });
});
