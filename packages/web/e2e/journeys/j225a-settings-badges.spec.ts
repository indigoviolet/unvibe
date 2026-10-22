/**
 * J225a (#225 part A, #224): settings screens share one card each with
 * compact rows, the start page rows align, PR state/decision icons show
 * on PR reviews (nothing on branch reviews), and the Remove popover
 * keeps the worst-case row (state + decision + new commits) still —
 * against the real service. No screenshot baselines (owner direction).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { checkLayout } from "../layout-check.js";
import { apiJson, createScratchReview, git, makeScratchRepo, realGitPath, writeFakeGitOffline } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/**
 * Fake `gh`: PR view carries state + reviewDecision (#224, #230); pr list
 * stays unimplemented. The head SHA is resolved from the repo at call
 * time, so a commit added mid-test is picked up by the next refresh (the
 * stale path). Empty reviewRequests/latestReviews: a changes-requested
 * reviewer who has not been re-requested still shows changes requested.
 */
function writeFakeGhDecision(binDir: string, logDir: string, repoDir: string, headSha: string): void {
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  HEAD=$(git -C "${repoDir}" rev-parse feature 2>/dev/null || echo "${headSha}")
  cat <<EOF
{"title":"Journey PR","body":"First paragraph.","author":{"login":"author"},"state":"OPEN","isDraft":false,"reviewDecision":"CHANGES_REQUESTED","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"$HEAD"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo 'author'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as author"; exit 0; fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

async function noPageScroll(page: import("@playwright/test").Page): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(1);
}

async function equalHeights(locator: import("@playwright/test").Locator): Promise<void> {
  const heights = await locator.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(1);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1.5);
}

