/** J367 (#367 + #368): one version state model after Update, plus the hunk-header chip gap. */
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

test.describe("J367 update clears every card; banner has one state model", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src-app.py");
  const appFile = `[id="F-${appKey}"]`;

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j367-repo-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "src-app.py"), V1);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 11").replace("    return 2", "    return 22"));
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j367-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createScratchReview(svc, repoDir);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const pages = (snap.json as { pages?: { cards: unknown[] }[] }).pages ?? [];
      if (pages.some((p) => p.cards.length > 0)) break;
      if (Date.now() > deadline) throw new Error("guide cards did not appear on the scratch review");
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("stale banner offers Update; after Update the banner reads current with no Update and no card banner", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // 1440 light: the default frame set (#362).
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 30_000 });

    // Mark both hunks reviewed; the v2 commit touches alpha only.
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const files = (snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files;
    const app = files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });

    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 111").replace("    return 2", "    return 22"));
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();

    // Stale state: one model — "New commits · v1 → v2 (…)" plus Update.
    const banner = page.locator('[data-testid="stale-banner"]');
    await expect(banner).toHaveAttribute("data-update-state", "stale", { timeout: 60_000 });
    await expect(banner).toContainText(/New commits · v1 → v2/);
    await expect(banner).toContainText(/1 changed/);
    await expect(banner.getByRole("button", { name: "Update", exact: true })).toBeVisible();

    // #368: the header chip sits off the diff stat with the shared gap.
    await expect(page.locator(appFile).getByText("changed since reviewed")).toHaveCount(1);
    await expect(page.locator(appFile).locator(".prtag").first()).toHaveCSS("margin-left", "6px");
    await page.screenshot({ path: "/tmp/367-frames/stale-banner.png" });
    await page.locator(appFile).locator(".dhunk").first().screenshot({ path: "/tmp/367-frames/hunk-header-chip.png" });

    await banner.getByRole("button", { name: "Update", exact: true }).click();
    const jobDeadline = Date.now() + 90_000;
    let updateJob: { id: string; kind: string; state: string } | undefined;
    for (;;) {
      const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
      const jobs = (res.json as { jobs: { id: string; kind: string; state: string }[] }).jobs ?? [];
      updateJob = jobs.find((j) => j.kind === "update-pass");
      if (updateJob && (updateJob.state === "done" || updateJob.state === "error" || updateJob.state === "cancelled")) break;
      if (Date.now() > jobDeadline) throw new Error(`update-pass job never finished: ${JSON.stringify(updateJob)}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(updateJob?.state).toBe("done");
    await expect(banner).toHaveAttribute("data-update-state", "current", { timeout: 60_000 });

    // Up-to-date state: "Updated to v2 · since v1" with the picker and
    // range-diff, no Update button, no "Already up to date" label.
    await expect(banner).toContainText(/Updated to v2 · since v1/);
    await expect(banner.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
    await expect(banner).not.toContainText(/Already up to date/);
    await expect(banner.locator('[data-testid="since-pick"]')).toBeVisible();

    // No card banner anywhere: the UI offers no Update the service would refuse.
    await expect(page.locator("#page .stale")).toHaveCount(0);
    await page.screenshot({ path: "/tmp/367-frames/updated-banner.png" });

    // The service agrees: a further update is refused as already up to date.
    const again = await apiJson(svc, "POST", `/api/reviews/${reviewId}/update`);
    expect(again.status).toBe(409);
  });
});
