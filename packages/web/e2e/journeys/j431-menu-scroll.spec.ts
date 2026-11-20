/**
 * J431 — Timeline menu with many commits (#431).
 *
 * Newest first: the guide entry leads, then the Commits group with the
 * latest row first (disabled) down to the oldest. Each row shows the
 * sha (hunk-header treatment), the subject and a right-aligned relative
 * time with the exact timestamp as its tooltip. Guards: with the guide
 * a few commits back on a long list, the guide entry and the guide row
 * are visible on open without any scrolling; and a short list fits
 * whole. The menu keeps its single scroll.
 *
 * Boots: one replay service over a scratch repo (22 commits, the guide
 * lands at that head, then 3 more commits and a Pull) plus one
 * agent:none service over a two-commit scratch repo for the short list.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "path";
import { exactTime, shortAge, type ReviewCommit } from "@unvibe/shared";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createScratchReview, git } from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const V1 = [
  "def alpha():", "    return 1", "", "", "CONST_A = 10", "", "",
  "# divider one", "# divider two", "# divider three", "", "",
  "def beta():", "    return 2", "", "", "CONST_B = 20", "",
].join("\n");

async function initRepo(featureCommits: number): Promise<string> {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j431-repo-"));
  await git(repoDir, "init", "-b", "main");
  await git(repoDir, "config", "user.email", "t@example.com");
  await git(repoDir, "config", "user.name", "T");
  writeFileSync(path.join(repoDir, "src-app.py"), V1);
  await git(repoDir, "add", ".");
  await git(repoDir, "commit", "-m", "base");
  await git(repoDir, "checkout", "-b", "feature");
  for (let i = 0; i < featureCommits; i++) {
    writeFileSync(path.join(repoDir, "src-app.py"), `${V1}\n# filler ${i}\n`);
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", `feature piece ${i}`);
  }
  return repoDir;
}

async function waitForGuideCards(svc: RunningService, reviewId: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const pages = (snap.json as { pages?: { cards: unknown[] }[] }).pages ?? [];
    if (pages.some((p) => p.cards.length > 0)) return;
    if (Date.now() > deadline) throw new Error("guide cards did not appear on the scratch review");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function reviewCommits(svc: RunningService, reviewId: string): Promise<ReviewCommit[]> {
  const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  return (snap.json as { commits: ReviewCommit[] }).commits;
}

test.describe("J431 long commit list, guide a few back", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = await initRepo(22);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j431-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "j431long" });
    reviewId = await createScratchReview(svc, repoDir);
    await waitForGuideCards(svc, reviewId);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("guide entry and guide row visible on open; rows show sha, subject and time", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 60_000 });

    // Three commits past the guide, then Pull: 25 rows, newest first.
    for (let i = 22; i < 25; i++) {
      writeFileSync(path.join(repoDir, "src-app.py"), `${V1}\n# filler ${i}\n`);
      await git(repoDir, "add", "src-app.py");
      await git(repoDir, "commit", "-m", `feature piece ${i}`);
    }
    await page.locator("#reviewbar").getByRole("button", { name: "Pull new commits from GitHub", exact: true }).click();
    const menuBtn = page.locator('#reviewbar [data-testid="explain-menu-button"]');
    await expect(menuBtn).toHaveAttribute("aria-label", "3 new commits since the guide was written", { timeout: 60_000 });

    const listed = await reviewCommits(svc, reviewId);
    expect(listed).toHaveLength(25);
    const guide = listed[21];
    expect(guide.subject).toBe("feature piece 21");

    await menuBtn.click();
    const menu = page.getByTestId("explain-menu");
    await expect(menu).toBeVisible();
    // The menu keeps its single scroll and opens at the top: nothing
    // scrolled to bring the guide into view.
    expect(await menu.evaluate((el) => el.scrollTop)).toBe(0);

    // The guide entry and the guide row are visible on open, inside the
    // menu's visible area.
    const pinned = menu.locator("[data-explain-guide]");
    await expect(pinned).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    const pinnedBox = (await pinned.boundingBox())!;
    expect(pinnedBox.y).toBeGreaterThanOrEqual(menuBox.y - 1);
    expect(pinnedBox.y + pinnedBox.height).toBeLessThanOrEqual(menuBox.y + menuBox.height + 1);
    const guideRow = menu.locator(`[data-explain-commit="${guide.sha}"]`);
    await expect(guideRow).toBeVisible();
    const guideBox = (await guideRow.boundingBox())!;
    expect(guideBox.y).toBeGreaterThanOrEqual(menuBox.y - 1);
    expect(guideBox.y + guideBox.height).toBeLessThanOrEqual(menuBox.y + menuBox.height + 1);

    // Newest first: the head row leads (disabled, latest), the oldest
    // trails.
    const rows = menu.locator("[data-explain-commit]");
    await expect(rows).toHaveCount(25);
    const head = listed[listed.length - 1];
    await expect(rows.first()).toHaveAttribute("data-explain-commit", head.sha);
    await expect(rows.first()).toBeDisabled();
    await expect(rows.first()).toContainText("latest");
    await expect(rows.last()).toHaveAttribute("data-explain-commit", listed[0].sha);

    // Each row shows the sha, the subject and the relative time; the
    // time's tooltip is the exact timestamp.
    await expect(guideRow.locator(".revc")).toHaveText(guide.sha.slice(0, 8));
    await expect(guideRow).toContainText("feature piece 21");
    await expect(guideRow).toContainText("guide");
    const age = guideRow.locator(".cnt").last();
    await expect(age).toHaveText(shortAge(guide.committedAt));
    await expect(age).toHaveAttribute("data-tip", exactTime(guide.committedAt));
    await page.keyboard.press("Escape");
  });
});

test.describe("J431 short commit list", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = await initRepo(2);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j431s-data-"));
    svc = await startService(dataDir, { agent: "none", label: "j431short" });
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a short list fits whole: every row with its time is in view", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 60_000 });

    const menuBtn = page.locator('#reviewbar [data-testid="explain-menu-button"]');
    await expect(menuBtn).toBeVisible({ timeout: 30_000 });
    await menuBtn.click();
    const menu = page.getByTestId("explain-menu");
    await expect(menu).toBeVisible();
    // Nothing to scroll: the whole menu fits.
    const overflow = await menu.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeLessThanOrEqual(1);
    const menuBox = (await menu.boundingBox())!;
    const listed = await reviewCommits(svc, reviewId);
    expect(listed).toHaveLength(2);
    const rows = menu.locator("[data-explain-commit]");
    await expect(rows).toHaveCount(2);
    for (const c of listed) {
      const row = menu.locator(`[data-explain-commit="${c.sha}"]`);
      const box = (await row.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(menuBox.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(menuBox.y + menuBox.height + 1);
      await expect(row.locator(".revc")).toHaveText(c.sha.slice(0, 8));
      await expect(row.locator(".cnt").last()).toHaveText(shortAge(c.committedAt));
    }
    await page.keyboard.press("Escape");
  });
});
