/**
 * Tour: start page (package D re-adds the frames packages A removed
 * from the gate in #363).
 *
 * On-demand only (`mise run visual-tour`): the start-page states the
 * owner reviews as frames — author-filter bob/all, the author-combo
 * rest/typing states, the Load-more button/loaded/error states, the
 * stacked badges/popover/header badge (1440 + the 960 named keep), and
 * the review-bar PR link with the icon inside it. Behaviour for all of
 * these lives in `e2e/journeys/l1-start.spec.ts`; this file keeps just
 * enough asserts to prove each framed state.
 *
 * Slim set: 1440px light Default plus the `tour-matrix.ts` named keeps;
 * the full matrix runs with `UNVIBE_TOUR_MATRIX=full`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { tourCombos } from "../tour-matrix.js";
import {apiJson, createScratchReview, git, makeScratchRepo, realGitPath, writeFakeGitOffline, writeFakeShell, fakeServicePath} from "../journeys/journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
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


/** Settle Floating UI first: scrolling the option into view repositions
 * the popup, and clicking mid-reposition can land outside the item
 * (popup closes with no selection). Wait until the option's box stops
 * moving instead of sleeping a fixed window (#363 B2). */
async function settleOption(page: import("@playwright/test").Page, target: import("@playwright/test").Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  let prev = "";
  await expect
    .poll(
      async () => {
        const b = await target.boundingBox();
        const cur = b ? `${b.x},${b.y},${b.width},${b.height}` : "hidden";
        const settled = prev !== "" && cur !== "hidden" && cur === prev;
        prev = cur;
        return settled;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
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
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: fakeServicePath(fakeBin) },
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
    await settleOption(page, target);
    await target.click();
  }
});

// ---- Load more + author search (from j297, frames re-added) ----
/** J297 (#297): start-page Load more + typed author search.
 *
 * The fake `gh` honours `--limit` (first-30 slice vs the full 35) and
 * `--author` (per-login pools), so the service's paging is real: the
 * first page holds 30 of 35 review requests, Load more fetches the rest
 * (and the author list grows to include the late authors), and typing a
 * login absent from the first page fetches that author's PRs.
 * `checkLayout` (#225) runs on the list in both variants. No real `gh`,
 * no network: everything else exits 1 (best-effort listings).
 */



