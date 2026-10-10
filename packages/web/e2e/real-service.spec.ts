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
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { fileKeyForPath } from "@unvibe/shared";

const exec = promisify(execFile);
const SERVICE_ENTRY = fileURLToPath(new URL("../../service/dist/index.js", import.meta.url));

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

interface RunningService {
  origin: string;
  token: string;
  stop: () => Promise<void>;
}

/** Spawn the built service on an ephemeral port; parse origin + token. */
async function startService(dataDir: string): Promise<RunningService> {
  if (!existsSync(SERVICE_ENTRY)) {
    throw new Error(`service not built: run \`mise run build\` first (missing ${SERVICE_ENTRY})`);
  }
  const { spawn } = await import("node:child_process");
  const proc = spawn(process.execPath, [SERVICE_ENTRY], {
    env: {
      ...process.env,
      UNVIBE_DATA_DIR: dataDir,
      UNVIBE_PORT: "0",
      UNVIBE_REPO_ROOTS: "",
      // No agent behaviour under test: keep the pipeline disabled so no
      // background job mutates the review mid-test.
      UNVIBE_AGENT: "none",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const started = new Promise<{ origin: string; token: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service did not start: ${out}`)), 30_000);
    proc.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      const m = out.match(/Unvibe listening on (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ origin: m[1], token: m[2] });
      }
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`service exited with ${code}: ${out}`));
      }
    });
  });
  const { origin, token } = await started;
  return {
    origin,
    token,
    stop: () =>
      new Promise<void>((resolve) => {
        proc.on("exit", () => resolve());
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill("SIGKILL");
          resolve();
        }, 5000).unref?.();
      }),
  };
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
    // Add this repo through the start page (PRD §4.2).
    await page.getByLabel("Add a repo by path").fill(repoDir);
    await page.getByRole("button", { name: "Add by path" }).click();
    await expect(page.getByText(`local/${path.basename(repoDir)}`).first()).toBeVisible();
    // Open a review of the scratch branch.
    await page.locator("#new-review .ci button").filter({ hasText: "feature" }).first().click();
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
});
