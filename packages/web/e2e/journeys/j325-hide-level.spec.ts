/** J325 (#325): hide-level selector — real service, seeded demo.
 *
 * The seeded snapshot gets deterministic hunk scores written straight
 * into its hunk states (what the hunk pass would store), so the levels
 * are exercised without an agent. Asserts: the levels and their
 * visible hunks, the hidden-count tooltip, persistence across reload,
 * guide-cited and individually unhidden hunks staying visible, and
 * the old score filter buttons being gone.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { apiJson, createSeededDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });

const CONN = "src-urllib3-connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";

const SCORES: Record<string, string> = {
  "src/urllib3/connection.py:0": "substantive",
  "src/urllib3/connection.py:1": "substantive",
  "test/test_connection.py:0": "mechanical",
  "test/test_connection.py:1": "mechanical",
  "test/test_connection.py:2": "routine",
  "test/with_dummyserver/test_socketlevel.py:0": "mechanical",
  "test/with_dummyserver/test_socketlevel.py:1": "substantive",
  "changelog/1362.bugfix.rst:0": "routine",
};

function seedScores(dataDir: string, reviewId: string): void {
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    const row = db.prepare("SELECT snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as { snapshot: string };
    const snap = JSON.parse(row.snapshot) as {
      files: { path: string; hunks: { contentHash: string }[] }[];
      hunkStates: { contentHash: string; score?: string }[];
    };
    const byHash = new Map(snap.hunkStates.map((s) => [s.contentHash, s]));
    for (const f of snap.files) {
      f.hunks.forEach((h, i) => {
        const score = SCORES[`${f.path}:${i}`];
        const entry = byHash.get(h.contentHash) ?? { contentHash: h.contentHash };
        entry.score = score;
        byHash.set(h.contentHash, entry);
      });
    }
    snap.hunkStates = [...byHash.values()];
    db.prepare("UPDATE review_snapshots SET snapshot = ? WHERE review_id = ?").run(JSON.stringify(snap), reviewId);
  } finally {
    db.close();
  }
}

/** Scroll the diff pane through every file so lazy sections mount. */
async function revealAll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const pane = document.querySelector("#right");
    if (!pane) return;
    for (let y = 0; y <= pane.scrollHeight; y += 500) {
      pane.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    pane.scrollTo(0, 0);
  });
}

/** Click one category row; the stored level lands on `expected`. */
async function clickCategory(page: Page, category: string, expected: string): Promise<void> {
  await page.getByRole("button", { name: /Hide level:/ }).click();
  await page.locator(`[data-hidecat="${category}"]`).click();
  await expect(page.locator(`[data-hidelevel-current="${expected}"]`)).toBeVisible();
}

test.describe("J325 hide-level selector", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j325-data-"));
    reviewId = createSeededDemoReview(dataDir, "j325-seed");
    seedScores(dataDir, reviewId);
    svc = await startService(dataDir, { agent: "none" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("levels, tooltip, persistence, cited and unhidden hunks", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator(`[id="F-${CONN}"]`)).toBeVisible({ timeout: 30_000 });

    // Default: Hide uninteresting, with the live breakdown tooltip.
    const selector = page.getByRole("button", { name: /Hide level:/ });
    await expect(page.locator('[data-hidelevel-current="uninteresting"]')).toBeVisible();
    await expect(selector).toHaveAttribute("data-tip", "Hiding 3 of 8 hunks: 3 uninteresting");
    await revealAll(page);
    await expect(page.locator("button.hid")).toHaveCount(2);
    await expect(page.locator("[data-scorepick]")).toHaveCount(0);
    await expect(page.locator('.dhunk-h .score-ind[data-score="substantive"]').first()).toBeVisible();

    // The menu is the category list: only Uninteresting starts hidden
    // (greyed, eye-off); clicking the shown Routine row hides it and
    // everything above it, landing on the substantive threshold.
    await page.getByRole("button", { name: /Hide level:/ }).click();
    const menu = page.getByRole("menu", { name: "Hunk categories" });
    await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(5);
    await expect(page.locator('[data-hidecat="uninteresting"]')).toHaveAttribute("data-hidden", "true");
    await expect(page.locator('[data-hidecat="uninteresting"]')).toHaveAttribute("aria-checked", "false");
    await expect(page.locator('[data-hidecat="uninteresting"] .cnt')).toHaveText("3");
    await expect(page.locator('[data-hidecat="routine"]')).toHaveAttribute("data-hidden", "false");
    await page.locator('[data-hidecat="routine"]').click();
    await expect(page.locator('[data-hidelevel-current="substantive"]')).toBeVisible();
    await expect(selector).toHaveAttribute("data-tip", /^Hiding 5 of 8 hunks:/);
    await revealAll(page);
    await expect(page.locator("button.hid")).toHaveCount(3);
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    expect((snap.json as { viewPrefs: { hideLevel?: string } }).viewPrefs.hideLevel).toBe("substantive");

    // Persistence across reload.
    await page.reload();
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator('[data-hidelevel-current="substantive"]')).toBeVisible({ timeout: 30_000 });
    await revealAll(page);
    await expect(page.locator("button.hid")).toHaveCount(3);

    // Individually unhide the socket-level mechanical hunk, then go to
    // Needs attention: it stays visible. Guide-cited hunks no longer
    // stay visible (owner decision, #325): the cited connection hunk
    // hides like any other, and the tooltip drops "kept because cited".
    await page.locator(`[id="F-${TSOCK}"] button.hid`).first().click();
    await expect(page.locator(`[data-hunk="${TSOCK}:0"]`)).toBeVisible();
    // Clicking the shown Substantive row moves the threshold past it.
    await clickCategory(page, "substantive", "needs-attention");
    await expect(page.locator(`[data-hunk="${TSOCK}:0"]`)).toBeVisible();
    await expect(page.locator(`[data-hunk="${CONN}:0"]`)).toHaveCount(0);
    await expect(selector).toHaveAttribute("data-tip", /kept because shown/);
    await expect(selector).not.toHaveAttribute("data-tip", /kept because cited/);
    await expect(selector).toContainText("Hiding 7");

    // Clicking its guide citation reveals the hidden hunk through the
    // per-hunk unhide and scrolls to it.
    await page.locator('.lk[data-refs="diff:src-urllib3-connection.py:80-88"]').first().click();
    await expect(page.locator(`[data-hunk="${CONN}:0"]`)).toBeVisible({ timeout: 15_000 });

    // Clicking the most important hidden row (Substantive) shows it
    // again: the threshold moves down by one.
    await clickCategory(page, "substantive", "substantive");

    // Keyboard: open with ArrowDown, Home to the first row, Enter shows
    // Uninteresting and everything above nothing — the all level.
    await selector.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu", { name: "Hunk categories" })).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: /Uninteresting/ })).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-hidelevel-current="all"]')).toBeVisible();
    await expect(page.locator("button.hid")).toHaveCount(0);
    await expect(selector).toContainText("All shown");
  });
});
