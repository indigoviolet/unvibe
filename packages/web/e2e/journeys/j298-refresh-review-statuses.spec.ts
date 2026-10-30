/**
 * J298 (#298): Refresh on the start page updates the Reviews list.
 *
 * Fake `gh` flips PR #1 to MERGED + APPROVED and gains a commit (new
 * head SHA) after ingest, and the open-only PR searches then return
 * nothing (a merged PR leaves those lists). Pressing lists-refresh
 * must update the review row in place: merged + approved badges and
 * the "new commits" tag, without opening the review and without
 * re-ingesting it (still version 1, stored head unchanged). The
 * status check is one batched `gh` query per repo per Refresh.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createScratchReview, git, makeScratchRepo, realGitPath } from "./journey-helpers.js";

/** Fake `git`: fetches fail instantly offline (the acme origin must never be contacted); all else is real git. */
function writeFakeGit298(binDir: string, realGit: string): void {
  const script = `#!/bin/sh
case "$1" in
  fetch)
    echo "git fetch stubbed offline (e2e)" >&2
    exit 1
    ;;
esac
case "$*" in
  *ls-remote*github/gitignore*)
    echo "git ls-remote stubbed offline (e2e)" >&2
    exit 1
    ;;
esac
exec "${realGit}" "$@"
`;
  writeFileSync(path.join(binDir, "git"), script, { mode: 0o755 });
}

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

function writeFakeGh298(binDir: string, logDir: string): void {
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
STATE=$(cat "$LOG/state" 2>/dev/null || echo open)
HEAD=$(cat "$LOG/head" 2>/dev/null || echo unknown)
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  if [ "$STATE" = "merged" ]; then
    printf '{"title":"Journey test PR","body":"First paragraph.","author":{"login":"author"},"state":"MERGED","isDraft":false,"reviewDecision":"APPROVED","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"%s"}\\n' "$HEAD"
  else
    printf '{"title":"Journey test PR","body":"First paragraph.","author":{"login":"author"},"state":"OPEN","isDraft":false,"reviewDecision":"REVIEW_REQUIRED","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"%s"}\\n' "$HEAD"
  fi
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  case "$*" in
    *search\\(query:*)
      if [ "$STATE" = "merged" ]; then
        echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}'
      else
        echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"__typename":"PullRequest","number":1,"title":"Journey test PR","author":{"login":"author"},"updatedAt":"2026-10-01T00:00:00Z","headRefName":"feature","additions":3,"deletions":1,"changedFiles":2,"url":"https://github.com/acme/app/pull/1","state":"OPEN","isDraft":false,"reviewDecision":"REVIEW_REQUIRED","reviewRequests":{"nodes":[]},"latestReviews":{"nodes":[]}}]}}}'
      fi
      exit 0
      ;;
    *pullRequest\\(number:*)
      if [ "$STATE" = "merged" ]; then
        printf '{"data":{"repository":{"pr1":{"number":1,"state":"MERGED","isDraft":false,"reviewDecision":"APPROVED","headRefOid":"%s","reviewRequests":{"nodes":[]},"latestReviews":{"nodes":[]}}}}}\\n' "$HEAD"
      else
        printf '{"data":{"repository":{"pr1":{"number":1,"state":"OPEN","isDraft":false,"reviewDecision":"REVIEW_REQUIRED","headRefOid":"%s","reviewRequests":{"nodes":[]},"latestReviews":{"nodes":[]}}}}}\\n' "$HEAD"
      fi
      exit 0
      ;;
  esac
  echo "fake gh: unexpected graphql: $*" >&2; exit 1
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as author"; exit 0; fi
case "$*" in *pulls/1/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

function statusCallCount(logDir: string): number {
  try {
    return readFileSync(path.join(logDir, "calls.log"), "utf8")
      .split("\n")
      .filter((l) => l.includes("pullRequest(number:")).length;
  } catch {
    return 0;
  }
}

test.describe("J298 start-page Refresh updates review statuses", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  let head1 = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j298-repo-"));
    const repo = await makeScratchRepo(repoDir);
    head1 = repo.headSha;
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/app.git");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j298-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j298-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j298-bin-"));
    writeFileSync(path.join(logDir, "state"), "open");
    writeFileSync(path.join(logDir, "head"), head1);
    writeFakeGh298(fakeBin, logDir);
    writeFakeGit298(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    reviewId = await createScratchReview(svc, repoDir, { pr: 1 });
    // Wait until ingest lands: the status check only touches ready reviews.
    const deadline = Date.now() + 60_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const status = (snap.json as { ingest?: { status?: string } }).ingest?.status ?? "ready";
      if (status === "ready") break;
      if (Date.now() > deadline) throw new Error(`review never became ready: ${JSON.stringify(snap.json)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("Refresh flips the row to merged/approved with new commits, no re-ingest", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");

    await page.goto(`${svc.origin}/?token=${svc.token}`);
    const row = page.locator(`[data-testid="session-${reviewId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator('[data-testid="pr-badges"]')).toHaveCount(0);
    await expect(row).not.toContainText("new commits");

    // The PR merges, is approved, and gains a commit.
    writeFileSync(path.join(repoDir, "src", "util.py"), "VALUE = 43\n");
    await git(repoDir, "commit", "-am", "second commit");
    const head2 = await git(repoDir, "rev-parse", "HEAD");
    expect(head2).not.toBe(head1);
    writeFileSync(path.join(logDir, "head"), head2);
    writeFileSync(path.join(logDir, "state"), "merged");
    const statusCallsBefore = statusCallCount(logDir);

    await page.locator('[data-testid="lists-refresh"]').click();

    await expect(row.locator('[data-testid="pr-badges"]').getByRole("img", { name: "Merged" })).toBeVisible({ timeout: 30_000 });
    await expect(row.locator('[data-testid="pr-badges"]').getByRole("img", { name: "Approved" })).toBeVisible();
    await expect(row).toContainText("new commits");

    // One batched status query for this Refresh press.
    expect(statusCallCount(logDir) - statusCallsBefore).toBe(1);

    const summary = await apiJson(svc, "GET", "/api/reviews");
    const found = (summary.json as { reviews: { id: string; prState?: string; reviewDecision?: string; stale: boolean; currentVersion: number }[] }).reviews.find(
      (r) => r.id === reviewId,
    );
    expect(found?.prState).toBe("merged");
    expect(found?.reviewDecision).toBe("approved");
    expect(found?.stale).toBe(true);
    expect(found?.currentVersion).toBe(1);

    // No re-ingest: the stored version still points at the first head.
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    expect((snap.json as { version: { headSha: string; n: number } }).version.headSha).toBe(head1);
    expect((snap.json as { version: { n: number } }).version.n).toBe(1);
  });
});
