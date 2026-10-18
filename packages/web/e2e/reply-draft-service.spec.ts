/**
 * Reply-box drafts over the real service (replay): sending a follow-up
 * clears the stored draft, so after a reload the box is still empty and
 * both answers are intact — no resurrected draft.
 *
 * Built service + temp data dir + the `demo` review (`UNVIBE_AGENT:
 * "replay"`). Requires `mise run build` first. Skipped when the service
 * isn't built.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { cpuThrottleFromEnv } from "./cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import { selectText } from "./select-text.js";

const exec = promisify(execFile);

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

async function apiJson(
  origin: string,
  token: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<unknown> {
  const args = [
    "-s",
    "-X",
    method,
    `${origin}${urlPath}`,
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "content-type: application/json",
  ];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });
test.describe("reply drafts over the real service", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-draft-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as {
      review: { id: string };
    };
    reviewId = created.review.id;
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
        pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
      };
      const root = snap.pages.find((p) => p.id === "root");
      const ready =
        root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0) &&
        root?.cards.some((c) => c.id === "central" && c.blocks.length > 0);
      if (ready) break;
      if (Date.now() > deadline) throw new Error("guide did not fill in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function openReview(page: Page): Promise<void> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText(
      "Unfold obsolete folded response headers",
      { timeout: 30_000 },
    );
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  }

  test("a sent follow-up stays sent across a reload", async ({ page }) => {
    test.setTimeout(120_000);
    await openReview(page);
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-central .ithread[data-pending-thread]");
    await expect(composer).toBeVisible();
    await composer.locator("textarea").fill("Does the fast path still catch a fold that uses a bare LF?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-central .card.child[data-expansion]", {
      hasText: "Does the fast path still catch a fold",
    });
    await expect(card.first()).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 30_000 });

    // The follow-up matches the bare-LF recording, so it fills with
    // blocks; the box empties on send and stays empty.
    const box = card.locator("textarea");
    await box.fill("And a bare LF?");
    await card.getByRole("button", { name: "Reply" }).click();
    await expect(box).toHaveValue("", { timeout: 5000 });
    await expect(card.locator(".ans").nth(1)).toContainText("bare LF", { timeout: 30_000 });
    await expect(box).toHaveValue("");

    // Across a reload: no resurrected draft, both answers intact (the
    // stored draft cleared with the turn).
    await page.reload();
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete", { timeout: 30_000 });
    const again = page.locator("#C-central .card.child[data-expansion]", {
      hasText: "Does the fast path still catch a fold",
    });
    await expect(again.first()).toBeVisible({ timeout: 30_000 });
    await expect(again.locator(".ans").nth(1)).toContainText("bare LF", { timeout: 30_000 });
    await expect(again.locator("textarea")).toHaveValue("");
  });
});
