/**
 * J352 (#352): the Reviews list shows a review's progress in one place —
 * the line under the title — through every phase (opening, ingesting,
 * building, failed, done). No phase pill on the right; the right side
 * keeps only status icons and hover/focus actions (Remove via #346
 * InlineConfirm); rows keep a constant height and title position.
 *
 * Against the real built service: agent `replay` with a stretched chunk
 * delay so the guide really runs (building phase) long enough to walk;
 * a fake `git` that sleeps on diff-family calls so the ingesting window
 * stays open (best-effort fetch fails offline; ingest proceeds locally);
 * and a fake `gh` whose `pr view` reports MERGED + APPROVED so the done
 * row carries status icons. No real `gh`, no network, no spend.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { checkLayout } from "../layout-check.js";
import { apiJson, git, makeScratchRepo, realGitPath } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Fake `gh`: one PR (#1 on `feature`), `pr view` MERGED + APPROVED. */
function writeFakeGh352(binDir: string, headSha: string): void {
  const pr = `{"__typename":"PullRequest","number":1,"title":"Journey test PR","author":{"login":"author"},"updatedAt":"2026-10-01T00:00:00Z","headRefName":"feature","additions":3,"deletions":1,"changedFiles":2,"url":"https://github.com/acme/app/pull/1","state":"MERGED","isDraft":false,"reviewDecision":"APPROVED","reviewRequests":{"nodes":[]},"latestReviews":{"nodes":[]}}`;
  const script = `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '{"title":"Journey test PR","body":"First paragraph.","author":{"login":"author"},"state":"MERGED","isDraft":false,"reviewDecision":"APPROVED","reviewRequests":[],"latestReviews":[],"baseRefName":"main","headRefName":"feature","headRefOid":"${headSha}"}\\n'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  case "$*" in
    *search\\(query:*)
      case "$*" in
        *author:*) echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[${pr}]}}}' ;;
        *) echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}' ;;
      esac
      exit 0
      ;;
  esac
  echo "fake gh: unexpected graphql: $*" >&2; exit 1
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as author"; exit 0; fi
case "$*" in *pulls/1/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

/**
 * Fake `git`: diff-family calls sleep (the ingesting window stays open
 * for the assertions below); `fetch` fails after a beat (best-effort:
 * ingest proceeds with local refs); `ls-remote` fails instantly offline;
 * everything else delegates to the real binary.
 */
function writeFakeGit352(binDir: string, realGit: string): void {
  const script = `#!/bin/sh
case "$1" in
  diff|log|show|merge-base) sleep 2 ;;
esac
case "$1" in
  fetch)
    sleep 1
    echo "fake git: fetch stubbed offline (e2e)" >&2
    exit 1
    ;;
esac
case "$*" in
  *ls-remote*) echo "fake git: ls-remote stubbed offline (e2e)" >&2; exit 1 ;;
