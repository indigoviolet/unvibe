/**
 * J311: data-format reset notice on the real service. A seeded data dir
 * whose DB has no format stamp (pre-#311 data) shows the full-page
 * notice instead of the normal UI; Export Outbox first downloads the
 * unposted drafts; Reset moves the data aside (never deletes) and the
 * app starts fresh on the same service process.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J311 data-format reset", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j311-data-"));
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    db.exec(
      "CREATE TABLE review_snapshots (review_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, snapshot JSON NOT NULL, updated_at INTEGER NOT NULL)",
    );
    const snapshot = {
      review: { id: "rv_old", repoId: "repo", branch: "feature", versions: [], currentVersion: 1, createdAt: 0 },
      version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
      files: [{ fileKey: "fk1", path: "src/app.py", category: "source", hunks: [] }],
      ingest: { status: "ready" },
      pages: [{ id: "root", kind: "root", title: "Guide title", cards: [] }],
      annotations: [
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
      ],
      hunkStates: [],
      fileStates: [],
      viewPrefs: {},
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
    };
    db.prepare("INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?)").run(
      "rv_old",
      1,
      JSON.stringify(snapshot),
      0,
    );
    db.close();
    svc = await startService(dataDir);
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    // The moved-aside sibling lives next to the data dir, not inside it.
    const parent = path.dirname(dataDir);
    for (const e of readdirSync(parent)) {
      if (e.startsWith(`${path.basename(dataDir)}.bak-`)) {
        rmSync(path.join(parent, e), { recursive: true, force: true });
      }
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("old-format data shows the notice; Export saves drafts; Reset moves data aside and starts fresh", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");

    const status = await apiJson(svc, "GET", "/api/data-format");
    expect(status.status).toBe(200);
    expect(status.json as unknown as Record<string, unknown>).toMatchObject({ state: "mismatch", expected: 1, stored: null, hasData: true });

    await page.goto(`${svc.origin}/?token=${svc.token}`);
    const notice = page.getByTestId("data-format-notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText("This version can't read your existing reviews");
    // The normal UI is not rendered behind the notice.
    await expect(page.getByText("Open a PR by URL or number")).toHaveCount(0);

    // Export Outbox first: one Markdown download with the unposted draft.
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await notice.getByRole("button", { name: "Export Outbox first" }).click();
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
    const parent = path.dirname(dataDir);
    const aside = readdirSync(parent).filter((e) => e.startsWith(`${path.basename(dataDir)}.bak-`));
    expect(aside).toHaveLength(1);
    expect(existsSync(path.join(parent, aside[0], "unvibe.db"))).toBe(true);
    expect(existsSync(path.join(dataDir, "unvibe.db"))).toBe(true);
  });
});
