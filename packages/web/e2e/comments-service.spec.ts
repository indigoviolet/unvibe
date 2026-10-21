/**
 * Comments + submit over the real service (M6 web).
 *
 * Built service + temp data dir + temp git repo; `gh` is stubbed by a fake
 * `gh` script first on `PATH` that records its invocations (tests never hit
 * real GitHub or real agents). Covers:
 * - create a note on a diff line → reload → still there;
 * - add to Outbox → edit draft → submit → the fake `gh` received exactly one
 *   review call with that comment;
 * - description edit → submit → `gh pr edit` called.
 *
 * Requires `mise run build` first. Skipped when the service isn't built.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import type { Page } from "@playwright/test";
import { fileKeyForPath } from "@unvibe/shared";

const exec = promisify(execFile);

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout.trim();
}

async function makeRepo(): Promise<{ dir: string; headSha: string }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-m6-repo-"));
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
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "feature work");
  const headSha = await git(dir, "rev-parse", "HEAD");
  return { dir, headSha };
}

/** Fake `gh`: answers PR reads, records review posts + description edits. */
function writeFakeGh(binDir: string, logDir: string, headSha: string): void {
  const body = [
    "First paragraph of the PR body.",
    "",
    "Second paragraph with details.",
  ].join("\n");
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat <<EOF
{"title":"M6 test PR","body":${JSON.stringify(body)},"author":{"login":"author"},"state":"OPEN","isDraft":false,"baseRefName":"main","headRefName":"feature","headRefOid":"${headSha}"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then
  echo '{"login":"author"}'
  exit 0
fi
case "$*" in
  *pulls/1/comments*)
    echo '[]'
    exit 0
    ;;
esac
case "$*" in
  *pulls/1/reviews*)
    cat > "$LOG/review-stdin.json"
    echo '{"html_url":"https://github.com/local/m6-test/pull/1#discussion_r9"}'
    exit 0
    ;;
esac
if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--body-file" ]; then
      cp "$arg" "$LOG/body.md"
    fi
    prev="$arg"
  done
  echo '{}'
  exit 0
fi
echo "fake gh: unexpected call: $*" >&2
exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

/**
 * Spawn the service with the fake `gh` first on PATH (tests never hit real
 * GitHub or real agents). The service resolves tools through the login
 * shell (`$SHELL` first), which would put the real `gh` ahead of our fake:
 * point SHELL at a stub that prints the fake bin first (real tools stay
 * visible after it), wrapped in the probe's delimiters
 * (`diagnostics/path-probe.ts`: undelimited output is not accepted).
 */
