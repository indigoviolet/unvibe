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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { checkLayout } from "../layout-check.js";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, git, makeScratchRepo, realGitPath, writeFakeGitOffline } from "./journey-helpers.js";

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

function pr(n: number, title: string, author: string, updatedAt = new Date().toISOString()): FakePr {
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

// 35 direct review requests: alice/bob share the first 30, carol owns the
// last 5 (past the first page). diana owns one PR reachable only through
// `--author diana` (typed search for a login the first page never shows).
// #307: yara's direct request likewise sits in the direct pools but on no
// team-inclusive page — and it is two days old, so the recency checks
// below can tell a capped-page drop from a window filter. It must show
// under All anyway (union of both searches).
const DIRECT_CORE: FakePr[] = Array.from({ length: 35 }, (_, i) => {
  const n = 301 + i;
  const author = i < 30 ? (i % 2 === 0 ? "alice" : "bob") : "carol";
  return pr(n, author === "carol" ? `Carol late ask ${n}` : `Review ask ${n}`, author);
});
const YARA_UPDATED_AT = new Date(Date.now() - 2 * 86400_000).toISOString();
const YARA: FakePr[] = [pr(336, "Yara's direct-only ask", "yara", YARA_UPDATED_AT)];
const DIRECT_FULL: FakePr[] = [...YARA, ...DIRECT_CORE];
const DIRECT_30 = DIRECT_FULL.slice(0, 30);
const TEAM: FakePr[] = [pr(401, "Alice asks the team", "alice"), pr(402, "Bob asks the team", "bob")];
const AUTHORING: FakePr[] = [pr(101, "My folded-header PR", "you"), pr(102, "My unfolding PR", "you")];
const DIANA: FakePr[] = [pr(501, "Diana's special ask", "diana")];
// Per-login direct pools (diana's and yara's PRs exist only for `--author`).
const DIRECT_BY_LOGIN: Record<string, FakePr[]> = {
  alice: pool(DIRECT_FULL, "alice"),
  bob: pool(DIRECT_FULL, "bob"),
  carol: pool(DIRECT_FULL, "carol"),
  diana: DIANA,
  yara: YARA,
};

function pool(rows: FakePr[], login: string): FakePr[] {
  return rows.filter((p) => p.author.login === login);
}

function writeFakeGhPaging(binDir: string, logDir: string, poolDir: string): void {
  const teamFull = [...DIRECT_CORE, ...TEAM];
  const team30 = teamFull.slice(0, 30);
  const teamFor = (login: string): FakePr[] => [...(DIRECT_BY_LOGIN[login] ?? []), ...pool(TEAM, login)];
  for (const [name, rows] of Object.entries({
    authoring: AUTHORING,
    direct30: DIRECT_30,
    directFull: DIRECT_FULL,
    // The team-inclusive search is a superset: it returns the direct
    // requests too. Sliced from its own pool (not the direct page), so
    // a direct-only PR (#307: yara) can sit on one page but past the other.
    team30,
    teamFull,
    "direct-alice": DIRECT_BY_LOGIN.alice,
    "direct-bob": DIRECT_BY_LOGIN.bob,
    "direct-carol": DIRECT_BY_LOGIN.carol,
    "direct-diana": DIRECT_BY_LOGIN.diana,
    "direct-yara": DIRECT_BY_LOGIN.yara,
    "team-yara": teamFor("yara"),
    "team-alice": teamFor("alice"),
    "team-bob": teamFor("bob"),
    "team-carol": teamFor("carol"),
    "team-diana": teamFor("diana"),
  }) as [string, FakePr[]][]) {
    writeFileSync(path.join(poolDir, `${name}.json`), JSON.stringify(rows));
  }
  const script = `#!/bin/sh
POOL="${poolDir}"
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  case "$*" in
    *"--author @me"*) cat "$POOL/authoring.json"; exit 0 ;;
    *"--author"*)
      login=$(printf '%s' "$*" | sed -n 's/.*--author \\([^ ]*\\).*/\\1/p')
      case "$*" in
        *"user-review-requested:@me"*) f="$POOL/direct-$login.json" ;;
        *) f="$POOL/team-$login.json" ;;
      esac
      if [ -f "$f" ]; then cat "$f"; else echo '[]'; fi
      exit 0 ;;
    *"user-review-requested:@me"*)
      case "$*" in *"--limit 30"*) cat "$POOL/direct30.json" ;; *) cat "$POOL/directFull.json" ;; esac
      exit 0 ;;
    *"review-requested:@me"*)
      case "$*" in *"--limit 30"*) cat "$POOL/team30.json" ;; *) cat "$POOL/teamFull.json" ;; esac
      exit 0 ;;
  esac
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
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await target.click();
  }

  for (const combo of [
    { name: "1440-light", width: 1440, dark: false },
    { name: "1440-dark", width: 1440, dark: true },
    { name: "960-light", width: 960, dark: false },
    { name: "960-dark", width: 960, dark: true },
  ] as const) {
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

      // Load more brings in rows past 30, and their authors join the filter.
      await prBlock.getByTestId("lists-load-more").click();
      await expect(prBlock.getByText("Carol late ask 335")).toBeVisible({ timeout: 30_000 });
      await expect(prBlock.getByText("Load more PRs")).toHaveCount(0);
      // The loaded-more list, framed with its new rows.
      await prBlock.getByText("Carol late ask 335").scrollIntoViewIfNeeded();
      await checkLayout(page, `start-pr-list-more-loaded-${combo.name}`);
      await page.screenshot({ path: `${SHOTS}/start-pr-list-more-loaded-${combo.name}.png` });
      await page.getByLabel("Author", { exact: true }).click();
      await expect(openPopup(page).getByRole("option", { name: "carol (5)" })).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press("Escape");

      // Typing a login absent from every loaded row fetches that author's
      // PRs from GitHub (`gh pr list --author`).
      await prBlock.getByLabel("Author", { exact: true }).fill("diana");
      await prBlock.getByLabel("Author", { exact: true }).press("Enter");
      await expect(prBlock.getByText("Diana's special ask")).toBeVisible({ timeout: 30_000 });
      await expect(prBlock.getByText("Review ask 301")).toHaveCount(0);
      await expect(page.getByLabel("Author", { exact: true })).toHaveValue("diana (1)");
      const calls = readFileSync(path.join(logDir, "calls.log"), "utf8");
      expect(calls).toContain("--author diana");
      // The committed search keeps the single control inside the card.
      await expectAuthorControlFits(page);

      await checkLayout(page, `start-pr-list-more-${combo.name}`);
      await page.screenshot({ path: `${SHOTS}/start-pr-list-more-${combo.name}.png` });
    });
  }
});
