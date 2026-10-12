/**
 * Front screen (PRD §4.2): the page follows one chosen repo — the top-bar
 * selector filters the Reviews list, PR/branch lists and the PR opener —
 * plus the demo row under Reviews and readiness callouts.
 *
 * Mock mode: two prior sessions on urllib3 (demo ready, r-old
 * stale+running), a remembered repo (urllib3/urllib3) plus a detected
 * checkout (you/demo-lib), the demo entry, PR-by-URL-or-number, and a
 * healthy readiness report (overridable via localStorage for the callout
 * case). Repos are added in Settings, not here.
 */
import { test, expect } from "./network-guard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
});

test("repo selector lists remembered and detected repos, persisted", async ({ page }) => {
  const sel = page.getByLabel("Repo");
  await expect(sel).toHaveValue("urllib3");
  await expect(sel.locator('optgroup[label="Repos"] option')).toHaveText(["urllib3/urllib3"]);
  await expect(sel.locator('optgroup[label="Found on this machine"] option')).toHaveText(["you/demo-lib"]);
  // The detected option carries its local path as the title.
  await expect(sel.locator('optgroup[label="Found on this machine"] option')).toHaveAttribute(
    "title",
    "~/code/demo-lib",
  );
  await sel.selectOption("demo-lib");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByLabel("Repo")).toHaveValue("demo-lib");
});

test("reviews list follows the selected repo; demo row always shows", async ({ page }) => {
  // Default selection (urllib3): both prior sessions, most recent first.
  const sessions = page.locator('[data-testid^="session-"]');
  await expect(sessions).toHaveCount(2);
  await expect(sessions.nth(0)).toHaveAttribute("data-testid", "session-demo");
  await expect(sessions.nth(1)).toHaveAttribute("data-testid", "session-r-old");

  const demo = page.locator('[data-testid="session-demo"]');
  await expect(demo).toContainText("Unfold obsolete folded response header values");
  await expect(demo).toContainText("urllib3/urllib3");
  await expect(demo).toContainText("#5020");
  await expect(demo).toContainText("hunks reviewed");
  await expect(demo).toContainText("Guide ready");

  const old = page.locator('[data-testid="session-r-old"]');
  await expect(old).toContainText("Fix retry backoff on 429s");
  await expect(old).toContainText("new commits");
  await expect(old).toContainText("Checking findings…");

  // The demo row sits inside the Reviews list regardless of the repo.
  await expect(page.locator('[data-testid="demo-entry"]')).toContainText("Demo · no agent needed");

  // Switch to the detected checkout: its sessions list is empty, but the
  // demo row stays.
  await page.getByLabel("Repo").selectOption("demo-lib");
  await expect(page.locator('[data-testid^="session-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="sessions-empty"]')).toContainText("No reviews for you/demo-lib yet");
  await expect(page.locator('[data-testid="demo-entry"]')).toBeVisible();

  // Switch back: the repo's sessions return.
  await page.getByLabel("Repo").selectOption("urllib3");
  await expect(page.locator('[data-testid^="session-"]')).toHaveCount(2);

  // Click resumes the review.
  await demo.locator("button.cj").click();
  await expect(page).toHaveURL(/\/review\/demo/);
});

test("demo row opens the fixture review", async ({ page }) => {
  await page.locator('[data-testid="demo-entry"] button').click();
  await expect(page).toHaveURL(/\/review\/demo/);
});

test("failing lists keep the PR input, show an error with Retry, and recover", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "unvibe.mock.repoChangesFail",
      JSON.stringify(["authoring", "review-requested", "recent"]),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  // The PR input does not wait on the lists.
  await expect(page.getByLabel("Open a PR by URL or number")).toBeVisible();
  const err = page.locator('[data-testid="lists-error"]');
  await expect(err).toContainText("Couldn't load urllib3/urllib3's lists: mock gh is down");
  await expect(err.getByRole("button", { name: "Retry" })).toBeVisible();
  // No sections underneath until the load succeeds.
  await expect(page.getByText("Your PRs")).toHaveCount(0);
  // Retry recovers once the failure clears.
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesFail"));
  await err.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Your PRs")).toBeVisible();
  await expect(page.locator('[data-testid="lists-error"]')).toHaveCount(0);
});