async function startServiceWithFakeGh(dataDir: string, fakeBin: string): Promise<RunningService> {
  const fakeShell = path.join(fakeBin, "fakeshell");
  writeFileSync(
    fakeShell,
    `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`,
    { mode: 0o755 },
  );
  return startService(dataDir, {
    extraEnv: {
      SHELL: fakeShell,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

async function apiJson(
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

test.describe("comments over the real service", () => {
  let repoDir = "";
  let dataDir = "";
  let logDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src/app.py");

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const repo = await makeRepo();
    repoDir = repo.dir;
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-m6-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-m6-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-m6-bin-"));
    writeFakeGh(fakeBin, logDir, repo.headSha);
    svc = await startServiceWithFakeGh(dataDir, fakeBin);
    // Register the repo and open a PR review through the real API.
    const repos = (await apiJson(svc.origin, svc.token, "POST", "/api/repos", {
      path: repoDir,
    })) as { repos: { id: string; localPath: string }[] };
    // Main added a synthetic "demo" repo entry: match ours by path.
    const registered = repos.repos.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(repos.repos)}`);
    const repoId = registered.id;
    const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", {
      repoId,
      pr: 1,
    })) as { review: { id: string } };
    reviewId = created.review.id;
    expect(reviewId).toMatch(/^rv_/);
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  });

  async function openReview(page: Page): Promise<void> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 60_000 });
  }

  test("create a comment on a diff line; it survives reload", async ({ page }) => {
    test.setTimeout(120_000);
    await openReview(page);
    // Line 2 is `return 2` on the new side of the first hunk.
    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    const slot = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
    await expect(slot).toBeVisible();
    await slot.locator("textarea").fill("Why 2 and not 3?");
    await slot.getByRole("button", { name: "Save" }).click();
    const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, {
      hasText: "Why 2 and not 3?",
    });
    await expect(thread).toBeVisible({ timeout: 10_000 });
    // Comments start no agent job and are for the PR by default.
    await expect(thread.locator(".working")).toHaveCount(0);
    await expect(thread.getByRole("button", { name: "In the Outbox" })).toBeVisible();
    await page.reload();
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "Why 2 and not 3?" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("add to Outbox, edit the draft, submit posts exactly one review", async ({ page }) => {
    test.setTimeout(120_000);
    rmSync(path.join(logDir, "review-stdin.json"), { force: true });
    await openReview(page);
    const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, {
      hasText: "Why 2 and not 3?",
    });
    await expect(thread).toBeVisible({ timeout: 10_000 });
    // Already marked for the PR by default (comments are for the PR).
    await expect(thread.getByRole("button", { name: "In the Outbox" })).toBeVisible();
    // Edit the Outbox draft in the Comments menu and let it save.
    await page.locator('#reviewbar [data-cm=""]').click();
    const draft = page.locator(".cmenu textarea[id^='ob-']").first();
    await draft.fill("Why 2 and not 3? Please explain.");
    // The draft autosaves through PATCH (debounced): wait for the save
    // response, not a fixed timeout, before closing the menu.
    await page.waitForResponse(
      (resp) =>
        resp.url().includes(`/comments/`) &&
        resp.request().method() === "PATCH" &&
        resp.ok(),
      { timeout: 10_000 },
    );
    await page.keyboard.press("Escape");
    // Submit from the top-bar panel.
    await page.locator("#submitSlot [data-submit]").click();
    const panel = page.locator("#submitSlot .submit");
    await expect(panel).toContainText("Why 2 and not 3? Please explain.", { timeout: 10_000 });
    await panel.locator("[data-submitgo]").click();
    await expect(panel).toContainText("Review posted", { timeout: 30_000 });
    // The fake gh saw exactly one review call carrying that comment.
    const posted = JSON.parse(readFileSync(path.join(logDir, "review-stdin.json"), "utf8")) as {
      event: string;
      commit_id: string;
      comments: { path: string; body: string }[];
    };
    expect(posted.event).toBe("COMMENT");
    expect(posted.comments).toHaveLength(1);
    expect(posted.comments[0].path).toBe("src/app.py");
    expect(posted.comments[0].body).toContain("Why 2 and not 3? Please explain.");
  });

  test("description edit submits through gh pr edit", async ({ page }) => {
    test.setTimeout(120_000);
    await openReview(page);
    await page.locator('#right [role="tab"]').getByText("PR description").click();
    await expect(page.locator("#right #d-p1")).toBeVisible();
    await page.locator("#right [data-descedit]").click();
    await page.locator("#right #descEdit").fill("First paragraph of the PR body. Edited by the reviewer.");
    await page.locator("#right [data-descsave]").click();
    await expect(page.locator("#right")).toContainText("Edited · goes to GitHub");
    await page.locator("#submitSlot [data-submit]").click();
    const panel = page.locator("#submitSlot .submit");
    await expect(panel).toContainText("PR description", { timeout: 10_000 });
    await panel.locator("[data-submitgo]").click();
    await expect(panel).toContainText("Review posted", { timeout: 30_000 });
    const edited = readFileSync(path.join(logDir, "body.md"), "utf8");
    expect(edited).toContain("Edited by the reviewer.");
  });
});
