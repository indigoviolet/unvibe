/** J228 (#228, narrowed per owner decision): start-page author filter.
 *
 * The filter applies ONLY to the requested-review PR groups ("Waiting on
 * your review": requested of you / requested of your team) — not "Your
 * PRs", branch rows, or the Reviews list. It sits with that section: the
 * shared Base UI Select lists All plus the authors in those two groups
 * with counts; one pick filters both groups; the choice persists like
 * the time filter. `checkLayout` (#225) runs on the filter in place.
 *
 * Fake `gh` returns Your PRs and review requests with mixed authors,
 * plus one PR review and one branch review (to prove Reviews ignores
 * the filter). No real `gh`, no network: the fake answers `pr list`/
 * `pr view`/`api user`/`auth status` from canned JSON, everything else
 * exits 1. Screenshots land in `visual-tour/` for the owner to look at
 * (git-ignored, no baselines).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { checkLayout } from "../layout-check.js";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, git, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

interface FakePr {
  number: number;
  title: string;
  author: { login: string };
  updatedAt: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  url: string;
  reviewRequests: { login?: string; slug?: string }[];
  state: string;
  isDraft: boolean;
}

function pr(n: number, title: string, author: string, branch: string, extra: Partial<FakePr> = {}): FakePr {
  return {
    number: n,
    title,
    author: { login: author },
    updatedAt: new Date().toISOString(),
    headRefName: branch,
    additions: 10 + n,
    deletions: n,
    changedFiles: 2,
    url: `https://github.com/acme/widgets/pull/${n}`,
    reviewRequests: [],
    state: "OPEN",
    isDraft: false,
    ...extra,
  };
}

// Your PRs: one by alice, one by bob (the filter must ignore them).
// Requested of you: bob's ask; requested of your team: alice's ask.
const AUTHORING: FakePr[] = [
  pr(101, "Alice adds folded-header parsing", "alice", "alice-parse"),
  pr(102, "Bob fixes header unfolding", "bob", "bob-unfold"),
];
const DIRECT: FakePr[] = [pr(103, "Bob asks for your review", "bob", "bob-ask")];
const TEAM: FakePr[] = [
  pr(103, "Bob asks for your review", "bob", "bob-ask"),
  pr(104, "Alice asks the team", "alice", "alice-team", { reviewRequests: [{ slug: "core-team" }] }),
];

/** A flat fixture PR as a GraphQL search node (what `gh api graphql` returns). */
function toNode(p: FakePr): unknown {
  const { reviewRequests, ...rest } = p as FakePr & { latestReviews?: unknown };
  return {
    __typename: "PullRequest",
    ...rest,
    reviewRequests: {
      nodes: (reviewRequests ?? []).map((r) => ({
        requestedReviewer: {
          __typename: "login" in r && r.login !== undefined ? "User" : "Team",
          ...r,
        },
      })),
    },
    latestReviews: { nodes: (("latestReviews" in p ? (p as { latestReviews?: unknown }).latestReviews : []) ?? []) as unknown[] },
  };
}

function searchPage(rows: FakePr[]): string {
  return JSON.stringify({
    data: {
      search: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: rows.map(toNode),
      },
    },
  });
}

