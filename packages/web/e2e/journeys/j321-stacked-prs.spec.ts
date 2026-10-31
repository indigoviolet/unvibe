/** J321 (#321): stacked PR badges + popover against the real service with a stub gh (3-PR implicit stack). */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, git, makeScratchRepo, realGitPath, writeFakeGitOffline } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });
const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

const STACK = [
  { number: 11, title: "Stack base change", head: "feat-a", base: "main" },
  { number: 12, title: "Stack middle change", head: "feat-b", base: "feat-a" },
  { number: 13, title: "Stack top change", head: "feat-c", base: "feat-b" },
];

function writeFakeGh(binDir: string, logDir: string, headSha: string): void {
  const searchNodes = STACK.map((p) => ({
    __typename: "PullRequest", number: p.number, title: p.title, author: { login: "you" },
    updatedAt: new Date().toISOString(), headRefName: p.head, additions: 5, deletions: 1, changedFiles: 1,
    url: `https://github.com/acme/widgets/pull/${p.number}`, state: "OPEN", isDraft: false,
    reviewRequests: { nodes: [] }, latestReviews: { nodes: [] },
  }));
  const stackNodes = STACK.map((p) => ({
    number: p.number, title: p.title, headRefName: p.head, baseRefName: p.base, isCrossRepository: false, stack: null, stackEntry: null,
  }));
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  n="$3"
  title="Stack PR $n"
  case "$n" in 11) title="Stack base change" ;; 12) title="Stack middle change" ;; 13) title="Stack top change" ;; esac
  cat <<EOF
{"title":"$title","body":"Body.","author":{"login":"you"},"state":"OPEN","isDraft":false,"reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"${headSha}"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  case "$*" in
    *pullRequests*)
      cat <<'EOF'
${JSON.stringify({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: stackNodes } } } })}
EOF
      ;;
    *"author:@me"*)
      cat <<'EOF'
${JSON.stringify({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: searchNodes } } })}
EOF
      ;;
    *) echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}' ;;
  esac
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"you"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as you"; exit 0; fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("J321 stacked PRs", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let repoId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j321-repo-"));
    const repo = await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j321-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j321-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j321-bin-"));
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/widgets.git");
    writeFakeGh(fakeBin, logDir, repo.headSha);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, { agent: "none", extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` } });
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
    const registered = list.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
    repoId = registered.id;
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("badges on PR list, Reviews list and header; popover opens another PR", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((id) => { try { localStorage.setItem("unvibe.start.repoId", id); } catch { /* ignore */ } }, repoId);
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    const badges = page.getByTestId("stack-badge");
    await expect(badges).toHaveCount(3, { timeout: 30_000 });
    await expect(badges.nth(0)).toContainText("1/3");
    // All three share one colour.
    const colors = await badges.evaluateAll((els) => els.map((e) => getComputedStyle(e as HTMLElement).backgroundColor));
    expect(new Set(colors).size).toBe(1);
    const texts = await badges.allTextContents();
    expect(texts.join(" ")).toContain("2/3");
    expect(texts.join(" ")).toContain("3/3");
    await page.screenshot({ path: path.join(SHOTS, "stack-list-1440-light.png") });

    // Popover from the middle badge: order top-first down to the base branch.
    await badges.filter({ hasText: "2/3" }).first().click();
    const pop = page.getByTestId("stack-popover");
    await expect(pop).toBeVisible();
    await expect(pop.getByTestId("stack-entry-13")).toContainText("Stack top change");
    await expect(pop.getByTestId("stack-entry-12")).toContainText("this PR");
    await expect(pop).toContainText("main (base)");
    await page.screenshot({ path: path.join(SHOTS, "stack-popover-1440-light.png") });

    // Opening another PR's review from the popover.
    await pop.getByTestId("stack-entry-11").click();
    await expect(page).toHaveURL(/\/review\//, { timeout: 60_000 });
    // Review header carries the same stack badge (1/3 for the root PR).
    await expect(page.getByTestId("stack-badge").first()).toContainText("1/3", { timeout: 60_000 });

    // Reviews list on the start page shows the badge too.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByTestId("stack-badge").first()).toBeVisible({ timeout: 30_000 });
  });
});
