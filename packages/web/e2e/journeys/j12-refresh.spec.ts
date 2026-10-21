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
    await page.locator("#version-pick").click();
    await page.getByRole("option", { name: /^v1 / }).click();
    await expect(page).toHaveURL(/version=1/);
    await expect(page.locator(appFile).getByText(/return 11\b/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="stale-banner"]')).toHaveCount(0, { timeout: 15_000 });
  });

  test("#112 a code citation outside the diff is re-anchored after refresh", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // helper.py lands on main and feature rebases onto it: at both heads
    // it is outside the PR diff (the PR only touches src-app.py).
    await git(repoDir, "checkout", "main");
    writeFileSync(path.join(repoDir, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
    await git(repoDir, "add", "helper.py");
    await git(repoDir, "commit", "-m", "add helper");
    await git(repoDir, "checkout", "feature");
    await git(repoDir, "rebase", "main");
    const seeded = await apiJson(svc, "POST", `/api/reviews/${reviewId}/refresh`);
    expect(seeded.status).toBe(200);
    const before = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const beforeSnap = before.json as unknown as {
      version: { headSha: string; n: number };
      files: { path: string }[];
    };
    expect(beforeSnap.files.some((f) => f.path === "helper.py")).toBe(false);
    const oldHead = beforeSnap.version.headSha;

    // Seed a guide card citing beta (line 2) outside the diff, through
    // the snapshot DB while the service is stopped (same technique as
    // the diagram journeys).
    await svc.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const snap = JSON.parse(row.snapshot) as {
        pages: { id: string; kind: string; title: string; saved: boolean; cards: unknown[] }[];
      };
      let root = snap.pages.find((p) => p.id === "root");
      if (!root) {
        root = { id: "root", kind: "root", title: "Guide", saved: false, cards: [] };
        snap.pages.unshift(root);
      }
      root.cards.push({
        id: "c-helper",
        pageId: "root",
        title: "Helper card",
        level: "standard",
        read: false,
        collapsed: false,
        revision: 1,
        blocks: [
          {
            type: "paragraph",
            id: "b-helper",
            text: { standard: "Uses the helper beta value." },
            citations: [{ target: `code:helper.py:2@${oldHead}` }],
          },
        ],
        undoStack: [],
      });
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(snap),
        reviewId,
      );
    } finally {
      db.close();
    }
    svc = await startService(dataDir, { agent: "none" });

    // Upstream moves beta down two lines; feature rebases again.
    await git(repoDir, "checkout", "main");
    writeFileSync(path.join(repoDir, "helper.py"), "top1 = 0\ntop2 = 0\nalpha = 1\nbeta = 2\ngamma = 3\n");
    await git(repoDir, "add", "helper.py");
    await git(repoDir, "commit", "-m", "shift helper");
    await git(repoDir, "checkout", "feature");
    await git(repoDir, "rebase", "main");

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.getByText("Uses the helper beta value.")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();

    // The citation now points at beta's new line under the new head.
    const deadline = Date.now() + 60_000;
    let target = "";
    let unverified: boolean | undefined;
    let newHead = "";
    for (;;) {
      const after = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const snap = after.json as unknown as {
        version: { headSha: string };
        pages: { cards: { id: string; stale?: boolean; blocks: { citations?: { target: string; unverified?: boolean }[] }[] }[] }[];
      };
      newHead = snap.version.headSha;
      const card = snap.pages.flatMap((p) => p.cards).find((c) => c.id === "c-helper");
      const cit = card?.blocks.flatMap((b) => b.citations ?? [])[0];
      target = cit?.target ?? "";
      unverified = cit?.unverified;
      if (target === `code:helper.py:4@${newHead}` && newHead !== oldHead) break;
      if (Date.now() > deadline) throw new Error(`citation not re-anchored: ${target} (head ${newHead})`);
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(unverified).not.toBe(true);
    // And in the UI the marker is a normal (verified) citation chip.
    await expect(page.getByText("Uses the helper beta value.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#C-c-helper .lk[data-refs]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#C-c-helper .lk.unverified")).toHaveCount(0);
  });
});
