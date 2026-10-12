/**
 * Real-service end-to-end (M1): build + start the actual service with a
 * temporary data dir, add a temporary git repo through the start page, open
 * a branch review in the UI, and verify the diff pane renders the real
 * snapshot, hunk state survives reload + service restart, and out-of-band
 * PATCHes (via curl) arrive over WS.
 *
 * Requires `mise run build` first (runs `packages/service/dist/index.js`).
 * Needs `git` and `curl` on PATH (macOS and Linux both ship them).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./network-guard.js";
import { startService, type RunningService } from "./service-harness.js";
import type { Page } from "@playwright/test";
import { fileKeyForPath } from "@unvibe/shared";

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

/** Scratch repo: main + a feature branch with a changed and a new file. */
async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-real-repo-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src", "app.py"), "def main():\n    return 1\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  writeFileSync(
    path.join(dir, "src", "app.py"),
    "def main():\n    return 2\n\n\ndef helper():\n    return 3\n",
  );
  writeFileSync(path.join(dir, "src", "util.py"), "VALUE = 42\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "feature work");
  return dir;
}

async function curlJson(
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

test.describe("real service", () => {
  let repoDir = "";
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    repoDir = await makeRepo();
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-real-data-"));
    svc = await startService(dataDir);
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function openFeatureReview(page: Page): Promise<{ reviewId: string; hash: string }> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
    // Repos are added in Settings; the start page follows the selector.
    // Wait for the repo state to settle: the selector or the empty state.
    await expect(
      page.locator('select[aria-label="Repo"], [data-testid="no-repos"]').first(),
    ).toBeVisible();
    if (await page.locator('[data-testid="no-repos"]').isVisible()) {
      await expect(page.locator('[data-testid="no-repos"]')).toBeVisible();
      await page.getByRole("link", { name: "Add one in Settings" }).click();
      await expect(page).toHaveURL(/\/settings\?tab=repositories/);
      await page.getByLabel("Add a repo by path").fill(repoDir);
      await page.getByRole("button", { name: "Add by path" }).click();
      await expect(page.locator('[data-testid^="repo-"]')).toContainText(path.basename(repoDir));
      await page.getByRole("link", { name: "Unvibe" }).click();
      await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
    }
    // The start page follows the selected repo: select the added checkout,
    // then open a review of the scratch branch.
    await page.getByLabel("Repo").selectOption({ label: `local/${path.basename(repoDir)}` });
    const feature = page.locator("main .ci button").filter({ hasText: "feature" }).first();
    await expect(feature).toBeVisible({ timeout: 30_000 });
    await feature.click();
    await page.waitForURL(/\/review\/rv_[0-9a-f]+/, { timeout: 60_000 });
    const reviewId = page.url().match(/\/review\/([^/?#]+)/)?.[1] ?? "";
    expect(reviewId).toMatch(/^rv_[0-9a-f]+$/);
    // The real snapshot renders: both changed files with hunks.
    const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;
    const utilFile = `[id="F-${fileKeyForPath("src/util.py")}"]`;
    await expect(page.locator(appFile)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(utilFile)).toBeVisible();
    await expect(page.locator(appFile).getByText("return 2")).toBeVisible();
    const snap = (await curlJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
      files: { path: string; hunks: { contentHash: string }[] }[];
    };
    const file = snap.files.find((f) => f.path === "src/app.py");
    expect(file).toBeDefined();
    return { reviewId, hash: file!.hunks[0].contentHash };
  }

  test("renders the real snapshot; hunk state survives reload and restart; WS patches arrive", async ({
    page,
  }) => {
    test.setTimeout(180_000);
      if (!svc) throw new Error("service not running");
      const { reviewId, hash } = await openFeatureReview(page);
      const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;

      // Mark the first hunk reviewed through the UI (PATCH + WS patch).
      await page.locator(appFile).getByRole("button", { name: "Mark reviewed" }).first().click();
      await expect(page.locator(appFile).getByText("changed lines folded · show")).toBeVisible();

      // State survives a page reload (durable ReviewStore).
      await page.reload();
      await expect(page.locator(appFile)).toBeVisible();
      await expect(page.locator(appFile).getByText("changed lines folded · show")).toBeVisible();

      // State survives a service restart (SQLite, same data dir).
      await svc.stop();
      svc = await startService(dataDir);
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator(appFile)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(appFile).getByText("changed lines folded · show")).toBeVisible();

    // Out-of-band change through curl arrives over WS with no reload.
    await curlJson(svc.origin, svc.token, "PATCH", `/api/reviews/${reviewId}/hunks/${hash}`, {
      reviewed: false,
      folded: false,
    });
    await expect(page.locator(appFile).getByText("changed lines folded · show")).toHaveCount(0);
    await expect(page.locator(appFile).getByText("return 2")).toBeVisible();
  });

  test("settings rejects a bad repo URL inline and removes a path checkout without touching it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("service not running");
    // Client-side verdict first: no request, no toast, control stays live.
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
    const section = page.locator('[data-testid="repositories-section"]');
    await section.getByLabel("Add a repo by URL").fill("not a repo!!!");
    await section.getByRole("button", { name: "Clone and add" }).click();
    await expect(section.getByText(/not a GitHub repo URL or owner\/name/)).toBeVisible();

    // A second scratch checkout, added through the API, removed through
    // the Settings UI: the row goes, the folder stays.
    const extraDir = await makeRepo();
    const base = path.basename(extraDir);
    try {
      await curlJson(svc.origin, svc.token, "POST", "/api/repos", { path: extraDir });
      await page.reload();
      await expect(section.locator('[data-testid^="repo-"]', { hasText: base }).first()).toBeVisible();
      const row = section.locator('[data-testid^="repo-"]', { hasText: base }).first();
      await row.getByRole("button", { name: `Remove local/${base}` }).click();
      await expect(row).toContainText("Remove this repo from the list? ");
      await expect(row).toContainText("is not touched.");
      await row.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(row).toHaveCount(0);
      const listed = (await curlJson(svc.origin, svc.token, "GET", "/api/repos")) as {
        repos: { localPath: string }[];
      };
      expect(listed.repos.some((r) => r.localPath === extraDir)).toBe(false);
      // Forgotten, not deleted: the checkout is intact on disk.
      expect(existsSync(path.join(extraDir, ".git"))).toBe(true);
    } finally {
      rmSync(extraDir, { recursive: true, force: true });
    }
  });
});