test.describe("J225a settings, start page and PR badges", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let prReviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j225a-repo-"));
    const repo = await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j225a-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j225a-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j225a-bin-"));
    writeFakeGhDecision(fakeBin, logDir, repoDir, repo.headSha);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    // A PR review (fake gh: OPEN + CHANGES_REQUESTED) and a branch review (no badges).
    prReviewId = await createScratchReview(svc, repoDir, { pr: 1 });
    await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("settings screens: one card each, compact rows, no stale commentary", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });

    // Limits: numeric inputs sized for their values, go-deeper toggle as
    // the shared Field checkbox inside the card.
    await page.getByRole("tab", { name: "Limits" }).click();
    const limitsPanel = page.getByRole("tabpanel", { name: "Limits" });
    const limitsCard = limitsPanel.locator(".ui-card").first();
    const sessionsInput = page.locator("#limit-sessionsPerProvider");
    await expect(sessionsInput).toBeVisible({ timeout: 15_000 });
    const cardBox = await limitsCard.boundingBox();
    const inputBox = await sessionsInput.boundingBox();
    expect(inputBox!.width).toBeLessThan((cardBox!.width - 32) / 2);
    await expect(limitsCard.getByTestId("auto-go-deeper-toggle")).toHaveRole("checkbox");
    await noPageScroll(page);

    // Version: the enable toggle lives inside the card on one line (#229).
    await page.getByRole("tab", { name: "Version" }).click();
    const versionPanel = page.getByRole("tabpanel", { name: "Version" });
    const versionCard = versionPanel.locator(".ui-card").first();
    await expect(versionCard.getByTestId("version-picker-toggle")).toHaveRole("checkbox");
    await noPageScroll(page);

    // Appearance: theme names only, no per-theme descriptions.
    await page.getByRole("tab", { name: "Appearance" }).click();
    const appearancePanel = page.getByRole("tabpanel", { name: "Appearance" });
    await expect(page.locator('[data-testid="ui-theme"]')).toBeVisible({ timeout: 15_000 });
    await expect(appearancePanel).not.toContainText("Soft modern workspace");
    await noPageScroll(page);

    // Models: nothing under the model picker — no description, no
    // status/path line; a role that isn't ready links to Environment.
    await page.getByRole("tab", { name: "Models" }).click();
    await expect(page.locator('[data-testid="model-main"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid$="-desc"]')).toHaveCount(0);
    const mainStatus = page.locator('[data-testid="model-main-status"]');
    await mainStatus.waitFor({ timeout: 15_000 }).catch(() => {});
    if ((await mainStatus.count()) > 0) {
      await expect(mainStatus.getByRole("link", { name: "Check Environment" })).toHaveAttribute(
        "href",
        "/settings?tab=environment",
      );
    }
    await noPageScroll(page);

    // Environment: one card, one compact row per check, actions in the footer.
    await page.getByRole("tab", { name: "Environment" }).click();
    const envPanel = page.getByRole("tabpanel", { name: "Environment" });
    const envCard = envPanel.locator(".ui-card").first();
    const envRows = envCard.locator(":scope > .ui-list > .ui-row");
    await expect(envRows.first()).toBeVisible({ timeout: 30_000 });
    expect(await envRows.count()).toBeGreaterThan(3);
    await equalHeights(envRows);
    await expect(envCard.getByRole("button", { name: "Re-check" })).toBeVisible();
    await expect(envCard.getByRole("button", { name: "Reload environment" })).toBeVisible();
    await expect(envCard.getByRole("link", { name: "Doctor page" })).toBeVisible();
    // #225: rows show versions, never paths or command lines. The d2
    // row reads "d2 0.9.0" (whatever the binary path is); the full
    // detail rides the row's hover title instead.
    const d2Row = envCard.locator('[data-testid="env-d2"]');
    await expect(d2Row).toBeVisible();
    await expect(d2Row.locator(".ui-row-meta")).toHaveText(/^d2 \d+\.\d+(\.\d+)?$/);
    await expect(d2Row).toHaveAttribute("title", /d2 .* at \//);
    const rowTexts = await envRows.evaluateAll((els) => els.map((el) => el.textContent ?? ""));
    expect(rowTexts.length).toBeGreaterThan(3);
    for (const text of rowTexts) {
      expect(text, `env row leaks a path: ${text}`).not.toMatch(/(\s|^)~?\/(?=\S)|^[A-Za-z]:[\\/]/);
    }
    await noPageScroll(page);

    // Repos: the list and both add rows share one card and one right edge.
    await page.getByRole("tab", { name: "Repos" }).click();
    const reposCard = page.locator('[data-testid="repositories-section"]').locator(".ui-card").first();
    await expect(reposCard.getByLabel("Add a repo by path")).toBeVisible({ timeout: 15_000 });
    const addRights = await reposCard
      .locator(":scope > .frow")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right));
    expect(addRights.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...addRights) - Math.min(...addRights)).toBeLessThanOrEqual(1.5);
    await expect(reposCard.getByRole("button", { name: "Browse…" })).toBeVisible();
    await noPageScroll(page);
  });

  test("start page rows align; PR icons on the PR review, Remove popover keeps the row still", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });

    // The PR opener row ends at the same right edge as the lists card below.
    const openerRight = await page
      .getByLabel("Open a PR by URL or number")
      .evaluate((el) => el.closest("div.frow")?.getBoundingClientRect().right ?? NaN);
    const blockRight = await page.getByTestId("pr-block").evaluate((el) => el.getBoundingClientRect().right);
    expect(Math.abs(openerRight - blockRight)).toBeLessThanOrEqual(1.5);
    await noPageScroll(page);

    // Reviews list: the PR review carries only the Changes requested icon
    // (#234: no icon for open)…
    const prRow = page.locator(`[data-testid="session-${prReviewId}"]`);
    await expect(prRow).toBeVisible({ timeout: 30_000 });
    const badges = prRow.locator('[data-testid="pr-badges"]');
    await expect(badges.getByRole("img", { name: "Changes requested" })).toBeVisible();
    await expect(badges.getByRole("img", { name: "Open" })).toHaveCount(0);
    // …with accessible labels and no text pills. #230: review_required never shows.
    await expect(page.getByRole("img", { name: "Review required" })).toHaveCount(0);
    await expect(badges).not.toContainText("Open");
    await expect(badges).not.toContainText("Changes requested");
    // #234: hovering the icon shows the status-only tooltip.
    await badges.getByRole("img", { name: "Changes requested" }).hover({ timeout: 15_000 });
    await expect(page.locator("#tip")).toContainText("Changes requested", { timeout: 15_000 });
    // The row's Remove is a real button with the action-only tooltip (#225).
    const removeBtn = prRow.getByRole("button", { name: "Remove this review" });
    await expect(removeBtn).toBeVisible();
    await expect(removeBtn).toHaveAttribute("title", "Remove this review");
    // …while branch reviews show none.
    const branchRows = page.locator('[data-testid^="session-"]');
    expect(await branchRows.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-testid^="session-"] [data-testid="pr-badges"]')).toHaveCount(1);

    // The review bar badges the PR review the same way (#234: open has no icon).
    await page.goto(`${svc.origin}/review/${prReviewId}?token=${svc.token}`);
    await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
    // #245: the status icon sits INSIDE the GitHub link box, after owner/repo#N.
    const barLink = page.locator('#reviewbar a[title="Open PR on GitHub"]');
    await expect(barLink).toBeVisible();
    const barBadges = barLink.locator('[data-testid="pr-badges"]');
    await expect(barBadges.getByRole("img", { name: "Changes requested" })).toBeVisible();
    await expect(barBadges.getByRole("img", { name: "Open" })).toHaveCount(0);
    await expect(barBadges).not.toContainText("Open");
    await expect(barBadges).not.toContainText("Changes requested");
    // No sibling badges in the row — the icon lives inside the link.
    await expect(page.locator('#reviewbar > .rid > [data-testid="pr-badges"]')).toHaveCount(0);
    // The icon keeps its shared tooltip inside the link.
    await barBadges.getByRole("img", { name: "Changes requested" }).hover({ timeout: 15_000 });
    await expect(page.locator("#tip")).toContainText("Changes requested", { timeout: 15_000 });
    await expect(page.getByRole("img", { name: "Review required" })).toHaveCount(0);
    // #235: the bar keeps the GitHub link and status icon, but no PR title,
    // no open-externally button, no preview/full-access badges. (Agent is
    // none here, so the left pane keeps today's "No guide yet" empty state;
    // the title move is covered by the guide heading in reviews with a guide.)
    await expect(page.locator("#reviewbar")).not.toContainText("Journey PR");
    await expect(page.locator('#reviewbar a[aria-label="Open PR on GitHub"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="preview-marker"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="full-access-marker"]')).toHaveCount(0);
    await expect(page.locator("#page .doc h1.title")).toContainText("No guide yet", { timeout: 30_000 });
    // The summary API carries the same state (no new polling: stored gh data).
    const summary = await apiJson(svc, "GET", "/api/reviews");
    const found = (summary.json as { reviews: { id: string; prState?: string; reviewDecision?: string }[] }).reviews.find(
      (r) => r.id === prReviewId,
    );
    expect(found?.prState).toBe("open");
    expect(found?.reviewDecision).toBe("changes_requested");

    // Worst case (#225, #234): decision + new commits on one row (open has
    // no icon). One more commit on the watched branch, then refresh: the
    // row gains the "new commits" tag next to its one icon.
    writeFileSync(path.join(repoDir, "src", "util.py"), "VALUE = 43\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "bump value");
    const refreshed = await apiJson(svc, "POST", `/api/reviews/${prReviewId}/refresh`);
    expect(refreshed.status).toBe(200);
    expect((refreshed.json as { newVersion?: boolean }).newVersion).toBe(true);
    await expect
      .poll(async () => {
        const s = await apiJson(svc!, "GET", "/api/reviews");
        return (s.json as { reviews: { id: string; stale?: boolean }[] }).reviews.find((r) => r.id === prReviewId)
          ?.stale;
      }, { timeout: 60_000 })
      .toBe(true);
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    const staleRow = page.locator(`[data-testid="session-${prReviewId}"]`);
    await expect(staleRow.locator('[data-testid="pr-badges"]')).toBeVisible();
    await expect(staleRow.getByRole("img", { name: "Changes requested" })).toBeVisible();
    await expect(staleRow.getByRole("img", { name: "Open" })).toHaveCount(0);
    await expect(staleRow).toContainText("new commits");

    // The row's title and meta keep their size and position with the
    // popover open; the popover covers neither. Boxes are compared
    // relative to the row so async callouts above the list can't flake
    // the assert; the overlap check uses the same-moment boxes.
    const rowTitle = staleRow.locator(".cx2");
    const rowMeta = staleRow.locator(".cj > .hint");
    const rowBoxBefore = await staleRow.boundingBox();
    const titleBefore = await rowTitle.boundingBox();
    const metaBefore = await rowMeta.boundingBox();
    expect(rowBoxBefore).not.toBeNull();
    expect(titleBefore).not.toBeNull();
    expect(metaBefore).not.toBeNull();
    await staleRow.getByRole("button", { name: "Remove this review" }).click();
    const pop = page.locator(".confirm-pop");
    await expect(pop).toContainText("Remove this review?");
    const confirmBtn = pop.getByRole("button", { name: "Remove", exact: true });
    const cancelBtn = pop.getByRole("button", { name: "Cancel" });
    await expect(confirmBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();
    await expect(confirmBtn).toHaveAttribute("data-size", "sm");
    await expect(cancelBtn).toHaveAttribute("data-size", "sm");
    const rowBoxAfter = await staleRow.boundingBox();
    const titleAfter = await rowTitle.boundingBox();
    const metaAfter = await rowMeta.boundingBox();
    const sizeOf = (b: { width: number; height: number }): { width: number; height: number } => ({ width: b.width, height: b.height });
    const offsetOf = (
      inner: { x: number; y: number },
      outer: { x: number; y: number },
    ): { dx: number; dy: number } => ({ dx: inner.x - outer.x, dy: inner.y - outer.y });
    expect(sizeOf(rowBoxAfter!)).toEqual(sizeOf(rowBoxBefore!));
    expect(sizeOf(titleAfter!)).toEqual(sizeOf(titleBefore!));
    expect(sizeOf(metaAfter!)).toEqual(sizeOf(metaBefore!));
    expect(offsetOf(titleAfter!, rowBoxAfter!)).toEqual(offsetOf(titleBefore!, rowBoxBefore!));
    expect(offsetOf(metaAfter!, rowBoxAfter!)).toEqual(offsetOf(metaBefore!, rowBoxBefore!));
    const popBox = await pop.boundingBox();
    const overlaps = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlaps(popBox!, titleBefore!)).toBe(false);
    expect(overlaps(popBox!, metaBefore!)).toBe(false);
    await checkLayout(page, "j225a-remove-confirm");

    // Escape cancels without touching the row…
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(staleRow).toBeVisible();
    // …and so does an outside click.
    await staleRow.getByRole("button", { name: "Remove this review" }).click();
    await expect(pop).toBeVisible();
    await page.getByRole("heading", { name: "Reviews" }).click();
    await expect(pop).toHaveCount(0);
    await expect(staleRow).toBeVisible();
    // Confirming removes the review; the branch review stays.
    await staleRow.getByRole("button", { name: "Remove this review" }).click();
    await expect(pop).toContainText("Remove this review?");
    await pop.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(staleRow).toHaveCount(0);
    await expect(page.locator('[data-testid^="session-"]')).toHaveCount(1);
    const after = await apiJson(svc, "GET", "/api/reviews");
    expect(
      (after.json as { reviews: { id: string }[] }).reviews.some((r) => r.id === prReviewId),
    ).toBe(false);
  });
});
