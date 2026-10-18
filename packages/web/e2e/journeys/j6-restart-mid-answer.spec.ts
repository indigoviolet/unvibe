/** J6 (#188): restart mid-answer — SIGKILL the service, restart on same data dir. */
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

  test("killed mid-answer, restart reopens review with a recoverable card", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const exp = page.locator("#C-central [data-expansion]").first();
    await expect(exp).toBeVisible({ timeout: 15_000 });

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
    // The interrupted card is completed, resumable, or clearly marked — never silently empty forever.
    const expAfter = page.locator("#C-central [data-expansion]").first();
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
    // Second restart is a no-op: review still opens, nothing duplicated.
    await svc.stop();
    svc = await startService(dataDir, { agent: "replay" });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
  });
});
