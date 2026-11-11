/**
 * L1 — Start page (#363 package A).
 *
 * The front screen in usage order: the repo selector and readiness line,
 * the Reviews list following the repo, the PR opener and clone flows,
 * request groups with filters, and the service-backed PR lists (badges,
 * author filter, paging, refresh, stacks, review bar).
 *
 * Boots: none for the mock shell (Vite mock mode); ONE real service for
 * every service step. The union fake `gh` dispatches GraphQL searches by
 * `repo:owner/name` (one scratch repo per list shape) and `pr view` by PR
 * number, so the six list behaviours share a single service + data dir.
 *
 * Absorbs: `start.spec.ts` (26 tests), `j225-start-pr-list`,
 * `j228-author-filter`, `j297-pr-list-more`, `j230-pr-state-fresh`,
 * `j298-refresh-review-statuses`, `j321-stacked-prs`, `j245-reviewbar-pr`.
 *
 * Guards kept: #274 (selector title, quiet remove, request-group counts),
 * #225 (edge alignment, working indicator, no state pills), #232
 * (preparing states read under the title), #230/#234 (badges: no open,
 * no review-required text), #231? no — #131 (branch filter), #149 is L2,
 * #141/#83 (bar home, guide toggle), #239/#244/#245 (bar alignment, boxed
 * link, icon inside), #258 (label links out), #321 (stacks), #346 (inline
 * confirm), #352 (under-title progress line, read-only here).
 *
 * Brittleness fixed here (#363 §4): the start.spec non-atomic layout
 * reads (B1 — every multi-rect read is one synchronous evaluate), the
 * Floating-UI settle sleeps (B2 — `select.ts` now polls the option box
 * instead of `waitForTimeout(250)`), the j321 960-width sleep (B2 — an
 * `expect.poll` on the settled bar), and the dropped tour/visual-tour
 * screenshots (frames live in the tour now; the gate keeps failure-only
 * screenshots). Kept rows, wording pins and demo-recording copy stay
 * text-based (no baselines).
 *
 * Frames removed (tour owns them; package D re-adds): j228's
 * start-author-filter-{bob,all} shots, j297's start-author-combo-*
 * + start-pr-list-more-* shots, j321's stack-list/stack-popover/
 * stack-header-badge shots, j245's reviewbar-pr shots.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { openPopup, pickOption, expectTriggerText } from "../select.js";
import { checkLayout } from "../layout-check.js";
import { tourCombos } from "../tour-matrix.js";
import { measureWithin } from "../geometry.js";
import { selectText } from "../select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createScratchReview, git, makeScratchRepo, realGitPath } from "./journey-helpers.js";
import {
  awaitIngestReady,
  writeFakeGh383,
  writeFakeGhL1,
  writeFakeGitL1,
  writeFakeGitSlowFetch,
  writeL1Pools,
} from "./l1-fakes.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

/** Load the mock start page with exactly these `unvibe.mock.*` seeds (clears the rest). */
async function mockStart(page: Page, seeds: Record<string, string> = {}): Promise<void> {
  await page.goto("/");
  await page.evaluate((s) => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("unvibe.mock.") || k.startsWith("unvibe.start.")) localStorage.removeItem(k);
    }
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seeds);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
}

/** Load the service start page with this repo pre-selected.
 *
 * The seed is registered with `addInitScript` BEFORE the navigation (the
 * same pattern the absorbed journeys use): the value is present when the
 * app first boots, so it never takes the default-select path and no late
 * default persist can clobber the seed. (A goto, evaluate, reload sequence
 * races the app's default-select persist under load.) Repeat calls
 * accumulate; scripts run in registration order so the latest call wins,
 * matching every test's usage (each selects forward, never back). */
async function serviceStart(page: Page, svc: RunningService, repoId: string, expectRepo?: string | RegExp): Promise<void> {
  await page.addInitScript((id) => {
    try {
      localStorage.setItem('unvibe.start.repoId', id);
    } catch {
      // Start page falls back to no selection; asserts below fail.
    }
  }, repoId);
  await page.goto(`${svc.origin}/?token=${svc.token}`);
  await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible({ timeout: 30_000 });
  // The seed stuck: the selector names the expected repo (loud here,
  // not 30 s later in a list row).
  await expect(page.getByLabel('Repo', { exact: true })).toContainText(expectRepo ?? repoId, { timeout: 15_000 });
}