interface FakePr297 {
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

function pr297(n: number, title: string, author: string, updatedAt = new Date().toISOString()): FakePr297 {
  return {
    number: n,
    title,
    author: { login: author },
    updatedAt,
    headRefName: `ask-branch-${n}`,
    additions: 10 + n,
    deletions: n,
    changedFiles: 2,
    url: `https://github.com/acme/widgets/pull/${n}`,
    reviewRequests: [],
    state: "OPEN",
    isDraft: false,
  };
}

// Direct review requests: alice/bob share the first 30, carol owns the
// next 5 (past the first page); 60 more follow so Load more pages three
// times before the stubbed failure. diana owns one PR reachable only
// through `--author diana` (typed search for a login the first page never shows).
// #307: yara's direct request likewise sits in the direct pools but on no
// team-inclusive page — and it is two days old, so the recency checks
// below can tell a capped-page drop from a window filter. It must show
// under All anyway (union of both searches).
const DIRECT_CORE: FakePr297[] = Array.from({ length: 35 }, (_, i) => {
  const n = 301 + i;
  const author = i < 30 ? (i % 2 === 0 ? "alice" : "bob") : "carol";
  return pr297(n, author === "carol" ? `Carol late ask ${n}` : `Review ask ${n}`, author);
});
const YARA_UPDATED_AT = new Date(Date.now() - 2 * 86400_000).toISOString();
const YARA: FakePr297[] = [pr297(336, "Yara's direct-only ask", "yara", YARA_UPDATED_AT)];
// #310: enough rows for three Load more presses (30 per page) plus a
// failing fourth page. Team-inclusive pages mirror the same ranges.
const EXTRA: FakePr297[] = Array.from({ length: 60 }, (_, i) => {
  const n = 336 + i;
  return pr297(n, `Review ask ${n}`, i % 2 === 0 ? "alice" : "bob");
});
const TEAM297: FakePr297[] = [pr297(401, "Alice asks the team", "alice"), pr297(402, "Bob asks the team", "bob")];
const AUTHORING297: FakePr297[] = [pr297(101, "My folded-header PR", "you"), pr297(102, "My unfolding PR", "you")];
const DIANA: FakePr297[] = [pr297(501, "Diana's special ask", "diana")];
const DIRECT_FULL: FakePr297[] = [...YARA, ...DIRECT_CORE, ...EXTRA];
const DIRECT_PAGES: FakePr297[][] = [
  DIRECT_FULL.slice(0, 30),
  DIRECT_FULL.slice(30, 60),
  DIRECT_FULL.slice(60, 90),
  DIRECT_FULL.slice(90),
];
const TEAM_FULL: FakePr297[] = [...DIRECT_CORE, ...EXTRA, ...TEAM297];
const TEAM_PAGES: FakePr297[][] = [
  TEAM_FULL.slice(0, 30),
  TEAM_FULL.slice(30, 60),
  TEAM_FULL.slice(60, 90),
  TEAM_FULL.slice(90),
];
// Per-login direct pools (diana's and yara's PRs exist only for `--author`).
const DIRECT_BY_LOGIN: Record<string, FakePr297[]> = {
  alice: pool(DIRECT_FULL, "alice"),
  bob: pool(DIRECT_FULL, "bob"),
  carol: pool(DIRECT_FULL, "carol"),
  diana: DIANA,
  yara: YARA,
};

function pool(rows: FakePr297[], login: string): FakePr297[] {
  return rows.filter((p) => p.author.login === login);
}

/**
 * Fake `gh api graphql` answering paged `search` calls (#310). Each page
 * carries up to 30 rows plus `pageInfo` (the service pages with `after:`,
 * never re-fetching). A 0.2s sleep simulates a realistic round trip. The
 * direct search fails on its fourth page, so Load more's third press
 * surfaces the inline error + Retry with all earlier rows kept.
 */
function toNode297(p: FakePr297): unknown {
  return {
    __typename: "PullRequest",
    number: p.number,
    title: p.title,
    author: p.author,
    updatedAt: p.updatedAt,
    headRefName: p.headRefName,
    additions: p.additions,
    deletions: p.deletions,
    changedFiles: p.changedFiles,
    url: p.url,
    state: p.state,
    isDraft: p.isDraft,
    ...((p as { reviewDecision?: string }).reviewDecision ? { reviewDecision: (p as { reviewDecision?: string }).reviewDecision } : {}),
    reviewRequests: {
      nodes: (p.reviewRequests ?? []).map((r) => ({ requestedReviewer: r })),
    },
    latestReviews: { nodes: (p as { latestReviews?: unknown[] }).latestReviews ?? [] },
  };
}

function searchPage297(rows: FakePr297[], endCursor: string | null, hasNextPage: boolean): string {
  return JSON.stringify({
    data: {
      search: {
        pageInfo: { hasNextPage, endCursor },
        nodes: rows.map(toNode297),
      },
    },
  });
}

function writeFakeGhPaging(binDir: string, logDir: string, poolDir: string): void {
  const teamFor = (login: string): FakePr297[] => [...(DIRECT_BY_LOGIN[login] ?? []), ...pool(TEAM297, login)];
  for (const [name, page, cursor, more] of [
    ["authoring", AUTHORING297, null, false],
    ["direct-p1", DIRECT_PAGES[0], "d1", true],
    ["direct-p2", DIRECT_PAGES[1], "d2", true],
    ["direct-p3", DIRECT_PAGES[2], "d3", true],
    ["team-p1", TEAM_PAGES[0], "t1", true],
    ["team-p2", TEAM_PAGES[1], "t2", true],
    ["team-p3", TEAM_PAGES[2], "t3", true],
    ["team-p4", TEAM_PAGES[3], null, false],
    ["direct-diana", DIRECT_BY_LOGIN.diana, null, false],
    ["team-diana", teamFor("diana"), null, false],
  ] as [string, FakePr297[], string | null, boolean][]) {
    writeFileSync(path.join(poolDir, `${name}.json`), searchPage297(page, cursor, more));
  }
  const script = `#!/bin/sh
POOL="${poolDir}"
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
sleep 0.2
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  case "$*" in
    *"author:@me"*) cat "$POOL/authoring.json" ;;
    *"author:"*)
      login=$(printf '%s' "$*" | sed -n 's/.*author:\\([A-Za-z@-]*\\).*/\\1/p')
      case "$*" in
        *"user-review-requested:@me"*) f="$POOL/direct-$login.json" ;;
        *) f="$POOL/team-$login.json" ;;
      esac
      if [ -f "$f" ]; then cat "$f"; else echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}'; fi
      ;;
    *"user-review-requested:@me"*)
      case "$*" in
        *"after=d1"*) cat "$POOL/direct-p2.json" ;;
        *"after=d2"*) cat "$POOL/direct-p3.json" ;;
        *"after=d3"*) echo "fake gh: review search page 4 is down" >&2; exit 1 ;;
        *) cat "$POOL/direct-p1.json" ;;
      esac
      ;;
    *"review-requested:@me"*)
      case "$*" in
        *"after=t1"*) cat "$POOL/team-p2.json" ;;
        *"after=t2"*) cat "$POOL/team-p3.json" ;;
        *"after=t3"*) cat "$POOL/team-p4.json" ;;
        *) cat "$POOL/team-p1.json" ;;
      esac
      ;;
    *) echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}'; ;;
  esac
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"reviewer"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as reviewer"; exit 0; fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("J297 start-page Load more + author search", () => {
  let repoDir = "";
  let dataDir = "";
  let logDir = "";
  let poolDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let repoId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j297-repo-"));
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j297-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j297-gh-"));
    poolDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j297-pool-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j297-bin-"));
    await makeScratchRepo(repoDir);
    // An origin remote: without one the repo registers as owner "local"
    // and the gh-backed PR lists stay empty.
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/widgets.git");
    writeFakeGhPaging(fakeBin, logDir, poolDir);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: fakeServicePath(fakeBin) },
    });
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
    const registered = list.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
    repoId = registered.id;
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, poolDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  /**
   * #297 combobox follow-up: the separate search box is gone, so the
   * old no-overlap assertion is moot. What remains is that the single
   * control fits: fully inside the PR card, horizontally (checkLayout
   * already asserts container overflow; this names the control).
   */
  async function expectAuthorControlFits(page: import("@playwright/test").Page): Promise<void> {
    await expect(page.getByLabel("Search author by login")).toHaveCount(0);
    const box = await page.getByLabel("Author", { exact: true }).boundingBox();
    const card = await page.getByTestId("pr-block").boundingBox();
    expect(box, "author combobox is visible").not.toBeNull();
    expect(card, "PR card is visible").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(card!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
  }

  /** Pick an option from a Base UI Select by label (recency filter). */
  async function pickSelectOption(page: import("@playwright/test").Page, label: string, option: string): Promise<void> {
    await page.getByLabel(label, { exact: true }).click();
    const target = openPopup(page).getByRole("option", { name: option });
    await settleOption(page, target);
    await target.click();
  }

  for (const combo of tourCombos("prListMore", [
    { name: "1440-light", width: 1440, dark: false },
    { name: "1440-dark", width: 1440, dark: true },
    { name: "960-light", width: 960, dark: false },
    { name: "960-dark", width: 960, dark: true },
  ] as const)) {
    test(`load more pages past 30 and typing an author fetches them (${combo.name})`, async ({ page }) => {
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

      // First page: rows 1..30 render, carol's late asks do not.
      await expect(prBlock.getByText("Review ask 301")).toBeVisible({ timeout: 30_000 });
      await expect(prBlock.getByText("Review ask 330")).toBeVisible();
      await expect(prBlock.getByText("Carol late ask 335")).toHaveCount(0);
      await expect(prBlock.getByText("Load more PRs")).toBeVisible();
      // The single author control fits inside the card; at rest it shows
      // the choice like the select did.
      await expectAuthorControlFits(page);
      await expect(page.getByLabel("Author", { exact: true })).toHaveValue("All");
      await prBlock.getByText("Waiting on your review").scrollIntoViewIfNeeded();
      await checkLayout(page, `start-author-combo-rest-${combo.name}`);
      await page.screenshot({ path: `${SHOTS}/start-author-combo-rest-${combo.name}.png` });

      // #307: a direct request past the capped team-inclusive page still
      // shows under All (the union of both searches), with a direct scope.
      await expect(prBlock.getByText("Yara's direct-only ask")).toBeVisible();
      // The recency window is not the cause: Yara's PR is two days old,
      // so it hides under "Last day" by design — and returns under All.
      await pickSelectOption(page, "Updated within", "Last day");
      await expect(prBlock.getByText("Yara's direct-only ask")).toHaveCount(0);
      await expect(prBlock.getByText("Review ask 301")).toBeVisible();
      await pickSelectOption(page, "Updated within", "All");
      await expect(prBlock.getByText("Yara's direct-only ask")).toBeVisible();

      // The Load more button, framed before it is used.
      await prBlock.getByTestId("lists-load-more").scrollIntoViewIfNeeded();
      await checkLayout(page, `start-pr-list-more-button-${combo.name}`);
      await page.screenshot({ path: `${SHOTS}/start-pr-list-more-button-${combo.name}.png` });

      // The author list knows only the first page's authors.
      await expect(page.getByLabel("Author", { exact: true })).toHaveValue("All");
      await page.getByLabel("Author", { exact: true }).click();
      await expect(openPopup(page).getByRole("option", { name: "alice (15)" })).toBeVisible({ timeout: 15_000 });
      await expect(openPopup(page).getByRole("option", { name: /carol/ })).toHaveCount(0);
      await page.keyboard.press("Escape");

      // Typing filters the dropdown to the matching authors (focusing
      // selects the shown choice, so typing replaces it) and opens it.
      await page.getByLabel("Author", { exact: true }).pressSequentially("ali");
      await expect(openPopup(page).getByRole("option", { name: "alice (15)" })).toBeVisible({ timeout: 15_000 });
      await expect(openPopup(page).getByRole("option", { name: /bob/ })).toHaveCount(0);
      // Capture the open filtered list before anything else runs.
      await page.screenshot({ path: `${SHOTS}/start-author-combo-typing-${combo.name}.png` });
      await checkLayout(page, `start-author-combo-typing-${combo.name}`);
      await page.keyboard.press("Escape");
      await expect(page.getByLabel("Author", { exact: true })).toHaveValue("All");

      // Load more appends the next page per search (#310: one page,
      // never a re-fetch), and new authors join the filter.
      await prBlock.getByTestId("lists-load-more").click();
      await expect(prBlock.getByText("Carol late ask 335")).toBeVisible({ timeout: 30_000 });
      await expect(prBlock.getByText("Review ask 360")).toBeVisible();
      await expect(prBlock.getByText("Load more PRs")).toBeVisible();
      // The loaded-more list, framed with its new rows.
      await prBlock.getByText("Carol late ask 335").scrollIntoViewIfNeeded();
      await checkLayout(page, `start-pr-list-more-loaded-${combo.name}`);
      await page.screenshot({ path: `${SHOTS}/start-pr-list-more-loaded-${combo.name}.png` });
      await page.getByLabel("Author", { exact: true }).click();
      await expect(openPopup(page).getByRole("option", { name: "carol (5)" })).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press("Escape");

      // A second press appends the next page after that.
      await prBlock.getByTestId("lists-load-more").click();
      await expect(prBlock.getByText("Review ask 375")).toBeVisible({ timeout: 30_000 });

      // A failing page (#310) keeps every shown row and offers Retry by
      // the button: the third page of the direct search is down.
      await prBlock.getByTestId("lists-load-more").click();
      const moreError = prBlock.getByTestId("lists-more-error");
      await expect(moreError).toHaveText("couldn't load the next page from GitHub");
      expect(await prBlock.getByText("Review ask 391").count()).toBe(0);
      await expect(prBlock.getByText("Review ask 375")).toBeVisible();
      await expect(prBlock.getByText("Yara's direct-only ask")).toBeVisible();
      const retry = prBlock.getByTestId("lists-load-more");
      await expect(retry).toHaveText("Retry");
      // Retry re-fires the same page and still fails: rows still kept.
      await retry.click();
      await expect(prBlock.getByTestId("lists-more-error")).toHaveText("couldn't load the next page from GitHub");
      await expect(prBlock.getByText("Review ask 375")).toBeVisible();
      // Frame the error state: every earlier row kept, Retry by the button.
      await prBlock.getByTestId("lists-load-more").scrollIntoViewIfNeeded();
      await checkLayout(page, `start-pr-list-more-error-${combo.name}`);
      await page.screenshot({ path: `${SHOTS}/start-pr-list-more-error-${combo.name}.png` });

      // Typing a login absent from every loaded row fetches that author's
      // PRs from GitHub (`gh api graphql` with `author:`).
      await prBlock.getByLabel("Author", { exact: true }).fill("diana");
      await prBlock.getByLabel("Author", { exact: true }).press("Enter");
      await expect(prBlock.getByText("Diana's special ask")).toBeVisible({ timeout: 30_000 });
      await expect(prBlock.getByText("Review ask 301")).toHaveCount(0);
      await expect(page.getByLabel("Author", { exact: true })).toHaveValue("diana (1)");
      const calls = readFileSync(path.join(logDir, "calls.log"), "utf8");
      expect(calls).toContain("author:diana");
      // The committed search keeps the single control inside the card.
      await expectAuthorControlFits(page);

      await checkLayout(page, `start-pr-list-more-${combo.name}`);
      await page.screenshot({ path: `${SHOTS}/start-pr-list-more-${combo.name}.png` });
    });
  }
});

// ---- Stacked PRs (from j321, frames re-added) ----
/** J321 (#321): stacked PR badges + popover against the real service with a stub gh (3-PR implicit stack). */


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
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, { agent: "none", extraEnv: { SHELL: fakeShell, PATH: fakeServicePath(fakeBin) } });
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
    // Row order follows recency, not stack order, and the stub stamps all
    // three PRs within the same millisecond — so the first row is not
    // always PR 11. Compare the set, never nth(0).
    const texts = (await badges.allTextContents()).map((t) => t.trim()).sort();
    expect(texts).toEqual(["1/3 ~", "2/3 ~", "3/3 ~"]);
    // All three share one colour.
    const colors = await badges.evaluateAll((els) => els.map((e) => getComputedStyle(e as HTMLElement).backgroundColor));
    expect(new Set(colors).size).toBe(1);
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
    // #321 follow-up: the header badge sits INSIDE the repo#PR button,
    // right after the PR number, in the stack colour.
    const headerBadge = page.getByTestId("stack-badge").first();
    const headerLink = page.locator("#reviewbar a.ui-btn").first();
    await expect(headerLink).toContainText("acme/widgets#11");
    expect(await headerBadge.evaluate((el) => el.closest("a.ui-btn") !== null)).toBe(true);
    expect(await headerBadge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(colors[0]);
    await page.locator("#reviewbar").screenshot({ path: path.join(SHOTS, "stack-header-badge-1440-light.png") });
    // Clicking the badge opens the popover, not the GitHub PR link.
    const pagesBefore = page.context().pages().length;
    await headerBadge.click();
    await expect(page.getByTestId("stack-popover")).toBeVisible();
    expect(page.context().pages().length).toBe(pagesBefore);
    await expect(page).toHaveURL(/\/review\//);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("stack-popover")).toHaveCount(0);
    // At 960 the bar still fits on one line with the badge inside.
    await page.setViewportSize({ width: 960, height: 900 });
    // Let the resized bar settle: poll until its height stops changing
    // instead of sleeping a fixed window (#363 B2).
    {
      let prevH = -1;
      await expect
        .poll(
          async () => {
            const h = await page.locator("#reviewbar").evaluate((el) => el.getBoundingClientRect().height);
            const settled = prevH !== -1 && h === prevH;
            prevH = h;
            return settled;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    }
    expect(await headerBadge.evaluate((el) => el.closest("a.ui-btn") !== null)).toBe(true);
    const fit960 = await page.evaluate(() => {
      const bar = document.getElementById("reviewbar")!;
      const kids = [...bar.children].map((el) => el.getBoundingClientRect());
      let overlap = false;
      for (let i = 0; i < kids.length; i++)
        for (let j = i + 1; j < kids.length; j++)
          if (kids[i].left < kids[j].right && kids[j].left < kids[i].right && kids[i].top < kids[j].bottom && kids[j].top < kids[i].bottom) overlap = true;
      return { h: bar.getBoundingClientRect().height, overlap, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    expect(fit960.overlap).toBe(false);
    expect(fit960.overflow).toBe(false);
    expect(fit960.h).toBeLessThan(64);
    await page.locator("#reviewbar").screenshot({ path: path.join(SHOTS, "stack-header-badge-960-light.png") });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Reviews list on the start page shows the badge too.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByTestId("stack-badge").first()).toBeVisible({ timeout: 30_000 });
  });
});

// ---- PR review bar (from j245, frames re-added) ----
/**
 * J245 (#245): the review bar on a PR review with the boxed GitHub link
 * and a status icon inside it — one frame at 1440 light (#362 default;
 * studio and console-dark in the full matrix only).
 *
 * Fake `gh` reports OPEN + APPROVED (open has no state icon, so the bar
 * shows the single Approved icon inside the link box). The scratch repo
 * carries a long `origin` remote
 * (`example-org/a-fairly-long-repository-name`), so the link reads
 * `example-org/a-fairly-long-repository-name#7502`: the box must grow to
 * fit the text without clipping or overflowing the bar, and the icon
 * must still sit inside, after the number. Every control is one height
 * and centred, with `checkLayout` on each frame — against the real
 * service, no agent.
 */



const LONG_OWNER = "example-org";
const LONG_NAME = "a-fairly-long-repository-name";
const PR_NUMBER = 7502;
const SHORT = `${LONG_OWNER}/${LONG_NAME}#${PR_NUMBER}`;

/** Fake `gh`: OPEN + APPROVED with the call-time feature head, so the bar shows one icon. */
function writeFakeGhApproved(binDir: string, logDir: string, repoDir: string): void {
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  HEAD=$(git -C "${repoDir}" rev-parse feature 2>/dev/null || echo "unknown")
  cat <<EOF
{"title":"Long name PR","body":"First paragraph.","author":{"login":"author"},"state":"OPEN","isDraft":false,"reviewDecision":"APPROVED","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"$HEAD"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as author"; exit 0; fi
case "$*" in *pulls/*/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("J245 PR review bar frames (boxed link, icon inside)", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j245-repo-"));
    await makeScratchRepo(repoDir);
    // Long repo identity comes from the origin remote (deriveIdentity).
    await git(repoDir, "remote", "add", "origin", `https://github.com/${LONG_OWNER}/${LONG_NAME}.git`);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j245-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j245-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j245-bin-"));
    writeFakeGhApproved(fakeBin, logDir, repoDir);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: fakeServicePath(fakeBin) },
    });
    reviewId = await createScratchReview(svc, repoDir, { pr: PR_NUMBER });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  for (const combo of tourCombos("reviewbarPr", [
    { name: "studio-light", theme: "studio", scheme: "light", dark: false },
    { name: "default-light", theme: "default", scheme: "light", dark: false },
    { name: "console-dark", theme: "console", scheme: "dark", dark: true },
  ] as const)) {
    test(`PR bar with icon inside the link (${combo.theme} ${combo.scheme}, #245)`, async ({ page }) => {
      test.setTimeout(240_000);
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: 1440, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      // Theme is server-side truth; mirror it locally like Settings → Appearance does.
      const staged = await apiJson(svc, "PUT", "/api/settings", { uiTheme: combo.theme });
      expect(staged.status).toBe(200);
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("unvibe:ui-theme", t);
        } catch {
          // Boot falls back; the assert below fails.
        }
      }, combo.theme);

      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("html")).toHaveAttribute("data-ui-theme", combo.theme);
      await page.evaluate(() => document.fonts.ready).catch(() => {});

      // The long boxed link with the single Approved icon inside it.
      const bar = page.locator("#reviewbar");
      const link = bar.locator('a[title="Open PR on GitHub"]');
      await expect(link).toContainText(SHORT, { timeout: 15_000 });
      // Moved from start-lists.spec.ts (#258): the label links to the PR
      // without opening the review.
      await expect(link).toHaveAttribute(
        "href",
        `https://github.com/${LONG_OWNER}/${LONG_NAME}/pull/${PR_NUMBER}`,
      );
      await expect(link).toHaveAttribute("target", "_blank");
      const badges = link.locator('[data-testid="pr-badges"]');
      await expect(badges.getByRole("img", { name: "Approved" })).toBeVisible();
      await expect(badges.getByRole("img", { name: "Open" })).toHaveCount(0);
      // No sibling badges in the row — the icon lives inside the link.
      await expect(page.locator('#reviewbar > .rid > [data-testid="pr-badges"]')).toHaveCount(0);
      // The icon keeps its shared tooltip inside the link.
      await badges.getByRole("img", { name: "Approved" }).hover({ timeout: 15_000 });
      await expect(page.locator("#tip")).toContainText("Approved", { timeout: 15_000 });

      // Every control is one height and centred on one line (#245).
      const boxes = await bar.evaluate((el) => {
        const sels: [string, string][] = [
          ["home", 'a[aria-label="Back to the start page"]'],
          ["github", 'a[title="Open PR on GitHub"]'],
          ["refresh", 'button[aria-label="Refresh"]'],
          ["version", '[data-testid="version-switcher"] .ui-select'],
          ["debug", 'a[aria-label="Debug"]'],
          ["panes", ".seg"],
          ["comments", '[data-cm=""]'],
          ["submit", ".ra .ui-btn[data-variant='primary']"],
        ];
        return sels.flatMap(([name, sel]) => {
          const n = el.querySelector(sel);
          if (!n) return [];
          const r = n.getBoundingClientRect();
          return r.height > 0 ? [{ name, height: r.height, mid: r.top + r.height / 2 }] : [];
        });
      });
      expect(boxes.map((b) => b.name)).toEqual(expect.arrayContaining(["home", "github", "refresh", "panes", "comments", "submit"]));
      const h = boxes[0].height;
      for (const b of boxes) expect(Math.abs(b.height - h), `${b.name} height ${b.height} vs ${h}`).toBeLessThanOrEqual(1);
      const mids = boxes.map((b) => b.mid);
      expect(Math.max(...mids) - Math.min(...mids), JSON.stringify(boxes)).toBeLessThanOrEqual(1);

      // The long box grows to fit the text: no clipping in the link, no
      // overflow of the bar, and the icon sits inside the link, after the number.
      const fit = await bar.evaluate((el) => {
        const barEl = el;
        const linkEl = barEl.querySelector('a[title="Open PR on GitHub"]');
        const iconEl = linkEl?.querySelector('[data-testid="pr-badges"] [role="img"]');
        if (!linkEl) return null;
        const lr = linkEl.getBoundingClientRect();
        const ir = iconEl?.getBoundingClientRect() ?? null;
        return {
          linkClip: linkEl.scrollWidth - linkEl.clientWidth,
          barOverflow: barEl.scrollWidth - barEl.clientWidth,
          link: { left: lr.left, right: lr.right, height: lr.height, mid: lr.top + lr.height / 2 },
          icon: ir ? { left: ir.left, right: ir.right, mid: ir.top + ir.height / 2 } : null,
        };
      });
      expect(fit).not.toBeNull();
      expect(fit!.linkClip, "link text clipped").toBeLessThanOrEqual(1);
      expect(fit!.barOverflow, "bar overflows").toBeLessThanOrEqual(1);
      expect(fit!.icon).not.toBeNull();
      expect(fit!.icon!.left, "icon left of link text").toBeGreaterThanOrEqual(fit!.link.left - 1);
      expect(fit!.icon!.right, "icon outside link box").toBeLessThanOrEqual(fit!.link.right + 1);
      expect(Math.abs(fit!.icon!.mid - mids[0]), "icon not on the centre line").toBeLessThanOrEqual(1);

      await checkLayout(page, `reviewbar-pr-${combo.theme}-${combo.scheme}`);
      await bar.screenshot({ path: path.join(SHOTS, `reviewbar-pr-${combo.theme}-${combo.scheme}.png`) });
    });
  }
});