function writeFakeGhAuthorFilter(binDir: string, logDir: string, poolDir: string, headSha: string): void {
  for (const [name, rows] of Object.entries({ authoring: AUTHORING, direct: DIRECT, team: TEAM }) as [string, FakePr[]][]) {
    writeFileSync(path.join(poolDir, `${name}.json`), searchPage(rows));
  }
  const script = `#!/bin/sh
POOL="${poolDir}"
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  case "$*" in
    *"user-review-requested:@me"*) cat "$POOL/direct.json" ;;
    *"review-requested:@me"*) cat "$POOL/team.json" ;;
    *"author:"*) cat "$POOL/authoring.json" ;;
    *) echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}'; ;;
  esac
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat <<EOF
{"title":"Alice adds folded-header parsing","body":"First paragraph.","author":{"login":"alice"},"state":"OPEN","isDraft":false,"reviewDecision":"","baseRefName":"main","headRefName":"feature","headRefOid":"${headSha}"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"reviewer"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo 'Logged in'; exit 0; fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

/** Wait until a review's ingest is done. */
async function awaitIngestReady(svc: RunningService, id: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const snap = await apiJson(svc, "GET", `/api/reviews/${id}`);
    const ingest = (snap.json as { ingest?: { status?: string } }).ingest?.status ?? "ready";
    if (ingest === "ready") return;
    if (ingest === "failed" || ingest === "empty") throw new Error(`ingest ended as ${ingest} for ${id}`);
    if (Date.now() > deadline) throw new Error(`ingest timed out for ${id}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

test.describe("J228 start-page author filter", () => {
  let repoDir = "";
  let dataDir = "";
  let logDir = "";
  let poolDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let repoId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j228-repo-"));
    const { headSha } = await makeScratchRepo(repoDir);
    // An origin remote: without one the repo registers as owner "local"
    // and the gh-backed PR lists stay empty (J225B does the same).
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/widgets.git");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j228-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j228-gh-"));
    poolDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j228-pool-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j228-bin-"));
    writeFakeGhAuthorFilter(fakeBin, logDir, poolDir, headSha);
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
    const registered = list.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
    repoId = registered.id;
    // One PR review and one branch review: both must ignore the filter.
    const created = await apiJson(svc, "POST", "/api/reviews", { repoId, pr: 101 });
    await awaitIngestReady(svc, (created.json as { review: { id: string } }).review.id);
    const branched = await apiJson(svc, "POST", "/api/reviews", { repoId, branch: "feature" });
    await awaitIngestReady(svc, (branched.json as { review: { id: string } }).review.id);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, poolDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  for (const combo of [
    { name: "1440-light", width: 1440, dark: false },
    { name: "1440-dark", width: 1440, dark: true },
    { name: "960-light", width: 960, dark: false },
  ] as const) {
    test(`author filter reads and filters the requested groups (${combo.name})`, async ({ page }) => {
      test.setTimeout(180_000);
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: combo.width, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript((id) => {
        try {
          localStorage.setItem("unvibe.start.repoId", id);
        } catch {
          // Start page falls back to no selection; asserts below fail.
        }
      }, repoId);
      await page.goto(`${svc.origin}/?token=${svc.token}`);
      const prBlock = page.getByTestId("pr-block");
      const reviews = page.locator('[aria-label="Reviews"]');
      // All rows render unfiltered.
      await expect(prBlock.getByText("Alice adds folded-header parsing")).toBeVisible({ timeout: 30_000 });
      await expect(prBlock.getByText("Bob fixes header unfolding")).toBeVisible();
      await expect(prBlock.getByText("Bob asks for your review")).toBeVisible();
      await expect(prBlock.getByText("Alice asks the team")).toBeVisible();
      await expect(reviews.getByText("Alice adds folded-header parsing")).toBeVisible({ timeout: 30_000 });
      await expect(reviews.locator('[data-testid^="session-"]')).toHaveCount(2);

      // The Author select lists All plus the requested-group authors with
      // counts (alice 1, bob 1) — nobody else's.
      await expectTrigger(page, "All");
      await page.getByLabel("Author", { exact: true }).click();
      await expect(openPopup(page).getByRole("option", { name: "alice (1)" })).toBeVisible({ timeout: 15_000 });
      await expect(openPopup(page).getByRole("option", { name: "bob (1)" })).toBeVisible();
      await page.keyboard.press("Escape");

      // Pick bob: his direct ask stays, alice's team ask hides with the
      // author note; Your PRs, Reviews and branches ignore the filter.
      await pickAuthor(page, "bob (1)");
      await expectTrigger(page, "bob (1)");
      await expect(prBlock.getByText("Bob asks for your review")).toBeVisible();
      await expect(prBlock.getByText("Alice asks the team")).toHaveCount(0);
      await expect(page.getByTestId("requested-team-empty")).toContainText("No PRs by bob.");
      await expect(prBlock.getByText("Alice adds folded-header parsing")).toBeVisible();
      await expect(prBlock.getByText("Bob fixes header unfolding")).toBeVisible();
      await expect(reviews.getByText("Alice adds folded-header parsing")).toBeVisible();
      await expect(reviews.locator('[data-testid^="session-"]')).toHaveCount(2);
      await expect(prBlock.getByText("feature").first()).toBeVisible();
      await checkLayout(page, `start-author-filter-${combo.name}`);
      await page.screenshot({ path: `${SHOTS}/start-author-filter-bob-${combo.name}.png` });

      // The choice persists like the time filter.
      await page.reload();
      await expectTrigger(page, "bob (1)");
      await expect(page.getByTestId("pr-block").getByText("Bob asks for your review")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("pr-block").getByText("Alice asks the team")).toHaveCount(0);

      // The way back clears the filter.
      await page.getByTestId("requested-team-empty").getByRole("button", { name: "Show all" }).click();
      await expectTrigger(page, "All");
      await expect(page.getByTestId("pr-block").getByText("Alice asks the team")).toBeVisible();
      await checkLayout(page, `start-author-filter-all-${combo.name}`);
      await page.screenshot({ path: `${SHOTS}/start-author-filter-all-${combo.name}.png` });
    });
  }

  async function expectTrigger(page: import("@playwright/test").Page, text: string): Promise<void> {
    await expect(page.getByLabel("Author", { exact: true })).toHaveValue(text, { timeout: 15_000 });
  }

  async function pickAuthor(page: import("@playwright/test").Page, option: string): Promise<void> {
    await page.getByLabel("Author", { exact: true }).click();
    const target = openPopup(page).getByRole("option", { name: option });
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await target.click();
  }
});
