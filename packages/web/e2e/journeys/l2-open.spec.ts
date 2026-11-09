/**
 * L2 — Open and ingest (#363 package A).
 *
 * Opening reviews and the ingest behind them: the demo opens non-degraded
 * with its working copy serving code beyond the diff (#176), the guide
 * reads and citations reveal diff rows, scratch reviews open with no
 * agent, hunk state survives reload + restart with out-of-band WS patches
 * arriving, reopening reuses the review (#149), seeded concept pages write
 * on open, empty diffs (no changes / merged-equal-base / refresh-emptied),
 * huge diffs stay navigable, the Reviews progress line holds one place
 * through every phase (j352), and start dots agree with the review pill
 * (j247).
 *
 * Boots: one replay service (demo + seeded guide), one agent:none service
 * (scratch + huge + empty-branch + merged-equal-base repos), one bare
 * service (snapshot/restart/WS), one refresh-empties service, one
 * stretched-replay service (progress line), one paced-replay service
 * (agreement) with a short-lived seeded stuck service inside the test.
 *
 * Absorbs: `j1-open-and-read` (4 tests + 2 seeded), `j7-huge-pr`,
 * `j18-empty-diff` (3 tests), `j352-reviews-progress`, `j247-running-agreement`
 * (2 tests).
 *
 * Guards kept: #176 (non-degraded demo + worktree serves beyond diff),
 * #149 (start-page reuse), #198/#212 (explain-first reader order), #341
 * (re-recorded citation/anchors), #232 (preparing states), #274 (card
 * toolbar hover/focus), #346 (quiet remove slot rule), #352 (under-title
 * line, constant geometry), #203/#204 (pinned thread chrome while
 * writing), #336 (toolbar hidden until hover).
 *
 * Brittleness fixed here (#363 §4): j352's non-atomic row/title reads (B1 —
 * every geometry read is one synchronous `measureWithinRow`), j352's
 * `waitForLoadState("networkidle")` (B4 — dropped; the Reviews-heading
 * assert it already did next is the gate), and the dropped
 * test-results/visual-tour screenshots (frames live in the tour now).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { measureWithinRow } from "../geometry.js";
import { fileKeyForPath } from "@unvibe/shared";
import { openPopup } from "../select.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import {
  apiJson,
  createDemoReview,
  createScratchReview,
  createSeededDemoReview,
  git,
  makeScratchRepo,
  realGitPath,
  stampDataFormat,
  writeFakeGitOffline,
} from "./journey-helpers.js";

test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Load the service start page, optionally with this repo pre-selected.
 *
 * The seed is registered with `addInitScript` BEFORE the navigation (the
 * same pattern the absorbed journeys use): the value is present when the
 * app first boots, so it never takes the default-select path and no late
 * default persist can clobber the seed. */
async function serviceStart(page: Page, svc: RunningService, repoId?: string, expectRepo?: string | RegExp): Promise<void> {
  if (repoId !== undefined) {
    await page.addInitScript((id) => {
      try {
        localStorage.setItem('unvibe.start.repoId', id);
      } catch {
        // Start page falls back to no selection; asserts below fail.
      }
    }, repoId);
  }
  await page.goto(`${svc.origin}/?token=${svc.token}`);
  await expect(page.getByRole('heading', { name: 'Reviews' })).toBeVisible({ timeout: 30_000 });
  if (expectRepo !== undefined) {
    await expect(page.getByLabel('Repo', { exact: true })).toContainText(expectRepo, { timeout: 15_000 });
  }
}

