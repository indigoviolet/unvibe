/**
 * J322 (#322 part 2): Settings → Extension (active repos, panel model,
 * install help) and the Reviews web-thread toggle, against the real
 * built service (no agent: panel ask falls back to retriever evidence).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, git } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J322 extension settings + web reviews", () => {
  let dataDir = "";
  let repoDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j322-data-"));
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j322-repo-"));
    mkdirSync(path.join(repoDir, "src"), { recursive: true });
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "src", "auth.ts"), "export function validateToken(t: string) { return true; }\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/service.git");
    svc = await startService(dataDir, { agent: "none" });
    const added = await apiJson(svc!, "POST", "/api/repos", { path: repoDir });
    expect(added.status).toBe(200);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  test("settings extension, panel ask, documents web group", async ({ page }) => {
    await page.goto(`${svc!.origin}/settings?tab=extension&token=${svc!.token}`);
    await expect(page.getByTestId("extension-show-folder")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("extension-path")).toContainText("extension");
    await expect(page.getByTestId("extension-steps")).toContainText("chrome://extensions");
    await expect(page.getByTestId("extension-status")).toContainText("Extension");
    // Active repo checkbox visible and checked by default (most recent).
    const boxes = page.locator('[data-testid^="extension-repo-"]');
    await expect(boxes.first()).toBeVisible();
    // Panel ask via the extension endpoint creates a web review.
    const asked = await apiJson(svc!, "POST", "/api/extension/panel/ask", {
      url: "https://github.com/acme/service/pull/1", title: "A page", selection: "", context: "page about validateToken",
      question: "Where is validateToken?",
    });
    expect(asked.status).toBe(200);
    // Never in Reviews (PRs and branches only, no toggle any more).
    await page.goto(`${svc!.origin}/?token=${svc!.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("show-web-reviews")).toHaveCount(0);
    await expect(page.getByText("A page")).toHaveCount(0);
    // Visible under Documents, in its own Web pages group.
    await page.goto(`${svc!.origin}/documents?token=${svc!.token}`);
    const row = page.getByTestId("web-thread-row");
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row).toContainText("A page");
    await expect(row).toContainText("github.com");
    await expect(row).toContainText("1 question");
  });
});
