/**
 * Front screen (PRD §4.2): the page follows one chosen repo — the repo
 * selector above Reviews filters the Reviews list, PR/branch lists and the
 * PR opener — plus the demo row under Reviews and readiness callouts.
 *
 * Mock mode: two prior sessions on urllib3 (demo ready, r-old
 * stale+running), a remembered repo (urllib3/urllib3) plus a detected
 * checkout (you/demo-lib), the demo entry, PR-by-URL-or-number, and a
 * healthy readiness report (overridable via localStorage for the callout
 * case). Repos are added in Settings, not here.
 */
import { test, expect } from "./network-guard.js";
import { openPopup, pickOption } from "./select.js";

async function gotoStart(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
}

test("repo selector lists remembered and detected repos, persisted", async ({ page }) => {
  await gotoStart(page);
  const sel = page.getByLabel("Repo", { exact: true });
  await expect(sel).toContainText("urllib3/urllib3");
  await sel.click();
  await expect(page.locator(".ui-select-grouplabel")).toContainText(["Repos", "Found on this machine"]);
  await expect(openPopup(page).getByRole("option", { name: "urllib3/urllib3" })).toBeVisible();
  await expect(openPopup(page).getByRole("option", { name: "you/demo-lib" })).toBeVisible();
  // The trigger carries the picked repo's local path as the title.
  await openPopup(page).getByRole("option", { name: "you/demo-lib" }).click();
  await expect(sel).toContainText("you/demo-lib");
  await expect(sel).toHaveAttribute("title", "~/code/demo-lib");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByLabel("Repo", { exact: true })).toContainText("you/demo-lib");
});

test("repo selector is the left-aligned page title, outside the top bar (#274)", async ({ page }) => {
  await gotoStart(page);
  await expect(page.locator("header.top").getByLabel("Repo", { exact: true })).toHaveCount(0);
  const sel = page.getByLabel("Repo", { exact: true });
  await expect(sel).toBeVisible();
  const headerBox = await page.locator("header.top").boundingBox();
  const selBox = await sel.boundingBox();
  const reviewsBox = await page.getByRole("heading", { name: "Reviews" }).boundingBox();
  // Below the top bar, but above the Reviews section it titles.
  expect(selBox?.y).toBeGreaterThan(headerBox?.y ?? 0);
  expect(selBox && reviewsBox ? selBox.y + selBox.height : 0).toBeLessThanOrEqual(
    reviewsBox?.y ?? 0,
  );
  // Left-aligned with the content column, not centred in it.
  const mainBox = await page.locator("main .doc").boundingBox();
  expect(selBox?.x ?? 0).toBeLessThanOrEqual((mainBox?.x ?? 0) + 120);
  const selCenter = (selBox?.x ?? 0) + (selBox?.width ?? 0) / 2;
  const mainCenter = (mainBox?.x ?? 0) + (mainBox?.width ?? 0) / 2;
  expect(mainCenter - selCenter).toBeGreaterThan(0);
  // Title-sized type.
  expect(await sel.evaluate((el) => getComputedStyle(el).fontSize)).toBe("24px");
});

test("ready indicator shows as a quiet content line, not in the top bar", async ({ page }) => {
  await gotoStart(page);
  await expect(page.locator("header.top").locator('[data-testid="readiness-ready"]')).toHaveCount(0);
  const ready = page.locator('[data-testid="readiness-ready"]');
  await expect(ready).toBeVisible();
  await expect(ready).toHaveText("Ready");
  const readyBox = await ready.boundingBox();
  const reviewsBox = await page.getByRole("heading", { name: "Reviews" }).boundingBox();
  expect(readyBox?.y).toBeGreaterThan(reviewsBox ? reviewsBox.y + reviewsBox.height : 0);
});

