/**
 * L10 — Failure and recovery (#363 package A).
 *
 * The service and UI under failure: a SIGKILL mid-answer restarts onto
 * the same data dir with a recoverable thread (#203/#204 pinned chrome,
 * #336 toolbar discipline), the data-format notice frames Export/Reset
 * with the data moved aside and never deleted (#311, traces kept), Go
 * back switches builds through the update helper with data untouched,
 * and removing a review mid-build keeps the service up (detached jobs
 * settle quietly, another review opens).
 *
 * Boots: one replay service with in-test restarts (mid-answer), three
 * sequential services (notice with drafts / without drafts / go-back
 * drill), one stretched-replay service (remove mid-build).
 *
 * Absorbs: `j6-restart-mid-answer`, `j311-data-reset` (3 tests),
 * `j354-remove-while-building`.
 *
 * Guards kept: #311 (framed notice, disabled bar, Export with count,
 * Reset moves aside, go-back command, traces kept); #203/#204 (pinned
 * thread while writing, no toolbar/follow-up box mid-flight); #336
 * (toolbar hidden until hover); #346 (inline confirm + Confirmed flash).
 *
 * Brittleness fixed here (#363 §4): j6's fixed 500 ms sleeps (B2 — the
 * post-kill sleep is a port-death poll, the outcome loop is an
 * `expect.poll` on thread state), and the go-back command's pinned
 * version (B3 — asserts the install-command shape, not the version).
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { DATA_FORMAT } from "@unvibe/shared";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview, fakeServicePath, makeScratchRepo, realGitPath, writeFakeGitOffline, writeFakeShell } from "./journey-helpers.js";

test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Load the start page (optionally with this repo pre-selected). */
async function serviceStart(page: Page, svc: RunningService): Promise<void> {
  await page.goto(`${svc.origin}/?token=${svc.token}`);
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
}

