/**
 * L7 — Versions, explain-since-X and refresh (#413 package D, #421
 * toolbar entry, #427 timeline menu).
 *
 * The explain lifecycle in usage order: an existing review gains
 * commits and Explain writes the Changes panel (the old guide
 * byte-for-byte, no addenda); the timeline menu leads with Explain
 * from the guide's commit and lists every commit newest first with
 * guide/new/latest hints and the head disabled, and picking one runs
 * Explain at once (re-run replaces the panel; a later Pull notes newer
 * commits in the header); the history icon dots and counts new commits
 * since the guide was written (cleared by a Re-do); the no-review-yet
 * offer on a real PR (prior GitHub review → one guide run with the
 * commit baseline and the delta hunk set, offer gone once the guide
 * lands, gone commit fails loudly, the prior review as a menu row
 * writes the panel); refresh recounts the dot with reviewed clearing
 * only on the changed hunk; cards, comments and reviewed state
 * surviving a refresh with the changed hunk reopening (#194's terminal
 * explain-pass plus the Debug refresh steps and job times); a code
 * citation outside the diff re-anchored after refresh (#112); and the
 * Version settings tab (fake channels list, 409 switch refusal from a
 * source checkout, the update icon states, the previews toggle, the
 * failed-check panel, the data-format warn line). No version switcher,
 * no banner, no old-version views anywhere.
 *
Boots: five scratch-repo services (since replay, since-commit
 * replay, explain replay, refresh none, carry-over replay) plus
 * one agent:none + fake-updater settings service for the version tab.
 *
 * Absorbs: `j351-since-b` (both), `j351-since-commit` (all 4),
 * `j367-update-state`, `j12-refresh` (both), `j16-refresh-carryover`,
 * the version-picker/update-icon/warn-line parts of
 * `j5-settings-versions` (settings halves live in L9).
 *
 * Guards kept: #413 (Changes section, citation reveal with the whole
 * diff shown, re-run replacement, old guide untouched, no stale
 * markers anywhere); #421 (toolbar menu with the head disabled,
 * grouped Changes panel with a commit-range header, no in-guide
 * picker rows, no versions); #427 (timeline menu with the guide
 * entry and guide/new/latest hints, dot with counting tooltip,
 * no switcher, no banner, no old-version views);
 * #351 (commit baseline +
 * delta hunk set, prior-review offer); #368 (the header chip's shared
 * gap — asserted, not framed); #112 (citation re-anchor); #194
 * (terminal explain-pass, refresh steps); #249 (release row shows its
 * version, previews keep short sha); #246 (Installed badge, no
 * separate Installed line, no "Releases always listed" hint);
 * #233/#229 (compact version rows, toggle alignment); #330
 * (per-channel Notes buttons); the 409 switch refusal from source
 * checkouts (real rollback covered by service units); #256
 * (versions-refresh flow inside J12).
 *
 * Frames removed (tour owns them; re-added in
 * `e2e/tour/visual-tour-system.spec.ts`): j367's dot/menu shots. No
 * `shot()`/`screenshot` lines remain in the gate.
 *
 * Brittleness fixed here (#363 §4): none of these files used fixed
 * sleeps for state (the polling loops below are state polls, not
 * delays); j367's screenshots move to the tour.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { fileKeyForPath, type ReviewSnapshot } from "@unvibe/shared";
import {apiJson, createScratchReview, git, realGitPath, writeFakeGitOffline, writeFakeShell, fakeServicePath} from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** The shared two-hunk fixture (j351/j12/j16/j367): base + feature touching both hunks. */
const V1 = [
  "def alpha():", "    return 1", "", "", "CONST_A = 10", "", "",
  "# divider one", "# divider two", "# divider three", "", "",
  "def beta():", "    return 2", "", "", "CONST_B = 20", "",
].join("\n");
const V_FEATURE = V1.replace("    return 1", "    return 11").replace("    return 2", "    return 22");
const V_ALPHA2 = V1.replace("    return 1", "    return 111").replace("    return 2", "    return 22");

async function initTwoHunkRepo(): Promise<string> {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7-repo-"));
  await git(repoDir, "init", "-b", "main");
  await git(repoDir, "config", "user.email", "t@example.com");
  await git(repoDir, "config", "user.name", "T");
  writeFileSync(path.join(repoDir, "src-app.py"), V1);
  await git(repoDir, "add", ".");
  await git(repoDir, "commit", "-m", "base");
  await git(repoDir, "checkout", "-b", "feature");
  writeFileSync(path.join(repoDir, "src-app.py"), V_FEATURE);
  await git(repoDir, "add", ".");
  await git(repoDir, "commit", "-m", "feature work");
  return repoDir;
}

