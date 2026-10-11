/**
 * Settings + versions against the real service (M8):
 * - limits persist across reload; service validation errors show inline;
 * - prompts list every template with a per-review expansion;
 * - versions: branch review, mark reviewed, add a commit + amend another,
 *   refresh → banner with correct counts, reviewed cleared only on the
 *   changed hunk, older version viewable read-only.
 *
 * Pattern copied from `real-service.spec.ts`: built service
 * (`mise run build` first), temp data dir, temp git repo, no agent.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const APP_V1 = [
  "def alpha():",
  "    return 1",
  "",
  "",
  "CONST_A = 10",
  "",
  "",
  "# divider one",
  "# divider two",
  "# divider three",
  "",
  "",
  "def beta():",
  "    return 2",
  "",
  "",
  "CONST_B = 20",
  "",
].join("\n");

/** Scratch repo: main + feature with two separate hunks + a new file. */
async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-m8-repo-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  writeFileSync(path.join(dir, "src-app.py"), APP_V1);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  const v2 = APP_V1.replace("    return 1", "    return 11").replace("    return 2", "    return 22");
  writeFileSync(path.join(dir, "src-app.py"), v2);
  writeFileSync(path.join(dir, "c.py"), "C = 1\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "feature work");
  return dir;
}

async function curlJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`];
  if (body !== undefined) args.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

interface HunkRef {
  contentHash: string;
  lines: { text: string }[];
}

test.describe("settings + versions on the real service", () => {
  let repoDir = "";
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = await makeRepo();
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-m8-data-"));
    svc = await startService(dataDir);
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function openFeatureReview(page: Page): Promise<string> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
    await page.getByLabel("Add a repo by path").fill(repoDir);
    await page.getByRole("button", { name: "Add by path" }).click();
    await expect(page.getByText(`local/${path.basename(repoDir)}`).first()).toBeVisible();
    await page.locator("#new-review .ci button").filter({ hasText: "feature" }).first().click();
    await page.waitForURL(/\/review\/rv_[0-9a-f]+/, { timeout: 60_000 });
    const id = page.url().match(/\/review\/([^/?#]+)/)?.[1] ?? "";
    expect(id).toMatch(/^rv_[0-9a-f]+$/);
    const appFile = `[id="F-${fileKeyForPath("src-app.py")}"]`;
    await expect(page.locator(appFile)).toBeVisible({ timeout: 30_000 });
    return id;
  }

  test("limits persist across reload; validation errors show inline", async ({ page }) => {
    test.setTimeout(120_000);
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByText("Models, prompts, limits, jobs, shared context")).toBeVisible();

    const input = page.locator("#limit-sessionsPerProvider");
    await input.fill("99");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("sessionsPerProvider must be an integer in [1, 32]")).toBeVisible();

    await input.fill("5");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Models, prompts, limits, jobs, shared context")).toBeVisible();
    await expect(page.locator("#limit-sessionsPerProvider")).toHaveValue("5");
  });

  test("prompts list all templates with an expansion for the review", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("service not running");
    reviewId = await openFeatureReview(page);
    await page.goto(`${svc.origin}/settings?review=${reviewId}&token=${svc.token}`);
    await expect(page.getByText("Models, prompts, limits, jobs, shared context")).toBeVisible();
    // All 18 PRD §13 templates, from the real prompts dir.
    await expect(page.locator('[data-testid^="prompt-"]')).toHaveCount(18);
    const reader = page.locator('[data-testid="prompt-reader"]');
    await reader.getByRole("button", { name: "Expand reader" }).click();
    await expect(reader.locator("mark.tm").first()).toContainText("{{source}}");
    // Forked templates (explain) serve L0–L3 from the warm base: cached.
    const explain = page.locator('[data-testid="prompt-explain"]');
    await explain.getByRole("button", { name: "Expand explain" }).click();
    await explain.getByRole("button", { name: "Expanded for this review" }).click();
    await expect(explain.locator('details.lay[data-layer="L0"]')).toBeVisible();
    await expect(explain.locator('details.lay[data-layer="L1"]')).toContainText("cached");
    await expect(explain.locator('details.lay[data-layer="L4"]')).not.toContainText("cached");
    // Model pickers list the adapter's models.
    await expect(page.locator('[data-testid="model-main"]').getByText("claude-sonnet", { exact: false }).first()).toBeAttached();
  });

  test("refresh banners counts; reviewed clears only on the changed hunk; v1 viewable", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("service not running");
    if (!reviewId) reviewId = await openFeatureReview(page);
    else await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);

    const appFile = page.locator(`[id="F-${fileKeyForPath("src-app.py")}"]`);
    await expect(appFile).toBeVisible({ timeout: 30_000 });

    // Which hunk is which: the alpha hunk holds `return 11`.
    const snap = (await curlJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
      files: { path: string; hunks: HunkRef[] }[];
    };
    const app = snap.files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    const alpha = app!.hunks.find((h) => h.lines.some((l) => l.text.includes("return 11")))!;
    const beta = app!.hunks.find((h) => h.lines.some((l) => l.text.includes("return 22")))!;
    expect(alpha.contentHash).not.toBe(beta.contentHash);

    // Mark both reviewed through the API (arrives over WS; left unfolded
    // so the version views below can assert on code text).
    for (const h of [alpha, beta]) {
      await curlJson(svc.origin, svc.token, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, {
        reviewed: true,
      });
    }
    await expect(appFile.locator(".revc")).toContainText("2/2");

    // A new commit touching only the alpha hunk, plus a commit adding a file
    // that is then amended.
    await git(repoDir, "checkout", "feature");
    const v3 = APP_V1.replace("    return 1", "    return 111").replace("    return 2", "    return 22");
    writeFileSync(path.join(repoDir, "src-app.py"), v3);
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    writeFileSync(path.join(repoDir, "d.py"), "D = 1\n");
    await git(repoDir, "add", "d.py");
    await git(repoDir, "commit", "-m", "add d");
    // Amend that commit (the "amend another" half of the test).
    writeFileSync(path.join(repoDir, "d.py"), "D = 1\nD2 = 2\n");
    await git(repoDir, "add", "d.py");
    await git(repoDir, "commit", "--amend", "--no-edit");

    // Refresh from the UI: banner with correct counts.
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const banner = page.locator('[data-testid="stale-banner"]');
    await expect(banner).toContainText("1 changed · 1 new · 0 removed hunks", { timeout: 60_000 });
    await banner.getByText("range-diff").click();
    await expect(page.locator('[data-testid="range-diff"]')).not.toBeEmpty();

    // Reviewed cleared only on the changed hunk: alpha carries the stale
    // marker with the new code, beta keeps its reviewed state, progress 1/2.
    await expect(appFile.getByText("changed since reviewed")).toHaveCount(1);
    await expect(appFile.locator(".revc")).toContainText("1/2");
    await expect(appFile.getByText("return 111")).toBeVisible();
    await expect(appFile.getByText(/return 11\b/)).toHaveCount(0);

    // Older version stays viewable, read-only, with the pre-refresh code.
    await page.locator("#version-pick").selectOption("1");
    await expect(page).toHaveURL(/version=1/);
    await expect(appFile.getByText(/return 11\b/)).toBeVisible();
    await expect(appFile.getByText("return 111")).toHaveCount(0);
    await expect(page.locator('[data-testid="stale-banner"]')).toHaveCount(0);

    // Update is not wired without the pipeline (no base runner): the button
    // reports that plainly instead of hanging.
    await page.getByRole("button", { name: "Back to current" }).click();
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Update" }).click();
  });
});