esac
exec "${realGit}" "$@"
`;
  writeFileSync(path.join(binDir, "git"), script, { mode: 0o755 });
}

interface PhaseGeometry {
  phase: string;
  height: number;
  titleOffsetY: number;
}

test.describe("J352 reviews-list progress line", () => {
  let repoDir = "";
  let dataDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let repoId = "";
  let headSha = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j352-repo-"));
    const repo = await makeScratchRepo(repoDir);
    headSha = repo.headSha;
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/app.git");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j352-data-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j352-bin-"));
    writeFakeGh352(fakeBin, headSha);
    writeFakeGit352(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: {
        SHELL: fakeShell,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        // Stretch the replay chunk delay so the building phase lasts
        // long enough to walk (~1 min); the done phase lands after.
        UNVIBE_REPLAY_DELAY_MS: "250",
      },
    });
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
    const registered = list.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
    repoId = registered.id;
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  async function reviewStatus(id: string): Promise<{ ingestStatus: string; guideStatus: string }> {
    const list = await apiJson(svc!, "GET", "/api/reviews");
    const found = (list.json as { reviews: { id: string; ingestStatus: string; guideStatus: string }[] }).reviews.find(
      (r) => r.id === id,
    );
    if (!found) throw new Error(`review ${id} missing from /api/reviews`);
    return { ingestStatus: found.ingestStatus, guideStatus: found.guideStatus };
  }

  async function waitForStatus(
    id: string,
    want: (s: { ingestStatus: string; guideStatus: string }) => boolean,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (want(await reviewStatus(id))) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for review ${id} status`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function measure(
    row: import("@playwright/test").Locator,
    phase: string,
  ): Promise<PhaseGeometry> {
    const rowBox = await row.boundingBox();
    const titleBox = await row.locator(".cx2").first().boundingBox();
    if (!rowBox || !titleBox) throw new Error(`no bounding box for ${phase} row`);
    return { phase, height: rowBox.height, titleOffsetY: titleBox.y - rowBox.y };
  }

  test("opening, ingesting, building, failed and done share one under-title line", async ({ page }) => {
    test.setTimeout(600_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((id) => {
      try {
        localStorage.setItem("unvibe.start.repoId", id);
      } catch {
        // Start page falls back to no selection; asserts below fail.
      }
    }, repoId);
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Journey test PR").first()).toBeVisible({ timeout: 30_000 });

    // Opening: hold the create POST in flight; the PR row names the phase
    // under its title — no pill on the right — and the title never moves.
    const prRow = page.locator(".ci", { hasText: "Journey test PR" }).first();
    // Title offset inside its own row: content above the list (readiness
    // banners that load late on slow runners) can move the whole row, which
    // is not a row jump.
    // Both rects in one synchronous read: two separate boundingBox() calls
    // can straddle a late banner and differ by its height (CI hit 67.5px).
    const titleOffset = (): Promise<number> =>
      prRow.evaluate((row) => {
        const title = row.querySelector(".cx2");
        if (!title) throw new Error("no title in row");
        return title.getBoundingClientRect().top - row.getBoundingClientRect().top;
      });
    await page.waitForLoadState("networkidle");
    const idleTitleOffset = await titleOffset();
    let releasePost!: () => void;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    await page.route("**/api/reviews", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await postGate;
      await route.continue();
    });
    await prRow.locator(".cj-open").click();
    const opening = prRow.getByTestId("change-progress");
    await expect(opening).toContainText("Opening…", { timeout: 10_000 });
    await expect(opening).toHaveAttribute("role", "status");
    expect(Math.abs((await titleOffset()) - idleTitleOffset)).toBeLessThanOrEqual(1);
    await expect(prRow.locator(".prtag")).toHaveCount(0);
    const posted = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/api/reviews"),
    );
    releasePost!();
    await posted;
    await page.unroute("**/api/reviews");

    // The create lands and the app navigates to the review; back on the
    // start page the Reviews list gains a session row, still ingesting.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    const sessionRow = page.locator('[data-testid^="session-"]', { hasText: "Journey test PR" }).first();
    await expect(sessionRow).toBeVisible({ timeout: 30_000 });
    const progress = sessionRow.getByTestId("row-progress");
    await expect(progress).toContainText(/Opening ·/, { timeout: 30_000 });
    await expect(sessionRow.locator(".prtag")).toHaveCount(0);
    await expect(progress).toHaveAttribute("role", "status");
    // Actions stay hidden until hover or keyboard focus, in every phase.
    // (The rule hides the confirm's idle slot; the button inside inherits
    // it visually, so the slot is the element to read.)
    const idle = sessionRow.locator(".uic-idlehold");
    const remove = sessionRow.getByRole("button", { name: "Remove this review" });
    await expect(idle).toHaveCSS("opacity", "0");
    await sessionRow.hover();
    await expect(idle).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    await remove.focus();
    await expect(idle).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    const geometries: PhaseGeometry[] = [await measure(sessionRow, "ingesting")];
    const created = await apiJson(svc, "GET", "/api/reviews");
    const reviewId = (created.json as { reviews: { id: string; title: string }[] }).reviews.find((r) =>
      r.title.includes("Journey test PR"),
    )?.id;
    if (!reviewId) throw new Error("walk review missing from /api/reviews");

    // Building: the replay pipeline runs the guide for real.
    await waitForStatus(reviewId, (s) => s.guideStatus === "running", 120_000);
    await page.reload();
    const buildingRow = page.locator(`[data-testid="session-${reviewId}"]`);
    await expect(buildingRow).toBeVisible({ timeout: 30_000 });
    const buildingProgress = buildingRow.getByTestId("row-progress");
    await expect(buildingProgress).toContainText("hunks reviewed");
    await expect(buildingProgress.locator(".dots")).toHaveCount(1);
    await expect(buildingRow.locator(".prtag")).toHaveCount(0);
    await expect(buildingRow.locator(".uic-idlehold")).toHaveCSS("opacity", "0");
    geometries.push(await measure(buildingRow, "building"));

    // Done: the guide lands; status icons read on the right, still no pill.
    await waitForStatus(reviewId, (s) => s.guideStatus === "ready", 300_000);
    await page.reload();
    const doneRow = page.locator(`[data-testid="session-${reviewId}"]`);
    await expect(doneRow).toBeVisible({ timeout: 30_000 });
    const doneProgress = doneRow.getByTestId("row-progress");
    await expect(doneProgress).toContainText("hunks reviewed");
    await expect(doneProgress.locator(".dots")).toHaveCount(0);
    await expect(doneRow.locator(".prtag")).toHaveCount(0);
    await expect(doneRow.getByTestId("pr-badges").getByRole("img", { name: "Merged" })).toBeVisible();
    await expect(doneRow.getByTestId("pr-badges").getByRole("img", { name: "Approved" })).toBeVisible();
    geometries.push(await measure(doneRow, "done"));
    await checkLayout(page, "start-progress-done");

    // One place, one height, one title position through every phase.
    for (const g of geometries) {
      expect(Math.abs(g.height - geometries[0].height), `${g.phase} row height`).toBeLessThanOrEqual(1);
      expect(
        Math.abs(g.titleOffsetY - geometries[0].titleOffsetY),
        `${g.phase} title position`,
      ).toBeLessThanOrEqual(1);
    }

    // Failed: a review that could not open shows its error under the
    // title — long text truncates to the one line — with no pill and the
    // same hidden-until-hover actions, at the same height as done.
    const failed = await apiJson(svc, "POST", "/api/reviews", { repoId, branch: "no-such-branch" });
    expect([200, 201, 202]).toContain(failed.status);
    const failedId = (failed.json as { review: { id: string } }).review.id;
    await waitForStatus(failedId, (s) => s.ingestStatus === "failed", 60_000);
    await page.reload();
    const failedRow = page.locator(`[data-testid="session-${failedId}"]`);
    await expect(failedRow).toBeVisible({ timeout: 30_000 });
    const failedProgress = failedRow.getByTestId("row-progress");
    await expect(failedProgress).toContainText("Couldn't open this review");
    await expect(failedProgress).toHaveAttribute("role", "status");
    await expect(failedRow.locator(".prtag")).toHaveCount(0);
    // Retry hides until hover or keyboard focus (Remove is covered on the
    // loading row above and by J225).
    const retrySlot = failedRow.getByTestId("row-retry");
    const retry = failedRow.getByRole("button", { name: "Retry" });
    await expect(retrySlot).toHaveCSS("opacity", "0");
    await failedRow.hover();
    await expect(retrySlot).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    const failedGeo = await measure(failedRow, "failed");
    const doneGeo = geometries.find((g) => g.phase === "done")!;
    expect(Math.abs(failedGeo.height - doneGeo.height), "failed row height").toBeLessThanOrEqual(1);
    expect(Math.abs(failedGeo.titleOffsetY - doneGeo.titleOffsetY), "failed title position").toBeLessThanOrEqual(1);
    await checkLayout(page, "start-progress-failed");
    // Retry re-runs the failed ingest: the row returns to the ingesting
    // phase, at the same height.
    await failedRow.hover();
    await retry.click();
    await expect(failedProgress).toContainText(/Opening ·/, { timeout: 30_000 });
    const retryGeo = await measure(failedRow, "retrying");
    expect(Math.abs(retryGeo.height - doneGeo.height), "retrying row height").toBeLessThanOrEqual(1);
    expect(Math.abs(retryGeo.titleOffsetY - doneGeo.titleOffsetY), "retrying title position").toBeLessThanOrEqual(1);
  });
});