async function waitForGuideCards(svc: RunningService, reviewId: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const pages = (snap.json as { pages?: { cards: unknown[] }[] }).pages ?? [];
    if (pages.some((p) => p.cards.length > 0)) return;
    if (Date.now() > deadline) throw new Error("guide cards did not appear on the scratch review");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function waitForExplainPass(svc: RunningService, reviewId: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let explainJob: { id: string; kind: string; state: string } | undefined;
  for (;;) {
    const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
    const jobs = (res.json as { jobs: { id: string; kind: string; state: string }[] }).jobs ?? [];
    explainJob = jobs.find((j) => j.kind === "explain-pass");
    if (explainJob && (explainJob.state === "done" || explainJob.state === "error" || explainJob.state === "cancelled")) break;
    if (Date.now() > deadline) throw new Error(`explain-pass job never finished: ${JSON.stringify(explainJob)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(explainJob?.state).toBe("done");
}

const appKey = fileKeyForPath("src-app.py");
const appFile = `[id="F-${appKey}"]`;

// ---------------------------------------------------------------------------
// Since-B update over a scratch review.
// ---------------------------------------------------------------------------

test.describe("L7 explain-since (was j351 step 1)", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = await initTwoHunkRepo();
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7b-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "l7sinceb" });
    reviewId = await createScratchReview(svc, repoDir);
    await waitForGuideCards(svc, reviewId);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("Explain writes the Changes panel; citation opens the range diff; a menu re-run replaces it", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 30_000 });

    // Mark both hunks reviewed; the v2 commit touches alpha only.
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const snapJson = snap.json as {
      files: { path: string; hunks: { contentHash: string }[] }[];
      commits: { sha: string; subject: string }[];
      version: { headSha: string };
    };
    const app = snapJson.files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });
    await expect(page.locator(appFile).locator(".revc")).toContainText("2/2", { timeout: 30_000 });
    // The guide was written at the v1 head: the banner counts from it.
    // (The base commit is outside the merge-base..head range, so the
    // menu lists from the v1 head on.)
    const v1Head = snapJson.version.headSha;
    const v1Short = v1Head.slice(0, 8);

    // A new commit touching only the alpha hunk, plus a commit adding a file
    // that is then amended (two pickable commits past the guide's).
    writeFileSync(path.join(repoDir, "src-app.py"), V_ALPHA2);
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    writeFileSync(path.join(repoDir, "d.py"), "D = 1\n");
    await git(repoDir, "add", "d.py");
    await git(repoDir, "commit", "-m", "add d");
    writeFileSync(path.join(repoDir, "d.py"), "D = 1\nD2 = 2\n");
    await git(repoDir, "add", "d.py");
    await git(repoDir, "commit", "--amend", "--no-edit");
    await page.locator("#reviewbar").getByRole("button", { name: "Pull new commits from GitHub", exact: true }).click();
    // #427: no Source-pane banner — the history icon dots and counts the
    // new commits since the guide, and its menu explains from them.
    const menuBtn = page.locator('#reviewbar [data-testid="explain-menu-button"]');
    await expect(menuBtn).toHaveAttribute("aria-label", "2 new commits since the guide was written", { timeout: 60_000 });
    await expect(menuBtn.locator("[data-new-commits]")).toBeVisible();
    await expect(page.getByTestId("stale-banner")).toHaveCount(0);
    await menuBtn.click();
    const guideMenu = page.getByTestId("explain-menu");
    await expect(guideMenu.getByRole("menuitem", { name: "Explain changes since the guide" })).toBeVisible();
    await expect(guideMenu.locator(`[data-explain-commit="${v1Head}"]`)).toContainText("guide");
    // Unchanged hunks keep reviewed state through the refresh.
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2", { timeout: 30_000 });

    await guideMenu.getByRole("menuitem", { name: "Explain changes since the guide" }).click();
    await waitForExplainPass(svc, reviewId);

    // The Changes panel, expanded with its cards: one grouped inset box
    // whose header names the commit range. No in-guide picker rows.
    const afterPull = (await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as {
      commits: { sha: string; subject: string }[];
      version: { headSha: string };
    };
    expect(afterPull.commits).toHaveLength(3);
    const h2Short = afterPull.commits[1].sha.slice(0, 8);
    const head3 = afterPull.version.headSha;
    const h3Short = head3.slice(0, 8);
    const since = page.locator('[data-testid="since-section"]');
    await expect(since).toBeVisible({ timeout: 30_000 });
    await expect(since).toContainText(new RegExp(`Changes ${v1Short} → ${h3Short}`));
    await expect(page.getByTestId("explain-pick")).toHaveCount(0);
    await expect(page.getByTestId("explain-control")).toHaveCount(0);
    await expect(since.getByRole("button", { name: /Collapse changes/ })).toBeVisible();
    // Collapse it, then expand it again: the panel folds to its header,
    // the cards come and go.
    await since.getByRole("button", { name: /Collapse changes/ }).click();
    await expect(since.locator('[id^="C-since-"]')).toHaveCount(0);
    await since.getByRole("button", { name: /Expand changes/ }).click();
    await expect(since.locator('[id^="C-since-"]')).toHaveCount(1);
    // Issue #411: every Since card, expanded, shows body text — never a
    // title with only an Answers line and no body.
    const sinceCount = await since.locator('[id^="C-since-"]').count();
    expect(sinceCount).toBeGreaterThan(0);
    for (let i = 0; i < sinceCount; i++) {
      const body = since.locator('[id^="C-since-"]').nth(i).locator("p.prose").first();
      await expect(body).toBeVisible();
      expect((((await body.textContent()) ?? "").trim().length)).toBeGreaterThan(0);
    }
    await expect(since.locator('[id^="C-since-"]').first()).toContainText(/Alpha now returns 111/);

    // The old guide is untouched: no addendum anywhere.
    const central = page.locator("#page #C-problem");
    await expect(central).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#page [data-addendum]")).toHaveCount(0);

    // #413: a section citation reveals and highlights its hunk like any
    // other citation; the diff keeps every hunk, and there is no Since
    // filter chip.
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).locator(".dhunk")).toHaveCount(2);
    await since.locator('[id^="C-since-"]').first().locator(".lk").first().click();
    await expect(page.locator(appFile).getByText("return 111")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).locator(".dhunk")).toHaveCount(2);
    await expect(page.locator('[data-filterchip="since"]')).toHaveCount(0);
    expect(((await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as { diffFilter?: unknown }).diffFilter).toBeUndefined();

    // A re-run from the timeline menu (the middle commit) replaces the
    // panel whole: still one card, header naming the new range. The
    // menu button is a borderless bar icon carrying the dot; the menu
    // is the shared `.fmenu` portal.
    await expect(menuBtn).toBeVisible();
    await expect(menuBtn).toHaveClass(/\bib\b/);
    await expect(menuBtn).toHaveClass(/\bhist\b/);
    await menuBtn.click();
    const menu = page.getByTestId("explain-menu");
    await expect(menu).toHaveClass(/fmenu/);
    // The guide entry leads; every commit newest first with its hints;
    // the head row leads, disabled with a quiet "latest" hint.
    await expect(menu.getByRole("menuitem", { name: "Explain changes since the guide" })).toBeVisible();
    const rows = menu.locator("[data-explain-commit]");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText(h3Short);
    await expect(rows.first()).toContainText("latest");
    await expect(rows.nth(1)).toContainText("new");
    await expect(rows.last()).toContainText(v1Short);
    await expect(rows.last()).toContainText("guide");
    const headRow = menu.locator(`[data-explain-commit="${head3}"]`);
    await expect(headRow).toBeDisabled();
    await expect(headRow).toContainText("latest");
    // The head row is not clickable: a forced click picks nothing —
    // the menu stays open and the panel is untouched.
    await headRow.click({ force: true });
    await expect(menu).toBeVisible();
    await expect(since).toContainText(new RegExp(`Changes ${v1Short} → ${h3Short}`));
    await rows.nth(1).click();
    // Picking runs Explain at once: the bar button shows the busy
    // state while the run is in flight.
    await expect(menuBtn.locator(".dots")).toBeVisible();
    await waitForExplainPass(svc, reviewId);
    await expect(since).toContainText(new RegExp(`Changes ${h2Short} → ${h3Short}`), { timeout: 30_000 });
    await expect(since.locator('[id^="C-since-"]')).toHaveCount(1);
    // The guide entry stays in the menu after the run.
    await menuBtn.click();
    await expect(page.getByTestId("explain-menu").getByRole("menuitem", { name: "Explain changes since the guide" })).toBeVisible();
    await page.keyboard.press("Escape");

    // A Pull that adds commits past the section's head notes it in the
    // panel header and recounts the dot from the guide's commit.
    writeFileSync(path.join(repoDir, "src-app.py"), V_ALPHA2.replace("    return 111", "    return 1111"));
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha again");
    await page.locator("#reviewbar").getByRole("button", { name: "Pull new commits from GitHub", exact: true }).click();
    await expect(menuBtn).toHaveAttribute("aria-label", "3 new commits since the guide was written", { timeout: 60_000 });
    await expect(since.getByTestId("since-newer")).toContainText("1 newer commit since this was written", { timeout: 30_000 });
  });

  test("the toolbar menu lists every commit newest first with the head disabled; picking runs Explain at once", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const before = (await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as {
      commits: { sha: string; subject: string }[];
      version: { headSha: string };
    };
    expect(before.commits.length).toBeGreaterThanOrEqual(2);
    // The oldest commit is strictly before the head, so explaining
    // from it is non-empty.
    const older = before.commits[0];
    const short = older.sha.slice(0, 8);
    const headShort = before.commits[before.commits.length - 1].sha.slice(0, 8);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    const since = page.locator('[data-testid="since-section"]');
    await expect(since).toBeVisible({ timeout: 60_000 });

    // The menu button is a borderless bar icon with the dot and a
    // counting tooltip: the guide is at the oldest commit, so every
    // other commit is new.
    const menuBtn = page.locator('#reviewbar [data-testid="explain-menu-button"]');
    await expect(menuBtn).toBeVisible();
    await expect(menuBtn).toHaveClass(/\bib\b/);
    const newer = before.commits.length - 1;
    await expect(menuBtn).toHaveAttribute("aria-label", `${newer} new commits since the guide was written`);
    await expect(menuBtn.locator("[data-new-commits]")).toBeVisible();
    await menuBtn.click();
    const menu = page.getByTestId("explain-menu");
    await expect(menu).toHaveClass(/fmenu/);
    await expect(menu).toHaveAttribute("role", "menu");
    // The guide entry leads; one row per commit, newest first, as
    // `<sha8> <subject>` — no versions anywhere, and no prior-review
    // row on a review without one.
    await expect(menu.getByRole("menuitem", { name: "Explain changes since the guide" })).toBeVisible();
    const rows = menu.locator("[data-explain-commit]");
    await expect(rows).toHaveCount(before.commits.length);
    await expect(rows.first()).toContainText(headShort);
    await expect(rows.last()).toContainText(`${short} ${older.subject}`);
    await expect(rows.last()).toContainText("guide");
    await expect(menu).not.toContainText("Versions");
    await expect(menu.locator("[data-explain-prior]")).toHaveCount(0);
    // The head is shown disabled with a quiet "latest" hint (an empty
    // range the route would refuse).
    const headRow = menu.locator(`[data-explain-commit="${before.version.headSha}"]`);
    await expect(headRow).toContainText(headShort);
    await expect(headRow).toBeDisabled();
    await expect(headRow).toContainText("latest");
    // Picking a commit runs Explain at once (no arming step): the menu
    // closes and the panel is replaced with the new range.
    await rows.last().click();
    await expect(menu).toBeHidden();
    await waitForExplainPass(svc, reviewId);
    const headNow = ((await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as { version: { headSha: string } }).version.headSha;
    await expect(since).toContainText(new RegExp(`Changes ${short} → ${headNow.slice(0, 8)}`), { timeout: 30_000 });
    await expect(since.locator('[id^="C-since-"]')).toHaveCount(1);
    // No in-guide picker rows anywhere: the menu is the only entry.
    await expect(page.getByTestId("explain-control")).toHaveCount(0);
    await expect(page.getByTestId("explain-pick")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Since-commit offer on a real PR (stubbed gh, offline git).
// ---------------------------------------------------------------------------

test.describe("L7 since-commit offer (j351 step 2)", () => {
  test.describe.configure({ mode: "serial" });
  let repoDir = "", bareDir = "", binDir = "", logDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  let c1 = "";
  let c1short = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7c-repo-"));
    bareDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7c-remote-"));
    binDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7c-bin-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7c-log-"));
    await git(bareDir, "init", "--bare", "-b", "main");
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "src-app.py"), V1);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 11"));
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "rework alpha");
    c1 = await git(repoDir, "rev-parse", "HEAD");
    c1short = c1.slice(0, 8);
    writeFileSync(path.join(repoDir, "src-app.py"), V1.replace("    return 1", "    return 11").replace("    return 2", "    return 22").replace("CONST_B = 20", "CONST_B = 20\n\n\ndef gamma():\n    return 3"));
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "rework beta and add gamma");
    const c2 = await git(repoDir, "rev-parse", "HEAD");
    // Offline-safe origin: GitHub-shaped for owner parsing, rewritten to
    // the local bare repo so every fetch stays local (never real GitHub).
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/app.git");
    await git(repoDir, "config", `url.${bareDir}.insteadOf`, "https://github.com/acme/app.git");
    await git(repoDir, "push", "origin", "main", "feature");
    await git(repoDir, "fetch", "origin");

    const reviews = JSON.stringify([
      { id: 11, user: { login: "teammate" }, commit_id: c2, state: "APPROVED", submitted_at: "2026-11-03T10:00:00Z" },
      { id: 12, user: { login: "you" }, commit_id: c1, state: "CHANGES_REQUESTED", submitted_at: "2026-11-01T10:00:00Z" },
      { id: 13, user: { login: "you" }, commit_id: c1, state: "COMMENTED", submitted_at: "2026-11-02T10:00:00Z" },
      { id: 14, user: { login: "you" }, state: "COMMENTED", submitted_at: "2026-11-04T10:00:00Z" },
    ]);
    const prView = JSON.stringify({
      title: "Journey test PR", body: "", author: { login: "you" }, state: "OPEN", isDraft: false,
      baseRefName: "main", headRefName: "feature", headRefOid: c2,
    });
    writeFileSync(
      path.join(binDir, "gh"),
      `#!/bin/sh
LOG="${logDir}"
mkdir -p "$LOG"
printf '%s\\n' "$*" >> "$LOG/calls.log"
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo 'you'; exit 0; fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then echo '${prView}'; exit 0; fi
case "$*" in *pulls/77/comments*) echo '[]'; exit 0 ;; esac
case "$*" in *pulls/77/reviews*) echo '${reviews}'; exit 0 ;; esac
case "$*" in *issues/77/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`,
      { mode: 0o755 },
    );
    writeFakeGitOffline(binDir, realGitPath());
    const fakeShell = writeFakeShell(binDir);

    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7c-data-"));
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: { SHELL: fakeShell, PATH: fakeServicePath(binDir) },
      label: "l7sinceoffer",
    });
    const repos = (await apiJson(svc, "POST", "/api/repos", { path: repoDir })).json as {
      repos: { id: string; localPath: string }[];
    };
    const registered = repos.repos.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error("scratch repo not registered");
    const created = (await apiJson(svc, "POST", "/api/reviews", { repoId: registered.id, pr: 77 })).json as ReviewSnapshot;
    reviewId = created.review.id;

    // The offer: the user's own latest review (c1) wins over the
    // teammate's later review and the entry without a commit_id.
    const prior = await apiJson(svc, "GET", `/api/reviews/${reviewId}/prior-github-review`);
    expect(prior.status).toBe(200);
    expect(prior.json as unknown).toEqual({ review: { sha: c1, author: "you", submittedAt: "2026-11-02T10:00:00Z" } });

    // Accept at once (deterministic: the single guide run picks it up
    // whether the ingest is still running or done).
    const accepted = await apiJson(svc, "POST", `/api/reviews/${reviewId}/since-baseline`, { sha: c1 });
    expect(accepted.status).toBe(200);
    expect((accepted.json as { baseline: unknown }).baseline).toEqual({ kind: "commit", sha: c1 });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    for (const d of [repoDir, bareDir, binDir, logDir, dataDir]) {
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  async function snap(): Promise<ReviewSnapshot> {
    return (await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as ReviewSnapshot;
  }

  test("one guide run stores the commit baseline and the delta hunk set", async () => {
    test.setTimeout(180_000);
    const deadline = Date.now() + 120_000;
    for (;;) {
      const s = await snap();
      const root = s.pages.find((p) => p.id === "root");
      if (root && root.cards.length > 0) break;
      if (Date.now() > deadline) throw new Error("guide cards did not appear on the PR review");
      await new Promise((r) => setTimeout(r, 500));
    }
    const s = await snap();
    expect(s.sinceBaseline).toEqual({ kind: "commit", sha: c1 });
    const hunks = [...(s.sinceHunks?.added ?? []), ...(s.sinceHunks?.changed ?? [])];
    expect(hunks.length).toBeGreaterThan(0);
    // Exactly one guide run: a single reader job, no explain pass.
    const readers = (s.jobs ?? []).filter((j) => j.kind === "reader");
    expect(readers).toHaveLength(1);
    expect(readers[0].state).toBe("done");
    expect((s.jobs ?? []).some((j) => j.kind === "explain-pass")).toBe(false);
  });

  test("Explain from the last GitHub review writes the panel", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`${svc!.origin}/review/${reviewId}?token=${svc!.token}`);
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 60_000 });
    // No section yet and no new commits. The reviewer's last GitHub
    // review is at a commit already in the Commits list, so (owner, #421)
    // that commit's row is marked "your last review" and there is no
    // separate row for it: the same commit never shows twice.
    const menuBtn = page.locator('#reviewbar [data-testid="explain-menu-button"]');
    await expect(menuBtn).toBeVisible({ timeout: 30_000 });
    await menuBtn.click();
    const menu = page.getByTestId("explain-menu");
    const markedRow = menu.locator(`[data-explain-commit="${c1}"]`);
    await expect(markedRow).toBeVisible({ timeout: 30_000 });
    await expect(markedRow).toContainText("your last review");
    await expect(menu.locator("[data-explain-prior]")).toHaveCount(0);
    await expect(menu.getByText(c1short)).toHaveCount(1);
    await markedRow.click();
    await waitForExplainPass(svc!, reviewId);
    // The panel names the last-review commit as the range start.
    const head = ((await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as { version: { headSha: string } }).version.headSha;
    const since = page.locator('[data-testid="since-section"]');
    await expect(since).toContainText(new RegExp(`Changes ${c1short} → ${head.slice(0, 8)}`), { timeout: 30_000 });
    await expect(since.locator('[id^="C-since-"]')).toHaveCount(1);
    // No in-guide picker rows anywhere.
    await expect(page.getByTestId("explain-control")).toHaveCount(0);
    await expect(page.getByTestId("explain-pick")).toHaveCount(0);
    // #413: no Since filter chip in the diff toolbar.
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-filterchip="since"]')).toHaveCount(0);
  });

  test("the offer is gone once the guide lands", async ({ page }) => {
    await page.goto(`${svc!.origin}/review/${reviewId}?token=${svc!.token}`);
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("prior-review-offer")).toHaveCount(0);
  });

  test("a gone commit fails loudly through the API", async () => {
    const gone = "f".repeat(40);
    const res = await apiJson(svc!, "POST", `/api/reviews/${reviewId}/since-baseline`, { sha: gone });
    expect(res.status).toBe(502);
    expect((res.json as { error: string }).error).toContain(gone.slice(0, 8));
    // The stored baseline is untouched by the failed pick.
    expect((await snap()).sinceBaseline).toEqual({ kind: "commit", sha: c1 });
  });
});

// ---------------------------------------------------------------------------
// One update-state model (j367).
// ---------------------------------------------------------------------------

test.describe("L7 new-commits dot; no stale anywhere", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = await initTwoHunkRepo();
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7u-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "l7update" });
    reviewId = await createScratchReview(svc, repoDir);
    await waitForGuideCards(svc, reviewId);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("the dot offers Explain from the guide; after Explain the old guide is untouched and nothing is stale", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 30_000 });

    // Mark both hunks reviewed; the v2 commit touches alpha only.
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const files = (snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files;
    const app = files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });

    writeFileSync(path.join(repoDir, "src-app.py"), V_ALPHA2);
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    await page.locator("#reviewbar").getByRole("button", { name: "Pull new commits from GitHub", exact: true }).click();

    // New-commits state: the history icon dots with "N new commits
    // since the guide was written", and the menu's first item explains
    // from the guide's commit. No banner anywhere.
    const menuBtn = page.locator('#reviewbar [data-testid="explain-menu-button"]');
    await expect(menuBtn).toHaveAttribute("aria-label", "1 new commit since the guide was written", { timeout: 60_000 });
    await expect(menuBtn.locator("[data-new-commits]")).toBeVisible();
    await expect(page.getByTestId("stale-banner")).toHaveCount(0);

    // #368: the header chip sits off the diff stat with the shared gap.
    await expect(page.locator(appFile).getByText("changed since reviewed")).toHaveCount(1);
    await expect(page.locator(appFile).locator(".prtag").first()).toHaveCSS("margin-left", "6px");

    // Explain from the guide: the section lands, the guide entry stays,
    // nothing stale.
    await menuBtn.click();
    await page.getByTestId("explain-menu").getByRole("menuitem", { name: "Explain changes since the guide" }).click();
    await waitForExplainPass(svc, reviewId);
    await expect(page.locator('[data-testid="since-section"]')).toContainText(/Changes [0-9a-f]{8} → [0-9a-f]{8}/, { timeout: 60_000 });
    await menuBtn.click();
    await expect(page.getByTestId("explain-menu").getByRole("menuitem", { name: "Explain changes since the guide" })).toBeVisible();
    await page.keyboard.press("Escape");

    // No stale markers anywhere: no card badges, no Update buttons.
    await expect(page.locator("#page .stale")).toHaveCount(0);
    await expect(page.locator("#page").getByRole("button", { name: "Update", exact: true })).toHaveCount(0);

    // The old guide is untouched by the run: no addenda appended.
    await expect(page.locator("#page [data-addendum]")).toHaveCount(0);

    // The service agrees: explaining again is a fresh 202, never a 409.
    const again = await apiJson(svc, "POST", `/api/reviews/${reviewId}/explain`);
    expect(again.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// Refresh (j12): dot recount, reviewed clears on the changed hunk only;
// #112 re-anchor.
// ---------------------------------------------------------------------------

test.describe("L7 refresh with new commits", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7r-repo-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "src-app.py"), V1);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(path.join(repoDir, "src-app.py"), V_FEATURE);
    writeFileSync(path.join(repoDir, "c.py"), "C = 1\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7r-data-"));
    svc = await startService(dataDir, { agent: "none", label: "l7refresh" });
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("refresh recounts the dot, reviewed clears only on the changed hunk", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });

    // Mark both hunks reviewed through the API (arrives over WS).
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const files = (snap.json as { files: { path: string; hunks: { contentHash: string; lines: { text: string }[] }[] }[] }).files;
    const app = files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) {
      await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });
    }
    await expect(page.locator(appFile).locator(".revc")).toContainText("2/2", { timeout: 30_000 });

    // A new commit touching only the alpha hunk, plus a commit adding a file
    // that is then amended.
    writeFileSync(path.join(repoDir, "src-app.py"), V_ALPHA2);
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    writeFileSync(path.join(repoDir, "d.py"), "D = 1\n");
    await git(repoDir, "add", "d.py");
    await git(repoDir, "commit", "-m", "add d");
    writeFileSync(path.join(repoDir, "d.py"), "D = 1\nD2 = 2\n");
    await git(repoDir, "add", "d.py");
    await git(repoDir, "commit", "--amend", "--no-edit");

    await page.locator("#reviewbar").getByRole("button", { name: "Pull new commits from GitHub", exact: true }).click();
    // #427: no banner, no switcher — the history icon dots and counts
    // the new commits, and its menu explains from the guide's commit.
    const menuBtn = page.locator('#reviewbar [data-testid="explain-menu-button"]');
    await expect(menuBtn).toHaveAttribute("aria-label", "2 new commits since the guide was written", { timeout: 60_000 });
    await expect(menuBtn.locator("[data-new-commits]")).toBeVisible();
    await expect(page.locator("#version-pick")).toHaveCount(0);
    await expect(page.getByTestId("stale-banner")).toHaveCount(0);
    await menuBtn.click();
    const rmenu = page.getByTestId("explain-menu");
    await expect(rmenu.getByRole("menuitem", { name: "Explain changes since the guide" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Reviewed cleared only on the changed hunk: alpha carries the stale
    // marker with the new code, beta keeps its reviewed state.
    await expect(page.locator(appFile).getByText("changed since reviewed")).toHaveCount(1);
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2", { timeout: 30_000 });
    await expect(page.locator(appFile).getByText("return 111")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).getByText(/return 11\b/)).toHaveCount(0);

    // Old-version viewing is gone: the pre-refresh code is not reachable
    // through any version UI, and diff line clicks open the composer.
    await page.locator(`${appFile} td.n.new`).first().click();
    await expect(page.locator(`${appFile} .ithread[data-pending-thread]`)).toBeVisible({ timeout: 15_000 });

    // Explain reports plainly without an agent runner (the explain-pass
    // job fails with the none-runner message) instead of hanging.
    await menuBtn.click();
    await page.getByTestId("explain-menu").getByRole("menuitem", { name: "Explain changes since the guide" }).click();
    await expect(page.locator("#toast")).toContainText("no agent configured", { timeout: 30_000 });
  });

  test("#112 a code citation outside the diff is re-anchored after refresh", async ({ page }) => {
    test.setTimeout(240_000);
    // helper.py lands on main and feature rebases onto it: at both heads
    // it is outside the PR diff (the PR only touches src-app.py).
    await git(repoDir, "checkout", "main");
    writeFileSync(path.join(repoDir, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
    await git(repoDir, "add", "helper.py");
    await git(repoDir, "commit", "-m", "add helper");
    await git(repoDir, "checkout", "feature");
    await git(repoDir, "rebase", "main");
    const seeded = await apiJson(svc!, "POST", `/api/reviews/${reviewId}/refresh`);
    expect(seeded.status).toBe(200);
    const before = await apiJson(svc!, "GET", `/api/reviews/${reviewId}`);
    const beforeSnap = before.json as unknown as {
      version: { headSha: string; n: number };
      files: { path: string }[];
    };
    expect(beforeSnap.files.some((f) => f.path === "helper.py")).toBe(false);
    const oldHead = beforeSnap.version.headSha;

    // Seed a guide card citing beta (line 2) outside the diff, through
    // the snapshot DB while the service is stopped.
    await svc!.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const { stampDataFormat } = await import("./journey-helpers.js");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const snap = JSON.parse(row.snapshot) as {
        pages: { id: string; kind: string; title: string; cards: unknown[] }[];
      };
      let root = snap.pages.find((p) => p.id === "root");
      if (!root) {
        root = { id: "root", kind: "root", title: "Guide", cards: [] };
        snap.pages.unshift(root);
      }
      root.cards.push({
        id: "c-helper",
        pageId: "root",
        title: "Helper card",
        read: false,
        collapsed: false,
        revision: 1,
        blocks: [
          {
            type: "paragraph",
            id: "b-helper",
            text: "Uses the helper beta value.",
            citations: [{ target: `code:helper.py:2@${oldHead}` }],
          },
        ],
        undoStack: [],
      });
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(snap),
        reviewId,
      );
      stampDataFormat(db);
    } finally {
      db.close();
    }
    svc = await startService(dataDir, { agent: "none", label: "l7refresh2" });

    // Upstream moves beta down two lines; feature rebases again.
    await git(repoDir, "checkout", "main");
    writeFileSync(path.join(repoDir, "helper.py"), "top1 = 0\ntop2 = 0\nalpha = 1\nbeta = 2\ngamma = 3\n");
    await git(repoDir, "add", "helper.py");
    await git(repoDir, "commit", "-m", "shift helper");
    await git(repoDir, "checkout", "feature");
    await git(repoDir, "rebase", "main");

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.getByText("Uses the helper beta value.")).toBeVisible({ timeout: 60_000 });
    await page.locator("#reviewbar").getByRole("button", { name: "Pull new commits from GitHub", exact: true }).click();

    // The citation now points at beta's new line under the new head.
    const deadline = Date.now() + 60_000;
    let target = "";
    let unverified: boolean | undefined;
    let newHead = "";
    for (;;) {
      const after = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const snap = after.json as unknown as {
        version: { headSha: string };
        pages: { cards: { id: string; stale?: boolean; blocks: { citations?: { target: string; unverified?: boolean }[] }[] }[] }[];
      };
      newHead = snap.version.headSha;
      const card = snap.pages.flatMap((p) => p.cards).find((c) => c.id === "c-helper");
      const cit = card?.blocks.flatMap((b) => b.citations ?? [])[0];
      target = cit?.target ?? "";
      unverified = cit?.unverified;
      if (target === `code:helper.py:4@${newHead}` && newHead !== oldHead) break;
      if (Date.now() > deadline) throw new Error(`citation not re-anchored: ${target} (head ${newHead})`);
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(unverified).not.toBe(true);
    // And in the UI the marker is a normal (verified) citation chip.
    await expect(page.getByText("Uses the helper beta value.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#C-c-helper .lk[data-refs]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#C-c-helper .lk.unverified")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Section citation into a folded doc/config hunk (#413): h: targets
// resolve to their head range, so the reveal unfolds the hidden group
// with no toast, and the whole diff stays shown.
// ---------------------------------------------------------------------------

test.describe("L7 section citation into a folded doc hunk", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  const RST_V1 = ["Title", "=====", "", "Alpha line one.", "Alpha line two.", "Alpha line three.", "Beta line one.", ""].join("\n") + "\n";
  const RST_V2 = RST_V1.replace("Alpha line two.", "Alpha line TWO reworked.").replace("Alpha line three.", "Alpha line THREE reworked.");

  test.beforeAll(async () => {
    repoDir = await initTwoHunkRepo();
    writeFileSync(path.join(repoDir, "docs.rst"), RST_V1);
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "add docs");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7doc-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "l7secdoc" });
    reviewId = await createScratchReview(svc, repoDir);
    await waitForGuideCards(svc, reviewId);
    // v2 touches the docs only.
    writeFileSync(path.join(repoDir, "docs.rst"), RST_V2);
    await git(repoDir, "add", "docs.rst");
    await git(repoDir, "commit", "-m", "rework docs");
    const refreshed = await apiJson(svc, "POST", `/api/reviews/${reviewId}/refresh`);
    expect(refreshed.status).toBe(200);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a section citation into a folded doc hunk unfolds and reveals it with no toast", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // The doc hunk's head id, then a stop-seed-restart (the #112
    // pattern): the Since section cites the doc hunk and the hunk
    // carries the docs/config hidden reason, so it renders grouped.
    const before = (await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as ReviewSnapshot;
    const docFile = before.files.find((f) => f.path === "docs.rst");
    if (!docFile) throw new Error("no docs.rst in the snapshot");
    const docHunk = docFile.hunks[0];
    if (!docHunk) throw new Error("no doc hunk in the snapshot");
    const docId = `h:${docFile.fileKey}:${docHunk.contentHash}`;
    await svc.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const { stampDataFormat } = await import("./journey-helpers.js");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const snap = JSON.parse(row.snapshot) as ReviewSnapshot & { pages: { id: string; cards: unknown[] }[] };
      for (const f of snap.files) {
        if (f.path !== "docs.rst") continue;
        for (const h of f.hunks) h.hiddenReason = "docs / config";
      }
      snap.sinceBaseline = { kind: "version", version: 1 };
      snap.sinceHunks = { added: [docId], changed: [] };
      const now = Date.now();
      snap.sinceSection = {
        baseline: { kind: "version", version: 1 },
        headVersion: snap.review.currentVersion,
        // Issue #421: the section was written at the current head.
        headSha: snap.version.headSha,
        at: now,
        cards: [
          {
            id: "since-doc-1",
            pageId: "since",
            title: "Docs reworked",
            collapsed: false,
            revision: 1,
            undoStack: [],
            blocks: [
              {
                type: "paragraph",
                id: "b-since-doc-1",
                text: "The docs now say TWO and THREE.",
                citations: [{ target: docId }],
              },
            ],
            answers: [],
          },
        ],
      };
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(snap),
        reviewId,
      );
      stampDataFormat(db);
    } finally {
      db.close();
    }
    svc = await startService(dataDir, { agent: "replay", label: "l7secdoc2" });

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    const since = page.locator('[data-testid="since-section"]');
    const v1 = (before.review.versions.find((v) => v.n === 1) ?? before.version).headSha.slice(0, 8);
    const v2 = before.version.headSha.slice(0, 8);
    await expect(since).toContainText(new RegExp(`Changes ${v1} → ${v2}`), { timeout: 30_000 });

    // The doc hunk starts folded in its hidden group: new text absent.
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });
    const docSection = page.locator(`[id="F-${fileKeyForPath("docs.rst")}"]`);
    await expect(docSection.locator(".dhid").first()).toBeVisible({ timeout: 30_000 });
    await expect(docSection.getByText("Alpha line TWO reworked.")).toHaveCount(0);

    // Clicking the section citation reveals the hunk: unfolded,
    // highlighted, no toast; no filter turns on.
    await since.locator("#C-since-doc-1 .lk").first().click();
    await expect(docSection.getByText("Alpha line TWO reworked.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-filterchip="since"]')).toHaveCount(0);
    await expect(page.locator("#toast")).toBeHidden({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Refresh carry-over (j16): cards, comments and reviewed state survive;
// the changed hunk reopens; the update pass terminates; Debug shows the
// refresh steps and job times.
// ---------------------------------------------------------------------------

test.describe("L7 refresh carry-over", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = await initTwoHunkRepo();
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7co-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "l7carry" });
    reviewId = await createScratchReview(svc, repoDir);
    await waitForGuideCards(svc, reviewId);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("one-version, one-commit review: no Explain row; head X is a 409", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // A fresh review on the same repo: a single version, no section,
    // no new commits.
    const id2 = await createScratchReview(svc, repoDir);
    await waitForGuideCards(svc, id2);
    await page.goto(`${svc.origin}/review/${id2}?token=${svc.token}`);
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 60_000 });
    // #413: nothing earlier than the head (one version, its only commit
    // is the head, no prior review): the guide shows no Explain row at
    // all, never a picker whose only choice is the head.
    const snap = await apiJson(svc, "GET", `/api/reviews/${id2}`);
    expect((snap.json as { commits: unknown[] }).commits.length).toBe(1);
    await expect(page.getByTestId("explain-control")).toHaveCount(0);
    await expect(page.getByTestId("explain-pick")).toHaveCount(0);
    // The route refuses the head in every spelling, before any spend.
    const headSha = (snap.json as { version: { headSha: string } }).version.headSha;
    for (const payload of [{}, { version: 1 }, { sha: headSha }]) {
      const res = await apiJson(svc, "POST", `/api/reviews/${id2}/explain`, payload);
      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toMatch(/Nothing to explain/);
    }
  });

  test("cards, a comment and reviewed state survive a refresh; the changed hunk reopens", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 30_000 });
    const guideText = await page.locator("#page .doc h1.title").innerText();

    // Mark both hunks reviewed; comment on the beta line (unchanged later).
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const files = (snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files;
    const app = files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });
    await expect(page.locator(appFile).locator(".revc")).toContainText("2/2", { timeout: 30_000 });

    // Comment on a diff line of the file.
    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    const slot = page.locator(`${appFile} .ithread[data-pending-thread]`);
    await expect(slot).toBeVisible({ timeout: 15_000 });
    await slot.locator("textarea").fill("Carry this comment over the refresh.");
    await slot.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(`${appFile} .ithread[data-thread]`, { hasText: "Carry this comment" })).toBeVisible({ timeout: 15_000 });

    // New commit touching only alpha.
    writeFileSync(path.join(repoDir, "src-app.py"), V_ALPHA2);
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    await page.locator("#reviewbar").getByRole("button", { name: "Pull new commits from GitHub", exact: true }).click();
    await expect(page.locator('#reviewbar [data-testid="explain-menu-button"]')).toHaveAttribute("aria-label", "1 new commit since the guide was written", { timeout: 60_000 });

    // Carried over: guide cards, the comment, and the unchanged reviewed state.
    await expect(page.locator("#page .doc h1.title")).toHaveText(guideText, { timeout: 30_000 });
    await expect(page.getByText("Carry this comment over the refresh.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2", { timeout: 30_000 });
    await expect(page.locator(appFile).getByText("return 111")).toBeVisible({ timeout: 30_000 });

    // #194: the explain pass finishes terminally either way under replay.
    const carryMenuBtn = page.locator('#reviewbar [data-testid="explain-menu-button"]');
    await carryMenuBtn.click();
    await page.getByTestId("explain-menu").getByRole("menuitem", { name: "Explain changes since the guide" }).click();
    const jobDeadline = Date.now() + 90_000;
    let explainJob: { id: string; kind: string; state: string; finishedAt?: number } | undefined;
    for (;;) {
      const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
      const jobs = (res.json as { jobs: { id: string; kind: string; state: string; finishedAt?: number }[] }).jobs ?? [];
      explainJob = jobs.find((j) => j.kind === "explain-pass");
      if (explainJob && (explainJob.state === "done" || explainJob.state === "error" || explainJob.state === "cancelled")) break;
      if (Date.now() > jobDeadline) throw new Error(`explain-pass job never finished: ${JSON.stringify(explainJob)}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(typeof explainJob?.finishedAt).toBe("number");

    // #194: Debug page shows job timings and the refresh's timed steps.
    await page.goto(`${svc.origin}/review/${reviewId}/debug?token=${svc.token}`);
    const steps = page.locator('[data-testid="refresh-steps"]');
    await expect(steps).toBeVisible({ timeout: 30_000 });
    for (const label of ["Fetch", "Building the new version", "Remapping anchors", "Remapping citations", "Remapping pins"]) {
      await expect(steps).toContainText(label);
    }
    await expect(steps).toContainText("started");
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Queued", { timeout: 30_000 });
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Duration");
    const updateRow = page.locator(`[data-testid="job-${explainJob!.id}"]`);
    await expect(updateRow).toContainText("Finished", { timeout: 30_000 });
    await expect(updateRow).toContainText("explain-pass");
  });
});