test("a partial lists failure shows per-section errors while branches still render", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "unvibe.mock.repoChangesFail",
      JSON.stringify(["authoring", "review-requested"]),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.locator('[data-testid="changes-error-authoring"]')).toContainText("mock gh is down");
  await expect(page.locator('[data-testid="changes-error-requested"]')).toContainText("mock gh is down");
  // Branches are local: they still render, and no whole-load error shows.
  await expect(page.getByText("Recent branches")).toBeVisible();
  await expect(page.locator('[data-testid="lists-error"]')).toHaveCount(0);
  await page.locator("main .ci button").filter({ hasText: "fix-obs-fold" }).first().click();
  await expect(page).toHaveURL(/\/review\//);
});

test("held lists show loading without stale rows and keep the PR input", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unvibe.mock.repoChangesHold", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  // Reviews and the demo row do not wait on the lists.
  await expect(page.locator('[data-testid="session-demo"]')).toBeVisible();
  await expect(page.locator('[data-testid="demo-entry"]')).toBeVisible();
  // The lists area shows loading, not sections, with the PR input usable.
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toContainText("Loading urllib3/urllib3…");
  await expect(page.getByLabel("Open a PR by URL or number")).toBeVisible();
  await expect(page.getByText("Your PRs")).toHaveCount(0);
  // Switching repos while held: still loading, never the old repo's rows.
  await page.getByLabel("Repo").selectOption("demo-lib");
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toContainText("Loading you/demo-lib…");
  await expect(page.getByText("#5020 · fix-obs-fold · you")).toHaveCount(0);
  // Release: the new selection's lists render.
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
  await expect(page.getByText("Your PRs")).toBeVisible();
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toHaveCount(0);
});

test("re-selecting the current repo reloads its lists", async ({ page }) => {
  await expect(page.getByText("Your PRs")).toBeVisible();
  // Hold live (addInitScript would only apply after a re-navigation).
  await page.evaluate(() => localStorage.setItem("unvibe.mock.repoChangesHold", "1"));
  // Re-selecting the already-selected value still fires change and must
  // pair the cleared lists with a fresh load — never a stuck "Loading…".
  await page.getByLabel("Repo").selectOption("urllib3");
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toContainText("Loading urllib3/urllib3…");
  await expect(page.getByText("Your PRs")).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
  await expect(page.getByText("Your PRs")).toBeVisible();
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toHaveCount(0);
});

test("reviews for checkouts no longer listed stay openable and removable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "unvibe.mock.extraSessions",
      JSON.stringify([
        {
          id: "r-gone",
          repoId: "gone-repo",
          repoOwner: "gone",
          repoName: "gone",
          title: "Work on a removed checkout",
          branch: "old-branch",
          createdAt: Date.now() - 86400000 * 3,
          lastOpened: Date.now() - 86400000 * 2,
          versionCount: 1,
          currentVersion: 1,
          stale: false,
          totalHunks: 8,
          reviewedHunks: 0,
          pendingComments: 0,
          guideStatus: "idle",
        },
      ]),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  const group = page.locator('[data-testid="orphan-sessions"]');
  await expect(group.locator('[data-testid="orphan-sessions-label"]')).toContainText(
    "no longer in your list",
  );
  const row = group.locator('[data-testid="session-r-gone"]');
  await expect(row).toContainText("gone/gone");
  await expect(row).toContainText("Work on a removed checkout");
  // Open works.
  await row.locator("button.cj").click();
  await expect(page).toHaveURL(/\/review\/r-gone/);
  // Remove works.
  await page.goto("/");
  await expect(group.locator('[data-testid="session-r-gone"]')).toBeVisible();
  await group.getByRole("button", { name: /Remove/ }).click();
  await expect(group).toContainText("Remove this review from Unvibe? Nothing changes on GitHub.");
  await group.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(group.locator('[data-testid="session-r-gone"]')).toHaveCount(0);
  // The other rows are untouched.
  await expect(page.locator('[data-testid="session-demo"]')).toBeVisible();
});

