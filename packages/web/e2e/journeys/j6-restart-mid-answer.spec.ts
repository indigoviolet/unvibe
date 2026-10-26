/** J6 (#188, reworked #273): restart mid-answer — SIGKILL, restart on same data dir. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J6 restart mid-answer", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j6-data-"));
    // Slow the replay stream so the answer is reliably mid-flight at the kill.
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

  test("killed mid-answer, restart reopens review with a recoverable thread", async ({ page }) => {
    test.setTimeout(420_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const exp = page.locator('#C-central section.ithread[data-thread]').first();
    await expect(exp).toBeVisible({ timeout: 15_000 });

    // #203 + #204: while the reply is being written the pinned thread
    // shows only its header and the writing state — no per-reply toolbar,
    // no follow-up box — and it is not floating.
    await expect(exp).not.toHaveClass(/floating/);
    await expect(exp.locator(".working")).toBeVisible({ timeout: 10_000 });
    await expect(exp.locator(".ctl")).toHaveCount(0);
    await expect(exp.getByPlaceholder(/Ask a follow-up/)).toHaveCount(0);
    await expect(exp.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);

    // Hard kill mid-stream, then restart on the same data dir.
    svc.killHard();
    await page.waitForTimeout(500);
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
    });

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 60_000 });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    // The interrupted thread is completed, resumable, or clearly marked — never silently empty forever.
    const expAfter = page.locator('#C-central section.ithread[data-thread]').first();
    if ((await expAfter.count()) > 0) {
      await expect
        .poll(
          async () => {
            const text = await expAfter.innerText().catch(() => "");
            return text.trim().length > 0;
          },
          { timeout: 60_000 },
        )
        .toBe(true);
    }
    // #204/#203 after the restart: the thread is still pinned inline, and
    // while its reply is being written again it shows no toolbar or
    // follow-up box.
    if ((await expAfter.count()) > 0) {
      await expect(expAfter).not.toHaveClass(/floating/, { timeout: 30_000 });
      if ((await expAfter.locator(".working").count()) > 0) {
        await expect(expAfter.locator(".ctl")).toHaveCount(0);
        await expect(expAfter.getByPlaceholder(/Ask a follow-up/)).toHaveCount(0);
      }
    }

    // Second restart is a no-op: review still opens, nothing duplicated.
    // (Fast replay this time, so the recovered reply can settle.)
    await svc.stop();
    svc = await startService(dataDir, { agent: "replay" });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
    const settled = page.locator('#C-central section.ithread[data-thread]').first();
    await expect(settled).not.toHaveClass(/floating/, { timeout: 30_000 });
    // The recovered reply either completes (toolbar + follow-up box back,
    // #203) or fails with Retry (and still no toolbar/follow-up box).
    let outcome = "waiting";
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline && outcome === "waiting") {
      if ((await settled.getByRole("button", { name: "Retry" }).count()) > 0) outcome = "retry";
      else if ((await settled.locator(".ctl").count()) > 0) outcome = "ready";
      else await page.waitForTimeout(500);
    }
    expect(outcome, "recovered thread neither completed nor showed Retry").not.toBe("waiting");
    if (outcome === "retry") {
      await expect(settled.locator(".ctl")).toHaveCount(0);
      await expect(settled.getByPlaceholder(/Ask a follow-up/)).toHaveCount(0);
      // Retry is the way forward: it refills the reply, and then the
      // toolbar and follow-up box appear.
      await settled.getByRole("button", { name: "Retry" }).click();
      await expect(settled.locator(".ctl").first()).toBeVisible({ timeout: 120_000 });
      await expect(settled.getByPlaceholder(/Ask a follow-up/)).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(settled.getByPlaceholder(/Ask a follow-up/)).toBeVisible({ timeout: 30_000 });
    }
  });
});
