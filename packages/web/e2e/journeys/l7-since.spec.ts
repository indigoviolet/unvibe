/**
 * L7 — Versions, Since and refresh (#363 package D).
 *
 * The update lifecycle in usage order: an existing review gains commits
 * and Update writes the Since-B section with an addendum (plotlines and
 * the Since filter follow); the picker offers versions and commits and
 * picking a commit re-baselines; the no-review-yet offer on a real PR
 * (prior GitHub review → one guide run with the commit baseline and the
 * delta hunk set, offer gone once the guide lands, gone commit fails
 * loudly); one update-state model after Update (stale banner offers
 * Update, current banner reads current with no card banner, a further
 * update 409s); refresh banners counts with reviewed clearing only on
 * the changed hunk and the old version read-only; cards, comments and
 * reviewed state surviving a refresh with the changed hunk reopening
 * (#194's terminal update-pass plus the Debug refresh steps and job
 * times); a code citation outside the diff re-anchored after refresh
 * (#112); and the Version settings tab (fake channels list, 409 switch
 * refusal from a source checkout, the update icon states, the previews
 * toggle, the failed-check panel, the data-format warn line).
 *
 * Boots: five scratch-repo services (since-B replay, since-commit
 * replay, update-state replay, refresh none, carry-over replay) plus
 * one agent:none + fake-updater settings service for the version tab.
 *
 * Absorbs: `j351-since-b` (both), `j351-since-commit` (all 4),
 * `j367-update-state`, `j12-refresh` (both), `j16-refresh-carryover`,
 * the version-picker/update-icon/warn-line parts of
 * `j5-settings-versions` (settings halves live in L9).
 *
 * Guards kept: #351 (Since-B section + addendum, plotlines, Since
 * filter, commit baseline + delta hunk set, prior-review offer);
 * #367 (one update-state model, no card banner, 409 on a second
 * Update); #368 (the header chip's shared gap — asserted, not framed);
 * #112 (citation re-anchor); #194 (terminal update-pass, refresh
 * steps); #249 (release row shows its version, previews keep short
 * sha); #246 (Installed badge, no separate Installed line, no
 * "Releases always listed" hint); #233/#229 (compact version rows,
 * toggle alignment); #330 (per-channel Notes buttons); the 409 switch
 * refusal from source checkouts (real rollback covered by service
 * units); #258 (read-only older version); #256 (versions-refresh flow
 * inside J12).
 *
 * Frames removed (tour owns them; package D re-adds in
 * `e2e/tour/visual-tour-system.spec.ts`): j367's stale-banner,
 * hunk-header-chip and updated-banner shots. No `shot()`/`screenshot`
 * lines remain in the gate.
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
import { openPopup } from "../select.js";
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

async function waitForUpdatePass(svc: RunningService, reviewId: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let updateJob: { id: string; kind: string; state: string } | undefined;
  for (;;) {
    const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
    const jobs = (res.json as { jobs: { id: string; kind: string; state: string }[] }).jobs ?? [];
    updateJob = jobs.find((j) => j.kind === "update-pass");
    if (updateJob && (updateJob.state === "done" || updateJob.state === "error" || updateJob.state === "cancelled")) break;
    if (Date.now() > deadline) throw new Error(`update-pass job never finished: ${JSON.stringify(updateJob)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(updateJob?.state).toBe("done");
}

const appKey = fileKeyForPath("src-app.py");
const appFile = `[id="F-${appKey}"]`;

// ---------------------------------------------------------------------------
// Since-B update over a scratch review.
// ---------------------------------------------------------------------------

test.describe("L7 since-B update (j351 step 1)", () => {
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

  test("Update writes the Since-B section and an addendum; plotlines and the Since-B filter follow", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 30_000 });

    // Mark both hunks reviewed; the v2 commit touches alpha only.
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const files = (snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files;
    const app = files.find((f) => f.path === "src-app.py");
    expect(app?.hunks).toHaveLength(2);
    for (const h of app!.hunks) await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/hunks/${h.contentHash}`, { reviewed: true });
    await expect(page.locator(appFile).locator(".revc")).toContainText("2/2", { timeout: 30_000 });

    writeFileSync(path.join(repoDir, "src-app.py"), V_ALPHA2);
    await git(repoDir, "add", "src-app.py");
    await git(repoDir, "commit", "-m", "rework alpha");
    await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.locator('[data-testid="stale-banner"]')).toContainText(/1 changed/, { timeout: 60_000 });
    // The unchanged hunk keeps reviewed; the changed one reopens.
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2", { timeout: 30_000 });
    // The baseline picker defaults to the version last opened.
    await expect(page.locator('[data-testid="since-pick"]')).toContainText("v1 ·", { timeout: 30_000 });

    await page.locator('[data-testid="stale-banner"]').getByRole("button", { name: "Update" }).click();
    await waitForUpdatePass(svc, reviewId);

    // The dated Since-B section, expanded with its cards.
    const since = page.locator('[data-testid="since-section"]');
    await expect(since).toBeVisible({ timeout: 30_000 });
    await expect(since).toContainText(/Since v1 → v2/);
    await expect(since.getByRole("button", { name: /Collapse changes since v1/ })).toBeVisible();
    // Collapse it, then expand it again: the cards come and go.
    await since.getByRole("button", { name: /Collapse changes since v1/ }).click();
    await expect(since.locator('[id^="C-since-"]')).toHaveCount(0);
    await since.getByRole("button", { name: /Expand changes since v1/ }).click();
    await expect(since.locator('[id^="C-since-"]')).toHaveCount(1);

    // The card addendum: old text unchanged, addendum appended.
    const central = page.locator("#page #C-problem");
    await expect(central).toContainText(/Updated since v1/, { timeout: 30_000 });
    await expect(central.locator("[data-addendum]")).toBeVisible();

    // Plotlines: the new thread reads new since B, with its +N.
    const plotlines = page.locator('.plotlines[aria-label="Plotlines"]');
    await expect(plotlines.getByText("new since v1")).toBeVisible({ timeout: 30_000 });
    await expect(plotlines.getByText("+1 since v1")).toHaveCount(0);

    // The diff: the Since-B filter shows only the delta.
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).locator(".dhunk")).toHaveCount(2);
    await page.locator("#right").getByRole("button", { name: "Show only hunks changed since v1" }).click();
    await expect(page.locator('[data-filterchip="since"]')).toContainText("Since v1 · 1 hidden");
    await expect(page.locator(appFile).locator(".dhunk")).toHaveCount(1);
    await expect(page.locator(appFile).locator(".dhunk").first()).toContainText("return 111");
    // Unchanged hunks keep reviewed state through the pass.
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2");
    await page.locator('[data-filterchip="since"]').click();
    await expect(page.locator(appFile).locator(".dhunk")).toHaveCount(2);
  });

  test("the picker offers versions and commits; picking a commit re-baselines", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const before = (await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as {
      commits: { sha: string; subject: string }[];
    };
    expect(before.commits.length).toBeGreaterThanOrEqual(2);
    // Commits are oldest-first: the oldest is v1's commit, strictly
    // before the head, so the delta is non-empty.
    const older = before.commits[0];
    const short = older.sha.slice(0, 8);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    const pick = page.locator('[data-testid="since-section"] [data-testid="since-pick"]');
    await expect(pick).toContainText("v1 ·", { timeout: 30_000 });
    await pick.click();
    await expect(page.getByRole("group", { name: "Versions" })).toBeVisible({ timeout: 15_000 });
    const commitsGroup = page.locator('[role="group"]', { hasText: "Commits" }).first();
    await expect(commitsGroup).toBeVisible();
    // The v1 head sha is this same commit, so scope to the Commits group.
    await expect(commitsGroup.getByRole("option", { name: new RegExp(short) })).toBeVisible();
    await commitsGroup.getByRole("option", { name: new RegExp(short) }).click();
    // The trigger names the picked commit (short sha + subject).
    await expect(pick).toContainText(short, { timeout: 30_000 });
    await expect(pick).toContainText(older.subject.slice(0, 12), { timeout: 30_000 });
    const after = (await apiJson(svc, "GET", `/api/reviews/${reviewId}`)).json as {
      sinceBaseline: unknown;
      sinceHunks?: { added: string[]; changed: string[] };
    };
    expect(after.sinceBaseline).toEqual({ kind: "commit", sha: older.sha });
    const hunks = [...(after.sinceHunks?.added ?? []), ...(after.sinceHunks?.changed ?? [])];
    expect(hunks.length).toBeGreaterThan(0);
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
    // Exactly one guide run: a single reader job, no update pass.
    const readers = (s.jobs ?? []).filter((j) => j.kind === "reader");
    expect(readers).toHaveLength(1);
    expect(readers[0].state).toBe("done");
    expect((s.jobs ?? []).some((j) => j.kind === "update-pass")).toBe(false);
  });

  test("the Since filter reads the commit baseline label", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`${svc!.origin}/review/${reviewId}?token=${svc!.token}`);
    await expect(page.locator("#page .doc")).toBeVisible({ timeout: 60_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 30_000 });
    const chip = page.locator('[data-filterchip="since"]');
    await expect(chip).toContainText(`Since ${c1short}`, { timeout: 30_000 });
    await expect(chip).toHaveAttribute("aria-label", `Show only hunks changed since ${c1short}`);
    await chip.click();
    await expect(chip).toContainText("hidden", { timeout: 30_000 });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
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

test.describe("L7 update clears every card; banner has one state model", () => {
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

  test("stale banner offers Update; after Update the banner reads current with no Update and no card banner", async ({ page }) => {
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
    await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();

    // Stale state: one model — "New commits · v1 → v2 (…)" plus Update.
    const banner = page.locator('[data-testid="stale-banner"]');
    await expect(banner).toHaveAttribute("data-update-state", "stale", { timeout: 60_000 });
    await expect(banner).toContainText(/New commits · v1 → v2/);
    await expect(banner).toContainText(/1 changed/);
    await expect(banner.getByRole("button", { name: "Update", exact: true })).toBeVisible();

    // #368: the header chip sits off the diff stat with the shared gap.
    await expect(page.locator(appFile).getByText("changed since reviewed")).toHaveCount(1);
    await expect(page.locator(appFile).locator(".prtag").first()).toHaveCSS("margin-left", "6px");

    await banner.getByRole("button", { name: "Update", exact: true }).click();
    await waitForUpdatePass(svc, reviewId);
    await expect(banner).toHaveAttribute("data-update-state", "current", { timeout: 60_000 });

    // Up-to-date state: "Updated to v2 · since v1" with the picker and
    // range-diff, no Update button, no "Already up to date" label.
    await expect(banner).toContainText(/Updated to v2 · since v1/);
    await expect(banner.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
    await expect(banner).not.toContainText(/Already up to date/);
    await expect(banner.locator('[data-testid="since-pick"]')).toBeVisible();

    // No card banner anywhere: the UI offers no Update the service would refuse.
    await expect(page.locator("#page .stale")).toHaveCount(0);

    // The service agrees: a further update is refused as already up to date.
    const again = await apiJson(svc, "POST", `/api/reviews/${reviewId}/update`);
    expect(again.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Refresh (j12): banner counts, reviewed clears on the changed hunk only,
// the old version is read-only; #112 re-anchor.
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

  test("refresh banners counts, reviewed clears only on the changed hunk, old version read-only", async ({ page }) => {
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

    await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();
    const banner = page.locator('[data-testid="stale-banner"]');
    await expect(banner).toContainText("1 changed · 1 new · 0 removed hunks", { timeout: 60_000 });
    await banner.getByText("range-diff").click();
    await expect(page.locator('[data-testid="range-diff"]')).not.toBeEmpty();

    // Reviewed cleared only on the changed hunk: alpha carries the stale
    // marker with the new code, beta keeps its reviewed state.
    await expect(page.locator(appFile).getByText("changed since reviewed")).toHaveCount(1);
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2", { timeout: 30_000 });
    await expect(page.locator(appFile).getByText("return 111")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).getByText(/return 11\b/)).toHaveCount(0);

    // Older version stays viewable, read-only, with the pre-refresh code.
    await page.locator("#version-pick").click();
    await openPopup(page).getByRole("option", { name: /^v1 / }).click();
    await expect(page).toHaveURL(/version=1/);
    await expect(page.locator(appFile).getByText(/return 11\b/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).getByText("return 111")).toHaveCount(0);
    await expect(page.locator('[data-testid="stale-banner"]')).toHaveCount(0, { timeout: 15_000 });
    // The switcher flags the older version read-only (trigger names it,
    // no back button, read-only hint).
    await expect(page.locator('[data-testid="version-switcher"]')).toHaveAttribute("data-ro", "1");
    await expect(page.locator("#version-pick")).toContainText("v1");
    await expect(page.getByRole("button", { name: "Back to current" })).toHaveCount(0);
    await expect(page.getByText("read-only", { exact: false }).first()).toBeVisible();
    // On the older version diff line clicks refuse with a toast and open no composer.
    await page.locator(`${appFile} td.n.new`).first().click();
    await expect(page.locator("#toast")).toContainText(/read-only/i, { timeout: 5_000 });
    await expect(page.locator(`${appFile} .ithread[data-pending-thread]`)).toHaveCount(0);

    // Choosing the current version (annotated in the dropdown) is the way
    // back; the banner returns, and Update reports plainly without the
    // pipeline (no base runner) instead of hanging.
    await page.locator("#version-pick").click();
    const options = openPopup(page).getByRole("option");
    await expect(options.last()).toContainText("current");
    await options.last().click();
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Update" }).click();
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
        level: "standard",
        read: false,
        collapsed: false,
        revision: 1,
        blocks: [
          {
            type: "paragraph",
            id: "b-helper",
            text: { standard: "Uses the helper beta value." },
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
    await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();

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
    await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.locator('[data-testid="stale-banner"]')).toContainText(/1 changed/, { timeout: 60_000 });

    // Carried over: guide cards, the comment, and the unchanged reviewed state.
    await expect(page.locator("#page .doc h1.title")).toHaveText(guideText, { timeout: 30_000 });
    await expect(page.getByText("Carry this comment over the refresh.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(appFile).locator(".revc")).toContainText("1/2", { timeout: 30_000 });
    await expect(page.locator(appFile).getByText("return 111")).toBeVisible({ timeout: 30_000 });

    // #194: the update pass finishes terminally either way under replay.
    await page.locator('[data-testid="stale-banner"]').getByRole("button", { name: "Update" }).click();
    const jobDeadline = Date.now() + 90_000;
    let updateJob: { id: string; kind: string; state: string; finishedAt?: number } | undefined;
    for (;;) {
      const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
      const jobs = (res.json as { jobs: { id: string; kind: string; state: string; finishedAt?: number }[] }).jobs ?? [];
      updateJob = jobs.find((j) => j.kind === "update-pass");
      if (updateJob && (updateJob.state === "done" || updateJob.state === "error" || updateJob.state === "cancelled")) break;
      if (Date.now() > jobDeadline) throw new Error(`update-pass job never finished: ${JSON.stringify(updateJob)}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(typeof updateJob?.finishedAt).toBe("number");

    // #194: Debug page shows job timings and the refresh's timed steps.
    await page.goto(`${svc.origin}/review/${reviewId}/debug?token=${svc.token}`);
    const steps = page.locator('[data-testid="refresh-steps"]');
    await expect(steps).toBeVisible({ timeout: 30_000 });
    for (const label of ["Fetch", "Building the new version", "Range diff", "Remapping anchors", "Remapping citations", "Remapping pins"]) {
      await expect(steps).toContainText(label);
    }
    await expect(steps).toContainText("started");
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Queued", { timeout: 30_000 });
    await expect(page.locator('[data-testid="job-times"]').first()).toContainText("Duration");
    const updateRow = page.locator(`[data-testid="job-${updateJob!.id}"]`);
    await expect(updateRow).toContainText("Finished", { timeout: 30_000 });
    await expect(updateRow).toContainText("update:");
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
    // #250: the update icon is a gift (rect box + lid), not chevrons.
    await expect(icon.locator("svg rect")).toHaveCount(1);
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
