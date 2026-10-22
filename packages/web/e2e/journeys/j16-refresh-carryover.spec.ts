/** J16 (#188): refresh after new commits carries cards, comments, reviewed state. */
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

test.describe("J16 refresh carry-over", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src-app.py");
  const appFile = `[id="F-${appKey}"]`;

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j16-repo-"));
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
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j16-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createScratchReview(svc, repoDir);
    // Wait for guide cards from the replay reader.
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

  test("cards, a comment and reviewed state survive a refresh; the changed hunk reopens", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 30_000 });
    const guideText = await page.locator("#page .doc h1.title").innerText();

    // Mark both hunks reviewed; comment on the beta line (unchanged later).
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const files = (snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files;
    const app = files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });
    await expect(page.locator(appFile).locator(".revc")).toContainText("2/2", { timeout: 30_000 });

    // Comment on a diff line of the file.
    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    const slot = page.locator(`${appFile} .ithread[data-pending-thread]`);
    await expect(slot).toBeVisible({ timeout: 15_000 });
    await slot.locator("textarea").fill("Carry this comment over the refresh.");
    await slot.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(`${appFile} .ithread[data-thread]`, { hasText: "Carry this comment" })).toBeVisible({ timeout: 15_000 });

    // New commit touching only alpha.
    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 111").replace("    return 2", "    return 22"));
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.locator('[data-testid="stale-banner"]')).toContainText(/1 changed/, { timeout: 60_000 });

    // Carried over: guide cards, the comment, and the unchanged reviewed state.
    await expect(page.locator("#page .doc h1.title")).toHaveText(guideText, { timeout: 30_000 });
    await expect(page.getByText("Carry this comment over the refresh.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2", { timeout: 30_000 });
    await expect(page.locator(appFile).getByText("return 111")).toBeVisible({ timeout: 30_000 });

    // #194: the update pass finishes (it used to sit RUNNING with no
    // token counts — the nested update-pass job deadlocked on the
    // enclosing job's dedupe key). Terminal either way under replay.
    await page.locator('[data-testid="stale-banner"]').getByRole("button", { name: "Update" }).click();
    const jobDeadline = Date.now() + 90_000;
    let updateJob: { id: string; kind: string; state: string; finishedAt?: number } | undefined;
    for (;;) {
      const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
      const jobs = (res.json as { jobs: { id: string; kind: string; state: string; finishedAt?: number }[] }).jobs ?? [];
      updateJob = jobs.find((j) => j.kind === "update-pass");
      if (updateJob && (updateJob.state === "done" || updateJob.state === "error" || updateJob.state === "cancelled")) break;
      if (Date.now() > jobDeadline) throw new Error(`update-pass job never finished: ${JSON.stringify(updateJob)}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(typeof updateJob?.finishedAt).toBe("number");

    // #194: Debug page shows job timings and the refresh's timed steps.
    await page.goto(`${svc.origin}/review/${reviewId}/debug?token=${svc.token}`);
    const steps = page.locator('[data-testid="refresh-steps"]');
    await expect(steps).toBeVisible({ timeout: 30_000 });
    for (const label of ["Fetch", "Building the new version", "Range diff", "Remapping anchors", "Remapping citations", "Remapping pins"]) {
      await expect(steps).toContainText(label);
    }
    await expect(steps).toContainText("started");
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Queued", { timeout: 30_000 });
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Duration");
    const updateRow = page.locator(`[data-testid="job-${updateJob!.id}"]`);
    await expect(updateRow).toContainText("Finished", { timeout: 30_000 });
    await expect(updateRow).toContainText("update:");
  });
});