// ---------------------------------------------------------------------------
// Version settings tab (j5 version-picker/update halves): fake channels,
// the 409 switch refusal, update-icon states, the previews toggle, the
// failed-check panel, the data-format warn line.
// ---------------------------------------------------------------------------

test.describe("L7 version settings and update system", () => {
  const NOW = Date.now();
  const iso = (ms: number): string => new Date(ms).toISOString();
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7v-data-"));
    svc = await startService(dataDir, { agent: "none", extraEnv: { UNVIBE_UPDATER_BACKEND: "fake" }, label: "l7version" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function stageChannels(s: RunningService, specs: unknown[], currentRef?: string): Promise<void> {
    mkdirSync(path.join(dataDir, "update"), { recursive: true });
    writeFileSync(path.join(dataDir, "update", "fake-channels.json"), JSON.stringify(specs));
    if (currentRef !== undefined) {
      writeFileSync(path.join(dataDir, "update", "current-ref"), `${currentRef}\n`);
    }
    // Bust the service's 30 s channel cache so the top bar reads the staged list.
    const refreshed = await apiJson(s, "GET", "/api/update/channels?refresh=1");
    expect(refreshed.status).toBe(200);
  }

  async function stageInstalled(over: unknown | null): Promise<void> {
    const file = path.join(dataDir, "update", "fake-installed.json");
    if (over === null) rmSync(file, { force: true });
    else {
      mkdirSync(path.join(dataDir, "update"), { recursive: true });
      writeFileSync(file, JSON.stringify(over));
    }
  }

  /**
   * Navigate only after the top-bar check's own requests (status +
   * channels) complete, so "no icon" asserts without a timeout wait.
   */
  async function gotoAfterUpdateCheck(pg: Page, url: string): Promise<void> {
    const status = pg.waitForResponse(
      (r) => r.url().includes("/api/update/status") && r.request().method() === "GET",
    );
    const channels = pg.waitForResponse(
      (r) => r.url().includes("/api/update/channels") && r.request().method() === "GET",
    );
    await pg.goto(url);
    await status;
    await channels;
  }

  test("version picker lists fake channels; switching from a source checkout 409s", async ({ page }) => {
    test.setTimeout(180_000);
    const s = service();
    await page.goto(`${s.origin}/settings?token=${s.token}`);
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible({ timeout: 30_000 });

    // Version picker (fake backend): enable, list, current marked.
    await page.getByRole("tab", { name: "Version" }).click();
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    const toggle = page.getByTestId("version-picker-toggle");
    if ((await toggle.count()) > 0 && !(await toggle.isChecked())) {
      await toggle.click();
      await expect(toggle).toBeChecked({ timeout: 15_000 });
    }
    await expect(page.locator('[data-testid="update-channel"]').first()).toBeVisible({ timeout: 30_000 });
    // #246: no separate Installed line — the installed channel is marked
    // by its Installed badge in the list.
    await expect(page.getByTestId("update-current-version")).toHaveCount(0);
    await expect(page.getByTestId("update-current").first()).toBeVisible({ timeout: 15_000 });
    // #246: the "Releases always listed." help text is gone.
    await expect(page.locator(".ver-toggle-hint")).toHaveCount(0);

    const rows = page.locator('[data-testid="update-channel"]');
    expect(await rows.count()).toBeGreaterThan(0);
    // #249: the release row shows its version, never the sha; preview
    // rows keep their short sha.
    await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).toContainText("v0.0.1");
    await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toContainText("abc1234");
    expect(await rows.locator(".ui-row-meta").count()).toBe(0);
    for (const text of await rows.evaluateAll((els) => els.map((el) => el.textContent ?? ""))) {
      expect(text).toMatch(/·.*·/);
    }
    const heights = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1.5);

    // Compact single-line channel rows sharing the card's side padding;
    // one synchronous read per pair so a late banner can't slip between
    // the rects (#363 B1). #233 bottom-alignment: the Channels label's
    // bottom and the Refresh button's bottom sit the same distance above
    // the divider (the first row's top border).
    const headRow = await page.evaluate(() => {
      const box = (el: Element | null) => {
        if (!el) throw new Error("version row pieces missing");
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      const head = document.querySelector(".ver-listhead");
      const first = document.querySelector('[data-testid="update-channel"]');
      const refresh = document.querySelector('[data-testid="update-refresh"]');
      const label = document.querySelector(".ver-listhead .hint");
      return { head: box(head), first: box(first), refresh: box(refresh), label: box(label) };
    });
    expect(Math.abs(headRow.head.x - headRow.first.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(headRow.head.x + headRow.head.width - (headRow.first.x + headRow.first.width))).toBeLessThanOrEqual(2);
    const labelAbove = headRow.first.y - (headRow.label.y + headRow.label.height);
    const buttonAbove = headRow.first.y - (headRow.refresh.y + headRow.refresh.height);
    expect(Math.abs(labelAbove - buttonAbove)).toBeLessThanOrEqual(2);
    // #330: every row ends in a Notes button after its Switch/Update
    // action, so the row's right edge is the Notes button.
    const refreshBox = await page.getByTestId("update-refresh").boundingBox();
    const actionBox = await rows.first().locator("button").last().boundingBox();
    expect(Math.abs(refreshBox!.x + refreshBox!.width - (actionBox!.x + actionBox!.width))).toBeLessThanOrEqual(2);

    // From a source checkout the switch itself refuses with a readable
    // reason (it needs an npm-installed build); the helper restart is
    // unit-covered. A switch through the real route is refused/accepted
    // by the service, never silent.
    const channels = await apiJson(s, "GET", "/api/update/channels");
    expect(channels.status).toBe(200);
    const sw = await apiJson(s, "POST", "/api/update/switch", { ref: "preview/feat-x" });
    expect([202, 409]).toContain(sw.status);
    if (sw.status === 409) expect(JSON.stringify(sw.json)).toMatch(/installed|npm/i);
    const status = await apiJson(s, "GET", "/api/update/status");
    expect(status.status).toBe(200);
  });

  test("release build with a newer release: icon shows, links to Version", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await stageChannels(
      s,
      [{ ref: "release", version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) }],
      "release",
    );
    await stageInstalled({ version: "0.0.1", commit: "oldcommit0000001", builtAt: iso(NOW - 7 * 86400_000) });

    await gotoAfterUpdateCheck(page, `${s.origin}/?token=${s.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    const icon = page.getByTestId("update-available-icon");
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("title", "Update available: v0.0.2");
    await expect(icon).toHaveAttribute("href", "/settings?tab=version");
    // #250: the update icon is a gift, not chevrons. #407 draws it from
    // Tabler (all paths, no rect), so check the icon's identity instead
    // of its drawing.
    await expect(icon.locator("svg.tabler-icon-gift")).toHaveCount(1);
  });

  test("up to date: no icon", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await stageChannels(
      s,
      [{ ref: "release", version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) }],
      "release",
    );
    // Installed matches published: nothing newer.
    await stageInstalled({ version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) });

    await gotoAfterUpdateCheck(page, `${s.origin}/?token=${s.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    expect(await page.getByTestId("update-available-icon").count()).toBe(0);
  });

  test("preview build with a release published later: icon shows", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await stageChannels(
      s,
      [
        { ref: "release", version: "0.0.1", commit: "rel0000000000001", builtAt: iso(NOW) },
        {
          ref: "preview/feat-x",
          version: "0.0.1-preview.feat-x.abc1234",
          commit: "abc1234def5678",
          sourceBranch: "feat/x",
          builtAt: iso(NOW - 7 * 86400_000),
        },
      ],
      "preview/feat-x",
    );
    await stageInstalled(null);

    await gotoAfterUpdateCheck(page, `${s.origin}/?token=${s.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    const icon = page.getByTestId("update-available-icon");
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("title", "Update available: v0.0.1");
    // A preview newer than the release: nothing to update to.
    await stageChannels(
      s,
      [
        { ref: "release", version: "0.0.1", commit: "rel0000000000001", builtAt: iso(NOW - 7 * 86400_000) },
        {
          ref: "preview/feat-x",
          version: "0.0.1-preview.feat-x.abc1234",
          commit: "abc1234def5678",
          sourceBranch: "feat/x",
          builtAt: iso(NOW),
        },
      ],
      "preview/feat-x",
    );
    const status = page.waitForResponse(
      (r) => r.url().includes("/api/update/status") && r.request().method() === "GET",
    );
    const channels = page.waitForResponse(
      (r) => r.url().includes("/api/update/channels") && r.request().method() === "GET",
    );
    await page.reload();
    await status;
    await channels;
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    expect(await page.getByTestId("update-available-icon").count()).toBe(0);
  });

  test("toggle hides previews while releases stay (#231)", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await stageChannels(
      s,
      [
        { ref: "release", version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) },
        {
          ref: "preview/feat-x",
          version: "0.0.2-preview.feat-x.abc1234",
          commit: "abc1234def5678",
          sourceBranch: "feat/x",
          builtAt: iso(NOW - 7200_000),
        },
      ],
      "release",
    );
    // Installed older than the published release: the icon shows even with the toggle off.
    await stageInstalled({ version: "0.0.1", commit: "oldcommit0000001", builtAt: iso(NOW - 7 * 86400_000) });

    await page.goto(`${s.origin}/settings?tab=version&token=${s.token}`);
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    const toggle = page.getByTestId("version-picker-toggle");
    if (await toggle.isChecked()) {
      await toggle.click();
      await expect(toggle).not.toBeChecked({ timeout: 15_000 });
    }
    // Toggle off: the release stays, previews hidden — the update check runs either way.
    await expect(page.locator('[data-testid="update-channel"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).toBeVisible();
    const stagedRelease = page.locator('[data-testid="update-channel"][data-ref="release"]');
    await expect(stagedRelease.getByTestId("update-available")).toBeVisible();
    await expect(stagedRelease.getByRole("button", { name: "Update release" })).toBeVisible();
    // #249: the release row shows its version, never the sha.
    await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).toContainText("v0.0.2");
    await expect(page.locator('[data-testid="update-channel"][data-ref="release"]')).not.toContainText("newcommit");
    await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toHaveCount(0);
    await expect(page.getByTestId("update-available-icon")).toBeVisible();

    await toggle.click();
    await expect(toggle).toBeChecked({ timeout: 15_000 });
    await expect(page.locator('[data-testid="update-channel"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toBeVisible();
    // #249: preview rows keep their short sha.
    await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toContainText("abc1234");
  });

  test("toggle on lists previews with the Installed badge; reload keeps it on (#403)", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await stageChannels(
      s,
      [
        { ref: "release", version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) },
        {
          ref: "preview/feat-x",
          version: "0.0.2-preview.feat-x.abc1234",
          commit: "abc1234def5678",
          sourceBranch: "feat/x",
          builtAt: iso(NOW - 7200_000),
        },
      ],
      "preview/feat-x",
    );
    // Installed build matches the published preview commit: no update available.
    await stageInstalled({ version: "0.0.2-preview.feat-x.abc1234", commit: "abc1234def5678", builtAt: iso(NOW - 7200_000) });

    await page.goto(`${s.origin}/settings?tab=version&token=${s.token}`);
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    const toggle = page.getByTestId("version-picker-toggle");
    if (!(await toggle.isChecked())) {
      await toggle.click();
      await expect(toggle).toBeChecked({ timeout: 15_000 });
    }
    const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
    await expect(feat).toBeVisible({ timeout: 15_000 });
    // The installed preview carries its Installed badge (#246).
    await expect(feat.getByTestId("update-current")).toBeVisible({ timeout: 15_000 });
    await expect(feat).toContainText("abc1234");

    await page.reload();
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("version-picker-toggle")).toBeChecked({ timeout: 15_000 });
    const featAfter = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
    await expect(featAfter).toBeVisible({ timeout: 15_000 });
    await expect(featAfter.getByTestId("update-current")).toBeVisible({ timeout: 15_000 });
  });

  test("a settings change under the page snaps the toggle to the saved value (#403)", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    await stageChannels(
      s,
      [
        { ref: "release", version: "0.0.2", commit: "newcommit0000001", builtAt: iso(NOW) },
        {
          ref: "preview/feat-x",
          version: "0.0.2-preview.feat-x.abc1234",
          commit: "abc1234def5678",
          sourceBranch: "feat/x",
          builtAt: iso(NOW - 7200_000),
        },
      ],
      "release",
    );
    await stageInstalled({ version: "0.0.1", commit: "oldcommit0000001", builtAt: iso(NOW - 7 * 86400_000) });

    await page.goto(`${s.origin}/settings?tab=version&token=${s.token}`);
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    const toggle = page.getByTestId("version-picker-toggle");
    if (!(await toggle.isChecked())) {
      await toggle.click();
      await expect(toggle).toBeChecked({ timeout: 15_000 });
    }
    await expect(page.locator('[data-testid="update-channel"]')).toHaveCount(2);

    // Another client (a switch or reset from elsewhere) flips the saved
    // setting off under the open page.
    const flip = await apiJson(s, "PUT", "/api/settings", { versionPickerEnabled: false });
    expect(flip.status).toBe(200);

    // Refresh re-reads status first: the box follows the saved value and
    // the list drops the previews.
    await page.getByTestId("update-refresh").click();
    await expect(toggle).not.toBeChecked({ timeout: 15_000 });
    await expect(page.locator('[data-testid="update-channel"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toHaveCount(0);

    // And back on: Refresh restores the ticked box with the previews.
    const flipBack = await apiJson(s, "PUT", "/api/settings", { versionPickerEnabled: true });
    expect(flipBack.status).toBe(200);
    await page.getByTestId("update-refresh").click();
    await expect(toggle).toBeChecked({ timeout: 15_000 });
    await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]')).toBeVisible({ timeout: 15_000 });

    // Reload: still on, since the saved value persisted.
    await page.reload();
    await expect(page.getByTestId("version-picker-toggle")).toBeChecked({ timeout: 15_000 });
    await expect(page.locator('[data-testid="update-channel"]')).toHaveCount(2);
  });

  test("failed check: no icon, no error UI, Version panel names the failure", async ({ page }) => {
    test.setTimeout(120_000);
    // A service whose fake updater fails the list: the panel names the
    // failure instead of hanging or erroring the page.
    const failDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l7vfail-"));
    const failSvc = await startService(failDir, {
      agent: "none",
      extraEnv: { UNVIBE_UPDATER_BACKEND: "fake", UNVIBE_UPDATE_FAKE_FAIL: "list" },
      label: "l7vfail",
    });
    try {
      const status = page.waitForResponse(
        (r) => r.url().includes("/api/update/status") && r.request().method() === "GET",
      );
      const channels = page.waitForResponse(
        (r) => r.url().includes("/api/update/channels") && r.request().method() === "GET",
      );
      await page.goto(`${failSvc.origin}/?token=${failSvc.token}`);
      await status;
      await channels;
      await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
      expect(await page.getByTestId("update-available-icon").count()).toBe(0);

      await page.goto(`${failSvc.origin}/settings?tab=version&token=${failSvc.token}`);
      await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("alert")).toContainText("Couldn't load version info", { timeout: 15_000 });
      expect(await page.getByTestId("update-available-icon").count()).toBe(0);
    } finally {
      await failSvc.stop().catch(() => {});
      rmSync(failDir, { recursive: true, force: true });
    }
  });

  test("format-changing target warns in one line; no Export drafts without drafts", async ({ page }) => {
    test.setTimeout(120_000);
    const s = service();
    mkdirSync(path.join(dataDir, "update"), { recursive: true });
    writeFileSync(
      path.join(dataDir, "update", "fake-channels.json"),
      JSON.stringify([
        { ref: "release", version: "0.0.1", commit: "rel0000000000001", builtAt: iso(NOW), dataFormat: 1 },
        {
          ref: "preview/feat-x",
          version: "0.0.1-preview.feat-x.abc1234",
          commit: "abc1234def5678",
          sourceBranch: "feat/x",
          builtAt: iso(NOW - 3600_000),
          dataFormat: 2,
        },
      ]),
    );
    writeFileSync(path.join(dataDir, "update", "current-ref"), "release\n");
    const refreshed = await apiJson(s, "GET", "/api/update/channels?refresh=1");
    expect(refreshed.status).toBe(200);

    await page.goto(`${s.origin}/settings?tab=version&token=${s.token}`);
    await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible({ timeout: 15_000 });
    const toggle = page.getByTestId("version-picker-toggle");
    if (!(await toggle.isChecked())) {
      await toggle.click();
      await expect(toggle).toBeChecked({ timeout: 15_000 });
    }
    const warn = page.locator('[data-testid="update-data-reset-warning"][data-ref="preview/feat-x"]');
    await expect(warn).toContainText("Needs a data reset (format 1 → 2)", { timeout: 15_000 });
    // Fresh data dir: no unposted drafts, so no Export action on the line.
    await expect(warn.getByRole("button")).toHaveCount(0);
    // The release row (same format) gets no warn line.
    await expect(page.locator('[data-testid="update-data-reset-warning"][data-ref="release"]')).toHaveCount(0);
    // The switch itself still confirms through the row's inline confirm
    // (opened and cancelled here — the switch is never committed).
    const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
    await feat.getByRole("button", { name: "Switch to preview/feat-x" }).click();
    await expect(feat.getByText("Confirm switch")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(feat.getByText("Confirm switch")).toHaveCount(0);
  });
});
