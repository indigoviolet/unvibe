/**
 * Explain inside an explanation (#116) over the real service (replay agent).
 *
 * Select text in a card → Explain → the parent expansion fills; select
 * text inside the parent → the toolbar appears → Explain → a nested
 * explanation appears under the parent block; reload → both are still
 * there and the nested anchor highlight returns.
 *
 * Requires `mise run build` first. Skipped when the service isn't built.
 * Uses the network-guard fixture (no non-local requests, no CSP errors).
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

/** Select `text` under `rootSelector` and wait for the toolbar. */
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

/** First word (≥4 letters) of the parent expansion body, for nesting into. */
async function firstBodyWord(page: Page, expSelector: string): Promise<string> {
  const word = await page.evaluate((sel: string) => {
    const exp = document.querySelector(sel);
    const text = exp?.querySelector(".exp-b")?.textContent ?? "";
    const m = text.match(/[A-Za-z]{4,}/);
    return m ? m[0] : "";
  }, expSelector);
  expect(word).not.toBe("");
  return word;
}

test.describe("explain inside an explanation (replay)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-nesting-data-"));
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
      if (root?.cards.some((c) => c.id === "central" && c.blocks.length > 0)) break;
      if (Date.now() > deadline) throw new Error("guide did not fill in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("select-inside-expansion → nested explanation → reload keeps it", async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    if (!svc) throw new Error("service not running");

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 30_000,
    });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Parent explanation on card text.
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const parent = page.locator("#C-central [data-expansion]").first();
    await expect(parent).toBeVisible({ timeout: 15_000 });
    await expect(parent.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

    // The toolbar appears for text selected inside the parent…
    const word = await firstBodyWord(page, "#C-central [data-expansion]");
    await selectText(page, "#C-central [data-expansion] .exp-b", word);
    // …and Explain nests a card under the parent block.
    await page.locator('#selbar [data-act="explain"]').click();
    const nested = parent.locator("[data-expansion]").first();
    await expect(nested).toBeVisible({ timeout: 15_000 });
    await expect(nested.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

    // Reload: both cards survive and the nested highlight returns.
    await page.reload();
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    const parentAfter = page.locator("#C-central [data-expansion]").first();
    await expect(parentAfter).toBeVisible({ timeout: 15_000 });
    const nestedAfter = parentAfter.locator("[data-expansion]").first();
    await expect(nestedAfter).toBeVisible({ timeout: 15_000 });
    await expect(nestedAfter.locator(".exp-b")).not.toBeEmpty({ timeout: 30_000 });
    await expect(parentAfter.locator("mark.anc.ex").first()).toBeVisible({ timeout: 10_000 });

    expect(errors).toEqual([]);
  });
});
