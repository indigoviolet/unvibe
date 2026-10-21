/** J11 (#188 round 2): settings combos — models/effort, access, repos, data reset. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J11 settings combos", () => {
  let repoDir = "", repo2Dir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j11-repo-"));
    repo2Dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j11-repo2-"));
    await makeScratchRepo(repoDir);
    await makeScratchRepo(repo2Dir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j11-data-"));
    svc = await startService(dataDir, { agent: "none" });
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, repo2Dir, dataDir]) rmSync(d, { recursive: true, force: true });
  });

  test("model persists, full access on/off with marker, repo add/remove, data reset", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });

    // Models: pick a different offered model for the main role; it persists.
    // (Effort levels come from a live adapter, so with no agent the control
    // honestly stays on Default — asserted, not skipped.)
    await page.getByRole("tab", { name: "Models" }).click();
    await expect(page.locator('[data-testid="model-main"]')).toBeVisible({ timeout: 30_000 });
    const model = page.locator("#model-main");
    await expect(model).toBeVisible({ timeout: 30_000 });
    const currentText = (await model.textContent())?.trim() ?? "";
    await model.click();
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible({ timeout: 15_000 });
    const names = await options.evaluateAll((os) => os.map((o) => (o.textContent ?? "").trim()));
    const picked = names.filter((n) => n !== "");
    expect(picked.length).toBeGreaterThan(1);
    const idx = names.findIndex((n) => n !== "" && n !== currentText);
    expect(idx).toBeGreaterThanOrEqual(0);
    const chosenName = names[idx];
    await options.nth(idx).click();
    await page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
      { timeout: 15_000 },
    );
    await expect(page.locator("#effort-main")).toContainText("Default", { timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Models" }).click();
    await expect(page.locator("#model-main")).toContainText(chosenName, { timeout: 30_000 });

    // Full access: acknowledge, marker shows on a review, turn off, marker goes.
    await page.getByRole("tab", { name: "Access" }).click();
    await expect(page.locator('[data-testid="access-state"]')).toContainText("Read-only", { timeout: 15_000 });
    await page.getByRole("button", { name: "Turn on full access…" }).click();
    await expect(page.locator('[data-testid="access-warning"]')).toBeVisible();
    await page.getByRole("button", { name: "I understand, turn on full access" }).click();
    await expect(page.locator('[data-testid="access-state"]')).toContainText("Full access is on", { timeout: 15_000 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator('[data-testid="full-access-marker"]')).toBeVisible({ timeout: 30_000 });
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await page.getByRole("tab", { name: "Access" }).click();
    await page.getByRole("button", { name: "Turn off full access" }).click();
    await expect(page.locator('[data-testid="access-state"]')).toContainText("Read-only", { timeout: 15_000 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator('[data-testid="full-access-marker"]')).toHaveCount(0, { timeout: 30_000 });

    // Appearance (issue #196): switch the UI theme, reload, and it is
    // applied before first paint (boot script + localStorage mirror) and
    // persisted server-side; light/dark stays a separate axis.
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await page.getByRole("tab", { name: "Appearance" }).click();
    const themeSelect = page.locator('[data-testid="ui-theme"]');
    await expect(themeSelect).toBeVisible({ timeout: 15_000 });
    await expect(themeSelect).toContainText("Default");
    await themeSelect.click();
    await expect(page.getByRole("option")).toHaveText(["Default", "Studio", "Console"]);
    await page.getByRole("option", { name: "Studio", exact: true }).click();
    await page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
      { timeout: 15_000 },
    );
    await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "studio");
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );
    expect(accent).not.toBe("");
    const before = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute("data-ui-theme"),
      mirror: localStorage.getItem("unvibe:ui-theme"),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    expect(before.mirror).toBe("studio");
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    const after = await page.evaluate(async () => {
      const token = new URLSearchParams(location.search).get("token") ?? "";
      const r = await fetch("/api/settings", { headers: { authorization: `Bearer ${token}` } });
      const settings = (await r.json()) as { uiTheme?: string };
      return {
        attr: document.documentElement.getAttribute("data-ui-theme"),
        bg: getComputedStyle(document.body).backgroundColor,
        serverTheme: settings.uiTheme,
      };
    });
    expect(after.attr).toBe("studio");
    expect(after.bg).toBe(before.bg);
    expect(after.serverTheme).toBe("studio");
    // Back to the default theme for the rest of the journey.
    await page.getByRole("tab", { name: "Appearance" }).click();
    await page.locator('[data-testid="ui-theme"]').click();
    await page.getByRole("option", { name: "Default", exact: true }).click();
    await page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
      { timeout: 15_000 },
    );
    await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "default");

    // Repos: add a second checkout in Settings, remove it, folder intact.
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await page.getByRole("tab", { name: "Repos" }).click();
    const section = page.locator('[data-testid="repositories-section"]');
    await section.getByLabel("Add a repo by path").fill(repo2Dir);
    await section.getByRole("button", { name: "Add by path" }).click();
    const row = section.locator('[data-testid^="repo-"]', { hasText: path.basename(repo2Dir) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: `Remove local/${path.basename(repo2Dir)}` }).click();
    await row.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    expect(existsSync(path.join(repo2Dir, ".git"))).toBe(true);

    // Data reset: removes the review, keeps settings and repos.
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Reset data…" }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByText(/Removed \d+ reviews?\./)).toBeVisible({ timeout: 30_000 });
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /feature work|Unfold/ })).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
    const repos = await page.evaluate(async () => {
      const token = new URLSearchParams(location.search).get("token") ?? "";
      const r = await fetch("/api/repos", { headers: { authorization: `Bearer ${token}` } });
      return (await r.json()) as { repos: unknown[] };
    });
    expect(repos.repos.length).toBeGreaterThan(0);
  });
});