test.describe("L10 restart mid-answer (j6)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l10-data-"));
    // Slow the replay stream so the answer is reliably mid-flight at the kill.
    svc = await startService(dataDir, {
      agent: "replay",
      label: "l10kill",
      extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
    });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("killed mid-answer, restart reopens review with a recoverable thread", async ({ page }) => {
    test.setTimeout(420_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    await test.step("an Explain pins inline and writes with pinned-only chrome", async () => {
      // Issue #341: the re-recorded central card has no "fast path" text.
      await selectText(page, "#C-central", "matches optional whitespace");
      await page.locator('#selbar [data-act="explain"]').click();
      const exp = page.locator("#C-central section.ithread[data-thread]").first();
      await expect.soft(exp).toBeVisible({ timeout: 15_000 });

      // #203 + #204: while the reply is being written the pinned thread
      // shows only its header and the writing state — no per-reply toolbar,
      // no follow-up box — and it is not floating.
      await expect.soft(exp).not.toHaveClass(/floating/);
      await expect.soft(exp.locator(".working")).toBeVisible({ timeout: 10_000 });
      await expect.soft(exp.locator(".ctl")).toHaveCount(0);
      await expect.soft(exp.getByPlaceholder(/Ask a follow-up/)).toHaveCount(0);
      await expect.soft(exp.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
    });

    await test.step("SIGKILL mid-stream, restart on the same data dir", async () => {
      if (!svc) throw new Error("no service");
      // Hard kill mid-stream, then restart on the same data dir (the
      // restart binds a new ephemeral port, so navigate by the new
      // origin below). Wait for the dead port, not a fixed delay (#363 B2).
      const deadOrigin = svc.origin;
      svc.killHard();
      await expect
        .poll(
          async () => {
            try {
              await fetch(deadOrigin);
              return "up";
            } catch {
              return "down";
            }
          },
          { timeout: 30_000 },
        )
        .toBe("down");
      svc = await startService(dataDir, {
        agent: "replay",
        label: "l10kill2",
        extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
      });

      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect.soft(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 60_000 });
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      // The interrupted thread is completed, resumable, or clearly marked — never silently empty forever.
      const expAfter = page.locator('#C-central section.ithread[data-thread]').first();
      if ((await expAfter.count()) > 0) {
        await expect
          .poll(
            async () => {
              const text = await expAfter.innerText().catch(() => "");
              return text.trim().length > 0;
            },
            { timeout: 60_000 },
          )
          .toBe(true);
      }
      // #204/#203 after the restart: the thread is still pinned inline, and
      // while its reply is being written again it shows no toolbar or
      // follow-up box.
      if ((await expAfter.count()) > 0) {
        await expect.soft(expAfter).not.toHaveClass(/floating/, { timeout: 30_000 });
        if ((await expAfter.locator(".working").count()) > 0) {
          await expect.soft(expAfter.locator(".ctl")).toHaveCount(0);
          await expect.soft(expAfter.getByPlaceholder(/Ask a follow-up/)).toHaveCount(0);
        }
      }
    });

    await test.step("a second restart settles or fails cleanly with Retry", async () => {
      if (!svc) throw new Error("no service");
      // Second restart is a no-op: review still opens, nothing duplicated.
      // (Fast replay this time, so the recovered reply can settle.)
      await svc.stop();
      svc = await startService(dataDir, { agent: "replay", label: "l10kill3" });
      const origin = svc.origin;
      const token = svc.token;
      await page.goto(`${origin}/review/${reviewId}?token=${token}`);
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
      const settled = page.locator('#C-central section.ithread[data-thread]').first();
      await expect.soft(settled).not.toHaveClass(/floating/, { timeout: 30_000 });
      // The recovered reply either completes (toolbar + follow-up box back,
      // #203) or fails with Retry (and still no toolbar/follow-up box).
      // Poll the thread state, not a fixed delay (#363 B2).
      await expect
        .poll(
          async () => {
            if ((await settled.getByRole("button", { name: "Retry" }).count()) > 0) return "retry";
            if ((await settled.locator(".ctl").count()) > 0) return "ready";
            return "waiting";
          },
          { timeout: 180_000 },
        )
        .not.toBe("waiting");
      // Settled by the poll above: read the outcome once.
      const outcome =
        (await settled.getByRole("button", { name: "Retry" }).count()) > 0 ? "retry" : "ready";
      expect.soft(outcome, "recovered thread neither completed nor showed Retry").not.toBe("waiting");
      if (outcome === "retry") {
        await expect.soft(settled.locator(".ctl")).toHaveCount(0);
        await expect.soft(settled.getByPlaceholder(/Ask a follow-up/)).toHaveCount(0);
        // Retry is the way forward: it refills the reply, and then the
        // follow-up box appears (#336: the toolbar itself stays hidden
        // until hovered, so landed is blocks with no working marker).
        await settled.getByRole("button", { name: "Retry" }).click();
        await expect.soft(settled.locator(".exp-b").last()).not.toBeEmpty({ timeout: 120_000 });
        await expect.soft(settled.locator(".working")).toHaveCount(0, { timeout: 30_000 });
        await expect.soft(settled.getByPlaceholder(/Ask a follow-up/)).toBeVisible({ timeout: 30_000 });
      } else {
        await expect.soft(settled.getByPlaceholder(/Ask a follow-up/)).toBeVisible({ timeout: 30_000 });
      }
    });
  });
});

