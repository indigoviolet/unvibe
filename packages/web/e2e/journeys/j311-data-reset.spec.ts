/**
 * J311: data-format notice on the real service. A seeded data dir whose
 * DB has no format stamp (pre-#311 data) shows the notice inside the
 * start-page frame (top bar visible but disabled, disco art behind),
 * instead of the normal UI.
 * - With drafts: the Export card shows their count, Export downloads
 *   them, Reset moves the data aside (never deletes) and starts fresh.
 * - Without drafts: no Export card — only Go back / Reset.
 * - Go back (fake updater drill): switches to the recorded previous
 *   build through the update helper; the data is byte-for-byte
 *   untouched and nothing is moved aside.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService } from "../service-harness.js";
import { apiJson } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

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
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j311-data-"));
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

function cleanup(dataDir: string): void {
  const parent = path.dirname(dataDir);
  for (const e of readdirSync(parent)) {
    if (e.startsWith(`${path.basename(dataDir)}.bak-`)) rmSync(path.join(parent, e), { recursive: true, force: true });
  }
  rmSync(dataDir, { recursive: true, force: true });
}

function asideDirs(dataDir: string): string[] {
  const parent = path.dirname(dataDir);
  return readdirSync(parent).filter((e) => e.startsWith(`${path.basename(dataDir)}.bak-`));
}

test.describe("J311 data-format notice", () => {
  test("with drafts: framed notice, disabled bar, Export with count, Reset moves data aside", async ({ page }) => {
    test.setTimeout(180_000);
    const dataDir = await seedDataDir(true);
    seedPreviousOutcome(dataDir);
    const svc = await startService(dataDir);
    try {
      const status = await apiJson(svc, "GET", "/api/data-format");
      expect(status.status).toBe(200);
      expect(status.json as unknown as Record<string, unknown>).toMatchObject({
        state: "mismatch",
        expected: 1,
        stored: null,
        outboxCount: 1,
        previousRef: "preview/old",
        previousVersion: "0.0.1-old",
      });

      await page.goto(`${svc.origin}/?token=${svc.token}`);
      const notice = page.getByTestId("data-format-notice");
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await expect(notice).toContainText("This version can't read your existing reviews");
      // Inside the app frame: top bar and disco art are present.
      await expect(page.locator("header.top")).toBeVisible();
      await expect(page.locator(".start-watermark img")).toBeAttached();
      // The normal UI is not rendered behind the notice.
      await expect(page.getByText("Open a PR by URL or number")).toHaveCount(0);

      // Every other control is visible but disabled and inert.
      const settings = page.getByRole("link", { name: "Settings" });
      await expect(settings).toBeVisible();
      await expect(settings).toHaveAttribute("aria-disabled", "true");
      await expect(settings).toHaveAttribute("tabindex", "-1");
      const urlBefore = page.url();
      // Force: Playwright's click waits for an enabled element, and
      // aria-disabled is exactly what makes this link inert.
      await settings.click({ force: true });
      await expect(notice).toBeVisible();
      expect(page.url()).toBe(urlBefore);

      // Go back is offered with the recorded version (not clicked here).
      await expect(notice.getByRole("button", { name: "Go back to 0.0.1-old" })).toBeVisible();

      // #311 follow-up: the cards' outer edges line up with the text
      // column (heading + intro paragraph) within 1px, wide and narrow.
      for (const width of [1440, 800]) {
        await page.setViewportSize({ width, height: 900 });
        const edges = await notice.evaluate((doc) => {
          const box = (el: Element) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, right: r.right };
          };
          const h1 = doc.querySelector("h1");
          const intro = doc.querySelector("p");
          const cards = [...doc.querySelectorAll(".ui-card")];
          if (!h1 || !intro || cards.length === 0) throw new Error("notice pieces missing");
          return { h1: box(h1), intro: box(intro), cards: cards.map(box) };
        });
        for (const card of [...edges.cards, edges.intro]) {
          expect(Math.abs(card.left - edges.h1.left)).toBeLessThanOrEqual(1);
          expect(Math.abs(card.right - edges.h1.right)).toBeLessThanOrEqual(1);
        }
      }

      // Export shows the draft count and downloads the drafts.
      const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
      await notice.getByRole("button", { name: "Export 1 unposted draft" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("unvibe-outbox.md");
      const file = await download.path();
      if (!file) throw new Error("no download path");
      const md = readFileSync(file, "utf8");
      expect(md).toContain("Unposted draft text");
      expect(md).toContain("src/app.py:2");
      await expect(notice).toContainText("Exported 1 draft");

      // Reset: confirm, then the same service comes back fresh.
      await notice.getByRole("button", { name: "Reset and start fresh" }).click();
      await notice.getByRole("button", { name: "Move my data aside and reset" }).click();
      await expect(page.getByText("Open a PR by URL or number")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("data-format-notice")).toHaveCount(0);

      const after = await apiJson(svc, "GET", "/api/data-format");
      expect(after.json as unknown as Record<string, unknown>).toMatchObject({ state: "match", expected: 1, stored: 1 });

      // Nothing was deleted: the old DB sits in a dated sibling dir.
      expect(asideDirs(dataDir)).toHaveLength(1);
      expect(existsSync(path.join(path.dirname(dataDir), asideDirs(dataDir)[0], "unvibe.db"))).toBe(true);
      expect(existsSync(path.join(dataDir, "unvibe.db"))).toBe(true);
    } finally {
      await svc.stop().catch(() => {});
      cleanup(dataDir);
    }
  });

  test("without drafts: no Export card, only Go back / Reset; deep links land on the notice", async ({ page }) => {
    test.setTimeout(180_000);
    const dataDir = await seedDataDir(false);
    const svc = await startService(dataDir);
    try {
      const status = await apiJson(svc, "GET", "/api/data-format");
      expect(status.json as unknown as Record<string, unknown>).toMatchObject({ state: "mismatch", outboxCount: 0, previousRef: null });

      // A deep link to a review lands on the same notice.
      await page.goto(`${svc.origin}/review/rv_old?token=${svc.token}`);
      const notice = page.getByTestId("data-format-notice");
      await expect(notice).toBeVisible({ timeout: 30_000 });
      await expect(notice.getByRole("button", { name: /Export .*unposted draft/ })).toHaveCount(0);
      await expect(notice).not.toContainText("Export your Outbox first");
      await expect(notice.getByRole("button", { name: "Reset and start fresh" })).toBeVisible();
      // Unknown previous build: the terminal command shows instead.
      await expect(notice.getByTestId("go-back-command")).toContainText("npm install -g github:indigoviolet/unvibe#v0.0.12");

      await notice.getByRole("button", { name: "Reset and start fresh" }).click();
      await notice.getByRole("button", { name: "Move my data aside and reset" }).click();
      await expect(page.getByText("Open a PR by URL or number")).toBeVisible({ timeout: 60_000 });
      expect(asideDirs(dataDir)).toHaveLength(1);
    } finally {
      await svc.stop().catch(() => {});
      cleanup(dataDir);
    }
  });

  test("go back: switches to the previous build through the helper, data untouched", async ({ page }) => {
    test.setTimeout(240_000);
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
    const scratchHome = mkdtempSync(path.join(os.tmpdir(), "unvibe-j311-home-"));
    const svc = await startService(dataDir, {
      extraEnv: { UNVIBE_UPDATER_BACKEND: "fake", UNVIBE_TEST: "1", HOME: scratchHome },
    });
    try {
      await page.goto(`${svc.origin}/?token=${svc.token}`);
      const notice = page.getByTestId("data-format-notice");
      await expect(notice).toBeVisible({ timeout: 30_000 });
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
      expect(readFileSync(path.join(dataDir, "update", "current-ref"), "utf8").trim()).toBe("preview/old");

      // The data was not touched: same DB bytes, nothing moved aside.
      expect(readFileSync(path.join(dataDir, "unvibe.db")).equals(dbBefore)).toBe(true);
      expect(asideDirs(dataDir)).toEqual([]);

      // The restarted (same-binary) service still shows the notice: in
      // this drill only the fake channel moved, so the format gate is
      // unchanged — what matters is the switch happened with data intact.
      await expect(page.getByTestId("data-format-notice")).toBeVisible({ timeout: 60_000 });
    } finally {
      await svc.stop().catch(() => {});
      rmSync(scratchHome, { recursive: true, force: true });
      cleanup(dataDir);
    }
  });
});
