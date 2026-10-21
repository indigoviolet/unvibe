/**
 * J225a (#225 part A, #224): settings screens share one card each with
 * compact rows, the start page rows align, and PR state/decision badges
 * show on PR reviews (nothing on branch reviews) — against the real
 * service. No screenshot baselines (owner direction).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Fake `gh`: PR view carries state + reviewDecision (#224); pr list stays unimplemented. */
function writeFakeGhDecision(binDir: string, logDir: string, headSha: string): void {
  const script = `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat <<EOF
{"title":"Journey PR","body":"First paragraph.","author":{"login":"author"},"state":"OPEN","isDraft":false,"reviewDecision":"APPROVED","baseRefName":"main","headRefName":"feature","headRefOid":"${headSha}"}
EOF
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
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
    writeFakeGhDecision(fakeBin, logDir, repo.headSha);
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    // A PR review (fake gh: OPEN + APPROVED) and a branch review (no badges).
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

    // Version: the enable toggle lives inside the card as a Field.
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

  test("start page rows align; PR badges on the PR review, none on branch reviews", async ({ page }) => {
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

    // Reviews list: the PR review carries Open + Approved badges…
    const prRow = page.locator(`[data-testid="session-${prReviewId}"]`);
    await expect(prRow).toBeVisible({ timeout: 30_000 });
    const badges = prRow.locator('[data-testid="pr-badges"]');
    await expect(badges).toContainText("Open");
    await expect(badges).toContainText("Approved");
    // …while branch reviews show none.
    const branchRows = page.locator('[data-testid^="session-"]');
    expect(await branchRows.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-testid^="session-"] [data-testid="pr-badges"]')).toHaveCount(1);

    // The review bar badges the PR review the same way.
    await page.goto(`${svc.origin}/review/${prReviewId}?token=${svc.token}`);
    await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
    const barBadges = page.locator('#reviewbar [data-testid="pr-badges"]');
    await expect(barBadges).toContainText("Open");
    await expect(barBadges).toContainText("Approved");
    // The summary API carries the same state (no new polling: stored gh data).
    const summary = await apiJson(svc, "GET", "/api/reviews");
    const found = (summary.json as { reviews: { id: string; prState?: string; reviewDecision?: string }[] }).reviews.find(
      (r) => r.id === prReviewId,
    );
    expect(found?.prState).toBe("open");
    expect(found?.reviewDecision).toBe("approved");
  });
});