function snapshotJson(withDraft: boolean): string {
  return JSON.stringify({
    review: { id: "rv_old", repoId: "repo", branch: "feature", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [{ fileKey: "fk1", path: "src/app.py", category: "source", hunks: [] }],
    ingest: { status: "ready" },
    pages: [{ id: "root", kind: "root", title: "Guide title", cards: [] }],
    annotations: withDraft
      ? [
          {
            type: "thread",
            id: "t1",
            anchor: { host: { kind: "diff-line", fileKey: "fk1", line: 2 }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
            open: true,
            pinned: false,
            post: true,
            replies: [
              {
                id: "r1",
                kind: "comment",
                who: "you",
                question: null,
                blocks: [{ type: "paragraph", id: "b1", text: { standard: "Unposted draft text" }, citations: [] }],
                level: "standard",
                revision: 1,
                undoStack: [],
              },
            ],
          },
        ]
      : [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: {},
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  });
}

async function seedDataDir(withDraft: boolean): Promise<string> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l10reset-data-"));
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  db.exec(
    "CREATE TABLE review_snapshots (review_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, snapshot JSON NOT NULL, updated_at INTEGER NOT NULL)",
  );
  db.prepare("INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?)").run(
    "rv_old",
    1,
    snapshotJson(withDraft),
    0,
  );
  db.close();
  return dataDir;
}

function seedPreviousOutcome(dataDir: string): void {
  mkdirSync(path.join(dataDir, "update"), { recursive: true });
  writeFileSync(
    path.join(dataDir, "update", "outcome.json"),
    JSON.stringify({ status: "ok", from: "preview/old", to: "release", finishedAt: "2026-10-29T00:00:00.000Z", fromVersion: "0.0.1-old" }) + "\n",
  );
}

function cleanupReset(dataDir: string): void {
  const parent = path.dirname(dataDir);
  for (const e of readdirSync(parent)) {
    if (e.startsWith(`${path.basename(dataDir)}.bak-`)) rmSync(path.join(parent, e), { recursive: true, force: true });
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(`${dataDir}-traces`, { recursive: true, force: true });
}

function asideDirs(dataDir: string): string[] {
  const parent = path.dirname(dataDir);
  return readdirSync(parent).filter((e) => e.startsWith(`${path.basename(dataDir)}.bak-`));
}

test.describe("L10 data-format notice (j311)", () => {
  test("with drafts, without drafts, and go back", async ({ page }) => {
    test.setTimeout(240_000);

    await test.step("with drafts: framed notice, disabled bar, Export with count, Reset moves data aside", async () => {
      const dataDir = await seedDataDir(true);
      seedPreviousOutcome(dataDir);
      const svc = await startService(dataDir, { label: "l10reset1" });
      try {
        const status = await apiJson(svc, "GET", "/api/data-format");
        expect(status.status).toBe(200);
        expect(status.json as unknown as Record<string, unknown>).toMatchObject({
          state: "mismatch",
          expected: DATA_FORMAT,
          stored: null,
          outboxCount: 1,
          previousRef: "preview/old",
          previousVersion: "0.0.1-old",
        });

        await page.goto(`${svc.origin}/?token=${svc.token}`);
        const notice = page.getByTestId("data-format-notice");
        await expect.soft(notice).toBeVisible({ timeout: 30_000 });
        await expect.soft(notice).toContainText("This version can't read your existing reviews");
        // Inside the app frame: top bar and disco art are present.
        await expect.soft(page.locator("header.top")).toBeVisible();
        await expect.soft(page.locator(".start-watermark img")).toBeAttached();
        // The normal UI is not rendered behind the notice.
        await expect.soft(page.getByText("Open a PR by URL or number")).toHaveCount(0);

        // Every other control is visible but disabled and inert.
        const settings = page.getByRole("link", { name: "Settings" });
        await expect.soft(settings).toBeVisible();
        await expect.soft(settings).toHaveAttribute("aria-disabled", "true");
        await expect.soft(settings).toHaveAttribute("tabindex", "-1");
        const urlBefore = page.url();
        // Force: Playwright's click waits for an enabled element, and
        // aria-disabled is exactly what makes this link inert.
        await settings.click({ force: true });
        await expect.soft(notice).toBeVisible();
        expect.soft(page.url()).toBe(urlBefore);

        // Go back is offered with the recorded version (not clicked here).
        await expect.soft(notice.getByRole("button", { name: "Go back to 0.0.1-old" })).toBeVisible();

        // #311 follow-up + #362 named keep (dataReset): the cards' outer
        // edges line up with the text column (heading + intro paragraph)
        // within 1px, wide and narrow (1440 and 960). One synchronous
        // read per width (#363 B1).
        for (const width of [1440, 960]) {
          await page.setViewportSize({ width, height: 900 });
          const edges = await page.evaluate(() => {
            const box = (el: Element) => {
              const r = el.getBoundingClientRect();
              return { left: r.left, right: r.right };
            };
            const h1 = document.querySelector("#data-format-notice h1, [data-testid='data-format-notice'] h1");
            const doc = document.querySelector("[data-testid='data-format-notice']");
            if (!h1 || !doc) throw new Error("notice pieces missing");
            const intro = doc.querySelector("p");
            const cards = [...doc.querySelectorAll(".ui-card")];
            if (!intro || cards.length === 0) throw new Error("notice pieces missing");
            return { h1: box(h1), intro: box(intro), cards: cards.map(box) };
          });
          for (const card of [...edges.cards, edges.intro]) {
            expect.soft(Math.abs(card.left - edges.h1.left)).toBeLessThanOrEqual(1);
            expect.soft(Math.abs(card.right - edges.h1.right)).toBeLessThanOrEqual(1);
          }
        }
        await page.setViewportSize({ width: 1440, height: 900 });

        // Export shows the draft count and downloads the drafts.
        const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
        await notice.getByRole("button", { name: "Export 1 unposted draft" }).click();
        const download = await downloadPromise;
        expect.soft(download.suggestedFilename()).toBe("unvibe-outbox.md");
        const file = await download.path();
        if (!file) throw new Error("no download path");
        const md = readFileSync(file, "utf8");
        expect.soft(md).toContain("Unposted draft text");
        expect.soft(md).toContain("src/app.py:2");
        await expect.soft(notice).toContainText("Exported 1 draft");

        // Reset keeps the locally recorded performance traces (#356).
        await expect.soft(notice).toContainText("Recorded performance traces are kept");

        // Reset: confirm, then the same service comes back fresh.
        await notice.getByRole("button", { name: "Reset and start fresh" }).click();
        await notice.getByRole("button", { name: "Confirm reset and start fresh" }).click();
        await expect.soft(page.getByText("Open a PR by URL or number")).toBeVisible({ timeout: 60_000 });
        await expect.soft(page.getByTestId("data-format-notice")).toHaveCount(0);

        const after = await apiJson(svc, "GET", "/api/data-format");
        expect(after.json as unknown as Record<string, unknown>).toMatchObject({ state: "match", expected: DATA_FORMAT, stored: DATA_FORMAT });

        // Nothing was deleted: the old DB sits in a dated sibling dir.
        expect.soft(asideDirs(dataDir)).toHaveLength(1);
        expect.soft(existsSync(path.join(path.dirname(dataDir), asideDirs(dataDir)[0]!, "unvibe.db"))).toBe(true);
        expect.soft(existsSync(path.join(dataDir, "unvibe.db"))).toBe(true);
      } finally {
        await svc.stop().catch(() => {});
        cleanupReset(dataDir);
      }
    });

    await test.step("without drafts: no Export card, only Go back / Reset; deep links land on the notice", async () => {
      const dataDir = await seedDataDir(false);
      const svc = await startService(dataDir, { label: "l10reset2" });
      try {
        const status = await apiJson(svc, "GET", "/api/data-format");
        expect(status.json as unknown as Record<string, unknown>).toMatchObject({ state: "mismatch", outboxCount: 0, previousRef: null });

        // A deep link to a review lands on the same notice.
        await page.goto(`${svc.origin}/review/rv_old?token=${svc.token}`);
        const notice = page.getByTestId("data-format-notice");
        await expect.soft(notice).toBeVisible({ timeout: 30_000 });
        await expect.soft(notice.getByRole("button", { name: /Export .*unposted draft/ })).toHaveCount(0);
        await expect.soft(notice).not.toContainText("Export your Outbox first");
        await expect.soft(notice.getByRole("button", { name: "Reset and start fresh" })).toBeVisible();
        // Unknown previous build: the terminal install command shows
        // (assert the shape, not the pinned version, #363 B3).
        await expect.soft(notice.getByTestId("go-back-command")).toHaveText(/npm install -g github:indigoviolet\/unvibe#v\d+\.\d+\.\d+/);

        await notice.getByRole("button", { name: "Reset and start fresh" }).click();
        await notice.getByRole("button", { name: "Confirm reset and start fresh" }).click();
        await expect.soft(page.getByText("Open a PR by URL or number")).toBeVisible({ timeout: 60_000 });
        expect.soft(asideDirs(dataDir)).toHaveLength(1);
      } finally {
        await svc.stop().catch(() => {});
        cleanupReset(dataDir);
      }
    });

    await test.step("go back: switches to the previous build through the helper, data untouched", async () => {
      const dataDir = await seedDataDir(true);
      seedPreviousOutcome(dataDir);
      writeFileSync(
        path.join(dataDir, "update", "fake-channels.json"),
        JSON.stringify([
          { ref: "release", kind: "release", version: "0.0.2-new", commit: null, sourceBranch: null, builtAt: null, dataFormat: 1 },
          { ref: "preview/old", kind: "preview", version: "0.0.1-old", commit: null, sourceBranch: "old", builtAt: null, dataFormat: 1 },
        ]),
      );
      const dbBefore = readFileSync(path.join(dataDir, "unvibe.db"));
      // Scratch HOME: the helper must never see the real login unit (it
      // would restart through systemd against the real install).
      const scratchHome = mkdtempSync(path.join(os.tmpdir(), "unvibe-l10-home-"));
      const svc = await startService(dataDir, {
        label: "l10reset3",
        extraEnv: { UNVIBE_UPDATER_BACKEND: "fake", UNVIBE_TEST: "1", HOME: scratchHome },
      });
      try {
        await page.goto(`${svc.origin}/?token=${svc.token}`);
        const notice = page.getByTestId("data-format-notice");
        await expect.soft(notice).toBeVisible({ timeout: 30_000 });
        await notice.getByRole("button", { name: "Go back to 0.0.1-old" }).click();

        // The helper records the completed switch back.
        const outcomeFile = path.join(dataDir, "update", "outcome.json");
        await expect
          .poll(
            () => {
              try {
                const o = JSON.parse(readFileSync(outcomeFile, "utf8")) as { from: string; to: string; status: string };
                return `${o.from}->${o.to}:${o.status}`;
              } catch {
                return "unreadable";
              }
            },
            { timeout: 120_000 },
          )
          .toBe("release->preview/old:ok");
        expect.soft(readFileSync(path.join(dataDir, "update", "current-ref"), "utf8").trim()).toBe("preview/old");

        // The data was not touched: same DB bytes, nothing moved aside.
        expect.soft(readFileSync(path.join(dataDir, "unvibe.db")).equals(dbBefore)).toBe(true);
        expect.soft(asideDirs(dataDir)).toEqual([]);

        // The restarted (same-binary) service still shows the notice: in
        // this drill only the fake channel moved, so the format gate is
        // unchanged — what matters is the switch happened with data intact.
        await expect.soft(page.getByTestId("data-format-notice")).toBeVisible({ timeout: 60_000 });
      } finally {
        await svc.stop().catch(() => {});
        rmSync(scratchHome, { recursive: true, force: true });
        cleanupReset(dataDir);
      }
    });
  });
});

test.describe("L10 remove while building (j354)", () => {
  let repoDir = "";
  let dataDir = "";
  let fakeBin = "";
  let svc: RunningService | null = null;
  let repoId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l10354-repo-"));
    await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l10354-data-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l10354-bin-"));
    // Fake `gh`: nothing here uses a PR source; keep repo/PR surfaces quiet.
    const script = `#!/bin/sh
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  echo '{"data":{"search":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}'
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo '{"login":"author"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "e2e stub: logged in as author"; exit 0; fi
case "$*" in *pulls/1/comments*) echo '[]'; exit 0 ;; esac
echo "fake gh: unexpected call: $*" >&2; exit 1
`;
    writeFileSync(path.join(fakeBin, "gh"), script, { mode: 0o755 });
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "replay",
      label: "l10354",
      extraEnv: {
        SHELL: fakeShell,
        PATH: fakeServicePath(fakeBin),
        // Stretch the replay so the guide is still building when Remove
        // is clicked; the detached jobs then settle after the delete.
        UNVIBE_REPLAY_DELAY_MS: "500",
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

  async function guideStatus(id: string): Promise<string> {
    if (!svc) throw new Error("no service");
    const list = await apiJson(svc, "GET", "/api/reviews");
    const found = (list.json as { reviews: { id: string; guideStatus: string }[] }).reviews.find((r) => r.id === id);
    if (!found) throw new Error(`review ${id} missing from /api/reviews`);
    return found.guideStatus;
  }

  async function waitForGuide(id: string, want: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await guideStatus(id)) === want) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for review ${id} guide=${want}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async function waitForLog(text: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const log = readFileSync(svc!.logFile, "utf8");
      if (log.includes(text)) return log;
      if (Date.now() > deadline) throw new Error(`timed out waiting for service log to contain: ${text}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  test("remove mid-build keeps the service up; another review opens", async ({ page }) => {
    test.setTimeout(600_000);
    if (!svc) throw new Error("no service");

    await test.step("a branch review builds, then Remove drops it from the list", async () => {
      if (!svc) throw new Error("no service");
      // Start a branch review; wait until the guide is really building.
      const created = await apiJson(svc, "POST", "/api/reviews", { repoId, branch: "feature" });
      expect(created.status).toBe(202);
      const doomedId = (created.json as { review: { id: string } }).review.id;
      await waitForGuide(doomedId, "running", 120_000);

      // Remove it from the start page (the real UI path): hover reveals
      // the action, the inline confirm asks, confirming drops the row.
      await serviceStart(page, svc);
      const row = page.locator(`[data-testid="session-${doomedId}"]`);
      await expect.soft(row).toBeVisible({ timeout: 30_000 });
      await row.hover();
      await row.getByRole("button", { name: "Remove this review" }).click();
      const pill = row.locator(".uic-pill");
      await expect.soft(pill).toContainText("Confirm remove review");
      await pill.getByRole("button", { name: "Confirm remove review" }).click();
      await expect.soft(row.getByText("Confirmed")).toBeVisible({ timeout: 10_000 });
      await expect.soft(row).toHaveCount(0);
      const afterDelete = await apiJson(svc, "GET", "/api/reviews");
      expect.soft(
        ((afterDelete.json as { reviews: { id: string }[] }).reviews ?? []).some((r) => r.id === doomedId),
      ).toBe(false);
    });

    await test.step("the detached jobs settle quietly with no FOREIGN KEY error", async () => {
      // The detached jobs settle after the delete — quietly. Pre-fix this
      // is where the FOREIGN KEY throw escaped and killed the process;
      // post-fix the queue logs one debug line per dropped settle.
      const log = await waitForLog("after its review was deleted; dropping", 300_000);
      expect.soft(log).not.toContain("FOREIGN KEY constraint failed");
      expect.soft(log).not.toContain("failed outside its state machine");
    });

    await test.step("the service is still up: start page loads, another review opens", async () => {
      if (!svc) throw new Error("no service");
      const list = await apiJson(svc, "GET", "/api/reviews");
      expect(list.status).toBe(200);
      await serviceStart(page, svc);
      const reopened = await apiJson(svc, "POST", "/api/reviews", { repoId, branch: "feature" });
      expect([200, 202]).toContain(reopened.status);
      const nextId = (reopened.json as { review: { id: string } }).review.id;
      const nextRow = page.locator(`[data-testid="session-${nextId}"]`);
      await page.reload();
      await expect.soft(nextRow).toBeVisible({ timeout: 30_000 });
      const fetched = await apiJson(svc, "GET", `/api/reviews/${nextId}`);
      expect.soft(fetched.status).toBe(200);
      await page.goto(`${svc.origin}/review/${nextId}?token=${svc.token}`);
      await expect.soft(page.getByText("Building the guide").first()).toBeVisible({ timeout: 120_000 });
    });
  });
});
