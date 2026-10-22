/** J18 (#179): empty diff — branch with no changes, merged PR, refresh to empty. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, git } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

async function makeBaseRepo(dir: string): Promise<string> {
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  writeFileSync(path.join(dir, "a.py"), "x = 1\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  return git(dir, "rev-parse", "main");
}

async function registerRepo(svc: RunningService, dir: string): Promise<string> {
  const repos = await apiJson(svc, "POST", "/api/repos", { path: dir });
  const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
  const found = list.find((r) => r.localPath === dir);
  if (!found) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
  return found.id;
}

async function createReview(svc: RunningService, repoId: string, source: { pr?: number; branch?: string }): Promise<string> {
  const created = await apiJson(svc, "POST", "/api/reviews", { repoId, ...source });
  if (created.status !== 201 && created.status !== 200 && created.status !== 202) {
    throw new Error(`review create failed: ${created.status} ${JSON.stringify(created.json)}`);
  }
  return (created.json as { review: { id: string } }).review.id;
}

async function awaitIngest(svc: RunningService, id: string, want: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await apiJson(svc, "GET", `/api/reviews/${id}`);
    const st = (snap.json as { ingest?: { status?: string; error?: string } }).ingest?.status ?? "ready";
    if (st === want) return;
    if (Date.now() > deadline) throw new Error(`ingest did not become ${want}: ${JSON.stringify(snap.json)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

test.describe("J18 empty diff (#179)", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j18-repo-"));
    await makeBaseRepo(repoDir);
    await git(repoDir, "checkout", "-b", "feature");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j18-data-"));
    svc = await startService(dataDir, { agent: "none" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("branch with no changes shows No changes to review, no guide started", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    const repoId = await registerRepo(svc, repoDir);
    const reviewId = await createReview(svc, repoId, { branch: "feature" });
    await awaitIngest(svc, reviewId, "empty");
    const jobs = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
    expect((jobs.json as { jobs: unknown[] }).jobs).toEqual([]);

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.getByTestId("review-empty")).toBeVisible({ timeout: 60_000 });
    // Heading says "No changes to review" once; the body explains why.
    await expect(page.getByTestId("review-empty-message")).toContainText('Branch "feature" is the same as its base');
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.screenshot({ path: "test-results/j18-empty-branch.png", fullPage: true });

    // Start page row says the same, with the no-changes tag.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    const row = page.getByTestId(`session-${reviewId}`);
    await expect(row).toContainText("No changes to review", { timeout: 30_000 });
    await expect(row).toContainText("no changes");
  });

  test("refresh that empties the diff says so in the banner and diff", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    const dir2 = mkdtempSync(path.join(os.tmpdir(), "unvibe-j18-repo2-"));
    let svc2: RunningService | null = null;
    const data2 = mkdtempSync(path.join(os.tmpdir(), "unvibe-j18-data2-"));
    try {
      await makeBaseRepo(dir2);
      await git(dir2, "checkout", "-b", "feature");
      writeFileSync(path.join(dir2, "a.py"), "x = 1\ny = 2\n");
      await git(dir2, "commit", "-am", "change");
      svc2 = await startService(data2, { agent: "none" });
      const repoId = await registerRepo(svc2, dir2);
      const reviewId = await createReview(svc2, repoId, { branch: "feature" });
      await awaitIngest(svc2, reviewId, "ready");

      await page.goto(`${svc2.origin}/review/${reviewId}?token=${svc2.token}`);
      await expect(page.getByText("y = 2")).toBeVisible({ timeout: 60_000 });

      // Seed a v1 guide (same DB technique as J12) so the review has a
      // guide before the refresh empties the diff.
      await svc2.stop();
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(path.join(data2, "unvibe.db"));
      try {
        const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
          | { rev: number; snapshot: string }
          | undefined;
        if (!row) throw new Error("no snapshot row to seed");
        const snap = JSON.parse(row.snapshot) as {
          pages: { id: string; kind: string; title: string; saved: boolean; cards: unknown[] }[];
        };
        snap.pages = [
          {
            id: "root",
            kind: "root",
            title: "Guide",
            saved: false,
            cards: [
              {
                id: "c-seed",
                pageId: "root",
                title: "Seed guide card",
                level: "standard",
                read: false,
                collapsed: false,
                revision: 1,
                blocks: [
                  { type: "paragraph", id: "b-seed", text: { standard: "Seed guide text for v1." }, citations: [] },
                ],
                undoStack: [],
              },
            ],
          },
        ];
        db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
          row.rev + 1,
          JSON.stringify(snap),
          reviewId,
        );
      } finally {
        db.close();
      }
      svc2 = await startService(data2, { agent: "none" });
      await page.goto(`${svc2.origin}/review/${reviewId}?token=${svc2.token}`);
      await expect(page.getByText("Seed guide text for v1.")).toBeVisible({ timeout: 60_000 });

      await git(dir2, "checkout", "feature");
      await git(dir2, "reset", "--hard", "main");
      await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();
      // Diff pane: the empty message appears once (the banner), not twice.
      await expect(page.getByTestId("empty-diff-message")).toContainText("No changes to review", { timeout: 60_000 });
      await expect(page.getByTestId("diff-empty")).toHaveCount(0);
      await expect(page.getByTestId("stale-banner").getByRole("button", { name: "Update" })).toHaveCount(0);
      // Guide pane: says this version is empty, not "diff is ready", and
      // points at the earlier version (which still has its guide).
      await expect(page.getByTestId("guide-empty-version")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("guide-empty-version-message")).toContainText("This version's diff is empty");
      await expect(page.getByTestId("guide-empty-version")).toContainText("Earlier versions are still available");
      // Submit stays available: work from earlier versions is not stranded.
      await expect(page.getByRole("button", { name: /Submit review/ })).toBeVisible();
      await page.screenshot({ path: "test-results/j18-refresh-empty.png", fullPage: true });

      // Picking v1 brings its guide and diff back.
      await page.locator("#version-pick").click();
      await openPopup(page).getByRole("option", { name: /^v1 / }).click();
      await expect(page).toHaveURL(/version=1/);
      await expect(page.getByText("Seed guide text for v1.")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("y = 2")).toBeVisible({ timeout: 30_000 });
    } finally {
      await svc2?.stop().catch(() => {});
      rmSync(dir2, { recursive: true, force: true });
      rmSync(data2, { recursive: true, force: true });
    }
  });

  test("merged PR whose head equals its base shows No changes to review", async ({ page }) => {
    test.setTimeout(180_000);
    const dir3 = mkdtempSync(path.join(os.tmpdir(), "unvibe-j18-repo3-"));
    const data3 = mkdtempSync(path.join(os.tmpdir(), "unvibe-j18-data3-"));
    const binDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j18-bin-"));
    let svc3: RunningService | null = null;
    try {
      const baseSha = await makeBaseRepo(dir3);
      await git(dir3, "checkout", "-b", "feature");
      const script = `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat <<EOF
{"title":"Merged journey PR","body":"Body.","author":{"login":"author"},"state":"MERGED","isDraft":false,"baseRefName":"main","headRefName":"feature","headRefOid":"${baseSha}"}
EOF
  exit 0
fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
      writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
      const fakeShell = path.join(binDir, "fakeshell");
      writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${binDir}:$PATH"\n`, { mode: 0o755 });
      svc3 = await startService(data3, {
        agent: "none",
        extraEnv: { SHELL: fakeShell, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
      });
      const repoId = await registerRepo(svc3, dir3);
      const reviewId = await createReview(svc3, repoId, { pr: 7 });
      await awaitIngest(svc3, reviewId, "empty");

      await page.goto(`${svc3.origin}/review/${reviewId}?token=${svc3.token}`);
      await expect(page.getByTestId("review-empty")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("review-empty-message")).toContainText("has been merged");
      await page.screenshot({ path: "test-results/j18-empty-pr.png", fullPage: true });
    } finally {
      await svc3?.stop().catch(() => {});
      rmSync(dir3, { recursive: true, force: true });
      rmSync(data3, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});