test("reviews list follows the selected repo; demo row always shows", async ({ page }) => {
  await gotoStart(page);
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
  // A finished guide shows no state text and no working indicator (#225).
  await expect(demo).not.toContainText("Guide ready");
  await expect(demo.getByRole("status")).toHaveCount(0);

  const old = page.locator('[data-testid="session-r-old"]');
  await expect(old).toContainText("Fix retry backoff on 429s");
  await expect(old).toContainText("new commits");
  // A running guide shows the app's working indicator, not a state line (#225).
  await expect(old.getByRole("status", { name: "Working" })).toBeVisible();
  await expect(old).not.toContainText("Checking findings…");

  // The demo row sits inside the Reviews list regardless of the repo.
  await expect(page.locator('[data-testid="demo-entry"]')).toContainText("Demo · no agent needed");

  // Switch to the detected checkout: its sessions list is empty, but the
  // demo row stays.
  await pickOption(page, "Repo", "you/demo-lib");
  await expect(page.locator('[data-testid^="session-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="sessions-empty"]')).toContainText("No reviews for you/demo-lib yet");
  await expect(page.locator('[data-testid="demo-entry"]')).toBeVisible();

  // Switch back: the repo's sessions return.
  await pickOption(page, "Repo", "urllib3/urllib3");
  await expect(page.locator('[data-testid^="session-"]')).toHaveCount(2);

  // Click resumes the review.
  await demo.locator("button.cj-open").click();
  await expect(page).toHaveURL(/\/review\/demo/);
});

test("failing lists keep the PR input, show an error with Retry, and recover", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "unvibe.mock.repoChangesFail",
      JSON.stringify(["authoring", "review-requested", "recent"]),
    );
  });
  // First load for the repo (no kept lists yet): the error shows alone.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  // The PR input does not wait on the lists.
  await expect(page.getByLabel("Open a PR by URL or number")).toBeVisible();
  const err = page.locator('[data-testid="lists-error"]');
  await expect(err).toContainText("Couldn't load PRs and branches for urllib3/urllib3: mock gh is down");
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
  await page.locator("main .ci", { hasText: "fix-obs-fold" }).first().locator("button.cj-open").click();
  await expect(page).toHaveURL(/\/review\//);
});

test("held lists show loading without stale rows and keep the PR input", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unvibe.mock.repoChangesHold", "1");
  });
  // First load for the repo (no kept lists yet): loading, not sections.
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
  await pickOption(page, "Repo", "you/demo-lib");
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toContainText("Loading you/demo-lib…");
  await expect(page.locator("main .ci", { hasText: "#5020 · fix-obs-fold" })).toHaveCount(0);
  // Release: the new selection's lists render.
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
  await expect(page.getByText("Your PRs")).toBeVisible();
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toHaveCount(0);
});

test("re-selecting the current repo reloads its lists", async ({ page }) => {
  await gotoStart(page);
  await expect(page.getByText("Your PRs")).toBeVisible();
  // Hold live (addInitScript would only apply after a re-navigation).
  await page.evaluate(() => localStorage.setItem("unvibe.mock.repoChangesHold", "1"));
  // Re-selecting the already-selected value still fires change and pairs
  // the kept lists with a fresh load: the kept rows stay visible with a
  // refresh sign — never a stuck "Loading…".
  await page.getByLabel("Repo", { exact: true }).click();
  await openPopup(page).getByRole("option", { name: "urllib3/urllib3" }).click();
  await expect(page.getByTestId("lists-refresh")).toHaveAttribute("title", /refreshing/);
  await expect(page.getByText("Your PRs")).toBeVisible();
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
  await expect(page.getByText("Your PRs")).toBeVisible();
  await expect(page.getByTestId("lists-refresh")).toHaveAttribute("title", /^Updated /);
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
  await row.locator("button.cj-open").click();
  await expect(page).toHaveURL(/\/review\/r-gone/);
  // Remove works.
  await page.goto("/");
  await expect(group.locator('[data-testid="session-r-gone"]')).toBeVisible();
  await group.getByRole("button", { name: /Remove/ }).click();
  // The confirm is a small popover, not inline in the row (#225).
  const pop = page.locator(".confirm-pop");
  await expect(pop).toContainText("Remove this review?");
  await expect(group.locator('[data-testid="session-r-gone"]')).toBeVisible();
  await pop.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(group.locator('[data-testid="session-r-gone"]')).toHaveCount(0);
  // The other rows are untouched.
  await expect(page.locator('[data-testid="session-demo"]')).toBeVisible();
});