test.describe("L1 start page shell (mock)", () => {
  test("selector, readiness line, lists follow the repo", async ({ page }) => {
    test.setTimeout(180_000);
    await test.step("selector lists remembered and detected repos, persisted", async () => {
      await mockStart(page);
      const sel = page.getByLabel("Repo", { exact: true });
      await expect.soft(sel).toContainText("urllib3/urllib3");
      await sel.click();
      await expect.soft(page.locator(".ui-select-grouplabel")).toContainText(["Repos", "Found on this machine"]);
      await expect.soft(openPopup(page).getByRole("option", { name: "urllib3/urllib3" })).toBeVisible();
      await expect.soft(openPopup(page).getByRole("option", { name: "you/demo-lib" })).toBeVisible();
      // The trigger carries the picked repo's local path as the title.
      await openPopup(page).getByRole("option", { name: "you/demo-lib" }).click();
      await expect.soft(sel).toContainText("you/demo-lib");
      await expect.soft(sel).toHaveAttribute("title", "~/code/demo-lib");
      await page.reload();
      await expect.soft(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
      await expect.soft(page.getByLabel("Repo", { exact: true })).toContainText("you/demo-lib");
    });

    await test.step("selector is the left-aligned page title, outside the top bar (#274)", async () => {
      await mockStart(page);
      await expect.soft(page.locator("header.top").getByLabel("Repo", { exact: true })).toHaveCount(0);
      const sel = page.getByLabel("Repo", { exact: true });
      await expect.soft(sel).toBeVisible();
      // One synchronous read: three boundingBox() calls can straddle a
      // late readiness banner and differ by its height (#363 B1).
      const boxes = await page.evaluate(() => {
        const read = (s: string): { x: number; y: number; width: number; height: number } | null => {
          const r = document.querySelector(s)?.getBoundingClientRect();
          return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
        };
        return {
          header: read("header.top"),
          sel: read('[aria-label="Repo"]'),
          main: read("main .doc"),
        };
      });
      const reviewsBox = await page.getByRole("heading", { name: "Reviews" }).boundingBox();
      expect.soft(boxes.header).not.toBeNull();
      expect.soft(boxes.sel).not.toBeNull();
      // Below the top bar, but above the Reviews section it titles.
      expect.soft(boxes.sel?.y ?? -1).toBeGreaterThan(boxes.header?.y ?? 0);
      expect
        .soft((boxes.sel?.y ?? 0) + (boxes.sel?.height ?? 0))
        .toBeLessThanOrEqual(reviewsBox?.y ?? 0);
      // Left-aligned with the content column, not centred in it.
      expect.soft(boxes.sel?.x ?? 0).toBeLessThanOrEqual((boxes.main?.x ?? 0) + 120);
      const selCenter = (boxes.sel?.x ?? 0) + (boxes.sel?.width ?? 0) / 2;
      const mainCenter = (boxes.main?.x ?? 0) + (boxes.main?.width ?? 0) / 2;
      expect.soft(mainCenter - selCenter).toBeGreaterThan(0);
      // Title-sized type.
      expect.soft(await sel.evaluate((el) => getComputedStyle(el).fontSize)).toBe("24px");
    });

    await test.step("readiness shows as a quiet content line, not in the top bar", async () => {
      await mockStart(page);
      await expect.soft(page.locator("header.top").locator('[data-testid="readiness-ready"]')).toHaveCount(0);
      const ready = page.locator('[data-testid="readiness-ready"]');
      await expect.soft(ready).toBeVisible();
      await expect.soft(ready).toHaveText("Ready");
      // One synchronous read (B1): the pair below used to straddle banners.
      const below = await page.evaluate(() => {
        const readyEl = document.querySelector('[data-testid="readiness-ready"]');
        const reviewsEl = [...document.querySelectorAll("h1, h2, h3")].find((el) =>
          el.textContent?.includes("Reviews"),
        );
        if (!readyEl || !reviewsEl) return null;
        const r = readyEl.getBoundingClientRect();
        const v = reviewsEl.getBoundingClientRect();
        return { readyTop: r.y, reviewsBottom: v.y + v.height };
      });
      expect.soft(below).not.toBeNull();
      expect.soft(below!.readyTop).toBeGreaterThan(below!.reviewsBottom);
    });

    await test.step("reviews list follows the selected repo; demo row always shows", async () => {
      await mockStart(page);
      // Default selection (urllib3): both prior sessions, most recent first.
      const sessions = page.locator('[data-testid^="session-"]');
      await expect.soft(sessions).toHaveCount(2);
      await expect.soft(sessions.nth(0)).toHaveAttribute("data-testid", "session-demo");
      await expect.soft(sessions.nth(1)).toHaveAttribute("data-testid", "session-r-old");

      const demo = page.locator('[data-testid="session-demo"]');
      await expect.soft(demo).toContainText("Unfold obsolete folded response header values");
      await expect.soft(demo).toContainText("urllib3/urllib3");
      await expect.soft(demo).toContainText("#5020");
      await expect.soft(demo).toContainText("hunks reviewed");
      // A finished guide shows no state text and no working indicator (#225).
      // Its under-title progress line is itself a role=status line (#352).
      await expect.soft(demo).not.toContainText("Guide ready");
      await expect.soft(demo.getByRole("status", { name: "Working" })).toHaveCount(0);

      const old = page.locator('[data-testid="session-r-old"]');
      await expect.soft(old).toContainText("Fix retry backoff on 429s");
      await expect.soft(old).toContainText("new commits");
      // A running guide shows the app's working indicator, not a state line (#225).
      await expect.soft(old.getByRole("status", { name: "Working" })).toBeVisible();
      await expect.soft(old).not.toContainText("Checking findings…");

      // The demo row sits inside the Reviews list regardless of the repo.
      await expect.soft(page.locator('[data-testid="demo-entry"]')).toContainText("Demo · no agent needed");

      // Switch to the detected checkout: its sessions list is empty, but the demo row stays.
      await pickOption(page, "Repo", "you/demo-lib");
      await expect.soft(page.locator('[data-testid^="session-"]')).toHaveCount(0);
      await expect.soft(page.locator('[data-testid="sessions-empty"]')).toContainText("No reviews for you/demo-lib yet");
      await expect.soft(page.locator('[data-testid="demo-entry"]')).toBeVisible();

      // Switch back: the repo's sessions return.
      await pickOption(page, "Repo", "urllib3/urllib3");
      await expect.soft(page.locator('[data-testid^="session-"]')).toHaveCount(2);

      // Click resumes the review.
      await demo.locator("button.cj-open").click();
      await expect.soft(page).toHaveURL(/\/review\/demo/);
    });

    await test.step("failing lists keep the PR input, show an error with Retry, and recover", async () => {
      await mockStart(page, { "unvibe.mock.repoChangesFail": JSON.stringify(["authoring", "review-requested", "recent"]) });
      // The PR input does not wait on the lists.
      await expect.soft(page.getByLabel("Open a PR by URL or number")).toBeVisible();
      const err = page.locator('[data-testid="lists-error"]');
      await expect.soft(err).toContainText("Couldn't load PRs and branches for urllib3/urllib3: mock gh is down");
      await expect.soft(err.getByRole("button", { name: "Retry" })).toBeVisible();
      // No sections underneath until the load succeeds.
      await expect.soft(page.getByText("Your PRs")).toHaveCount(0);
      // Retry recovers once the failure clears.
      await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesFail"));
      await err.getByRole("button", { name: "Retry" }).click();
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      await expect.soft(page.locator('[data-testid="lists-error"]')).toHaveCount(0);
    });

    await test.step("a partial lists failure shows per-section errors while branches still render", async () => {
      await mockStart(page, { "unvibe.mock.repoChangesFail": JSON.stringify(["authoring", "review-requested"]) });
      await expect.soft(page.locator('[data-testid="changes-error-authoring"]')).toContainText("mock gh is down");
      await expect.soft(page.locator('[data-testid="changes-error-requested"]')).toContainText("mock gh is down");
      // Branches are local: they still render, and no whole-load error shows.
      await expect.soft(page.getByText("Recent branches")).toBeVisible();
      await expect.soft(page.locator('[data-testid="lists-error"]')).toHaveCount(0);
      await page.locator("main .ci", { hasText: "fix-obs-fold" }).first().locator("button.cj-open").click();
      await expect.soft(page).toHaveURL(/\/review\//);
    });

    await test.step("held lists show loading without stale rows and keep the PR input", async () => {
      await mockStart(page, { "unvibe.mock.repoChangesHold": "1" });
      // Reviews and the demo row do not wait on the lists.
      await expect.soft(page.locator('[data-testid="session-demo"]')).toBeVisible();
      await expect.soft(page.locator('[data-testid="demo-entry"]')).toBeVisible();
      // The lists area shows loading, not sections, with the PR input usable.
      await expect.soft(page.locator('[data-testid="repo-lists-loading"]')).toContainText("Loading urllib3/urllib3…");
      await expect.soft(page.getByLabel("Open a PR by URL or number")).toBeVisible();
      await expect.soft(page.getByText("Your PRs")).toHaveCount(0);
      // Switching repos while held: still loading, never the old repo's rows.
      await pickOption(page, "Repo", "you/demo-lib");
      await expect.soft(page.locator('[data-testid="repo-lists-loading"]')).toContainText("Loading you/demo-lib…");
      await expect.soft(page.locator("main .ci", { hasText: "#5020 · fix-obs-fold" })).toHaveCount(0);
      // Release: the new selection's lists render.
      await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      await expect.soft(page.locator('[data-testid="repo-lists-loading"]')).toHaveCount(0);
    });

    await test.step("re-selecting the current repo reloads its lists", async () => {
      await mockStart(page);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      // Hold live (addInitScript would only apply after a re-navigation).
      await page.evaluate(() => localStorage.setItem("unvibe.mock.repoChangesHold", "1"));
      // Re-selecting the already-selected value still fires change and pairs
      // the kept lists with a fresh load: the kept rows stay visible with a
      // refresh sign — never a stuck "Loading…".
      await page.getByLabel("Repo", { exact: true }).click();
      await openPopup(page).getByRole("option", { name: "urllib3/urllib3" }).click();
      await expect.soft(page.getByTestId("lists-refresh")).toHaveAttribute("title", /refreshing/);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      await expect.soft(page.locator('[data-testid="repo-lists-loading"]')).toHaveCount(0);
      await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      await expect.soft(page.getByTestId("lists-refresh")).toHaveAttribute("title", /^Updated /);
    });

    await test.step("reviews for checkouts no longer listed stay openable and removable", async () => {
      await mockStart(page, {
        "unvibe.mock.extraSessions": JSON.stringify([
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
      });
      const group = page.locator('[data-testid="orphan-sessions"]');
      await expect.soft(group.locator('[data-testid="orphan-sessions-label"]')).toContainText("no longer in your list");
      const row = group.locator('[data-testid="session-r-gone"]');
      await expect.soft(row).toContainText("gone/gone");
      await expect.soft(row).toContainText("Work on a removed checkout");
      // Open works.
      await row.locator("button.cj-open").click();
      await expect.soft(page).toHaveURL(/\/review\/r-gone/);
      // Remove works: the button expands in place into the inline
      // confirm (#346), then flashes confirmed before the row goes.
      await mockStart(page, {
        "unvibe.mock.extraSessions": JSON.stringify([
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
      });
      const group2 = page.locator('[data-testid="orphan-sessions"]');
      const row2 = group2.locator('[data-testid="session-r-gone"]');
      await expect.soft(row2).toBeVisible();
      await group2.getByRole("button", { name: /Remove/ }).click();
      await expect.soft(row2.getByText("Confirm remove review")).toBeVisible();
      await expect.soft(group2.locator('[data-testid="session-r-gone"]')).toBeVisible();
      await row2.getByRole("button", { name: "Confirm remove review" }).click();
      await expect.soft(row2.getByText("Confirmed")).toBeVisible();
      await expect.soft(group2.locator('[data-testid="session-r-gone"]')).toHaveCount(0);
      // The other rows are untouched.
      await expect.soft(page.locator('[data-testid="session-demo"]')).toBeVisible();
    });

    await test.step("remove asks to confirm and deletes local data only", async () => {
      await mockStart(page);
      const old = page.locator('[data-testid="session-r-old"]');
      await old.getByRole("button", { name: /Remove/ }).click();
      // The confirm expands in place (#346): Escape cancels it without touching the row.
      await expect.soft(old.getByText("Confirm remove review")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect.soft(old.getByText("Confirm remove review")).toHaveCount(0);
      await expect.soft(page.locator('[data-testid="session-r-old"]')).toBeVisible();
      // Confirming flashes confirmed, then removes the row.
      await old.getByRole("button", { name: /Remove/ }).click();
      await expect.soft(old.getByText("Confirm remove review")).toBeVisible();
      await old.getByRole("button", { name: "Confirm remove review" }).click();
      await expect.soft(old.getByText("Confirmed")).toBeVisible();
      await expect.soft(page.locator('[data-testid="session-r-old"]')).toHaveCount(0);
      await expect.soft(page.locator('[data-testid="session-demo"]')).toBeVisible();
    });
  });

  test("PR opener, clone flows, managed clone, fresh install", async ({ page }) => {
    test.setTimeout(180_000);
    await test.step("PR by number opens a review; a URL for another known repo switches the selector; bad input errors", async () => {
      await mockStart(page);
      // The remembered repo is selected by default; a number opens its PR.
      await page.getByLabel("Open a PR by URL or number").fill("5020");
      await page.getByRole("button", { name: "Open PR" }).click();
      await expect.soft(page).toHaveURL(/\/review\/demo/, { timeout: 15000 });

      // A URL for a different known repo opens it and switches the selector.
      await mockStart(page);
      await page.getByLabel("Open a PR by URL or number").fill("https://github.com/you/demo-lib/pull/7");
      await page.getByRole("button", { name: "Open PR" }).click();
      await expect.soft(page).toHaveURL(/\/review\/demo/, { timeout: 15000 });
      await page.goto("/");
      await expect.soft(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
      await expect.soft(page.getByLabel("Repo", { exact: true })).toContainText("you/demo-lib");

      await pickOption(page, "Repo", "urllib3/urllib3");
      await page.getByLabel("Open a PR by URL or number").fill("not a pr!!!");
      await page.getByRole("button", { name: "Open PR" }).click();
      await expect.soft(page.getByText("Enter a PR number")).toBeVisible();
    });

    await test.step("healthy readiness shows a ready indicator and no callouts", async () => {
      await mockStart(page);
      await expect.soft(page.locator('[data-testid="readiness-ready"]')).toBeVisible();
      await expect.soft(page.locator('[data-testid^="readiness-callout-"]')).toHaveCount(0);
      // Model pickers show nothing when ready (no status/path line, #225).
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Models" }).click();
      await expect.soft(page.locator('[data-testid="model-main-status"]')).toHaveCount(0);
    });

    await test.step("failing readiness shows compact callouts linking to Settings", async () => {
      await mockStart(page, {
        "unvibe.mock.readiness": JSON.stringify({
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
          ],
          generatedAt: Date.now(),
          cached: false,
        }),
      });
      const callout = page.locator('[data-testid="readiness-callout-gh"]');
      await expect.soft(callout).toContainText("gh not logged in");
      await expect.soft(callout.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings?tab=environment");
      // Starting a local-branch review stays possible: the hint says what needs gh.
      await expect.soft(page.locator('[data-testid="newreview-gh-hint"]')).toContainText("Listing PRs needs gh");
    });

    await test.step("pasting a PR URL for an unknown repo offers to clone it, then selects the repo and opens the PR", async () => {
      await mockStart(page);
      await page.getByLabel("Open a PR by URL or number").fill("https://github.com/acme/app/pull/123");
      await page.getByRole("button", { name: "Open PR" }).click();
      const offer = page.locator('[data-testid="pr-clone-offer"]');
      await expect.soft(offer).toContainText("acme/app isn't in your repos. Clone it and open #123?");
      await offer.getByRole("button", { name: "Clone and open #123" }).click();
      // Clone, select, open: the mock review opens and the selector follows.
      await expect.soft(page).toHaveURL(/\/review\//, { timeout: 15000 });
      // Plain return trip: a re-seed would wipe the cloned repo the flow just added.
      await page.goto("/");
      await expect.soft(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
      await expect.soft(page.getByLabel("Repo", { exact: true })).toContainText("acme/app (cloned)");
    });

    await test.step("pasting owner/name#N for an unknown repo offers the same clone flow", async () => {
      await mockStart(page);
      await page.getByLabel("Open a PR by URL or number").fill("acme/app#7");
      await page.getByRole("button", { name: "Open PR" }).click();
      const offer = page.locator('[data-testid="pr-clone-offer"]');
      await expect.soft(offer).toContainText("acme/app isn't in your repos. Clone it and open #7?");
      await offer.getByRole("button", { name: "Clone and open #7" }).click();
      await expect.soft(page).toHaveURL(/\/review\//, { timeout: 15000 });
    });

    await test.step("cancelling the clone offer leaves the input as typed", async () => {
      await mockStart(page);
      const input = page.getByLabel("Open a PR by URL or number");
      await input.fill("https://github.com/acme/app/pull/123");
      await page.getByRole("button", { name: "Open PR" }).click();
      const offer = page.locator('[data-testid="pr-clone-offer"]');
      await expect.soft(offer).toBeVisible();
      await offer.getByRole("button", { name: "Cancel" }).click();
      await expect.soft(offer).toHaveCount(0);
      await expect.soft(input).toHaveValue("https://github.com/acme/app/pull/123");
      // Nothing was added: the selector still offers only the seeds.
      await expect.soft(page.getByLabel("Repo", { exact: true })).toContainText("urllib3/urllib3");
      await expect.soft(page).toHaveURL("/");
    });

    await test.step("a stale managed clone shows the refresh note once", async () => {
      await mockStart(page, { "unvibe.mock.repoChangesFetchError": "couldn't refresh the local clone (offline?)" });
      // Three lists calls carry the same note; the page shows it exactly once.
      const note = page.locator('[data-testid="fetch-note"]');
      await expect.soft(note).toHaveCount(1);
      await expect.soft(note).toContainText("couldn't refresh the local clone");
      // The lists still render underneath.
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
    });

    await test.step("fresh install: paste a PR URL, clone, repo selected, PR opens", async () => {
      await mockStart(page, { "unvibe.mock.noRepos": "1" });
      // Both routes in: paste a PR URL here, or add a repo in Settings.
      const empty = page.locator('[data-testid="no-repos"]');
      await expect.soft(empty).toContainText("Paste a PR URL below");
      await expect.soft(empty.getByRole("link", { name: "add one in Settings" })).toHaveAttribute(
        "href",
        "/settings?tab=repositories",
      );
      // No repos, no selector yet.
      await expect.soft(page.getByLabel("Repo", { exact: true })).toHaveCount(0);
      // A bare number still needs a repo first.
      await empty.getByLabel("Open a PR by URL or number").fill("5020");
      await empty.getByRole("button", { name: "Open PR" }).click();
      await expect.soft(empty).toContainText("Add a repo in Settings first");
      // A PR URL offers the clone.
      await empty.getByLabel("Open a PR by URL or number").fill("https://github.com/acme/app/pull/123");
      await empty.getByRole("button", { name: "Open PR" }).click();
      const offer = page.locator('[data-testid="pr-clone-offer"]');
      await expect.soft(offer).toContainText("acme/app isn't in your repos. Clone it and open #123?");
      await offer.getByRole("button", { name: "Clone and open #123" }).click();
      await expect.soft(page).toHaveURL(/\/review\//, { timeout: 15000 });
      // Back on the start page the selector exists with the clone selected.
      // Plain return trip: a re-seed would wipe the cloned repo the flow just added.
      await page.goto("/");
      await expect.soft(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
      await expect.soft(page.getByLabel("Repo", { exact: true })).toContainText("acme/app (cloned)");
      await expect.soft(page.locator('[data-testid="no-repos"]')).toHaveCount(0);
    });
  });

  test("request groups, filters, block layout, kept rows", async ({ page }) => {
    test.setTimeout(180_000);
    await test.step("review requests split into direct and team, newest first", async () => {
      await mockStart(page);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      await expect.soft(page.getByText("Requested of you", { exact: true })).toBeVisible();
      await expect.soft(page.getByText("Requested of your team")).toBeVisible();
      await expect.soft(page.getByText("Docs: clarify retry wording")).toHaveCount(1);
      await expect.soft(page.locator(".ci", { hasText: "Docs: clarify retry wording" })).not.toContainText("via docs");
      // One synchronous read (B1): the newest/older pair below used to straddle banners.
      const order = await page.evaluate(() => {
        const box = (text: string): number | null => {
          const el = [...document.querySelectorAll(".ci")].find((n) => n.textContent?.includes(text));
          const r = el?.getBoundingClientRect();
          return r ? r.y : null;
        };
        return { newer: box("Docs: clarify retry wording"), older: box("Pool: reuse connections across redirects") };
      });
      expect.soft(order.newer).not.toBeNull();
      expect.soft(order.older).not.toBeNull();
      expect.soft(order.newer!).toBeLessThan(order.older!);
      await expect.soft(page.locator(".ci", { hasText: "Pool: reuse connections across redirects" })).toContainText("2h ago");
      await expect.soft(page.locator(".ci", { hasText: "CI: pin the lint action" })).not.toContainText("via core");
    });

    await test.step("recency filter hides older rows in both groups and persists", async () => {
      await mockStart(page);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      await expect.soft(page.getByText("CI: pin the lint action")).toBeVisible();
      await pickOption(page, "Updated within", "Last day");
      await expect.soft(page.getByText("CI: pin the lint action")).toHaveCount(0);
      await expect.soft(page.locator('[data-testid="requested-team-empty"]')).toContainText("No PRs updated in the last day.");
      await expect.soft(page.getByText("Pool: reuse connections across redirects")).toBeVisible();
      await pickOption(page, "Updated within", "All");
      await expect.soft(page.getByText("CI: pin the lint action")).toBeVisible();
      await pickOption(page, "Updated within", "Last 2 weeks");
      await page.reload();
      await expect.soft(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
      await expectTriggerText(page, "Updated within", "Last 2 weeks");
      await expect.soft(page.getByText("Changelog: backfill old entries")).toHaveCount(0);
    });

    await test.step("PR rows show the diff size without the file count, and omit it when unknown", async () => {
      await mockStart(page);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      const row = page.locator(".ci", { hasText: "Pool: reuse connections across redirects" });
      await expect.soft(row).toContainText("+545");
      await expect.soft(row).not.toContainText("files");
      const unsized = page.locator(".ci", { hasText: "Changelog: backfill old entries" });
      await expect.soft(unsized).not.toContainText("+");
      await expect.soft(unsized).not.toContainText("files");
    });

    await test.step("the PR label links to GitHub without opening the review (#258)", async () => {
      await mockStart(page);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      const link = page.getByRole("link", { name: "Open PR #5018 on GitHub" });
      await expect.soft(link).toHaveAttribute("href", "https://github.com/urllib3/urllib3/pull/5018");
      await expect.soft(link).toHaveAttribute("target", "_blank");
      await expect.soft(link).toHaveAttribute("rel", "noreferrer");
      expect.soft(await link.evaluate((el) => el.closest("button"))).toBeNull();
    });

    await test.step("branches filter by last commit and show ages, Reviews stays unfiltered (#131)", async () => {
      await mockStart(page);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      await expect.soft(page.locator(".ci", { hasText: "experiment/lazy-headers" })).toContainText("3d ago");
      await pickOption(page, "Updated within", "Last day");
      await expect.soft(page.getByText("experiment/lazy-headers")).toHaveCount(0);
      await expect.soft(page.getByRole("button", { name: "fix-obs-fold", exact: true })).toBeVisible();
      await expect
        .soft(page.locator('div[aria-label="Reviews"]').getByText("Unfold obsolete folded response header values"))
        .toBeVisible();
    });

    await test.step("PR and branch lists form one block with the filter and refresh in its heading row", async () => {
      await mockStart(page);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      const block = page.getByTestId("pr-block");
      await expect.soft(block).toBeVisible();
      await expect.soft(block.getByRole("heading", { name: "PRs and branches" })).toBeVisible();
      await expect.soft(block.getByLabel("Updated within", { exact: true })).toBeVisible();
      await expect.soft(block.getByText("Updated within", { exact: true })).toHaveCount(0);
      await expect.soft(block.getByRole("heading", { name: "Reviews" })).toHaveCount(0);
      const refresh = block.getByTestId("lists-refresh");
      await expect.soft(refresh).toHaveAttribute("title", /^Updated /);
      await page.evaluate(() => localStorage.setItem("unvibe.mock.repoChangesHold", "1"));
      await refresh.click();
      await expect.soft(refresh).toHaveAttribute("title", /refreshing/);
      await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
      await expect.soft(refresh).toHaveAttribute("title", /^Updated /);
    });

    await test.step("the recency filter empties lists inside the block with a way back", async () => {
      await mockStart(page);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      const block = page.getByTestId("pr-block");
      await pickOption(page, "Updated within", "Last day");
      await expect.soft(block.getByTestId("requested-team-empty")).toContainText("No PRs updated in the last day.");
      await block.getByTestId("requested-team-empty").getByRole("button", { name: "Show all" }).click();
      await expectTriggerText(page, "Updated within", "All");
      await expect.soft(page.getByText("CI: pin the lint action")).toBeVisible();
    });

    await test.step("reload shows kept rows before the changes request completes, then updates", async () => {
      await mockStart(page);
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      await expect.soft(page.getByTestId("lists-refresh")).toHaveAttribute("title", /^Updated /);
      await expect.soft(page.getByText("Unfold obsolete folded response header values").first()).toBeVisible();
      await page.evaluate(() => localStorage.setItem("unvibe.mock.repoChangesHold", "1"));
      await page.reload();
      await expect.soft(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
      await expect
        .soft(page.getByText("Unfold obsolete folded response header values").first())
        .toBeVisible();
      await expect.soft(page.locator('[data-testid="repo-lists-loading"]')).toHaveCount(0);
      await expect.soft(page.getByTestId("lists-refresh")).toHaveAttribute("title", /refreshing/);
      await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
      await expect.soft(page.getByText("Your PRs")).toBeVisible();
      await expect.soft(page.getByTestId("lists-refresh")).toHaveAttribute("title", /^Updated /);
      await expect
        .soft(page.getByText("Unfold obsolete folded response header values").first())
        .toBeVisible();
    });
  });
});

// ---------------------------------------------------------------------------
// Service-backed PR lists: one service, one union fake `gh`.
//
// GraphQL searches dispatch on `repo:owner/name` (one scratch repo per list
// shape); `pr view` dispatches on the PR number (flip=1, refresh=2,
// author=101, stack=11/12/13, bar=7502). Test order matters: the author
// test counts session rows, and demo reviews (repoId "demo") render in
// the Reviews region under every repo — so it runs before the demo review
// is created in the quiet-remove step.
// ---------------------------------------------------------------------------

test.describe("L1 start page PR lists (service)", () => {
  let dataDir = "";
  let logDir = "";
  let svc: RunningService | null = null;
  const dirs: string[] = [];
  const repoIds: Record<string, string> = {};
  let flipId = "";
  let refreshId = "";
  let refreshHead1 = "";

  test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

  test.beforeAll(async () => {
    const tmp = (tag: string): string => {
      const d = mkdtempSync(path.join(os.tmpdir(), `unvibe-l1-${tag}-`));
      dirs.push(d);
      return d;
    };
    const repoDirs: Record<string, string> = {
      prlist: tmp("prlist-repo"),
      filter: tmp("filter-repo"),
      more: tmp("more-repo"),
      flip: tmp("flip-repo"),
      refresh: tmp("refresh-repo"),
      stack: tmp("stack-repo"),
      bar: tmp("bar-repo"),
    };
    dataDir = tmp("data");
    logDir = tmp("gh");
    const poolDir = tmp("pool");
    const fakeBin = tmp("bin");
    const heads: Record<string, string> = {};
    for (const [tag, dir] of Object.entries(repoDirs)) {
      heads[tag] = (await makeScratchRepo(dir)).headSha;
    }
    await git(repoDirs["prlist"]!, "remote", "add", "origin", "https://github.com/acme/prlist.git");
    await git(repoDirs["filter"]!, "remote", "add", "origin", "https://github.com/acme/filter.git");
    await git(repoDirs["more"]!, "remote", "add", "origin", "https://github.com/acme/more.git");
    await git(repoDirs["refresh"]!, "remote", "add", "origin", "https://github.com/acme/app.git");
    await git(repoDirs["stack"]!, "remote", "add", "origin", "https://github.com/acme/stack.git");
    await git(
      repoDirs["bar"]!,
      "remote",
      "add",
      "origin",
      "https://github.com/example-org/a-fairly-long-repository-name.git",
    );
    refreshHead1 = heads["refresh"]!;
    writeFileSync(path.join(logDir, "state"), "open");
    writeFileSync(path.join(logDir, "head"), refreshHead1);
    writeL1Pools(poolDir);
    writeFakeGhL1(fakeBin, logDir, poolDir, {
      flipHead: heads["flip"]!,
      stackHead: heads["stack"]!,
      filterRepo: repoDirs["filter"]!,
      barRepo: repoDirs["bar"]!,
    });
    writeFakeGitL1(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, {
      mode: 0o755,
    });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    for (const [tag, dir] of Object.entries(repoDirs)) {
      const repos = await apiJson(svc, "POST", "/api/repos", { path: dir });
      const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
      const registered = list.find((r) => r.localPath === dir);
      if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
      repoIds[tag] = registered.id;
    }
    flipId = await createScratchReview(svc, repoDirs["flip"]!, { pr: 1 });
    refreshId = await createScratchReview(svc, repoDirs["refresh"]!, { pr: 2 });
    const filterPr = await createScratchReview(svc, repoDirs["filter"]!, { pr: 101 });
    const filterBranch = await createScratchReview(svc, repoDirs["filter"]!);
    // Every review's ingest settles before the tests run: the flip test
    // asserts post-refresh badges, which need a completed ingest behind
    // the row (four concurrent ingests here, not one like the originals).
    await awaitIngestReady(svc, flipId);
    await awaitIngestReady(svc, filterPr);
    await awaitIngestReady(svc, filterBranch);
    await awaitIngestReady(svc, refreshId);
    // The union fake dispatches on owner/name: verify each repo registered
    // with the identity the fake expects (a mismatch serves the wrong
    // pools and fails loudly here, not 30 s later in a list row).
    {
      const got = await apiJson(svc, "GET", "/api/repos");
      const seen = Object.fromEntries(
        ((got.json as { repos: { id: string; owner: string; name: string }[] }).repos ?? []).map((r) => [r.id, `${r.owner}/${r.name}`]),
      );
      const want: Record<string, string> = {
        prlist: "acme/prlist",
        filter: "acme/filter",
        more: "acme/more",
        refresh: "acme/app",
        stack: "acme/stack",
        bar: "example-org/a-fairly-long-repository-name",
      };
      for (const [tag, name] of Object.entries(want)) {
        const id = repoIds[tag];
        if (!id) throw new Error(`missing repoId for ${tag}`);
        const actual = seen[id];
        if (actual !== name) throw new Error(`repo ${tag} registered as ${actual ?? "unknown"} (want ${name})`);
      }
      // The flip repo has no origin and registers as local/<dirname>.
      const flipSeen = seen[repoIds["flip"]!];
      if (!flipSeen || !flipSeen.startsWith("local/")) throw new Error(`flip repo identity wrong: ${flipSeen ?? "unknown"}`);
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  // Runs before the demo review exists (see the ordering note above).
  test("author filter reads and filters the requested groups", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await serviceStart(page, svc, repoIds["filter"]!, "acme/filter");
    const prBlock = page.getByTestId("pr-block");
    const reviews = page.locator('[aria-label="Reviews"]');

    await test.step("all rows render unfiltered", async () => {
      await expect.soft(prBlock.getByText("Alice adds folded-header parsing")).toBeVisible({ timeout: 30_000 });
      await expect.soft(prBlock.getByText("Bob fixes header unfolding")).toBeVisible();
      await expect.soft(prBlock.getByText("Bob asks for your review")).toBeVisible();
      await expect.soft(prBlock.getByText("Alice asks the team")).toBeVisible();
      await expect.soft(reviews.getByText("Alice adds folded-header parsing")).toBeVisible({ timeout: 30_000 });
      await expect.soft(reviews.locator('[data-testid^="session-"]')).toHaveCount(2);
    });

    await test.step("the Author select lists the requested-group authors with counts", async () => {
      await expect.soft(page.getByLabel("Author", { exact: true })).toHaveValue("All", { timeout: 15_000 });
      await page.getByLabel("Author", { exact: true }).click();
      await expect.soft(openPopup(page).getByRole("option", { name: "alice (1)" })).toBeVisible({ timeout: 15_000 });
      await expect.soft(openPopup(page).getByRole("option", { name: "bob (1)" })).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await test.step("picking bob filters both requested groups, ignoring Your PRs, Reviews and branches", async () => {
      await pickOption(page, "Author", "bob (1)");
      await expect.soft(page.getByLabel("Author", { exact: true })).toHaveValue("bob (1)");
      await expect.soft(prBlock.getByText("Bob asks for your review")).toBeVisible();
      await expect.soft(prBlock.getByText("Alice asks the team")).toHaveCount(0);
      await expect.soft(page.getByTestId("requested-team-empty")).toContainText("No PRs by bob.");
      await expect.soft(prBlock.getByText("Alice adds folded-header parsing")).toBeVisible();
      await expect.soft(prBlock.getByText("Bob fixes header unfolding")).toBeVisible();
      await expect.soft(reviews.getByText("Alice adds folded-header parsing")).toBeVisible();
      await expect.soft(reviews.locator('[data-testid^="session-"]')).toHaveCount(2);
      await expect.soft(prBlock.getByText("feature").first()).toBeVisible();
      await checkLayout(page, "start-author-filter-1440-light");
    });

    await test.step("the choice persists like the time filter, with a way back", async () => {
      await page.reload();
      await expect.soft(page.getByLabel("Author", { exact: true })).toHaveValue("bob (1)", { timeout: 15_000 });
      await expect.soft(page.getByTestId("pr-block").getByText("Bob asks for your review")).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.getByTestId("pr-block").getByText("Alice asks the team")).toHaveCount(0);
      await page.getByTestId("requested-team-empty").getByRole("button", { name: "Show all" }).click();
      await expect.soft(page.getByLabel("Author", { exact: true })).toHaveValue("All");
      await expect.soft(page.getByTestId("pr-block").getByText("Alice asks the team")).toBeVisible();
      await checkLayout(page, "start-author-filter-all-1440-light");
    });
  });

  test("load more pages past 30 and typing an author fetches them", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await serviceStart(page, svc, repoIds["more"]!, "acme/more");
    const prBlock = page.getByTestId("pr-block");

    await test.step("first page renders with the author control fitting the card", async () => {
      await expect.soft(prBlock.getByText("Review ask 301")).toBeVisible({ timeout: 30_000 });
      await expect.soft(prBlock.getByText("Review ask 330")).toBeVisible();
      await expect.soft(prBlock.getByText("Carol late ask 335")).toHaveCount(0);
      await expect.soft(prBlock.getByText("Load more PRs")).toBeVisible();
      // #297 combobox follow-up: the single control fits fully inside the
      // card. One synchronous read (B1): the pair below used to straddle banners.
      const fit = await measureWithin(page, '[data-testid="pr-block"]', '[aria-label="Author"]');
      const control = fit.inner['[aria-label="Author"]']!;
      const card = fit.row;
      expect.soft(control, "author combobox is visible").toBeTruthy();
      expect.soft(control.x).toBeGreaterThanOrEqual(card.x - 1);
      expect.soft(control.x + control.width).toBeLessThanOrEqual(card.x + card.width + 1);
      await expect.soft(page.getByLabel("Author", { exact: true })).toHaveValue("All");
      await checkLayout(page, "start-author-combo-rest-1440-light");
    });

    await test.step("a direct request past the capped team page shows under All; recency still filters it", async () => {
      // #307: Yara's direct request sits in the direct pools but on no
      // team-inclusive page — yet shows under All (the union of both searches).
      await expect.soft(prBlock.getByText("Yara's direct-only ask")).toBeVisible();
      // The recency window is not the cause: Yara's PR is two days old,
      // so it hides under "Last day" by design — and returns under All.
      await pickOption(page, "Updated within", "Last day");
      await expect.soft(prBlock.getByText("Yara's direct-only ask")).toHaveCount(0);
      await expect.soft(prBlock.getByText("Review ask 301")).toBeVisible();
      await pickOption(page, "Updated within", "All");
      await expect.soft(prBlock.getByText("Yara's direct-only ask")).toBeVisible();
    });

    await test.step("the author list knows only the first page; typing filters the dropdown", async () => {
      await expect.soft(page.getByLabel("Author", { exact: true })).toHaveValue("All");
      await page.getByLabel("Author", { exact: true }).click();
      await expect.soft(openPopup(page).getByRole("option", { name: "alice (15)" })).toBeVisible({ timeout: 15_000 });
      await expect.soft(openPopup(page).getByRole("option", { name: /carol/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
      // Typing filters the dropdown to the matching authors and opens it.
      await page.getByLabel("Author", { exact: true }).pressSequentially("ali");
      await expect.soft(openPopup(page).getByRole("option", { name: "alice (15)" })).toBeVisible({ timeout: 15_000 });
      await expect.soft(openPopup(page).getByRole("option", { name: /bob/ })).toHaveCount(0);
      await checkLayout(page, "start-author-combo-typing-1440-light");
      await page.keyboard.press("Escape");
      await expect.soft(page.getByLabel("Author", { exact: true })).toHaveValue("All");
    });

    await test.step("Load more appends one page per search; a failing page keeps rows with Retry", async () => {
      await prBlock.getByTestId("lists-load-more").click();
      await expect.soft(prBlock.getByText("Carol late ask 335")).toBeVisible({ timeout: 30_000 });
      await expect.soft(prBlock.getByText("Review ask 360")).toBeVisible();
      await expect.soft(prBlock.getByText("Load more PRs")).toBeVisible();
      await checkLayout(page, "start-pr-list-more-loaded-1440-light");
      await page.getByLabel("Author", { exact: true }).click();
      await expect.soft(openPopup(page).getByRole("option", { name: "carol (5)" })).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press("Escape");

      // A second press appends the page after that.
      await prBlock.getByTestId("lists-load-more").click();
      await expect.soft(prBlock.getByText("Review ask 375")).toBeVisible({ timeout: 30_000 });

      // A failing page (#310) keeps every shown row and offers Retry by the
      // button: the third page of the direct search is down.
      await prBlock.getByTestId("lists-load-more").click();
      const moreError = prBlock.getByTestId("lists-more-error");
      await expect.soft(moreError).toHaveText("couldn't load the next page from GitHub");
      expect.soft(await prBlock.getByText("Review ask 391").count()).toBe(0);
      await expect.soft(prBlock.getByText("Review ask 375")).toBeVisible();
      await expect.soft(prBlock.getByText("Yara's direct-only ask")).toBeVisible();
      const retry = prBlock.getByTestId("lists-load-more");
      await expect.soft(retry).toHaveText("Retry");
      // Retry re-fires the same page and still fails: rows still kept.
      await retry.click();
      await expect.soft(prBlock.getByTestId("lists-more-error")).toHaveText("couldn't load the next page from GitHub");
      await expect.soft(prBlock.getByText("Review ask 375")).toBeVisible();
      await checkLayout(page, "start-pr-list-more-error-1440-light");
    });

    await test.step("typing an absent login fetches that author's PRs from GitHub", async () => {
      await prBlock.getByLabel("Author", { exact: true }).fill("diana");
      await prBlock.getByLabel("Author", { exact: true }).press("Enter");
      await expect.soft(prBlock.getByText("Diana's special ask")).toBeVisible({ timeout: 30_000 });
      await expect.soft(prBlock.getByText("Review ask 301")).toHaveCount(0);
      await expect.soft(page.getByLabel("Author", { exact: true })).toHaveValue("diana (1)");
      const calls = readFileSync(path.join(logDir, "calls.log"), "utf8");
      expect.soft(calls).toContain("author:diana");
      await checkLayout(page, "start-pr-list-more-1440-light");
    });
  });

  test("PR lists, badges and the quiet remove", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const repoId = repoIds["prlist"]!;

    for (const combo of tourCombos("startPrList", [
      { name: "1440-light", width: 1440, dark: false },
      { name: "1440-dark", width: 1440, dark: true },
      { name: "960-light", width: 960, dark: false },
      { name: "960-dark", width: 960, dark: true },
    ] as const)) {
      await test.step(`pr lists read and share the column edge (${combo.name})`, async () => {
        if (!svc) throw new Error("no service");
        await page.setViewportSize({ width: combo.width, height: 900 });
        if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
        await serviceStart(page, svc, repoId, "acme/prlist");
        // Your PRs (open + draft).
        await expect.soft(page.getByText("Fix quadratic backtracking in OWS matching")).toBeVisible({ timeout: 30_000 });
        await expect.soft(page.getByText("WIP: normalize folded headers on parse")).toBeVisible();
        // Requested of you: empty sub-group shows a 0 count badge on the
        // heading instead of an empty line (#274).
        await expect.soft(page.locator(".subhead", { hasText: "Requested of you" }).locator(".cnt")).toHaveText("0");
        await expect.soft(page.getByTestId("requested-direct-empty")).toHaveCount(0);
        // Requested of your team: the rest of the state mix.
        await expect.soft(page.getByText("Bump minimum Python to 3.10")).toBeVisible();
        await expect.soft(page.getByText("Drop the old compat shim")).toBeVisible();
        await expect.soft(page.getByText("Add OWS regression tests")).toBeVisible();
        await expect.soft(page.getByText("Document header unfolding")).toBeVisible();
        await expect.soft(page.getByText("Re-requested after changes")).toBeVisible();
        // #224: state + decision read as icons with accessible labels…
        // #234: no icon for open — open PRs with no decision show no badges.
        const iconRow = (title: string): import("@playwright/test").Locator =>
          page.locator(".ci", { hasText: title });
        await expect.soft(iconRow("Fix quadratic backtracking in OWS matching").locator('[data-testid="pr-badges"]')).toHaveCount(0);
        await expect.soft(iconRow("WIP: normalize folded headers on parse").getByRole("img", { name: "Draft" })).toBeVisible();
        await expect.soft(iconRow("Drop the old compat shim").getByRole("img", { name: "Merged" })).toBeVisible();
        await expect.soft(iconRow("Add OWS regression tests").getByRole("img", { name: "Changes requested" })).toBeVisible();
        await expect.soft(iconRow("Document header unfolding").getByRole("img", { name: "Approved" })).toBeVisible();
        // …and no text pill remains. #230: review_required never shows; #234:
        // open rows (plain open, re-requested) show no badges at all.
        const badgeTexts = await page.locator('[data-testid="pr-badges"]').allTextContents();
        expect.soft(badgeTexts.join(" ")).not.toMatch(/Open|Draft|Merged|Closed|Approved|Changes requested|Review required/);
        await expect.soft(page.getByRole("img", { name: "Review required" })).toHaveCount(0);
        await expect.soft(page.getByRole("img", { name: "Open" })).toHaveCount(0);
        await expect.soft(iconRow("Bump minimum Python to 3.10").locator('[data-testid="pr-badges"]')).toHaveCount(0);
        await expect.soft(iconRow("Re-requested after changes").locator('[data-testid="pr-badges"]')).toHaveCount(0);
        await page.getByText("Requested of your team").scrollIntoViewIfNeeded();
        await checkLayout(page, `start-pr-list-${combo.name}`);
      });
    }

    await test.step("quiet remove on session rows: hover and keyboard focus reveal it (#274)", async () => {
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: 1440, height: 900 });
      const created = await apiJson(svc, "POST", "/api/reviews", { repoId: "demo" });
      const demoId = (created.json as { review: { id: string } }).review.id;
      await serviceStart(page, svc, repoId, "acme/prlist");
      const row = page.locator(`[data-testid="session-${demoId}"]`);
      await expect.soft(row).toBeVisible({ timeout: 30_000 });
      const remove = row.getByRole("button", { name: "Remove this review" });
      // Hidden until the row is hovered... (#346: the rule hides the
      // confirm's idle slot, so the slot is the element to read.)
      const idle = row.locator(".uic-idlehold");
      await expect.soft(idle).toHaveCSS("opacity", "0");
      await row.hover();
      await expect.soft(idle).toHaveCSS("opacity", "1");
      // ...and still keyboard-reachable: focusing it reveals it via :focus-within.
      await page.mouse.move(0, 0);
      await remove.focus();
      await expect.soft(idle).toHaveCSS("opacity", "1");
      await checkLayout(page, "start-quiet-remove");
    });
  });

  test("PR state follows refresh with no new commits and no re-ingest", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const flipRepo = repoIds["flip"]!;
    const refreshRepo = repoIds["refresh"]!;

    await test.step("refresh flips the bar and the Reviews list with the same head (#230)", async () => {
      if (!svc) throw new Error("no service");
      await serviceStart(page, svc, flipRepo, /local\//);
      const row = page.locator(`[data-testid="session-${flipId}"]`);
      await expect.soft(row).toBeVisible({ timeout: 30_000 });
      await expect.soft(row.locator('[data-testid="pr-badges"]')).toHaveCount(0);

      // Review bar starts the same way.
      await page.goto(`${svc.origin}/review/${flipId}?token=${svc.token}`);
      await expect.soft(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator('#reviewbar [data-testid="pr-badges"]')).toHaveCount(0);
      const bar = page.locator("#reviewbar");

      // The refresh button: same head, new state — no new version, no banner.
      await bar.getByRole("button", { name: "Refresh" }).click();
      // #245: the status icons sit INSIDE the GitHub link box, after owner/repo#N.
      const barLink = bar.locator('a[title="Open PR on GitHub"]');
      await expect.soft(barLink.getByRole("img", { name: "Merged" })).toBeVisible({ timeout: 30_000 });
      await expect.soft(barLink.getByRole("img", { name: "Approved" })).toBeVisible();
      await expect.soft(bar).not.toContainText("Merged");
      await expect.soft(bar).not.toContainText("Approved");
      // No sibling badges in the row — the icons live inside the link.
      await expect.soft(page.locator('#reviewbar > .rid > [data-testid="pr-badges"]')).toHaveCount(0);
      // The icon keeps its shared tooltip inside the link.
      await barLink.getByRole("img", { name: "Merged" }).hover({ timeout: 15_000 });
      await expect.soft(page.locator("#tip")).toContainText("Merged", { timeout: 15_000 });

      // #239: home, GitHub link, Refresh and Debug line up on the bottom
      // (within 1–2px). One synchronous read (B1): the pair below used
      // separate boundingBox calls.
      const bottoms = await page.evaluate(() => {
        const barEl = document.getElementById("reviewbar");
        if (!barEl) return null;
        const pick = (sel: string): Element | null => barEl.querySelector(sel);
        const els: Element[] = [
          pick('a[aria-label="Back to the start page"]'),
          pick('a[title="Open PR on GitHub"]'),
          pick('button[aria-label="Refresh"]'),
          pick('a[aria-label="Debug"]'),
        ].filter((el): el is Element => el !== null);
        return els.map((el) => {
          const r = el.getBoundingClientRect();
          const label = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName;
          return { label, bottom: r.bottom, height: r.height };
        });
      });
      expect.soft(bottoms).not.toBeNull();
      expect.soft(bottoms!.length).toBeGreaterThanOrEqual(4);
      const bs = bottoms!.map((b) => b.bottom);
      expect.soft(
        Math.max(...bs) - Math.min(...bs),
        `review bar bottoms misaligned: ${JSON.stringify(bottoms)}`,
      ).toBeLessThanOrEqual(2);
      // #245: the icon is inside the link, so it is not a separate
      // bottom — its centre sits on the bar's centre line instead.
      const iconMid = await page.evaluate(() => {
        const barEl = document.getElementById("reviewbar");
        const link = barEl?.querySelector('a[title="Open PR on GitHub"]');
        const icon = link?.querySelector('[data-testid="pr-badges"] [role="img"]');
        const lr = link?.getBoundingClientRect();
        const ir = icon?.getBoundingClientRect();
        if (!lr || !ir) return null;
        return { linkMid: lr.top + lr.height / 2, iconMid: ir.top + ir.height / 2 };
      });
      expect.soft(iconMid).not.toBeNull();
      expect.soft(
        Math.abs(iconMid!.iconMid - iconMid!.linkMid),
        `icon not centred in link: ${JSON.stringify(iconMid)}`,
      ).toBeLessThanOrEqual(1);
      // #244: the boxed link matches the Comments button height.
      const heights = await page.evaluate(() => {
        const barEl = document.getElementById("reviewbar");
        if (!barEl) return null;
        const link = barEl.querySelector('a[title="Open PR on GitHub"]');
        const comments = barEl.querySelector('[data-cm=""]');
        if (!link || !comments) return null;
        return {
          link: link.getBoundingClientRect().height,
          comments: comments.getBoundingClientRect().height,
        };
      });
      expect.soft(heights).not.toBeNull();
      expect.soft(
        Math.abs(heights!.link - heights!.comments),
        `boxed link height ${heights!.link} != Comments height ${heights!.comments}`,
      ).toBeLessThanOrEqual(1);
      await checkLayout(page, "j230-bar");

      // The stored review moved too: the API summary carries the new state.
      const summary = await apiJson(svc, "GET", "/api/reviews");
      const found = (summary.json as { reviews: { id: string; prState?: string; reviewDecision?: string }[] }).reviews.find(
        (r) => r.id === flipId,
      );
      expect.soft(found?.prState).toBe("merged");
      expect.soft(found?.reviewDecision).toBe("approved");

      // And the Reviews list shows it after returning to the start page.
      await serviceStart(page, svc, flipRepo, /local\//);
      const rowAfter = page.locator(`[data-testid="session-${flipId}"]`);
      await expect.soft(rowAfter).toBeVisible({ timeout: 30_000 });
      await expect.soft(rowAfter.locator('[data-testid="pr-badges"]').getByRole("img", { name: "Merged" })).toBeVisible({ timeout: 30_000 });
      await expect.soft(rowAfter.locator('[data-testid="pr-badges"]').getByRole("img", { name: "Approved" })).toBeVisible();

      // No extra gh calls beyond ingest + refresh (the lists were never
      // fetched, no polling on open): count this PR's views exactly.
      const views = readdirSync(logDir).filter((f) => f.startsWith("view-flip-1-")).length;
      expect.soft(views).toBeLessThanOrEqual(3);
    });

    await test.step("lists Refresh flips the row to merged/approved with new commits, no re-ingest (#298)", async () => {
      if (!svc) throw new Error("no service");
      await serviceStart(page, svc, refreshRepo, "acme/app");
      const row = page.locator(`[data-testid="session-${refreshId}"]`);
      await expect.soft(row).toBeVisible({ timeout: 30_000 });
      await expect.soft(row.locator('[data-testid="pr-badges"]')).toHaveCount(0);
      await expect.soft(row).not.toContainText("new commits");

      // The PR merges, is approved, and gains a commit.
      const repoDir = dirs.find((d) => d.includes("l1-refresh-repo"))!;
      writeFileSync(path.join(repoDir, "src", "util.py"), "VALUE = 43\n");
      await git(repoDir, "commit", "-am", "second commit");
      const head2 = await git(repoDir, "rev-parse", "HEAD");
      expect.soft(head2).not.toBe(refreshHead1);
      writeFileSync(path.join(logDir, "head"), head2);
      writeFileSync(path.join(logDir, "state"), "merged");
      const statusCallsBefore = statusCallCount();

      await page.locator('[data-testid="lists-refresh"]').click();

      await expect.soft(row.locator('[data-testid="pr-badges"]').getByRole("img", { name: "Merged" })).toBeVisible({ timeout: 30_000 });
      await expect.soft(row.locator('[data-testid="pr-badges"]').getByRole("img", { name: "Approved" })).toBeVisible();
      await expect.soft(row).toContainText("new commits");

      // One batched status query for this Refresh press.
      expect.soft(statusCallCount() - statusCallsBefore).toBe(1);

      const summary = await apiJson(svc, "GET", "/api/reviews");
      const found = (summary.json as { reviews: { id: string; prState?: string; reviewDecision?: string; stale: boolean; currentVersion: number }[] }).reviews.find(
        (r) => r.id === refreshId,
      );
      expect.soft(found?.prState).toBe("merged");
      expect.soft(found?.reviewDecision).toBe("approved");
      expect.soft(found?.stale).toBe(true);
      expect.soft(found?.currentVersion).toBe(1);

      // No re-ingest: the stored version still points at the first head.
      const snap = await apiJson(svc, "GET", `/api/reviews/${refreshId}`);
      expect.soft((snap.json as { version: { headSha: string; n: number } }).version.headSha).toBe(refreshHead1);
      expect.soft((snap.json as { version: { n: number } }).version.n).toBe(1);
    });

    function statusCallCount(): number {
      try {
        return readFileSync(path.join(logDir, "calls.log"), "utf8")
          .split("\n")
          .filter((l) => l.includes("pullRequest(number:")).length;
      } catch {
        return 0;
      }
    }
  });

  test("stacked badges, popover and the review bar", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const stackRepo = repoIds["stack"]!;
    const barRepo = repoIds["bar"]!;
    const SHORT = "example-org/a-fairly-long-repository-name#7502";

    await test.step("badges on PR list, Reviews list and header; popover opens another PR (#321)", async () => {
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: 1440, height: 900 });
      await serviceStart(page, svc, stackRepo, "acme/stack");
      const badges = page.getByTestId("stack-badge");
      await expect.soft(badges).toHaveCount(3, { timeout: 30_000 });
      // Row order follows recency, not stack order, and the stub stamps all
      // three PRs within the same millisecond — so the first row is not
      // always PR 11. Compare the set, never nth(0).
      const texts = (await badges.allTextContents()).map((t) => t.trim()).sort();
      expect.soft(texts).toEqual(["1/3 ~", "2/3 ~", "3/3 ~"]);
      // All three share one colour.
      const colors = await badges.evaluateAll((els) => els.map((e) => getComputedStyle(e as HTMLElement).backgroundColor));
      expect.soft(new Set(colors).size).toBe(1);

      // Popover from the middle badge: order top-first down to the base branch.
      await badges.filter({ hasText: "2/3" }).first().click();
      const pop = page.getByTestId("stack-popover");
      await expect.soft(pop).toBeVisible();
      await expect.soft(pop.getByTestId("stack-entry-13")).toContainText("Stack top change");
      await expect.soft(pop.getByTestId("stack-entry-12")).toContainText("this PR");
      await expect.soft(pop).toContainText("main (base)");

      // Opening another PR's review from the popover.
      await pop.getByTestId("stack-entry-11").click();
      await expect.soft(page).toHaveURL(/\/review\//, { timeout: 60_000 });
      // Review header carries the same stack badge (1/3 for the root PR).
      await expect.soft(page.getByTestId("stack-badge").first()).toContainText("1/3", { timeout: 60_000 });
      // #321 follow-up: the header badge sits INSIDE the repo#PR button,
      // right after the PR number, in the stack colour.
      const headerBadge = page.getByTestId("stack-badge").first();
      const headerLink = page.locator("#reviewbar a.ui-btn").first();
      await expect.soft(headerLink).toContainText("acme/stack#11");
      expect.soft(await headerBadge.evaluate((el) => el.closest("a.ui-btn") !== null)).toBe(true);
      expect.soft(await headerBadge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(colors[0]);
      // Clicking the badge opens the popover, not the GitHub PR link.
      const pagesBefore = page.context().pages().length;
      await headerBadge.click();
      await expect.soft(page.getByTestId("stack-popover")).toBeVisible();
      expect.soft(page.context().pages().length).toBe(pagesBefore);
      await expect.soft(page).toHaveURL(/\/review\//);
      await page.keyboard.press("Escape");
      await expect.soft(page.getByTestId("stack-popover")).toHaveCount(0);
      // At 960 the bar still fits on one line with the badge inside (#362 keep).
      await page.setViewportSize({ width: 960, height: 900 });
      // Wait for the settled layout, not a fixed delay (#363 B2).
      const settledBar = async (): Promise<{ h: number; overlap: boolean; overflow: boolean }> =>
        page.evaluate(() => {
          const bar = document.getElementById("reviewbar")!;
          const kids = [...bar.children].map((el) => el.getBoundingClientRect());
          let overlap = false;
          for (let i = 0; i < kids.length; i++)
            for (let j = i + 1; j < kids.length; j++)
              if (
                kids[i]!.left < kids[j]!.right &&
                kids[j]!.left < kids[i]!.right &&
                kids[i]!.top < kids[j]!.bottom &&
                kids[j]!.top < kids[i]!.bottom
              )
                overlap = true;
          return {
            h: bar.getBoundingClientRect().height,
            overlap,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          };
        });
      await expect.poll(settledBar, { timeout: 15_000 }).toMatchObject({ overlap: false, overflow: false });
      expect.soft((await settledBar()).h).toBeLessThan(64);
      await page.setViewportSize({ width: 1440, height: 900 });

      // Reviews list on the start page shows the badge too.
      await serviceStart(page, svc!, stackRepo, "acme/stack");
      await expect.soft(page.getByTestId("stack-badge").first()).toBeVisible({ timeout: 30_000 });
    });

    for (const combo of tourCombos("reviewbarPr", [
      { name: "studio-light", theme: "studio", scheme: "light", dark: false },
      { name: "default-light", theme: "default", scheme: "light", dark: false },
      { name: "console-dark", theme: "console", scheme: "dark", dark: true },
    ] as const)) {
      await test.step(`PR bar with icon inside the link (${combo.theme} ${combo.scheme}, #245)`, async () => {
        if (!svc) throw new Error("no service");
        const barId = await apiJson(svc, "POST", "/api/reviews", { repoId: barRepo, pr: 7502 }).then(
          (r) => (r.json as { review: { id: string } }).review.id,
        );
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

        await page.goto(`${svc.origin}/review/${barId}?token=${svc.token}`);
        await expect.soft(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
        await expect.soft(page.locator("html")).toHaveAttribute("data-ui-theme", combo.theme);
        await page.evaluate(() => document.fonts.ready).catch(() => {});

        // The long boxed link with the single Approved icon inside it.
        const bar = page.locator("#reviewbar");
        const link = bar.locator('a[title="Open PR on GitHub"]');
        await expect.soft(link).toContainText(SHORT, { timeout: 15_000 });
        // Moved from start-lists.spec.ts (#258): the label links to the PR
        // without opening the review.
        await expect.soft(link).toHaveAttribute(
          "href",
          "https://github.com/example-org/a-fairly-long-repository-name/pull/7502",
        );
        await expect.soft(link).toHaveAttribute("target", "_blank");
        const badges = link.locator('[data-testid="pr-badges"]');
        await expect.soft(badges.getByRole("img", { name: "Approved" })).toBeVisible();
        await expect.soft(badges.getByRole("img", { name: "Open" })).toHaveCount(0);
        // No sibling badges in the row — the icon lives inside the link.
        await expect.soft(page.locator('#reviewbar > .rid > [data-testid="pr-badges"]')).toHaveCount(0);
        // The icon keeps its shared tooltip inside the link.
        await badges.getByRole("img", { name: "Approved" }).hover({ timeout: 15_000 });
        await expect.soft(page.locator("#tip")).toContainText("Approved", { timeout: 15_000 });

        // Every control is one height and centred on one line (#245).
        // One synchronous read (B1).
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
        expect.soft(boxes.map((b) => b.name)).toEqual(
          expect.arrayContaining(["home", "github", "refresh", "panes", "comments", "submit"]),
        );
        const h = boxes[0]!.height;
        for (const b of boxes) expect.soft(Math.abs(b.height - h), `${b.name} height ${b.height} vs ${h}`).toBeLessThanOrEqual(1);
        const mids = boxes.map((b) => b.mid);
        expect.soft(Math.max(...mids) - Math.min(...mids), JSON.stringify(boxes)).toBeLessThanOrEqual(1);

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
        expect.soft(fit).not.toBeNull();
        expect.soft(fit!.linkClip, "link text clipped").toBeLessThanOrEqual(1);
        expect.soft(fit!.barOverflow, "bar overflows").toBeLessThanOrEqual(1);
        expect.soft(fit!.icon).not.toBeNull();
        expect.soft(fit!.icon!.left, "icon left of link text").toBeGreaterThanOrEqual(fit!.link.left - 1);
        expect.soft(fit!.icon!.right, "icon outside link box").toBeLessThanOrEqual(fit!.link.right + 1);
        expect.soft(Math.abs(fit!.icon!.mid - mids[0]!), "icon not on the centre line").toBeLessThanOrEqual(1);

        await checkLayout(page, `reviewbar-pr-${combo.theme}-${combo.scheme}`);
      });
    }

    await test.step("one bar, home, comments with source closed, guide toggle, fits at 960 (#141 #83)", async () => {
      if (!svc) throw new Error("no service");
      const barId = await apiJson(svc, "POST", "/api/reviews", { repoId: barRepo, pr: 7502 }).then(
        (r) => (r.json as { review: { id: string } }).review.id,
      );
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${svc.origin}/review/${barId}?token=${svc.token}`);
      await expect.soft(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
      // Issue #141: no application top bar on a review, no breadcrumb;
      // the bar's home control returns to the start page.
      await expect.soft(page.locator("header.top")).toHaveCount(0);
      await expect.soft(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
      const bar = page.locator("#reviewbar");
      const home = bar.getByRole("link", { name: "Back to the start page" });
      await expect.soft(home).toHaveAttribute("href", "/");
      await home.click();
      expect.soft(new URL(page.url()).pathname).toBe("/");
      await page.goBack();
      await expect.soft(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
      // Comments menu opens with the source pane closed.
      await page.locator("#toggleRight").click();
      await expect.soft(page.locator("#right")).toHaveClass(/hide/);
      await page.locator('#reviewbar [data-cm=""]').click();
      await expect.soft(page.locator("#reviewbar .cmenu")).toBeVisible();
      await page.keyboard.press("Escape");
      // Issue #83: guide off, the source pane spans the window with no
      // drag handle; back on, the two-pane split returns.
      const guide = page.getByRole("button", { name: "Guide", exact: true });
      await guide.click();
      await expect.soft(page.locator("#page")).toHaveClass(/hide/);
      const box = await page.locator("#right").boundingBox();
      expect.soft(box?.width).toBeGreaterThanOrEqual(1430);
      await expect.soft(page.locator("#handle")).toBeHidden();
      await guide.click();
      await expect.soft(page.locator("#page")).not.toHaveClass(/hide/);
      await expect.soft(page.locator("#right")).not.toHaveClass(/hide/);
      await expect.soft(page.locator("#handle")).toBeVisible();
      // Narrow desktop (#362 named keep): the bar never overflows.
      await page.setViewportSize({ width: 960, height: 600 });
      const overflow = await page.locator("#reviewbar").evaluate((el) => el.scrollWidth - el.clientWidth);
      expect.soft(overflow).toBeLessThanOrEqual(1);
      await checkLayout(page, "reviewbar-pr-narrow");
    });

    await test.step("GitHub action links diff lines at the review commit", async () => {
      if (!svc) throw new Error("no service");
      if (!svc) throw new Error("no service");
      const barId = await apiJson(svc, "POST", "/api/reviews", { repoId: barRepo, pr: 7502 }).then(
        (r) => (r.json as { review: { id: string } }).review.id,
      );
      await page.goto(`${svc.origin}/review/${barId}?nohl=1&token=${svc.token}`);
      await expect.soft(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      await expect.soft(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });
      await selectText(page, "#right table.diff", "return 2");
      await expect.soft(page.locator("#selbar")).toBeVisible({ timeout: 10_000 });
      const link = page.locator('#selbar [data-act="github"]');
      await expect.soft(link).toBeVisible();
      await expect.soft(link).toHaveAttribute(
        "href",
        /https:\/\/github\.com\/example-org\/a-fairly-long-repository-name\/blob\/[0-9a-f]+\/.+#L\d+(-L\d+)?/,
      );
      await expect.soft(link).toHaveAttribute("target", "_blank");
    });
  });
});


// ---------------------------------------------------------------------------
// #383 — progressive start page: its own service + fakes, so the shared
// union service above stays untouched. A slow stub `git fetch` records
// every call; a stub `gh` holds one list call behind a release marker;
// the repo is a managed clone. Nothing touches the network.
// ---------------------------------------------------------------------------

test.describe("L1 progressive start page (#383)", () => {
  let dataDir = "";
  let logDir = "";
  let svc: RunningService | null = null;
  const dirs: string[] = [];
  let repoId = "";
  let reviewTitle = "";

  test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

  test.beforeAll(async () => {
    const tmp = (tag: string): string => {
      const d = mkdtempSync(path.join(os.tmpdir(), `unvibe-l1-383-${tag}-`));
      dirs.push(d);
      return d;
    };
    dataDir = tmp("data");
    logDir = tmp("gh");
    const fakeBin = tmp("bin");
    writeFakeGh383(fakeBin, logDir);
    writeFakeGitSlowFetch(fakeBin, realGitPath(), logDir, 6);
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, {
      mode: 0o755,
    });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    // Managed clone through the stubbed `gh repo clone`.
    const added = await apiJson(svc, "POST", "/api/repos", { url: "https://github.com/acme/progapp" });
    if (added.status !== 200) throw new Error(`managed add failed: ${added.status} ${JSON.stringify(added.json)}`);
    const list = (added.json as { repos: { id: string; localPath: string; managed?: boolean }[] }).repos;
    const repo = list.find((r) => r.id !== "demo" && r.managed === true);
    if (!repo) throw new Error(`managed repo not registered: ${JSON.stringify(list)}`);
    repoId = repo.id;
    // One branch review, so the Reviews list is non-empty.
    const created = await apiJson(svc, "POST", "/api/reviews", { repoId, branch: "feature" });
    if (created.status !== 201 && created.status !== 200 && created.status !== 202) {
      throw new Error(`review create failed: ${created.status} ${JSON.stringify(created.json)}`);
    }
    const reviewId = (created.json as { review: { id: string } }).review.id;
    await awaitIngestReady(svc, reviewId);
    const snap = await apiJson(svc, "GET", "/api/reviews");
    const rows = (snap.json as { reviews: { id: string; title: string }[] }).reviews;
    reviewTitle = rows.find((r) => r.id === reviewId)?.title ?? "feature";
    // The review creation fetched the clone; the fetch log below counts
    // page loads only.
    rmSync(path.join(logDir, "fetch.log"), { force: true });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test("each list lands on its own, kept rows first, one fetch per load", async ({ page }) => {
    test.setTimeout(240_000);
    const active = svc;
    if (!active) throw new Error("no service");
    const fetchLog = path.join(logDir, "fetch.log");
    const fetchLines = (): string[] => {
      try {
        return readFileSync(fetchLog, "utf8").split("\n").filter((l) => l.length > 0);
      } catch {
        return [];
      }
    };
    const fetchStarts = (): number => fetchLines().filter((l) => l.startsWith("start")).length;
    const fetchDones = (): number => fetchLines().filter((l) => l.startsWith("done")).length;
    const releaseMarker = path.join(logDir, "release383");

    await test.step("first load: fast lists render while the held list and the fetch are still in flight", async () => {
      rmSync(releaseMarker, { force: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await serviceStart(page, active, repoId, "acme/progapp");
      const prBlock = page.getByTestId("pr-block");
      const reviews = page.locator('[aria-label="Reviews"]');
      // Your PRs and branches (fast calls) render on their own.
      await expect.soft(prBlock.getByText("Progapp folded-header fix")).toBeVisible({ timeout: 30_000 });
      await expect.soft(prBlock.getByText("Recent branches")).toBeVisible({ timeout: 30_000 });
      // The held review-requested call hasn't landed: its section is absent.
      await expect.soft(page.getByText("Waiting on your review")).toHaveCount(0);
      // The one background fetch is still in flight while the lists show.
      expect.soft(fetchStarts()).toBe(1);
      expect.soft(fetchDones()).toBe(0);
      // Release the held list: it lands on its own.
      writeFileSync(releaseMarker, "go\n");
      await expect.soft(prBlock.getByText("Team progapp ask")).toBeVisible({ timeout: 30_000 });
      await expect.soft(prBlock.getByText("Reviewer asks for your progapp review")).toBeVisible();
      // The Reviews list shows the session.
      await expect.soft(reviews.getByText(reviewTitle, { exact: true })).toBeVisible();
      // Exactly one fetch ran for the whole load.
      await expect.poll(() => fetchDones(), { timeout: 30_000 }).toBe(1);
      expect.soft(fetchStarts()).toBe(1);
    });

    await test.step("reload: kept rows and kept Reviews render while fresh responses are held", async () => {
      rmSync(releaseMarker, { force: true });
      rmSync(fetchLog, { force: true });
      // Hold the fresh Reviews response: only the kept list can render it.
      await page.route("**/api/reviews", async (route) => {
        await new Promise((r) => setTimeout(r, 8000));
        await route.continue();
      });
      await serviceStart(page, active, repoId, "acme/progapp");
      const prBlock = page.getByTestId("pr-block");
      const reviews = page.locator('[aria-label="Reviews"]');
      // Kept Reviews + kept PR rows show while the fresh responses are held.
      await expect.soft(reviews.getByText(reviewTitle, { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect.soft(prBlock.getByText("Progapp folded-header fix")).toBeVisible({ timeout: 15_000 });
      // The kept requested rows show too — the backend is still blocked.
      await expect.soft(prBlock.getByText("Team progapp ask")).toBeVisible({ timeout: 15_000 });
      expect.soft(fetchStarts()).toBe(1);
      // Release the held list and let the held Reviews refresh confirm it.
      writeFileSync(releaseMarker, "go\n");
      await expect.soft(prBlock.getByText("Reviewer asks for your progapp review")).toBeVisible({ timeout: 30_000 });
      await expect.soft(reviews.getByText(reviewTitle, { exact: true })).toBeVisible({ timeout: 30_000 });
      // Exactly one more fetch for the reload.
      await expect.poll(() => fetchDones(), { timeout: 30_000 }).toBe(1);
      expect.soft(fetchStarts()).toBe(1);
    });
  });
});
