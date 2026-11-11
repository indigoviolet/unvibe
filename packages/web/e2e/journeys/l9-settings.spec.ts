/**
 * L9 — Settings and system (#363 package D).
 *
 * Settings in usage order: limits persist with inline invalid handling
 * and full access on/off with its front-page marker; tabs switch,
 * `?tab=` deep links land, legacy `#section` links redirect, and unsaved
 * edits survive tab switches; the Prompts tab lists every template and
 * the debug page expands them for the review; repos add/remove (bad URLs
 * rejected inline, removal forgets without touching, removal refused
 * while reviews exist) and data reset (Cancel first, then confirm);
 * the Doctor page over the real service (breadcrumb through Settings,
 * service/PATH/tool detail with copy, model display names); appearance
 * theme persistence; one card per settings screen with compact rows and
 * no stale commentary; start-page rows aligning with PR icons and a
 * Remove popover that keeps the worst-case row still (#225/#346);
 * per-channel release notes (#330); and the mock-only failed-switch
 * rollback (the real service 409s from source checkouts by design, so
 * the switching/rollback UI is reachable only through the mock updater).
 *
 * Boots: ONE agent:none + fake-updater settings service (all settings
 * CRUD, doctor, appearance, repos, reset — the reset test runs last);
 * ONE agent:none service with stubbed `gh` over a scratch + branch
 * review (j225a); ONE agent:none service with staged channels (j330).
 * The update-picker rollback and the reload-everything button run in
 * mock mode (no service).
 *
 * Absorbs: the settings halves of `j5-settings-versions` (limits,
 * full-access marker, tabs, prompts, repos, doctor, display names) and
 * of `j11-settings-combos` (full access, appearance, repos, data reset;
 * the Models halves already live in L8), `j225a-settings-badges`
 * (both), `j330-release-notes`, `doctor.spec.ts` (breadcrumb, detail,
 * copy, display names; the reload-everything button stays mock-covered
 * as it was), and `update-picker.spec.ts` (unchanged behaviour, now a
 * mock-mode describe in this file).
 *
 * Guards kept: #274 (selector title, quiet remove, request-group
 * counts); #225 (one card per screen, compact rows, edge alignment,
 * tooltips action-only, no stale commentary); #234 (no icon for open,
 * changes-requested only, no Review required, status-only tooltip, icon
 * inside the GitHub link, no PR title in the bar); #245 (icon inside
 * the link, one height/centre line); #235 (full-access marker on the
 * front page only); #346 (shared inline confirms + Confirmed flash for
 * access, repo remove, data reset); #346/#231 (update refusal 409 from
 * source checkouts — real rollback unit-covered); #249 (release row
 * shows version, previews keep short sha); #258 (removing a repo with
 * reviews refused inline; Cancel-first reset); #196 (theme persists
 * server-side, applied before first paint, light/dark separate);
 * #330 (per-channel notes, plain-text issue text); #36 (failed-switch
 * rollback UI copy — mock-only by design); #238 (Documents next to
 * Unvibe in the top bar); #249/#230 (summary API carries stored gh
 * state).
 *
 * Security / privacy guards kept: `GITHUB_TOKEN` stripped in the
 * harness (fake `gh` never sees real credentials); no page request
 * leaves the local origin (network-guard on every spec).
 *
 * No frames in this area (nothing to move to the tour).
 *
 * Brittleness fixed here (#363 §4): the `j11:62` 250 ms popup-settle
 * sleep (B2 — the same settle poll L8 uses: the option's box must stop
 * moving before the click); j225a's triple/pair reads stay single
 * synchronous evaluates (#363 B1).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { measureWithinRow } from "../geometry.js";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import {apiJson, createScratchReview, git, makeScratchRepo, realGitPath, writeFakeGitOffline, writeFakeShell, fakeServicePath} from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

// ---------------------------------------------------------------------------
// Settings service: limits, access, tabs, prompts, doctor, appearance,
// repos, reset.
// ---------------------------------------------------------------------------

test.describe("L9 settings CRUD", () => {
  let dataDir = "";
  let repoDir = "";
  let repo2Dir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l9-repo-"));
    repo2Dir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l9-repo2-"));
    await makeScratchRepo(repoDir);
    await makeScratchRepo(repo2Dir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l9-data-"));
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_UPDATER_BACKEND: "fake" }, label: "l9settings" });
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, repo2Dir, dataDir]) rmSync(d, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  test("limits persist with inline invalid; full access on/off with front-page marker", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });

    // Limits: invalid inline, then a save that persists.
    await page.getByRole("tab", { name: "Limits" }).click();
    const input = page.locator("#limit-sessionsPerProvider");
    await input.fill("99");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(
      page.getByText("Agent sessions at once, per provider: must be an integer in [1, 32]"),
    ).toBeVisible({ timeout: 15_000 });
    await input.fill("5");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Limits" }).click();
    await expect(page.locator("#limit-sessionsPerProvider")).toHaveValue("5");

    // Issue #376: the hunk summary limit row persists like the rest.
    const hunkInput = page.locator("#limit-hunkSummaryLimit");
    await hunkInput.fill("501");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(
      page.getByText("Hunk summaries written automatically: must be an integer in [0, 500]"),
    ).toBeVisible({ timeout: 15_000 });
    await hunkInput.fill("7");
    await page.getByRole("button", { name: "Save limits" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Limits" }).click();
    await expect(page.locator("#limit-hunkSummaryLimit")).toHaveValue("7");

    // Full access: acknowledge, marker shows on a review, turn off, marker goes.
    await page.getByRole("tab", { name: "Access" }).click();
    await expect(page.locator('[data-testid="access-state"]')).toContainText("Read-only", { timeout: 15_000 });
    await page.getByRole("button", { name: "Turn on full access" }).click();
    // #346: the shared inline confirm with one short line for what it
    // means (the full warning is the tooltip, not a paragraph).
    const warning = page.locator('[data-testid="access-warning"]');
    await expect(warning).toContainText("Confirm full access");
    await expect(warning).toContainText("can run shell commands, git and gh as you");
    await page.getByRole("button", { name: "Confirm full access" }).click();
    await expect(page.locator('[data-testid="access-state"]')).toContainText("Full access is on", { timeout: 15_000 });
    // #235: the marker shows on the front page only, not in the review bar.
    await page.goto(`${s.origin}/?token=${s.token}`);
    await expect(page.locator('[data-testid="full-access-marker"]')).toBeVisible({ timeout: 30_000 });
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="full-access-marker"]')).toHaveCount(0);
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await page.getByRole("tab", { name: "Access" }).click();
    await page.getByRole("button", { name: "Turn off full access" }).click();
    await expect(page.locator('[data-testid="access-state"]')).toContainText("Read-only", { timeout: 15_000 });
    await page.goto(`${s.origin}/?token=${s.token}`);
    await expect(page.locator('[data-testid="full-access-marker"]')).toHaveCount(0, { timeout: 30_000 });
  });

  test("tabs switch, ?tab= deep links land, #section links redirect, edits survive tab switches", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    const tabs = page.getByRole("tablist", { name: "Settings sections" });
    await expect(tabs).toBeVisible({ timeout: 30_000 });
    await expect(tabs.getByRole("tab", { name: "Repos" })).toHaveAttribute("aria-selected", "true");
    await tabs.getByRole("tab", { name: "Models" }).click();
    await expect(page.getByRole("tabpanel", { name: "Models" })).toBeVisible();
    // ?tab= deep link survives reload.
    await page.goto(`${s.origin}/settings?tab=limits&token=${s.token}`);
    await expect(page.getByRole("tab", { name: "Limits" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#limit-sessionsPerProvider")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("tab", { name: "Limits" })).toHaveAttribute("aria-selected", "true");
    // Legacy #section links land on the matching tab.
    await page.goto(`${s.origin}/settings?token=${s.token}#repositories`);
    await expect(page.getByRole("tab", { name: "Repos" })).toHaveAttribute("aria-selected", "true");
    await page.goto(`${s.origin}/settings?token=${s.token}#environment`);
    await expect(page.getByRole("tab", { name: "Environment" })).toHaveAttribute("aria-selected", "true");
    // Unsaved edits survive a tab switch.
    await page.getByRole("tab", { name: "Limits" }).click();
    await page.locator("#limit-sessionsPerProvider").fill("9");
    await page.getByRole("tab", { name: "Models" }).click();
    await expect(page.getByRole("tabpanel", { name: "Models" })).toBeVisible();
    await page.getByRole("tab", { name: "Limits" }).click();
    await expect(page.locator("#limit-sessionsPerProvider")).toHaveValue("9");
  });

  test("prompts list all templates; the debug page expands them", async ({ page }) => {
    test.setTimeout(180_000);
    const s = service();
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
    await page.getByRole("tab", { name: "Prompts" }).click();
    // The real template list, by name — not a bare count, so the next
    // add/remove fails on the name. Contract: PROMPT_TEMPLATE_NAMES in
    // packages/shared/src/prompts.ts. #349 removed the two
    // second-opinion templates and added persona_card (16 + 1 = 17);
    // concept_stub was removed with the stub job (#216).
    const expectedTemplates = [
      "instructions",
      "reader",
      "base_pack",
      "critic",
      "hunk_pass",
      "plotline_assign",
      "concept_page",
      "ask",
      "ask_turn",
      "depth",
      "examples",
      "diagram",
      "go_deeper",
      "update_pass",
      "consolidate",
      "persona_card",
    ];
    await expect(page.locator('[data-testid^="prompt-"]')).toHaveCount(expectedTemplates.length);
    for (const name of expectedTemplates) {
      await expect(page.locator(`[data-testid="prompt-${name}"]`)).toHaveCount(1);
    }
    await expect(page.locator('[data-testid="prompt-concept_stub"]')).toHaveCount(0);
    const reader = page.locator('[data-testid="prompt-reader"]');
    await reader.getByRole("button", { name: "Expand reader" }).click();
    // The reader's `{{source}}` variable is marked, wherever it sits:
    // `{{reviewed_context}}` frames the task first (#351 step 2), so
    // `{{source}}` is no longer the first mark.
    await expect(reader.locator("mark.tm", { hasText: "{{source}}" })).toHaveCount(1);
    // The debug page expands them for the review. Forked templates
    // (ask) serve L0–L3 from the warm base: cached.
    await page.goto(`${s.origin}/review/${reviewId}/debug?token=${s.token}`);
    await page.getByRole("tab", { name: "Prompts" }).click();
    const ask = page.locator('section[aria-label="Prompts"]').locator('[data-testid="prompt-ask"]');
    await ask.getByRole("button", { name: "Expand ask" }).click();
    await expect(ask.locator('details.lay[data-layer="L0"]')).toBeVisible();
    await expect(ask.locator('details.lay[data-layer="L1"]')).toContainText("cached");
    await expect(ask.locator('details.lay[data-layer="L4"]')).not.toContainText("cached");
  });

  test("doctor page: breadcrumb through Settings, service/PATH/tool detail with copy, display names", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await page.goto(`${s.origin}/doctor?token=${s.token}`);
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs).toBeVisible({ timeout: 20_000 });
    await expect(crumbs.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings?tab=environment",
    );
    await expect(crumbs.getByText("Doctor")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("doctor-report")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("doctor-service")).toContainText("pid");
    await expect(page.getByTestId("doctor-path")).toContainText("effective");
    await expect(page.getByTestId("doctor-tool-claude")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy diagnostics" })).toBeVisible();
    // #238: the Documents icon sits next to the Unvibe home link on the
    // left, before the breadcrumb, badge, update and Settings controls.
    const barOrder = await page.evaluate(() =>
      [...(document.querySelector("header.top")?.children ?? [])].map(
        (el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "",
      ),
    );
    expect(barOrder[0]).toBe("Unvibe");
    expect(barOrder[1]).toBe("Documents");
    expect(barOrder.indexOf("Documents")).toBeLessThan(barOrder.indexOf("Settings"));

    // Model pickers show display names on the real service (static
    // fallback carries names even with no agent). Models holds only the
    // small model since #379; the main model is on the Guide persona.
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("tab", { name: "Models" }).click();
    const small = page.locator('[data-testid="model-small"]');
    await small.locator("#model-small").click();
    await expect(openPopup(page).getByRole("option", { name: "Sonnet" })).toBeVisible();
  });

  test("appearance theme persists server-side and applies before first paint", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Appearance" }).click();
    const themeSelect = page.locator('[data-testid="ui-theme"]');
    await expect(themeSelect).toBeVisible({ timeout: 15_000 });
    await expect(themeSelect).toContainText("Default");
    await themeSelect.click();
    await expect(openPopup(page).getByRole("option", { name: "Default" })).toBeVisible();
    await expect(openPopup(page).getByRole("option", { name: "Studio" })).toBeVisible();
    await expect(openPopup(page).getByRole("option", { name: "Console" })).toBeVisible();
    const studioSaved = page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
      { timeout: 15_000 },
    );
    await openPopup(page).getByRole("option", { name: "Studio" }).click();
    await studioSaved;
    await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "studio");
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );
    expect(accent).not.toBe("");
    const before = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute("data-ui-theme"),
      mirror: localStorage.getItem("unvibe:ui-theme"),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    expect(before.mirror).toBe("studio");
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    const after = await page.evaluate(async () => {
      const token = new URLSearchParams(location.search).get("token") ?? "";
      const r = await fetch("/api/settings", { headers: { authorization: `Bearer ${token}` } });
      const settings = (await r.json()) as { uiTheme?: string };
      return {
        attr: document.documentElement.getAttribute("data-ui-theme"),
        bg: getComputedStyle(document.body).backgroundColor,
        serverTheme: settings.uiTheme,
      };
    });
    expect(after.attr).toBe("studio");
    expect(after.bg).toBe(before.bg);
    expect(after.serverTheme).toBe("studio");
    // Back to the default theme for the rest of the journey.
    await page.getByRole("tab", { name: "Appearance" }).click();
    await page.locator('[data-testid="ui-theme"]').click();
    const defaultSaved = page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() !== "GET" && r.ok(),
      { timeout: 15_000 },
    );
    await openPopup(page).getByRole("option", { name: "Default" }).click();
    await defaultSaved;
    await expect(page.locator("html")).toHaveAttribute("data-ui-theme", "default");
  });

  test("repos add/remove + invalid + has-reviews refusal; data reset last", async ({ page }) => {
    test.setTimeout(240_000);
    const s = service();
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Repos" }).click();
    const section = page.locator('[data-testid="repositories-section"]');
    // Empty path hints instead of doing nothing.
    await section.getByRole("button", { name: "Add by path" }).click();
    await expect(section.getByText("Enter a folder path first.")).toBeVisible();
    // Invalid URLs are rejected inline with no request.
    await section.getByLabel("Add a repo by URL").fill("not a repo!!!");
    await section.getByRole("button", { name: "Clone and add" }).click();
    await expect(section.getByText(/not a GitHub repo URL or owner\/name/)).toBeVisible();
    await expect(page.locator("#toast")).toBeHidden();
    await expect(section.getByRole("button", { name: "Clone and add" })).toBeEnabled();
    // Add the second checkout, remove it, folder intact.
    await section.getByLabel("Add a repo by path").fill(repo2Dir);
    await section.getByRole("button", { name: "Add by path" }).click();
    const row = section.locator('[data-testid^="repo-"]', { hasText: path.basename(repo2Dir) }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: `Remove local/${path.basename(repo2Dir)}` }).click();
    // #346: the shared inline confirm ("Confirm remove repo" ✓ ✕).
    await row.getByRole("button", { name: "Confirm remove repo" }).click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    expect(existsSync(path.join(repo2Dir, ".git"))).toBe(true);

    // Removing a repo with reviews is refused inline.
    const ownRow = section.locator('[data-testid^="repo-"]', { hasText: path.basename(repoDir) }).first();
    await expect(ownRow).toBeVisible();
    await ownRow.getByRole("button", { name: `Remove local/${path.basename(repoDir)}` }).click();
    await ownRow.getByRole("button", { name: "Confirm remove repo" }).click();
    await expect(ownRow.getByRole("alert")).toContainText(/still has 1 review/);
    await ownRow.getByRole("button", { name: "Cancel" }).click();
    await expect(ownRow.getByRole("alert")).toHaveCount(0);
    await expect(ownRow).toBeVisible();

    // Data reset (runs last on this service): Cancel first does nothing,
    // then confirm removes the review but keeps settings and repos.
    // #346: the shared inline confirm ("Confirm reset data" ✓ ✕).
    await page.getByRole("tab", { name: "Data" }).click();
    await page.getByRole("button", { name: "Reset data" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText(/Removed \d+ reviews?\./)).toHaveCount(0);
    await page.getByRole("button", { name: "Reset data" }).click();
    await page.getByRole("button", { name: "Confirm reset data" }).click();
    await expect(page.getByText(/Removed \d+ reviews?\./)).toBeVisible({ timeout: 30_000 });
    await page.goto(`${s.origin}/?token=${s.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /feature work|Unfold/ })).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
    const repos = await page.evaluate(async () => {
      const token = new URLSearchParams(location.search).get("token") ?? "";
      const r = await fetch("/api/repos", { headers: { authorization: `Bearer ${token}` } });
      return (await r.json()) as { repos: unknown[] };
    });
    expect(repos.repos.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// j225a: settings screens, start page rows, PR badges, Remove popover.
// ---------------------------------------------------------------------------

/**
 * Fake `gh`: PR view carries state + reviewDecision (#224, #230); pr list
 * stays unimplemented. The head SHA is resolved from the repo at call
 * time, so a commit added mid-test is picked up by the next refresh.
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

test.describe("L9 settings screens, start rows and PR badges", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let prReviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l9b-repo-"));
    const repo = await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l9b-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l9b-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l9b-bin-"));
    writeFakeGhDecision(fakeBin, logDir, repoDir, repo.headSha);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: fakeServicePath(fakeBin) },
      label: "l9badges",
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
    // One synchronous read: two boundingBox() calls can straddle a late
    // banner and differ by its height (#363 B1).
    const limitsGeo = await measureWithinRow(limitsCard, "#limit-sessionsPerProvider");
    expect(limitsGeo.inner["#limit-sessionsPerProvider"]!.width).toBeLessThan(
      (limitsGeo.row.width - 32) / 2,
    );
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
    // Since #379 Models holds only the small model.
    await expect(page.locator('[data-testid="model-small"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="model-main"]')).toHaveCount(0);
    await expect(page.locator('[data-testid$="-desc"]')).toHaveCount(0);
    const smallStatus = page.locator('[data-testid="model-small-status"]');
    await smallStatus.waitFor({ timeout: 15_000 }).catch(() => {});
    if ((await smallStatus.count()) > 0) {
      await expect(smallStatus.getByRole("link", { name: "Check Environment" })).toHaveAttribute(
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
    // no open-externally button, no preview/full-access badges.
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

    // The row's title and meta keep their size and position when the
    // button expands in place (#346, overlay placement): the pill
    // overlays within the row. Each triple is one synchronous read so a
    // late banner above the list can't slip between the rects (#363 B1).
    const before = await measureWithinRow(staleRow, [".cx2", ".cj > .hint"]);
    await staleRow.getByRole("button", { name: "Remove this review" }).click();
    const pill = staleRow.locator(".uic-pill");
    await expect(pill).toContainText("Confirm remove review");
    const confirmBtn = pill.getByRole("button", { name: "Confirm remove review" });
    const cancelBtn = pill.getByRole("button", { name: "Cancel" });
    await expect(confirmBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();
    const placed = await measureWithinRow(staleRow, [".cx2", ".cj > .hint", ".uic-pill"]);
    const sizeOf = (b: { width: number; height: number }): { width: number; height: number } => ({
      width: b.width,
      height: b.height,
    });
    const offsetOf = (inner: { x: number; y: number }, outer: { x: number; y: number }): { dx: number; dy: number } => ({
      dx: inner.x - outer.x,
      dy: inner.y - outer.y,
    });
    const rowBefore = before.row;
    const titleBefore = before.inner[".cx2"]!;
    const metaBefore = before.inner[".cj > .hint"]!;
    const rowAfter = placed.row;
    const titleAfter = placed.inner[".cx2"]!;
    const metaAfter = placed.inner[".cj > .hint"]!;
    expect(sizeOf(rowAfter)).toEqual(sizeOf(rowBefore));
    expect(sizeOf(titleAfter)).toEqual(sizeOf(titleBefore));
    expect(sizeOf(metaAfter)).toEqual(sizeOf(metaBefore));
    expect(offsetOf(titleAfter, rowAfter)).toEqual(offsetOf(titleBefore, rowBefore));
    expect(offsetOf(metaAfter, rowAfter)).toEqual(offsetOf(metaBefore, rowBefore));
    // The pill overlays within the row: fully inside the row's box.
    const pillBox = placed.inner[".uic-pill"]!;
    expect(pillBox.x).toBeGreaterThanOrEqual(rowAfter.x - 1);
    expect(pillBox.x + pillBox.width).toBeLessThanOrEqual(rowAfter.x + rowAfter.width + 1);
    expect(pillBox.y).toBeGreaterThanOrEqual(rowAfter.y - 1);
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(rowAfter.y + rowAfter.height + 1);
    await checkLayout(page, "j225a-remove-confirm");

    // Escape cancels without touching the row…
    await page.keyboard.press("Escape");
    await expect(pill).toHaveCount(0);
    await expect(staleRow).toBeVisible();
    // …and so does an outside click.
    await staleRow.getByRole("button", { name: "Remove this review" }).click();
    await expect(pill).toBeVisible();
    await page.getByRole("heading", { name: "Reviews" }).click();
    await expect(pill).toHaveCount(0);
    await expect(staleRow).toBeVisible();
    // Confirming flashes confirmed, then removes the review; the branch
    // review stays.
    await staleRow.getByRole("button", { name: "Remove this review" }).click();
    await expect(pill).toContainText("Confirm remove review");
    await pill.getByRole("button", { name: "Confirm remove review" }).click();
    await expect(staleRow.getByText("Confirmed")).toBeVisible();
    await expect(staleRow).toHaveCount(0);
    await expect(page.locator('[data-testid^="session-"]')).toHaveCount(1);
    const after = await apiJson(svc, "GET", "/api/reviews");
    expect(
      (after.json as { reviews: { id: string }[] }).reviews.some((r) => r.id === prReviewId),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Release notes (j330): per-channel notes only, plain-text issue text.
// ---------------------------------------------------------------------------

test.describe("L9 release notes", () => {
  const NEW_VERSION = "0.0.1-preview.feat-x.abc1234";
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l9n-data-"));
    // Stamp the data format: a seeded dir without it reads as pre-format
    // data and the service shows the reset notice instead.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    db.exec("PRAGMA user_version = 1");
    db.close();
    const notesFor = (channel: string, version: string, summary: string) => ({
      channel,
      version,
      previousVersion: "0.0.1",
      commit: "abc1234def5678",
      previousCommit: "b535a30ccccccc",
      dataFormat: 1,
      previousDataFormat: 1,
      dataResetNeeded: false,
      generatedAt: "2026-10-31T00:00:00.000Z",
      items: [
        {
          number: 330,
          title: "Release notes inside every build",
          summary,
          url: "https://github.com/indigoviolet/unvibe/issues/330",
          whatChanged: "Every build now ships its release notes.",
          whatToTry: "Open Settings, then Version, and read the notes.",
          caveats: "Full gates not yet run. <b>not bold</b>",
        },
      ],
    });
    mkdirSync(path.join(dataDir, "update"), { recursive: true });
    writeFileSync(
      path.join(dataDir, "update", "fake-channels.json"),
      JSON.stringify([
        { ref: "release", kind: "release", version: "0.0.1", commit: "b535a30ccccccc", sourceBranch: null, builtAt: "2026-10-28T00:00:00.000Z", dataFormat: 1 },
        { ref: "preview/feat-x", kind: "preview", version: NEW_VERSION, commit: "abc1234def5678", sourceBranch: "feat/x", builtAt: "2026-10-31T00:00:00.000Z", dataFormat: 1 },
      ]),
    );
    writeFileSync(path.join(dataDir, "update", "current-ref"), "preview/feat-x\n");
    writeFileSync(
      path.join(dataDir, "update", "outcome.json"),
      JSON.stringify({
        status: "ok",
        from: "release",
        to: "preview/feat-x",
        finishedAt: "2026-10-31T00:00:00.000Z",
        fromVersion: "0.0.1",
        toVersion: NEW_VERSION,
      }) + "\n",
    );
    writeFileSync(
      path.join(dataDir, "update", "fake-release-notes.json"),
      JSON.stringify({
        "preview/feat-x": notesFor("preview/feat-x", NEW_VERSION, "Release notes inside every build"),
        release: notesFor("release", "0.0.1", "Earlier release notes"),
      }),
    );
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_UPDATER_BACKEND: "fake" }, label: "l9notes" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("Version shows only per-channel notes (no current-build block)", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");

    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: "Version" }).click();
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });

    // No current-build notes block: notes live per channel only.
    await expect(page.getByTestId("current-release-notes")).toHaveCount(0);
    await expect(page.getByText("Current build notes")).toHaveCount(0);

    const toggle = page.getByTestId("version-picker-toggle");
    if (!(await toggle.isChecked())) await toggle.click();
    await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid="channel-notes-toggle"][data-ref="release"]').click();
    const channelNotes = page.locator('[data-testid="channel-release-notes"][data-ref="release"]');
    await expect(channelNotes).toBeVisible({ timeout: 15_000 });
    await expect(channelNotes).toContainText("Earlier release notes");
    await expect(channelNotes).toContainText("What to try:");
    await expect(channelNotes).toContainText("Full gates not yet run. <b>not bold</b>");
    // Plain text only: the literal tag never becomes an element.
    await expect(channelNotes.locator("b")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Mock-mode: failed-switch rollback (update-picker) + reload-everything.
// The real service refuses every switch from a source checkout with 409
// by design (L7 asserts the refusal), so the switching/rollback UI is
// reachable only through the mock updater; the rollback logic itself is
// covered by service unit tests.
// ---------------------------------------------------------------------------

test.describe("L9 mock-only update rollback (update-picker)", () => {
  test.beforeEach(async ({ page }) => {
    // Every test gets a fresh browser context, so localStorage starts empty.
    await page.goto("/settings");
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
    await page.getByRole("tab", { name: "Version" }).click();
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible();
  });

  test("failed switch rolls back with a reason and stays on release", async ({ page }) => {
    test.setTimeout(60_000);
    await page.getByTestId("version-picker-toggle").click();
    await expect(page.getByTestId("version-picker-toggle")).toBeChecked();
    await expect(page.locator('[data-testid="update-channel"]')).not.toHaveCount(0);
    await page.evaluate(() => {
      localStorage.setItem("unvibe.mock.update.fail", "health");
    });
    const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
    await feat.getByRole("button", { name: "Switch to preview/feat-x" }).click();
    await page.getByRole("button", { name: "Confirm switch" }).click();
    await expect(page.getByTestId("update-switching")).toBeVisible();
    await expect(page.getByTestId("update-outcome")).toContainText("Rolled back to release", { timeout: 30_000 });
    await expect(page.locator('[data-testid="update-channel"][data-ref="release"]').getByTestId("update-current")).toBeVisible();
    await expect(page.getByTestId("preview-badge")).toHaveCount(0);
  });

  test("reload everything reports in mock mode", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Environment" }).click();
    await page.getByRole("button", { name: "Reload environment" }).click();
    await expect(page.getByTestId("reload-result")).toBeVisible({ timeout: 10_000 });
  });
});
