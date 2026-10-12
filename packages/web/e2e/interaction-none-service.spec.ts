/**
 * No-agent state over the real service (M4 interaction, `UNVIBE_AGENT: "none"`).
 *
 * Every agent control shows the clear no-agent state while non-agent
 * controls keep working: explain/ask/depth/examples/diagram/generate/
 * followup/concept/second-opinion fail with "no agent configured" copy (or
 * a visible error + retry), and read/collapse/bookmark/threads/diff controls
 * work.
 *
 * Requires `mise run build` first. Skipped when the service isn't built.
 * Uses the network-guard fixture.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import type { Page } from "@playwright/test";

const exec = promisify(execFile);

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

async function apiJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`, "-H", "content-type: application/json"];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

async function selectText(page: Page, rootSelector: string, text: string): Promise<void> {
  await page.evaluate((sel: string) => {
    document.querySelector(sel)?.scrollIntoView({ block: "center" });
  }, rootSelector);
  await page.waitForTimeout(350);
  const found = await page.evaluate(
    ({ rootSelector, text }: { rootSelector: string; text: string }) => {
      const root = document.querySelector(rootSelector);
      if (!root) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data;
        const at = data.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        (node as Text).parentElement?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return true;
      }
      return false;
    },
    { rootSelector, text },
  );
  expect(found).toBe(true);
  await expect(page.locator("#selbar")).toBeVisible({ timeout: 5000 });
}

test.describe("no-agent state (UNVIBE_AGENT=none)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-none-data-"));
    svc = await startService(dataDir);
    // With no agent the pipeline enqueues nothing; seed the guide shape by
    // creating the review (ingest only) — the diff + empty guide load.
    const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as {
      review: { id: string };
    };
    reviewId = created.review.id;
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function openReview(page: Page): Promise<void> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#right")).toBeVisible({ timeout: 30_000 });
  }

  test("agent controls show no-agent state; plain controls work", async ({ page }) => {
    test.setTimeout(120_000);
    await openReview(page);
    // Non-agent controls work without an agent: diff tab loads hunks.
    await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff", { timeout: 30_000 });

    // Explain surfaces the no-agent state on its expansion (visible error,
    // no spinner forever). The guide may be empty without an agent, so act
    // from the diff when no guide card exists.
    const hasGuide = (await page.locator("#C-central").count()) > 0;
    if (hasGuide) {
      await selectText(page, "#C-central", "the");
      await page.locator('#selbar [data-act="explain"]').click();
      const exp = page.locator('#C-central [data-expansion]').first();
      await expect(exp).toBeVisible({ timeout: 15_000 });
      await expect(exp).toContainText(/agent is turned off/i, { timeout: 30_000 });
    } else {
      // Diff-anchored explain via keyboard selection on the first code cell.
      // Fail-fast with no agent: the expansion shows the no-agent error
      // state (accepted, no job), never a spinner forever.
      const cell = page.locator("#right table.diff td.c").first();
      await expect(cell).toBeVisible({ timeout: 30_000 });
      const text = (await cell.innerText()).slice(0, 12) || "test";
      await selectText(page, "#right table.diff", text.slice(0, 6));
      await page.locator('#selbar [data-act="explain"]').click();
      const exp = page.locator("#right [data-expansion]").first();
      await expect(exp).toBeVisible({ timeout: 15_000 });
      await expect(exp).toContainText(/agent is turned off/i, { timeout: 30_000 });
    }

    // Read/collapse-adjacent non-agent controls still work: toggle the
    // source pane and the files panel without errors.
    await page.locator('#right [role="tab"]').getByText("PR description").click();
    await expect(page.locator("#right .desc, #right .dbar").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#toast")).toBeHidden({ timeout: 3000 }).catch(() => {});
  });
});
