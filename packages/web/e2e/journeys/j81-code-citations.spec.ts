/** J81: `code:` citations outside the diff — hover, file tab, comment. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createScratchReview, git, stampDataFormat, writeFakeGh } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J81 code citations outside the diff", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  // Stubbed `gh` only (AGENTS.md: tests never hit real GitHub).
  async function start(): Promise<RunningService> {
    const fakeShell = path.join(fakeBin, "fakeshell");
    return startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
  }

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j81-repo-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "helper.py"), "alpha = 1\nbeta = 2\ngamma = 3\n");
    writeFileSync(path.join(repoDir, "app.py"), "def main():\n    return 1\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(path.join(repoDir, "app.py"), "def main():\n    return 2\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");
    const headSha = (await git(repoDir, "rev-parse", "HEAD")).trim();
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j81-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j81-bin-"));
    writeFakeGh(fakeBin, logDir, headSha);
    writeFileSync(path.join(fakeBin, "fakeshell"), `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j81-data-"));
    svc = await start();
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  });

  test("hover previews, click opens a closable file tab, selection comments on the code host", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // Wait for the ingest to really land (head SHA present, ingest
    // ready, no active jobs) before seeding: stopping over a snapshot
    // that still says "loading" lets boot recovery re-ingest on the
    // restart and replace the seeded guide with an empty one.
    type SnapProbe = {
      version: { headSha: string };
      files: { path: string }[];
      ingest?: { status: string };
      jobs?: { state: string }[];
      pages: { id: string; cards: { id: string }[] }[];
    };
    let before: SnapProbe | null = null;
    const settleDeadline = Date.now() + 90_000;
    for (;;) {
      const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const snap = res.json as unknown as SnapProbe;
      const active = (snap.jobs ?? []).some((j) => j.state === "queued" || j.state === "running" || j.state === "backing-off");
      if (snap.version.headSha !== "" && snap.ingest?.status === "ready" && !active) {
        before = snap;
        break;
      }
      if (Date.now() > settleDeadline) throw new Error("scratch ingest did not settle");
      await new Promise((r) => setTimeout(r, 250));
    }
    const head = before.version.headSha;
    expect(before.files.some((f) => f.path === "helper.py")).toBe(false);

    // Seed guide cards: a verified outside-diff citation, a past-the-end
    // one (valid under #81: no length check), and a missing file.
    await svc.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
        | { rev: number; snapshot: string }
        | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const snap = JSON.parse(row.snapshot) as {
        pages: { id: string; kind: string; title: string; cards: unknown[] }[];
        pipeline?: { stages: Record<string, string> };
        ingest?: { status: string };
      };
      // Keep boot recovery from re-ingesting over the seed.
      snap.ingest = { status: "ready" };
      snap.pipeline = {
        stages: { reader: "done", base: "done", critic: "done", "hunk-pass": "done", "go-deeper": "done" },
      };
      let root = snap.pages.find((p) => p.id === "root");
      if (!root) {
        root = { id: "root", kind: "root", title: "Guide", cards: [] };
        snap.pages.unshift(root);
      }
      const card = (id: string, text: string, target: string, unverified?: boolean): unknown => ({
        id,
        pageId: "root",
        title: id,
        level: "standard",
        collapsed: false,
        revision: 1,
        blocks: [
          {
            type: "paragraph",
            id: `b-${id}`,
            text: { standard: text },
            citations: [{ target, ...(unverified ? { unverified: true } : {}) }],
          },
        ],
        undoStack: [],
      });
      root.cards.push(
        card("c-beta", "Uses the helper beta value.", `code:helper.py:2@${head}`),
        card("c-past", "Cites past the end.", `code:helper.py:2-99@${head}`),
        card("c-missing", "Cites a missing file.", `code:nope.py:1@${head}`, true),
      );
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
        row.rev + 1,
        JSON.stringify(snap),
        reviewId,
      );
      stampDataFormat(db);
    } finally {
      db.close();
    }
    svc = await start();

    // The restarted service must actually serve the seeded guide
    // before the browser opens it (poll the served state, not a timer).
    await expect
      .poll(
        async () => {
          const res = await apiJson(svc as RunningService, "GET", `/api/reviews/${reviewId}`);
          const snap = res.json as unknown as SnapProbe;
          return snap.pages.some((p) => p.cards.some((c) => c.id === "c-beta"));
        },
        { timeout: 60_000 },
      )
      .toBe(true);

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.getByText("Uses the helper beta value.")).toBeVisible({ timeout: 60_000 });
    // Past-the-end is verified now; a missing file gets no marker at all
    // (#264): the surrounding text stays plain text.
    await expect(page.locator("#C-c-past .lk.unverified")).toHaveCount(0);
    await expect(page.locator("#C-c-missing .lk.unverified")).toHaveCount(0);
    await expect(page.locator("#C-c-missing .lk")).toHaveCount(0);
    await expect(page.locator("#C-c-missing")).toContainText("Cites a missing file.");

    // Hover previews the cited lines at the commit.
    await page.locator("#C-c-beta .lk[data-refs]").hover();
    await expect(page.locator("#pop")).toContainText("beta = 2", { timeout: 30_000 });

    // Click opens the file tab at the cited lines.
    await page.locator("#C-c-beta .lk[data-refs]").click();
    await expect(page.getByRole("tab", { name: "helper.py" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".codefile")).toContainText("beta = 2");
    await expect(page.locator('.codefile [data-code-line="2"]')).toHaveClass(/cited/);

    // A past-the-end citation reuses the same tab and clamps the highlight.
    await page.locator("#C-c-past .lk[data-refs]").click();
    await expect(page.getByRole("tab", { name: "helper.py" })).toHaveCount(1);
    await expect(page.locator('.codefile [data-code-line="3"]')).toHaveClass(/cited/);

    // Selecting cited text and commenting anchors to the code host.
    await page.evaluate(() => {
      const row = document.querySelector('.codefile [data-code-line="2"] .cf-c');
      if (!row?.firstChild) throw new Error("no cited row");
      const range = document.createRange();
      range.setStart(row.firstChild, 0);
      range.setEnd(row.firstChild, 4);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(page.locator("#selbar")).toBeVisible({ timeout: 30_000 });
    await page.locator('#selbar [data-act="note"]').click();
    const composer = page.locator(".codefile textarea");
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill("Is beta still the right default?");
    await page.locator(".codefile").getByRole("button", { name: "Save", exact: true }).click();
    const deadline = Date.now() + 30_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const anns = (snap.json as unknown as { annotations: { type: string; anchor: { host: { kind: string; path?: string } }; replies?: { kind?: string }[] }[] }).annotations;
      const thread = anns.find((a) => a.type === "thread" && a.anchor.host.kind === "code" && (a.replies ?? []).some((r) => r.kind === "comment"));
      if (thread) {
        expect(thread.anchor.host.path).toBe("helper.py");
        break;
      }
      if (Date.now() > deadline) throw new Error("code-host comment not stored");
      await new Promise((r) => setTimeout(r, 250));
    }
    await expect(page.locator(".codefile")).toContainText("Is beta still the right default?", { timeout: 30_000 });

    // The tab closes; the Diff tab remains.
    await page.getByRole("button", { name: "Close helper.py" }).click();
    await expect(page.locator(".codefile")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Diff" })).toBeVisible();
  });
});