test("remove asks to confirm and deletes local data only", async ({ page }) => {
  const old = page.locator('[data-testid="session-r-old"]');
  await old.getByRole("button", { name: /Remove/ }).click();
  await expect(old).toContainText("Remove this review from Unvibe? Nothing changes on GitHub.");
  await old.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator('[data-testid="session-r-old"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="session-demo"]')).toBeVisible();
});

test("PR by number opens a review; a URL for another known repo switches the selector; bad input errors", async ({
  page,
}) => {
  // The remembered repo is selected by default; a number opens its PR.
  await page.getByLabel("Open a PR by URL or number").fill("5020");
  await page.getByRole("button", { name: "Open PR" }).click();
  await expect(page).toHaveURL(/\/review\/demo/, { timeout: 15000 });

  // A URL for a different known repo opens it and switches the selector.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await page.getByLabel("Open a PR by URL or number").fill("https://github.com/you/demo-lib/pull/7");
  await page.getByRole("button", { name: "Open PR" }).click();
  await expect(page).toHaveURL(/\/review\/demo/, { timeout: 15000 });
  await page.goto("/");
  await expect(page.getByLabel("Repo")).toHaveValue("demo-lib");

  await page.getByLabel("Repo").selectOption("urllib3");
  await page.getByLabel("Open a PR by URL or number").fill("not a pr!!!");
  await page.getByRole("button", { name: "Open PR" }).click();
  await expect(page.getByText("Enter a PR number")).toBeVisible();
});

test("healthy readiness shows a ready indicator and no callouts", async ({ page }) => {
  await expect(page.locator('[data-testid="readiness-ready"]')).toBeVisible();
  await expect(page.locator('[data-testid^="readiness-callout-"]')).toHaveCount(0);
  // Model pickers show inline ok status.
  await page.goto("/settings");
  await expect(page.locator('[data-testid="model-main-status"]')).toContainText("ready");
});

test("failing readiness shows compact callouts linking to Settings", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "unvibe.mock.readiness",
      JSON.stringify({
        checks: [
          { id: "git", label: "git", status: "ok", summary: "git found", fix: "", settingsAnchor: "#environment" },
          {
            id: "gh",
            label: "gh (GitHub CLI)",
            status: "error",
            summary: "gh not logged in",
            fix: "Run gh auth login, then Re-check.",
            settingsAnchor: "#environment",
          },
          { id: "agent:main", label: "Main model", status: "ok", summary: "ready", fix: "", settingsAnchor: "#models" },
          { id: "agent:small", label: "Small model", status: "ok", summary: "ready", fix: "", settingsAnchor: "#models" },
          { id: "agent:secondOpinion", label: "Second-opinion model", status: "ok", summary: "ready", fix: "", settingsAnchor: "#models" },
          { id: "agents-distinct", label: "Second opinion independence", status: "ok", summary: "ok", fix: "", settingsAnchor: "#models" },
        ],
        generatedAt: Date.now(),
        cached: false,
      }),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  const callout = page.locator('[data-testid="readiness-callout-gh"]');
  await expect(callout).toContainText("gh not logged in");
  await expect(callout.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings?tab=environment");
  // Starting a local-branch review stays possible: the hint says what needs gh.
  await expect(page.locator('[data-testid="newreview-gh-hint"]')).toContainText("Listing PRs needs gh");
});

