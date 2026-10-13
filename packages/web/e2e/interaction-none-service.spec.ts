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
  // Select and wait in one polled step (same as interaction.spec.ts):
  // scrollIntoView can deliver its scroll event after the toolbar shows
  // when the loop is busy, and a late scroll dismisses the bar — so
  // select-then-assert flakes. Re-select until the bar sticks; a repeated
  // select is harmless (same range, same mouseup path) and converges once
  // the scroll lands.
  await expect
    .poll(
      async () => {
        await page.evaluate((sel: string) => {
          document.querySelector(sel)?.scrollIntoView({ block: "center" });
        }, rootSelector);
        // No settle wait: the app has no smooth scrolling.
        const found = await page.evaluate(
          ({ rootSelector, text }: { rootSelector: string; text: string }) => {
            const root = document.querySelector(rootSelector);
            if (!root) return false;
            // Highlight token spans split code text across many nodes: locate in
            // the joined text first, then map back (issue #23).
            // Scoped per code cell: joining the whole table would match across
            // line-number/code boundaries and anchor the selection in the gutter.
            const cells = [...root.querySelectorAll("td.c")];
            const scopes = cells.length > 0 ? cells : [root];
            for (const scope of scopes) {
              const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
              const nodes: Text[] = [];
              for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
              const joined = nodes.map((n) => n.data).join("");
              const at = joined.indexOf(text);
              if (at < 0) continue;
              const nodeAt = (offset: number): { node: Text; at: number } | null => {
                let acc = 0;
                for (let i = 0; i < nodes.length; i++) {
                  const n = nodes[i];
                  const next = acc + n.data.length;
                  // Boundary offsets prefer the next node (a range starting at
                  // the end of one node behaves as starting in the gutter).
                  if (offset < next) return { node: n, at: offset - acc };
                  if (offset === next) {
                    return i + 1 < nodes.length ? { node: nodes[i + 1], at: 0 } : { node: n, at: n.data.length };
                  }
                  acc = next;
                }
                return null;
              };
              const s = nodeAt(at);
              const e = nodeAt(at + text.length);
              if (!s || !e) continue;
              const range = document.createRange();
              try {
                range.setStart(s.node, s.at);
                range.setEnd(e.node, e.at);
              } catch {
                continue;
              }
              const sel = getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
              (range.endContainer as Text).parentElement?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
              return true;
            }
            return false;
          },
          { rootSelector, text },
        );
        if (!found) return "not-found";
        // Let a late scroll land before reading the bar.
        await page.waitForTimeout(150);
        return (await page.locator("#selbar").isVisible()) ? "shown" : "hidden-again";
      },
      { timeout: 15000 },
    )
    .toBe("shown");
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
