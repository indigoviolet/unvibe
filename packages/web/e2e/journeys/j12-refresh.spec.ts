/** J12 (#188 round 2): refresh a review after new commits — real git, no agent. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { fileKeyForPath } from "@unvibe/shared";
import { apiJson, createScratchReview, git } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const V1 = [
  "def alpha():", "    return 1", "", "", "CONST_A = 10", "", "",
  "# divider one", "# divider two", "# divider three", "", "",
  "def beta():", "    return 2", "", "", "CONST_B = 20", "",
].join("\n");

test.describe("J12 refresh with new commits", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src-app.py");
  const appFile = `[id="F-${appKey}"]`;

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j12-repo-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "src-app.py"), V1);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 11").replace("    return 2", "    return 22"));
    writeFileSync(path.join(repoDir, "c.py"), "C = 1\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j12-data-"));
    svc = await startService(dataDir, { agent: "none" });
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("refresh banners counts, reviewed clears only on the changed hunk, old version read-only", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });

    // Mark both hunks reviewed through the API (arrives over WS).
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const files = (snap.json as { files: { path: string; hunks: { contentHash: string; lines: { text: string }[] }[] }[] }).files;
    const app = files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) {
      await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });
    }
    await expect(page.locator(appFile).locator(".revc")).toContainText("2/2", { timeout: 30_000 });

    // One new commit touching only the alpha hunk.
    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 111").replace("    return 2", "    return 22"));
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");

    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const banner = page.locator('[data-testid="stale-banner"]');
    await expect(banner).toContainText(/1 changed/, { timeout: 60_000 });
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2", { timeout: 30_000 });
    await expect(page.locator(appFile).getByText("return 111")).toBeVisible({ timeout: 30_000 });

    // Older version: pre-refresh code, no description editing.
    await page.locator("#version-pick").selectOption("1");
    await expect(page).toHaveURL(/version=1/);
    await expect(page.locator(appFile).getByText(/return 11\b/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="stale-banner"]')).toHaveCount(0, { timeout: 15_000 });
  });
});