test("remove asks to confirm and deletes local data only", async ({ page }) => {
  await gotoStart(page);
  const old = page.locator('[data-testid="session-r-old"]');
  await old.getByRole("button", { name: /Remove/ }).click();
  // The confirm is a small popover, not inline in the row (#225):
  // Escape cancels it without touching the row.
  const pop = page.locator(".confirm-pop");
  await expect(pop).toContainText("Remove this review?");
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(page.locator('[data-testid="session-r-old"]')).toBeVisible();
  // Confirming removes the row.
  await old.getByRole("button", { name: /Remove/ }).click();
  await expect(pop).toContainText("Remove this review?");
  await pop.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator('[data-testid="session-r-old"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="session-demo"]')).toBeVisible();
});

test("PR by number opens a review; a URL for another known repo switches the selector; bad input errors", async ({
  page,
}) => {
  await gotoStart(page);
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
  await expect(page.getByLabel("Repo", { exact: true })).toContainText("you/demo-lib");

  await pickOption(page, "Repo", "urllib3/urllib3");
  await page.getByLabel("Open a PR by URL or number").fill("not a pr!!!");
  await page.getByRole("button", { name: "Open PR" }).click();
  await expect(page.getByText("Enter a PR number")).toBeVisible();
});

test("healthy readiness shows a ready indicator and no callouts", async ({ page }) => {
  await gotoStart(page);
  await expect(page.locator('[data-testid="readiness-ready"]')).toBeVisible();
  await expect(page.locator('[data-testid^="readiness-callout-"]')).toHaveCount(0);
  // Model pickers show nothing when ready (no status/path line, #225).
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Models" }).click();
  await expect(page.locator('[data-testid="model-main-status"]')).toHaveCount(0);
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
  await gotoStart(page);
  await page.getByLabel("Open a PR by URL or number").fill("https://github.com/acme/app/pull/123");
  await page.getByRole("button", { name: "Open PR" }).click();
  const offer = page.locator('[data-testid="pr-clone-offer"]');
  await expect(offer).toContainText("acme/app isn't in your repos. Clone it and open #123?");
  await offer.getByRole("button", { name: "Clone and open #123" }).click();
  // Clone, select, open: the mock review opens and the selector follows.
  await expect(page).toHaveURL(/\/review\//, { timeout: 15000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByLabel("Repo", { exact: true })).toContainText("acme/app (cloned)");
});

test("pasting owner/name#N for an unknown repo offers the same clone flow", async ({ page }) => {
  await gotoStart(page);
  await page.getByLabel("Open a PR by URL or number").fill("acme/app#7");
  await page.getByRole("button", { name: "Open PR" }).click();
  const offer = page.locator('[data-testid="pr-clone-offer"]');
  await expect(offer).toContainText("acme/app isn't in your repos. Clone it and open #7?");
  await offer.getByRole("button", { name: "Clone and open #7" }).click();
  await expect(page).toHaveURL(/\/review\//, { timeout: 15000 });
});

test("cancelling the clone offer leaves the input as typed", async ({ page }) => {
  await gotoStart(page);
  const input = page.getByLabel("Open a PR by URL or number");
  await input.fill("https://github.com/acme/app/pull/123");
  await page.getByRole("button", { name: "Open PR" }).click();
  const offer = page.locator('[data-testid="pr-clone-offer"]');
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Cancel" }).click();
  await expect(offer).toHaveCount(0);
  await expect(input).toHaveValue("https://github.com/acme/app/pull/123");
  // Nothing was added: the selector still offers only the seeds.
  await expect(page.getByLabel("Repo", { exact: true })).toContainText("urllib3/urllib3");
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
  await expect(page.getByLabel("Repo", { exact: true })).toHaveCount(0);
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
  await expect(page.getByLabel("Repo", { exact: true })).toContainText("acme/app (cloned)");
  await expect(page.locator('[data-testid="no-repos"]')).toHaveCount(0);
});