test("pasting a PR URL for an unknown repo offers to clone it, then selects the repo and opens the PR", async ({
  page,
}) => {
  await page.getByLabel("Open a PR by URL or number").fill("https://github.com/acme/app/pull/123");
  await page.getByRole("button", { name: "Open PR" }).click();
  const offer = page.locator('[data-testid="pr-clone-offer"]');
  await expect(offer).toContainText("acme/app isn't in your repos. Clone it and open #123?");
  await offer.getByRole("button", { name: "Clone and open #123" }).click();
  // Clone, select, open: the mock review opens and the selector follows.
  await expect(page).toHaveURL(/\/review\//, { timeout: 15000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByLabel("Repo")).toHaveValue("managed-acme-app");
  await expect(page.getByLabel("Repo").locator('option[value="managed-acme-app"]')).toContainText(
    "acme/app (cloned)",
  );
});

test("pasting owner/name#N for an unknown repo offers the same clone flow", async ({ page }) => {
  await page.getByLabel("Open a PR by URL or number").fill("acme/app#7");
  await page.getByRole("button", { name: "Open PR" }).click();
  const offer = page.locator('[data-testid="pr-clone-offer"]');
  await expect(offer).toContainText("acme/app isn't in your repos. Clone it and open #7?");
  await offer.getByRole("button", { name: "Clone and open #7" }).click();
  await expect(page).toHaveURL(/\/review\//, { timeout: 15000 });
});

test("cancelling the clone offer leaves the input as typed", async ({ page }) => {
  const input = page.getByLabel("Open a PR by URL or number");
  await input.fill("https://github.com/acme/app/pull/123");
  await page.getByRole("button", { name: "Open PR" }).click();
  const offer = page.locator('[data-testid="pr-clone-offer"]');
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Cancel" }).click();
  await expect(offer).toHaveCount(0);
  await expect(input).toHaveValue("https://github.com/acme/app/pull/123");
  // Nothing was added: the selector still offers only the seeds.
  await expect(page.getByLabel("Repo")).toHaveValue("urllib3");
  await expect(page).toHaveURL("/");
});

test("a stale managed clone shows the refresh note once", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unvibe.mock.repoChangesFetchError", "couldn't refresh the local clone (offline?)");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  // Three lists calls carry the same note; the page shows it exactly once.
  const note = page.locator('[data-testid="fetch-note"]');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("couldn't refresh the local clone");
  // The lists still render underneath.
  await expect(page.getByText("Your PRs")).toBeVisible();
});

test("fresh install: paste a PR URL, clone, repo selected, PR opens", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unvibe.mock.noRepos", "1");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  // Both routes in: paste a PR URL here, or add a repo in Settings.
  const empty = page.locator('[data-testid="no-repos"]');
  await expect(empty).toContainText("Paste a PR URL below");
  await expect(empty.getByRole("link", { name: "add one in Settings" })).toHaveAttribute(
    "href",
    "/settings?tab=repositories",
  );
  // No repos, no selector yet.
  await expect(page.getByLabel("Repo")).toHaveCount(0);
  // A bare number still needs a repo first.
  await empty.getByLabel("Open a PR by URL or number").fill("5020");
  await empty.getByRole("button", { name: "Open PR" }).click();
  await expect(empty).toContainText("Add a repo in Settings first");
  // A PR URL offers the clone.
  await empty.getByLabel("Open a PR by URL or number").fill("https://github.com/acme/app/pull/123");
  await empty.getByRole("button", { name: "Open PR" }).click();
  const offer = page.locator('[data-testid="pr-clone-offer"]');
  await expect(offer).toContainText("acme/app isn't in your repos. Clone it and open #123?");
  await offer.getByRole("button", { name: "Clone and open #123" }).click();
  await expect(page).toHaveURL(/\/review\//, { timeout: 15000 });
  // Back on the start page the selector exists with the clone selected.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByLabel("Repo")).toHaveValue("managed-acme-app");
  await expect(page.locator('[data-testid="no-repos"]')).toHaveCount(0);
});
