/**
 * Front screen (PRD §4.2): prior sessions first, then the New-review flow,
 * plus readiness callouts.
 *
 * Mock mode: two prior sessions (demo ready, r-old stale+running), the
 * standard repo picker flow, PR-by-URL-or-number, and a healthy readiness
 * report (overridable via localStorage for the callout case).
 */
import { test, expect } from "./network-guard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
});

test("prior sessions list across repos, most recent first, with summaries", async ({ page }) => {
  const sessions = page.locator('[data-testid^="session-"]');
  await expect(sessions).toHaveCount(2);
  // Most recent first: demo (opened recently) before r-old.
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
  await expect(old).toContainText("new commits · Update");
  await expect(old).toContainText("Running: critic");

  // Click resumes the review.
  await demo.locator("button.cj").click();
  await expect(page).toHaveURL(/\/review\/demo/);
});

test("remove asks to confirm and deletes local data only", async ({ page }) => {
  const old = page.locator('[data-testid="session-r-old"]');
  await old.getByRole("button", { name: /Remove/ }).click();
  await expect(old).toContainText("Remove local data only?");
  await old.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator('[data-testid="session-r-old"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="session-demo"]')).toBeVisible();
});

test("PR by number opens a review; bad input errors", async ({ page }) => {
  // Pick the remembered repo first (number needs a selected repo).
  await page.locator("#new-review").getByText("urllib3/urllib3").first().click();
  await page.getByLabel("Open a PR by URL or number").fill("5020");
  await page.getByRole("button", { name: "Open PR" }).click();
  await expect(page).toHaveURL(/\/review\/demo/, { timeout: 15000 });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await page.getByLabel("Open a PR by URL or number").fill("not a pr!!!");
  await page.getByRole("button", { name: "Open PR" }).click();
  await expect(page.getByText("Enter a PR number")).toBeVisible();
});

test("healthy readiness shows a ready indicator and no callouts", async ({ page }) => {
  await expect(page.locator('[data-testid="readiness-ready"]')).toBeVisible();
  await expect(page.locator('[data-testid^="readiness-callout-"]')).toHaveCount(0);
  // Model pickers show inline ok status.
  await page.goto("/settings?review=demo");
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
          { id: "agent:main", label: "Agent · main", status: "ok", summary: "ready", fix: "", settingsAnchor: "#models" },
          { id: "agent:small", label: "Agent · small", status: "ok", summary: "ready", fix: "", settingsAnchor: "#models" },
          { id: "agent:secondOpinion", label: "Agent · second opinion", status: "ok", summary: "ready", fix: "", settingsAnchor: "#models" },
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
  await expect(callout.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings#environment");
  // Starting a local-branch review stays possible: the hint says what needs gh.
  await expect(page.locator('[data-testid="newreview-gh-hint"]')).toContainText("PR lists need gh");
});
