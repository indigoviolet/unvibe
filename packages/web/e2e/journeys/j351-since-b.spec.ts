/** J351 (#351 step 1): an existing review gains commits; Update explains the delta and appends. */
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

test.describe("J351 since-B update", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src-app.py");
  const appFile = `[id="F-${appKey}"]`;

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j351-repo-"));
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
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j351-data-"));
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

  test("Update writes the Since-B section and an addendum; plotlines and the Since-B filter follow", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 30_000 });

    // Mark both hunks reviewed; the v2 commit touches alpha only.
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const files = (snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files;
    const app = files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });
    await expect(page.locator(appFile).locator(".revc")).toContainText("2/2", { timeout: 30_000 });

    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 111").replace("    return 2", "    return 22"));
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.locator('[data-testid="stale-banner"]')).toContainText(/1 changed/, { timeout: 60_000 });
    // The unchanged hunk keeps reviewed; the changed one reopens.
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2", { timeout: 30_000 });
    // The baseline picker defaults to the version last opened.
    await expect(page.locator('[data-testid="since-pick"]')).toContainText("v1 ·", { timeout: 30_000 });

    await page.locator('[data-testid="stale-banner"]').getByRole("button", { name: "Update" }).click();
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

    // The dated Since-B section, expanded with its cards.
    const since = page.locator('[data-testid="since-section"]');
    await expect(since).toBeVisible({ timeout: 30_000 });
    await expect(since).toContainText(/Since v1 → v2/);
    await expect(since.getByRole("button", { name: /Collapse changes since v1/ })).toBeVisible();
    // Collapse it, then expand it again: the cards come and go.
    await since.getByRole("button", { name: /Collapse changes since v1/ }).click();
    await expect(since.locator('[id^="C-since-"]')).toHaveCount(0);
    await since.getByRole("button", { name: /Expand changes since v1/ }).click();
    await expect(since.locator('[id^="C-since-"]')).toHaveCount(1);

    // The card addendum: old text unchanged, addendum appended.
    const central = page.locator("#page #C-problem");
    await expect(central).toContainText(/Updated since v1/, { timeout: 30_000 });
    await expect(central.locator("[data-addendum]")).toBeVisible();

    // Plotlines: the new thread reads new since B, with its +N.
    const plotlines = page.locator('.plotlines[aria-label="Plotlines"]');
    await expect(plotlines.getByText("new since v1")).toBeVisible({ timeout: 30_000 });
    await expect(plotlines.getByText("+1 since v1")).toHaveCount(0);

    // The diff: the Since-B filter shows only the delta.
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).locator(".dhunk")).toHaveCount(2);
    await page.locator("#right").getByRole("button", { name: "Show only hunks changed since v1" }).click();
    await expect(page.locator('[data-filterchip="since"]')).toContainText("Since v1 · 1 hidden");
    await expect(page.locator(appFile).locator(".dhunk")).toHaveCount(1);
    await expect(page.locator(appFile).locator(".dhunk").first()).toContainText("return 111");
    // Unchanged hunks keep reviewed state through the pass.
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2");
    await page.locator('[data-filterchip="since"]').click();
    await expect(page.locator(appFile).locator(".dhunk")).toHaveCount(2);
  });

  test("the picker offers versions and commits; picking a commit re-baselines", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const before = (await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as {
      commits: { sha: string; subject: string }[];
    };
    expect(before.commits.length).toBeGreaterThanOrEqual(2);
    // Commits are oldest-first: the oldest is v1's commit, strictly
    // before the head, so the delta is non-empty.
    const older = before.commits[0];
    const short = older.sha.slice(0, 8);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    const pick = page.locator('[data-testid="since-section"] [data-testid="since-pick"]');
    await expect(pick).toContainText("v1 ·", { timeout: 30_000 });
    await pick.click();
    await expect(page.getByRole("group", { name: "Versions" })).toBeVisible({ timeout: 15_000 });
    const commitsGroup = page.getByRole("group", { name: "Commits" });
    await expect(commitsGroup).toBeVisible();
    // The v1 head sha is this same commit, so scope to the Commits group.
    await expect(commitsGroup.getByRole("option", { name: new RegExp(short) })).toBeVisible();
    await commitsGroup.getByRole("option", { name: new RegExp(short) }).click();
    // The trigger names the picked commit (short sha + subject).
    await expect(pick).toContainText(short, { timeout: 30_000 });
    await expect(pick).toContainText(older.subject.slice(0, 12), { timeout: 30_000 });
    const after = (await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as {
      sinceBaseline: unknown;
      sinceHunks?: { added: string[]; changed: string[] };
    };
    expect(after.sinceBaseline).toEqual({ kind: "commit", sha: older.sha });
    const hunks = [...(after.sinceHunks?.added ?? []), ...(after.sinceHunks?.changed ?? [])];
    expect(hunks.length).toBeGreaterThan(0);
  });
});
