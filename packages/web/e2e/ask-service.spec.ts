/**
 * Ask over the real service (#136 slice 2: Ask makes the same card).
 *
 * Built service + temp data dir + the `demo` review (`UNVIBE_AGENT:
 * "replay"`, so no live agents and no git needed). Covers:
 * - select guide text → Ask → working card → streamed agent answer
 *   stored as blocks with citation markers (the `ask` action through the
 *   patch path, replacing the old 60 s client-only fallback);
 * - a diagram in an Ask answer renders through the diagrams route (#106).
 *
 * Requires `mise run build` first. Skipped when the service isn't built.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { selectText } from "./select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";

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

test.describe("ask over the real service", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-ask-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as {
      review: { id: string };
    };
    reviewId = created.review.id;
    // Wait for the guide: root problem + central cards with content.
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

  test("ask answers with citations through the streamed patch path", async ({ page }) => {
    test.setTimeout(120_000);
    await openReview(page);
    // Record transient processing UI: the working indicator renders only
    // while the job runs (the replay backend answers in ~a second, faster
    // than an assertion round trip), so observe the DOM continuously from
    // before the Ask click. Streamed agent text must never render (issue
    // #46): the indicator carries a fixed label only.
    await page.evaluate(() => {
      (window as unknown as { __m4seen?: { working: boolean; stream: boolean } }).__m4seen = {
        working: false,
        stream: false,
      };
      const root = document.querySelector("#C-central");
      if (!root) return;
      new MutationObserver(() => {
        const seen = (window as unknown as { __m4seen: { working: boolean; stream: boolean } }).__m4seen;
        if (root.querySelector(".ui-card.child .working")) seen.working = true;
        if (root.querySelector(".ui-card.child .stream")) seen.stream = true;
      }).observe(root, { childList: true, subtree: true, characterData: true });
    });
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-central .ithread[data-pending-thread]");
    await expect(composer).toBeVisible();
    await composer.locator("textarea").fill("Does the fast path still catch a fold that uses a bare LF?");
    await composer.getByRole("button", { name: "Ask" }).click();
    // The card carries the question; the agent answer arrives as blocks
    // with a citation marker whose refs point at the diff (never the
    // 60 s waiting fallback, never raw thread HTML).
    const card = page.locator("#C-central .ui-card.child[data-expansion]", {
      hasText: "Does the fast path still catch a fold",
    });
    // Card-creation patch latency stretches under parallel-suite load
    // (same race as the comments-service specs); the answer below is the
    // stable signal.
    await expect(card.first()).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".ans-q").first()).toContainText("Does the fast path still catch a fold", {
      timeout: 30_000,
    });
    const marker = card.locator(".lk[data-refs]");
    await expect(marker.first()).toBeVisible({ timeout: 30_000 });
    await expect(marker.first()).toHaveAttribute("data-refs", /diff:/);
    await expect(card.locator(".working")).toHaveCount(0);
    // And the working state really rendered mid-flight, with no streamed
    // agent text anywhere (issue #46).
    const seen = await page.evaluate(
      () => (window as unknown as { __m4seen?: { working: boolean; stream: boolean } }).__m4seen,
    );
    expect(seen?.working).toBe(true);
    expect(seen?.stream).toBe(false);
  });
});