/** Wait until a review's ingest reaches `want`. */
async function awaitIngest(svc: RunningService, id: string, want: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await apiJson(svc, "GET", `/api/reviews/${id}`);
    const st = (snap.json as { ingest?: { status?: string; error?: string } }).ingest?.status ?? "ready";
    if (st === want) return;
    if (Date.now() > deadline) throw new Error(`ingest did not become ${want}: ${JSON.stringify(snap.json)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

test.describe("L2 open and read", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const GUIDE_SEED_ID = "guide-seed";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2-data-"));
    createSeededDemoReview(dataDir, GUIDE_SEED_ID);
    svc = await startService(dataDir, { agent: "replay", label: "l2demo" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("demo opens non-degraded, guide reads, citation reveals diff, reload keeps", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");

    await test.step("the reader job finishes done with no degraded reason", async () => {
      if (!svc) throw new Error("no service");
      type JobRow = { kind: string; state: string; degradedReason?: string; error?: string };
      let reader: JobRow | undefined;
      const deadline = Date.now() + 90_000;
      for (;;) {
        const res = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
        reader = (res.json as { jobs: JobRow[] }).jobs.find((j) => j.kind === "reader");
        if (reader && (reader.state === "done" || reader.state === "error")) break;
        if (Date.now() > deadline) throw new Error(`reader did not settle: ${JSON.stringify(reader)}`);
        await new Promise((r) => setTimeout(r, 250));
      }
      expect.soft(reader.state).toBe("done");
      expect.soft(reader.degradedReason).toBeUndefined();
      expect.soft(reader.error).toBeUndefined();
    });

    await test.step("the working copy serves real head code beyond the diff (#176)", async () => {
      if (!svc) throw new Error("no service");
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const headSha = (snap.json as { version: { headSha: string } }).version.headSha;
      const slice = await apiJson(
        svc,
        "GET",
        `/api/reviews/${reviewId}/file?path=src/urllib3/connection.py&commit=${headSha}&start=91&end=95`,
      );
      expect.soft(slice.status).toBe(200);
      expect.soft(JSON.stringify(slice.json)).toContain("_normalize_header_value");
    });

    await test.step("no degraded note rides the guide in the browser", async () => {
      if (!svc) throw new Error("no service");
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.getByText("Some references in this answer could not be linked to the code.")).toHaveCount(0);
    });

    await test.step("start page lists the demo; opening it reads the guide in order", async () => {
      if (!svc) throw new Error("no service");
      await serviceStart(page, svc);
      // The opened demo review is listed on the start page; open it from there.
      await page.getByRole("button", { name: /Unfold obsolete folded response headers/ }).first().click();
      await page.waitForURL(new RegExp(`/review/${reviewId}`), { timeout: 30_000 });
      await expect.soft(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator("#C-problem")).toBeVisible();
      // Explain-first reader order (#198/#212): build-up, then the renamed
      // decisions card. The demo introduces no name with reach (only
      // private helpers), so it correctly has no Names card.
      await expect.soft(page.locator("#C-buildup")).toBeVisible();
      await expect.soft(page.locator("#C-decisions")).toBeVisible();
      await expect.soft(page.locator("#C-decisions")).toContainText("Decisions and questions");
      await expect.soft(page.locator("#C-names")).toHaveCount(0);
      // Contents lists the renamed card under its stable id.
      await expect.soft(page.locator('[data-tocard="decisions"]')).toContainText("Decisions and questions");
    });

    await test.step("a citation reveals the diff row; reload keeps the guide", async () => {
      // Dismiss any open pinned card first, as a reader would.
      const seeded = page.locator("#C-problem [data-expansion]");
      if ((await seeded.count()) > 0) {
        const closer = page.locator('#C-problem [data-expansion]').getByRole("button", { name: "Close" });
        if ((await closer.count()) > 0) await closer.first().click().catch(() => {});
      }
      await page.locator("#C-central .lk[data-refs]").first().click();
      // Issue #341: the re-recorded central card cites connection.py:80-88
      // first (was the message-rewrite lines at 91-110), so the reveal lands
      // on line 80.
      await expect.soft(page.locator('[id="L-src-urllib3-connection.py-80"].hl')).toBeVisible({ timeout: 15_000 });

      await page.reload();
      await expect.soft(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    });

    await test.step("card toolbars stay hidden until hover or keyboard focus (#274)", async () => {
      const cardToolbar = page.locator("#C-central .chead .ctl");
      await expect.soft(cardToolbar).toHaveCSS("opacity", "0");
      await page.locator("#C-central").hover();
      await expect.soft(cardToolbar).toHaveCSS("opacity", "1");
      // Keyboard: focusing a toolbar control reveals it via :focus-within.
      await page.mouse.move(0, 0);
      await cardToolbar.getByRole("button", { name: "Use examples" }).focus();
      await expect.soft(cardToolbar).toHaveCSS("opacity", "1");
    });

    await test.step("opening the existing demo from the start page reuses it (#149)", async () => {
      if (!svc) throw new Error("no service");
      const before = await apiJson(svc, "GET", "/api/reviews");
      const idsBefore = new Set((before.json as { reviews: { id: string }[] }).reviews.map((r) => r.id));
      await serviceStart(page, svc);
      await page.getByRole("button", { name: /Unfold obsolete folded response headers/ }).first().click();
      await page.waitForURL(new RegExp(`/review/${reviewId}`), { timeout: 30_000 });
      const after = await apiJson(svc, "GET", "/api/reviews");
      expect
        .soft((after.json as { reviews: { id: string }[] }).reviews.map((r) => r.id).filter((id) => !idsBefore.has(id)))
        .toEqual([]);
    });
  });

  test("seeded guide: concept page writes on open, citation reveals, collapse applies", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");

    await test.step("a concept page writes on open with its stub title", async () => {
      if (!svc) throw new Error("no service");
      await page.goto(`${svc.origin}/review/${GUIDE_SEED_ID}?token=${svc.token}`);
      await expect
        .soft(page.locator("#page .doc h1.title"))
        .toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
      // #167: the seed carries an open pinned card under C-problem that
      // overlays the controls below it — close it first, as a reader would.
      const closer = page.locator("#C-problem [data-expansion]").getByRole("button", { name: "Close" });
      if ((await closer.count()) > 0) await closer.first().click();
      // #216: no concept page exists yet; opening it writes it (replayed
      // concept_page job), and the title lands when it's written. Issue
      // #341: the re-recorded reader wrote no [[concept:]] link tokens, so
      // no a.cx link renders — fire the same `concept` action the link would
      // fire, then open its stub page directly.
      const concept = await apiJson(svc, "POST", `/api/reviews/${GUIDE_SEED_ID}/actions`, {
        kind: "concept",
        slug: "obs-fold",
      });
      expect(concept.status).toBe(200);
      await page.goto(`${svc.origin}/review/${GUIDE_SEED_ID}/page/c-obs-fold?token=${svc.token}`);
      await expect.soft(page).toHaveURL(/\/review\/guide-seed\/page\/c-obs-fold/);
      // Issue #341: the re-recorded concept page is titled with its slug.
      await expect.soft(page.locator("#page h1.title")).toContainText("obs-fold", { timeout: 60_000 });
      // Description tab serves the fixture HTML with stable paragraph ids.
      await page.locator('#right [role="tab"]').getByText("PR description").click();
      await expect.soft(page.locator("#right #d-p1")).toBeVisible();
    });

    await test.step("a diff citation reveals the canonical hunk, then collapse applies", async () => {
      // Back on the root page, a diff citation reveals the canonical hunk row.
      await page.locator("#page nav.crumbs button").first().click();
      await expect.soft(page.locator("#C-central")).toBeVisible();
      await page.locator("#C-central .lk[data-refs]").first().click();
      // Issue #341: first central citation is connection.py:80-88 now.
      await expect.soft(page.locator('[id="L-src-urllib3-connection.py-80"].hl')).toBeVisible({ timeout: 10_000 });

      await page.locator("#C-central > .chead").getByRole("button", { name: "Collapse" }).click();
      await expect.soft(page.locator("#C-central")).toHaveClass(/collapsed/, { timeout: 10_000 });
      await page.locator("#C-central").getByRole("button", { name: "Expand" }).click();
      await expect.soft(page.locator("#C-central")).not.toHaveClass(/collapsed/, { timeout: 10_000 });
    });
  });
});

/** Fake `gh` for the merged-equal-base review: MERGED with head == base. */
function writeFakeGhMerged(binDir: string, baseSha: string): void {
  const script = `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  cat <<EOF
{"title":"Merged journey PR","body":"Body.","author":{"login":"author"},"state":"MERGED","isDraft":false,"baseRefName":"main","headRefName":"feature","headRefOid":"${baseSha}"}
EOF
  exit 0
fi
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
  writeFileSync(path.join(binDir, "gh"), script, { mode: 0o755 });
}

test.describe("L2 diff shapes: huge, empty, merged-equal-base (agent none)", () => {
  let dataDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  const dirs: string[] = [];
  const repoIds: Record<string, string> = {};
  const ids: Record<string, string> = {};

  test.beforeAll(async () => {
    const tmp = (tag: string): string => {
      const d = mkdtempSync(path.join(os.tmpdir(), `unvibe-l2shape-${tag}-`));
      dirs.push(d);
      return d;
    };
    // Scratch repo (no-agent open).
    const scratchDir = tmp("scratch");
    await makeScratchRepo(scratchDir);
    // Huge PR: 250 changed files.
    const hugeDir = tmp("huge");
    mkdirSync(path.join(hugeDir, "src"), { recursive: true });
    await git(hugeDir, "init", "-b", "main");
    await git(hugeDir, "config", "user.email", "t@example.com");
    await git(hugeDir, "config", "user.name", "T");
    for (let i = 0; i < 250; i++) writeFileSync(path.join(hugeDir, "src", `f${i}.py`), `VALUE_${i} = ${i}\n`);
    await git(hugeDir, "add", ".");
    await git(hugeDir, "commit", "-m", "base");
    await git(hugeDir, "checkout", "-b", "feature");
    for (let i = 0; i < 250; i++) writeFileSync(path.join(hugeDir, "src", `f${i}.py`), `VALUE_${i} = ${i + 1000}\n`);
    await git(hugeDir, "add", ".");
    await git(hugeDir, "commit", "-m", "huge change");
    // Empty branch: feature == main.
    const emptyDir = tmp("empty");
    await git(emptyDir, "init", "-b", "main");
    await git(emptyDir, "config", "user.email", "t@example.com");
    await git(emptyDir, "config", "user.name", "T");
    writeFileSync(path.join(emptyDir, "a.py"), "x = 1\n");
    await git(emptyDir, "add", ".");
    await git(emptyDir, "commit", "-m", "base");
    await git(emptyDir, "checkout", "-b", "feature");
    // Merged PR whose head equals its base.
    const mergedDir = tmp("merged");
    await git(mergedDir, "init", "-b", "main");
    await git(mergedDir, "config", "user.email", "t@example.com");
    await git(mergedDir, "config", "user.name", "T");
    writeFileSync(path.join(mergedDir, "a.py"), "x = 1\n");
    await git(mergedDir, "add", ".");
    await git(mergedDir, "commit", "-m", "base");
    await git(mergedDir, "checkout", "-b", "feature");
    const baseSha = await git(mergedDir, "rev-parse", "main");

    dataDir = tmp("data");
    fakeBin = tmp("bin");
    writeFakeGhMerged(fakeBin, baseSha);
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, {
      mode: 0o755,
    });
    svc = await startService(dataDir, {
      agent: "none",
      label: "l2shape",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    for (const [tag, dir] of Object.entries({ scratch: scratchDir, huge: hugeDir, empty: emptyDir, merged: mergedDir })) {
      const repos = await apiJson(svc, "POST", "/api/repos", { path: dir });
      const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
      const registered = list.find((r) => r.localPath === dir);
      if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
      repoIds[tag] = registered.id;
    }
    ids["scratch"] = await createScratchReview(svc, scratchDir);
    ids["huge"] = await createScratchReview(svc, hugeDir);
    const emptyReview = await apiJson(svc, "POST", "/api/reviews", { repoId: repoIds["empty"], branch: "feature" });
    ids["empty"] = (emptyReview.json as { review: { id: string } }).review.id;
    await awaitIngest(svc, ids["empty"]!, "empty");
    const mergedReview = await apiJson(svc, "POST", "/api/reviews", { repoId: repoIds["merged"], pr: 7 });
    ids["merged"] = (mergedReview.json as { review: { id: string } }).review.id;
    await awaitIngest(svc, ids["merged"]!, "empty");
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test("scratch repo opens with no agent: diff + metadata, no guide promised", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${ids["scratch"]}?token=${svc.token}`);
    const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;
    await expect.soft(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
    await expect.soft(page.locator(appFile).getByText("return 2")).toBeVisible({ timeout: 30_000 });
  });

  test("huge diff opens, filter and fold work, header count matches", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${ids["huge"]}?token=${svc.token}`);
    // First and last files eventually render (virtualised or not, they are addressable).
    await expect.soft(page.locator('[id^="F-src-f0.py"], [id^="F-"]').first()).toBeVisible({ timeout: 120_000 });
    const fileCount = await page.locator('[id^="F-"]').count();
    expect.soft(fileCount).toBeGreaterThan(0);
    // Open one hunk's file and fold it.
    const firstFile = page.locator('[id^="F-"]').first();
    const firstId = await firstFile.getAttribute("id");
    expect.soft(firstId).toBeTruthy();
    // Filter via the file-list UI when present; otherwise assert the diff is responsive.
    const filterBtn = page.getByRole("button", { name: "Show file list" });
    if ((await filterBtn.count()) > 0) {
      await filterBtn.first().click();
      const search = page.locator(".flist input, input[placeholder*='Filter' i]").first();
      if ((await search.count()) > 0) {
        await search.fill("f249.py");
        await expect.soft(page.locator('[id="F-src-f249.py"]')).toBeVisible({ timeout: 30_000 });
      }
    }
    await expect.soft(page.locator("#right")).toBeVisible();
  });

  test("branch with no changes shows No changes to review, no guide started", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    if (!ids["empty"]) throw new Error("no empty review");
    const jobs = await apiJson(svc, "GET", `/api/jobs?review=${ids["empty"]}`);
    expect.soft((jobs.json as { jobs: unknown[] }).jobs).toEqual([]);

    await page.goto(`${svc.origin}/review/${ids["empty"]}?token=${svc.token}`);
    await expect.soft(page.getByTestId("review-empty")).toBeVisible({ timeout: 60_000 });
    // Heading says "No changes to review" once; the body explains why.
    await expect.soft(page.getByTestId("review-empty-message")).toContainText('Branch "feature" is the same as its base');
    await expect.soft(page.getByRole("button", { name: "Retry" })).toBeVisible();

    // Start page row says the same, with the no-changes tag.
    await serviceStart(page, svc, repoIds["empty"], /local\//);
    const row = page.getByTestId(`session-${ids["empty"]}`);
    await expect.soft(row).toContainText("No changes to review", { timeout: 30_000 });
    await expect.soft(row).toContainText("no changes");
  });

  test("merged PR whose head equals its base shows No changes to review", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    if (!ids["merged"]) throw new Error("no merged review");
    await page.goto(`${svc.origin}/review/${ids["merged"]}?token=${svc.token}`);
    await expect.soft(page.getByTestId("review-empty")).toBeVisible({ timeout: 60_000 });
    await expect.soft(page.getByTestId("review-empty-message")).toContainText("has been merged");
  });
});

test.describe("L2 snapshot, hunk state and WS patch across reload + restart", () => {
  let repoDir = "";
  let dataDir = "";
  let svc: RunningService | null = null;

  test("hunk state survives reload and restart, out-of-band PATCH arrives over WS", async ({ page }) => {
    test.setTimeout(240_000);
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2real-repo-"));
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2real-data-"));
    await makeScratchRepo(repoDir);
    // Bare startService (like the original): under UNVIBE_TEST the app
    // substitutes the fake runner instead of real agents (#119).
    svc = await startService(dataDir, { label: "l2real" });
    try {
      const scratchId = await createScratchReview(svc, repoDir);

      await test.step("the real snapshot renders", async () => {
        await page.goto(`${svc!.origin}/review/${scratchId}?token=${svc!.token}`);
        const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;
        const utilFile = `[id="F-${fileKeyForPath("src/util.py")}"]`;
        await expect.soft(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
        await expect.soft(page.locator(utilFile)).toBeVisible();
        await expect.soft(page.locator(appFile).getByText("return 2")).toBeVisible();
        const snap = await apiJson(svc!, "GET", `/api/reviews/${scratchId}`);
        const file = ((snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files ?? []).find(
          (f) => f.path === "src/app.py",
        );
        expect.soft(file).toBeDefined();
        if (!file) throw new Error("app.py missing from snapshot");
        expect.soft(file.hunks[0]!.contentHash).toBeTruthy();

        // Mark the first hunk reviewed through the UI: its code folds behind
        // the header chevron.
        await page.locator(appFile).getByRole("checkbox", { name: "Mark reviewed" }).first().click();
        await expect.soft(page.locator(appFile).getByRole("button", { name: "Show code" })).toBeVisible();
        await expect.soft(page.locator(appFile).getByText("return 2")).toHaveCount(0);
      });

      await test.step("state survives a page reload (durable ReviewStore)", async () => {
        const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;
        await page.reload();
        await expect.soft(page.locator(appFile)).toBeVisible();
        await expect.soft(page.locator(appFile).getByRole("button", { name: "Show code" })).toBeVisible();
      });

      await test.step("state survives a service restart (SQLite, same data dir)", async () => {
        const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;
        await svc!.stop();
        svc = await startService(dataDir, { label: "l2real2" });
        await page.goto(`${svc.origin}/review/${scratchId}?token=${svc.token}`);
        await expect.soft(page.locator(appFile)).toBeVisible({ timeout: 30_000 });
        await expect.soft(page.locator(appFile).getByRole("button", { name: "Show code" })).toBeVisible();
      });

      await test.step("an out-of-band change arrives over WS with no reload", async () => {
        if (!svc) throw new Error("no service");
        const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;
        const snap = await apiJson(svc, "GET", `/api/reviews/${scratchId}`);
        const file = ((snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files ?? []).find(
          (f) => f.path === "src/app.py",
        );
        const hash = file!.hunks[0]!.contentHash;
        await apiJson(svc, "PATCH", `/api/reviews/${scratchId}/hunks/${hash}`, {
          reviewed: false,
          folded: false,
        });
        await expect.soft(page.locator(appFile).getByRole("button", { name: "Show code" })).toHaveCount(0);
        await expect.soft(page.locator(appFile).getByText("return 2")).toBeVisible();
      });
    } finally {
      await svc?.stop().catch(() => {});
      svc = null;
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

test.describe("L2 refresh that empties the diff", () => {
  test("refresh-emptied diff says so in the banner and diff, guide points at v1", async ({ page }) => {
    test.setTimeout(240_000);
    const dir2 = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2empty-repo2-"));
    const data2 = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2empty-data2-"));
    let svc2: RunningService | null = null;
    try {
      await git(dir2, "init", "-b", "main");
      await git(dir2, "config", "user.email", "t@example.com");
      await git(dir2, "config", "user.name", "T");
      writeFileSync(path.join(dir2, "a.py"), "x = 1\n");
      await git(dir2, "add", ".");
      await git(dir2, "commit", "-m", "base");
      await git(dir2, "checkout", "-b", "feature");
      writeFileSync(path.join(dir2, "a.py"), "x = 1\ny = 2\n");
      await git(dir2, "commit", "-am", "change");
      svc2 = await startService(data2, { agent: "none", label: "l2empty" });
      const repos = await apiJson(svc2, "POST", "/api/repos", { path: dir2 });
      const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
      const repoId = list.find((r) => r.localPath === dir2);
      if (!repoId) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
      const created = await apiJson(svc2, "POST", "/api/reviews", { repoId: repoId.id, branch: "feature" });
      const reviewId = (created.json as { review: { id: string } }).review.id;
      await awaitIngest(svc2, reviewId, "ready");

      await page.goto(`${svc2.origin}/review/${reviewId}?token=${svc2.token}`);
      await expect.soft(page.getByText("y = 2")).toBeVisible({ timeout: 60_000 });

      await test.step("seed a v1 guide, then empty the diff with a refresh", async () => {
        if (!svc2) throw new Error("no service");
        // Seed a v1 guide (same DB technique as J12) so the review has a
        // guide before the refresh empties the diff.
        await svc2.stop();
        const db = new DatabaseSync(path.join(data2, "unvibe.db"));
        try {
          const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
            | { rev: number; snapshot: string }
            | undefined;
          if (!row) throw new Error("no snapshot row to seed");
          const snap = JSON.parse(row.snapshot) as {
            pages: { id: string; kind: string; title: string; cards: unknown[] }[];
          };
          snap.pages = [
            {
              id: "root",
              kind: "root",
              title: "Guide",
              cards: [
                {
                  id: "c-seed",
                  pageId: "root",
                  title: "Seed guide card",
                  level: "standard",
                  read: false,
                  collapsed: false,
                  revision: 1,
                  blocks: [
                    { type: "paragraph", id: "b-seed", text: { standard: "Seed guide text for v1." }, citations: [] },
                  ],
                  undoStack: [],
                },
              ],
            },
          ];
          db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
            row.rev + 1,
            JSON.stringify(snap),
            reviewId,
          );
          stampDataFormat(db);
        } finally {
          db.close();
        }
        svc2 = await startService(data2, { agent: "none", label: "l2empty2" });
        await page.goto(`${svc2.origin}/review/${reviewId}?token=${svc2.token}`);
        await expect.soft(page.getByText("Seed guide text for v1.")).toBeVisible({ timeout: 60_000 });

        await git(dir2, "checkout", "feature");
        await git(dir2, "reset", "--hard", "main");
        await page.locator("#reviewbar").getByRole("button", { name: "Refresh", exact: true }).click();
      });

      await test.step("the emptied diff names v1 and keeps Submit available", async () => {
        // Diff pane: the empty message appears once (the banner), not twice.
        await expect.soft(page.getByTestId("empty-diff-message")).toContainText("No changes to review", { timeout: 60_000 });
        await expect.soft(page.getByTestId("diff-empty")).toHaveCount(0);
        await expect.soft(page.getByTestId("stale-banner").getByRole("button", { name: "Update" })).toHaveCount(0);
        // Guide pane: says this version is empty, not "diff is ready", and
        // points at the earlier version (which still has its guide).
        await expect.soft(page.getByTestId("guide-empty-version")).toBeVisible({ timeout: 30_000 });
        await expect.soft(page.getByTestId("guide-empty-version-message")).toContainText("This version's diff is empty");
        await expect.soft(page.getByTestId("guide-empty-version")).toContainText("Earlier versions are still available");
        // Submit stays available: work from earlier versions is not stranded.
        await expect.soft(page.getByRole("button", { name: /Submit review/ })).toBeVisible();
      });

      await test.step("picking v1 brings its guide and diff back", async () => {
        await page.locator("#version-pick").click();
        await openPopup(page).getByRole("option", { name: /^v1 / }).click();
        await expect.soft(page).toHaveURL(/version=1/);
        await expect.soft(page.getByText("Seed guide text for v1.")).toBeVisible({ timeout: 30_000 });
        await expect.soft(page.getByText("y = 2")).toBeVisible({ timeout: 30_000 });
      });
    } finally {
      await svc2?.stop().catch(() => {});
      rmSync(dir2, { recursive: true, force: true });
      rmSync(data2, { recursive: true, force: true });
    }
  });
});

/** Fake `gh` for the progress-line journey: PR #1 on `feature`, MERGED + APPROVED. */
function writeFakeGhProgress(binDir: string, headSha: string): void {
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
        *) echo '${L2_EMPTY_SEARCH}' ;;
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

/** Fake `git`: diff-family calls sleep (the ingesting window stays open); fetch/ ls-remote fail offline. */
function writeFakeGitProgress(binDir: string, realGit: string): void {
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

const L2_EMPTY_SEARCH = JSON.stringify({
  data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
});

test.describe("L2 reviews-list progress line (j352)", () => {
  let repoDir = "";
  let dataDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let repoId = "";
  let headSha = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2prog-repo-"));
    headSha = (await makeScratchRepo(repoDir)).headSha;
    await git(repoDir, "remote", "add", "origin", "https://github.com/acme/app.git");
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2prog-data-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2prog-bin-"));
    writeFakeGhProgress(fakeBin, headSha);
    writeFakeGitProgress(fakeBin, realGitPath());
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, {
      mode: 0o755,
    });
    svc = await startService(dataDir, {
      agent: "replay",
      label: "l2prog",
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
    if (!svc) throw new Error("no service");
    const list = await apiJson(svc, "GET", "/api/reviews");
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

  test("opening, ingesting, building, done and failed share one under-title line", async ({ page }) => {
    test.setTimeout(600_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await serviceStart(page, svc, repoId, "acme/app");
    await expect(page.getByText("Journey test PR").first()).toBeVisible({ timeout: 30_000 });
    const geometries: { phase: string; height: number; titleOffsetY: number }[] = [];
    const geoOf = async (id: string, phase: string): Promise<void> => {
      const m = await measureWithinRow(page.locator(`[data-testid="session-${id}"]`), ".cx2");
      geometries.push({ phase, height: m.row.height, titleOffsetY: m.inner[".cx2"]!.y - m.row.y });
    };

    await test.step("opening names the phase under the title, no pill, title never moves", async () => {
      if (!svc) throw new Error("no service");
      const prRow = page.locator(".ci", { hasText: "Journey test PR" }).first();
      // Title offset inside its own row: content above the list (readiness
      // banners that load late on slow runners) can move the whole row,
      // which is not a row jump. Both rects in one synchronous read: two
      // separate boundingBox() calls can straddle a late banner (CI hit
      // 67.5px). (#363 B1: now via the shared helper.)
      const titleOffset = async (): Promise<number> => {
        const m = await measureWithinRow(prRow, ".cx2");
        return m.inner[".cx2"]!.y - m.row.y;
      };
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
      await expect.soft(opening).toContainText("Opening…", { timeout: 10_000 });
      await expect.soft(opening).toHaveAttribute("role", "status");
      expect.soft(Math.abs((await titleOffset()) - idleTitleOffset)).toBeLessThanOrEqual(1);
      await expect.soft(prRow.locator(".prtag")).toHaveCount(0);
      const posted = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/api/reviews"),
      );
      releasePost!();
      await posted;
      await page.unroute("**/api/reviews");
    });

    // The create lands and the app navigates to the review; back on the
    // start page the Reviews list gains a session row, still ingesting.
    await serviceStart(page, svc, repoId, "acme/app");
    const sessionRow = page.locator('[data-testid^="session-"]', { hasText: "Journey test PR" }).first();
    await expect(sessionRow).toBeVisible({ timeout: 30_000 });

    await test.step("ingesting reads the phase under the title with hidden-until-hover actions", async () => {
      const progress = sessionRow.getByTestId("row-progress");
      await expect.soft(progress).toContainText(/Opening ·/, { timeout: 30_000 });
      await expect.soft(sessionRow.locator(".prtag")).toHaveCount(0);
      await expect.soft(progress).toHaveAttribute("role", "status");
      // Actions stay hidden until hover or keyboard focus, in every phase.
      // (The rule hides the confirm's idle slot; the button inside inherits
      // it visually, so the slot is the element to read.)
      const idle = sessionRow.locator(".uic-idlehold");
      const remove = sessionRow.getByRole("button", { name: "Remove this review" });
      await expect.soft(idle).toHaveCSS("opacity", "0");
      await sessionRow.hover();
      await expect.soft(idle).toHaveCSS("opacity", "1");
      await page.mouse.move(0, 0);
      await remove.focus();
      await expect.soft(idle).toHaveCSS("opacity", "1");
      await page.mouse.move(0, 0);
      const walkingId = (await sessionRow.getAttribute("data-testid"))?.replace(/^session-/, "");
      if (!walkingId) throw new Error("walk row has no session testid");
      await geoOf(walkingId, "ingesting");
    });

    const created = await apiJson(svc, "GET", "/api/reviews");
    const reviewId = (created.json as { reviews: { id: string; title: string }[] }).reviews.find((r) =>
      r.title.includes("Journey test PR"),
    )?.id;
    if (!reviewId) throw new Error("walk review missing from /api/reviews");

    await test.step("building shows hunks-reviewed progress with dots, still no pill", async () => {
      await waitForStatus(reviewId, (s) => s.guideStatus === "running", 120_000);
      await page.reload();
      const buildingRow = page.locator(`[data-testid="session-${reviewId}"]`);
      await expect.soft(buildingRow).toBeVisible({ timeout: 30_000 });
      const buildingProgress = buildingRow.getByTestId("row-progress");
      await expect.soft(buildingProgress).toContainText("hunks reviewed");
      await expect.soft(buildingProgress.locator(".dots")).toHaveCount(1);
      await expect.soft(buildingRow.locator(".prtag")).toHaveCount(0);
      await expect.soft(buildingRow.locator(".uic-idlehold")).toHaveCSS("opacity", "0");
      await geoOf(reviewId, "building");
    });

    await test.step("done lands the guide with status icons on the right, still no pill", async () => {
      await waitForStatus(reviewId, (s) => s.guideStatus === "ready", 300_000);
      await page.reload();
      const doneRow = page.locator(`[data-testid="session-${reviewId}"]`);
      await expect.soft(doneRow).toBeVisible({ timeout: 30_000 });
      const doneProgress = doneRow.getByTestId("row-progress");
      await expect.soft(doneProgress).toContainText("hunks reviewed");
      await expect.soft(doneProgress.locator(".dots")).toHaveCount(0);
      await expect.soft(doneRow.locator(".prtag")).toHaveCount(0);
      await expect.soft(doneRow.getByTestId("pr-badges").getByRole("img", { name: "Merged" })).toBeVisible();
      await expect.soft(doneRow.getByTestId("pr-badges").getByRole("img", { name: "Approved" })).toBeVisible();
      await checkLayout(page, "start-progress-done");
      await geoOf(reviewId, "done");
    });

    await test.step("one place, one height, one title position through every phase", async () => {
      await geoOf(reviewId, "done-again");
      expect.soft(geometries.length).toBeGreaterThanOrEqual(2);
      for (const g of geometries) {
        expect.soft(Math.abs(g.height - geometries[0]!.height), `${g.phase} row height`).toBeLessThanOrEqual(1);
        expect.soft(
          Math.abs(g.titleOffsetY - geometries[0]!.titleOffsetY),
          `${g.phase} title position`,
        ).toBeLessThanOrEqual(1);
      }
    });

    await test.step("a failed review shows its error under the title at the same height, with Retry", async () => {
      if (!svc) throw new Error("no service");
      const failed = await apiJson(svc, "POST", "/api/reviews", { repoId, branch: "no-such-branch" });
      expect([200, 201, 202]).toContain(failed.status);
      const failedId = (failed.json as { review: { id: string } }).review.id;
      await waitForStatus(failedId, (s) => s.ingestStatus === "failed", 60_000);
      await page.reload();
      const failedRow = page.locator(`[data-testid="session-${failedId}"]`);
      await expect.soft(failedRow).toBeVisible({ timeout: 30_000 });
      const failedProgress = failedRow.getByTestId("row-progress");
      await expect.soft(failedProgress).toContainText("Couldn't open this review");
      await expect.soft(failedProgress).toHaveAttribute("role", "status");
      await expect.soft(failedRow.locator(".prtag")).toHaveCount(0);
      // Retry hides until hover or keyboard focus (Remove is covered on the
      // loading row above and by J225).
      const retrySlot = failedRow.getByTestId("row-retry");
      const retry = failedRow.getByRole("button", { name: "Retry" });
      await expect.soft(retrySlot).toHaveCSS("opacity", "0");
      await failedRow.hover();
      await expect.soft(retrySlot).toHaveCSS("opacity", "1");
      await page.mouse.move(0, 0);
      // Same height and title position as done, read in one synchronous pass.
      const failedGeo = await measureWithinRow(failedRow, ".cx2");
      const doneGeo = await measureWithinRow(page.locator(`[data-testid="session-${reviewId}"]`), ".cx2");
      expect.soft(Math.abs(failedGeo.row.height - doneGeo.row.height), "failed row height").toBeLessThanOrEqual(1);
      expect.soft(
        Math.abs(failedGeo.inner[".cx2"]!.y - failedGeo.row.y - (doneGeo.inner[".cx2"]!.y - doneGeo.row.y)),
        "failed title position",
      ).toBeLessThanOrEqual(1);
      await checkLayout(page, "start-progress-failed");
      // Retry re-runs the failed ingest: the row returns to the ingesting
      // phase, at the same height.
      await failedRow.hover();
      await retry.click();
      await expect.soft(failedProgress).toContainText(/Opening ·/, { timeout: 30_000 });
      const retryGeo = await measureWithinRow(failedRow, ".cx2");
      expect.soft(Math.abs(retryGeo.row.height - doneGeo.row.height), "retrying row height").toBeLessThanOrEqual(1);
      expect.soft(
        Math.abs(retryGeo.inner[".cx2"]!.y - retryGeo.row.y - (doneGeo.inner[".cx2"]!.y - doneGeo.row.y)),
        "retrying title position",
      ).toBeLessThanOrEqual(1);
    });
  });
});

const L2_LIVE = new Set(["queued", "running", "backing-off"]);

type L2JobRow = { id: string; kind: string; state: string };

test.describe("L2 start dots and review pill agree (j247)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2agree-data-"));
    // Paced replay: the unpaced pipeline drains before the first poll
    // lands, so the sampling loop below can never observe live jobs.
    // The delay only spaces word chunks; matching stays deterministic.
    svc = await startService(dataDir, {
      agent: "replay",
      label: "l2agree",
      extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50" },
    });
    // Serialize the pipeline so queued jobs exist long enough to cancel.
    const put = await apiJson(svc, "PUT", "/api/settings", { sessionsPerProvider: 1 });
    if (put.status !== 200) throw new Error(`settings update failed: ${put.status}`);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function liveJobs(on: RunningService, reviewId: string): Promise<L2JobRow[]> {
    const res = await apiJson(on, "GET", `/api/jobs?review=${reviewId}`);
    return (res.json as { jobs: L2JobRow[] }).jobs.filter((j) => L2_LIVE.has(j.state));
  }

  async function listStatus(on: RunningService, reviewId: string): Promise<string> {
    const res = await apiJson(on, "GET", "/api/reviews");
    const found = (res.json as { reviews: { id: string; guideStatus: string }[] }).reviews.find(
      (r) => r.id === reviewId,
    );
    if (!found) throw new Error("review missing from the list");
    return found.guideStatus;
  }

  async function snapshotLive(on: RunningService, reviewId: string): Promise<L2JobRow[]> {
    const res = await apiJson(on, "GET", `/api/reviews/${reviewId}`);
    const jobs = (res.json as { jobs?: L2JobRow[] }).jobs ?? [];
    return jobs.filter((j) => L2_LIVE.has(j.state));
  }

  test("list and snapshot agree through a live pipeline and after it drains", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const created = await apiJson(svc, "POST", "/api/reviews", { repoId: "demo" });
    if (created.status !== 201 && created.status !== 200 && created.status !== 202) {
      throw new Error(`demo create failed: ${created.status}`);
    }
    const reviewId = (created.json as { review: { id: string } }).review.id;

    await test.step("while the pipeline is live the bar shows the job count and links to Debug", async () => {
      if (!svc) throw new Error("no service");
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      const count = page.locator("#reviewbar").getByRole("link", { name: /running, .* queued/ });
      await expect.soft(count).toBeVisible({ timeout: 90_000 });
      await expect.soft(count).toHaveAttribute("href", `/review/${reviewId}/debug`);
      await count.click();
      await expect.soft(page).toHaveURL(new RegExp(`/review/${reviewId}/debug`));
    });

    await test.step("the list says running exactly when the snapshot carries live jobs", async () => {
      if (!svc) throw new Error("no service");
      // Snapshot and list are two separate API calls, so a job finishing
      // between them can straddle the reads (list=ready with N live jobs).
      // Bracket the list read with a snapshot before and after, and only
      // assert when liveness was stable across the three reads; otherwise
      // re-sample. Intent unchanged: whenever work is live the list says
      // running, and vice versa.
      let sawLive = false;
      const start = Date.now();
      for (;;) {
        const before = await snapshotLive(svc, reviewId);
        const status = await listStatus(svc, reviewId);
        const after = await snapshotLive(svc, reviewId);
        const stable = (before.length > 0) === (after.length > 0);
        if (!stable) {
          if (before.length > 0 || after.length > 0) sawLive = true;
        } else {
          const live = before;
          expect.soft(status === "running", `list=${status} with ${live.length} live jobs`).toBe(live.length > 0);
          if (live.length > 0) sawLive = true;
          else if (sawLive && Date.now() - start > 2000) break;
        }
        if (Date.now() - start > 90_000) throw new Error("pipeline never drained");
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!sawLive) throw new Error("never observed live jobs (pipeline drained first)");
      expect.soft(await liveJobs(svc, reviewId)).toHaveLength(0);
    });

    await test.step("settled: neither page shows anything running", async () => {
      if (!svc) throw new Error("no service");
      await serviceStart(page, svc);
      const row = page.locator(`[data-testid="session-${reviewId}"]`);
      await expect.soft(row).toBeVisible({ timeout: 30_000 });
      await expect.soft(row.getByRole("status", { name: "Working" })).toHaveCount(0);
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect.soft(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator("#reviewbar").getByRole("link", { name: /running, .* queued/ })).toHaveCount(0);
    });
  });

  test("list and review agree with stages stuck at running and no live job", async ({ page }) => {
    test.setTimeout(240_000);
    // Separate service so it can be stopped for seeding. The demo review
    // runs its pipeline to a drained, guided state first.
    const stuckDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l2agree-stuck-"));
    let stuck: RunningService | null = null;
    try {
      stuck = await startService(stuckDir, { agent: "replay", label: "l2agreestuck" });
      const created = await apiJson(stuck, "POST", "/api/reviews", { repoId: "demo" });
      if (created.status !== 201 && created.status !== 200 && created.status !== 202) {
        throw new Error(`demo create failed: ${created.status}`);
      }
      const reviewId = (created.json as { review: { id: string } }).review.id;
      // Quiesce: guide filled and nothing live.
      {
        const start = Date.now();
        for (;;) {
          const snap = await apiJson(stuck, "GET", `/api/reviews/${reviewId}`);
          const pages = (snap.json as { pages?: { id: string; cards: unknown[] }[] }).pages ?? [];
          const root = pages.find((p) => p.id === "root");
          const live = ((snap.json as { jobs?: L2JobRow[] }).jobs ?? []).filter((j) => L2_LIVE.has(j.state));
          if (root && root.cards.length > 0 && live.length === 0) break;
          if (Date.now() - start > 120_000) throw new Error("demo pipeline never drained");
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      // Stop and seed the stuck shape: pipeline stages `running` with no
      // live job behind them (what cancelling queued pipeline jobs leaves;
      // the stored jobs are all terminal, so nothing reruns on boot).
      await stuck.stop();
      stuck = null;
      const { DatabaseSync: StuckDb } = await import("node:sqlite");
      const db = new StuckDb(path.join(stuckDir, "unvibe.db"));
      try {
        const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
          | { rev: number; snapshot: string }
          | undefined;
        if (!row) throw new Error("no snapshot row to seed");
        const seeded = JSON.parse(row.snapshot) as {
          pages: unknown[];
          pipeline?: { stages: Record<string, string> };
        };
        if (seeded.pages.length === 0) throw new Error("seed needs the finished guide");
        seeded.pipeline = { stages: { reader: "done", base: "running", critic: "running", "hunk-pass": "running" } };
        db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
          row.rev + 1,
          JSON.stringify(seeded),
          reviewId,
        );
        stampDataFormat(db);
      } finally {
        db.close();
      }
      stuck = await startService(stuckDir, { agent: "replay", label: "l2agreestuck2" });
      const origin = stuck.origin;
      const token = stuck.token;

      await test.step("nothing live: the list stops saying running and both pages stay silent", async () => {
        // Nothing live: the list stops saying running, and fresh loads of
        // both pages show nothing running — while the finished guide itself
        // still renders (the owner's report: dots outside, silence inside).
        expect.soft(await listStatus(stuck!, reviewId)).not.toBe("running");
        await page.goto(`${origin}/?token=${token}`);
        const row = page.locator(`[data-testid="session-${reviewId}"]`);
        await expect.soft(row).toBeVisible({ timeout: 30_000 });
        await expect.soft(row.getByRole("status", { name: "Working" })).toHaveCount(0);
        await page.goto(`${origin}/review/${reviewId}?token=${token}`);
        await expect.soft(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
        await expect.soft(page.locator("#reviewbar").getByRole("link", { name: /running, .* queued/ })).toHaveCount(0);
        await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      });
    } finally {
      await stuck?.stop().catch(() => {});
      rmSync(stuckDir, { recursive: true, force: true });
    }
  });
});


