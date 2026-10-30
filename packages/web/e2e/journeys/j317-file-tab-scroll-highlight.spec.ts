/** J317: a `code:` citation into a non-diff file scrolls + highlights. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createScratchReview, git, stampDataFormat, writeFakeGh } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const BIG_LINES = 3000;
function bigPy(): string {
  const out: string[] = [];
  for (let i = 1; i <= BIG_LINES; i++) out.push(`value_${i} = compute_${i}(seed)  # row ${i}`);
  return out.join("\n") + "\n";
}

test.describe("J317 file tab scroll + syntax highlight", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  async function start(): Promise<RunningService> {
    const fakeShell = path.join(fakeBin, "fakeshell");
    return startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });
  }

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j317-repo-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    writeFileSync(path.join(repoDir, "big.py"), bigPy());
    writeFileSync(path.join(repoDir, "app.py"), "def main():\n    return 1\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    writeFileSync(path.join(repoDir, "app.py"), "def main():\n    return 2\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");
    const headSha = (await git(repoDir, "rev-parse", "HEAD")).trim();
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j317-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j317-bin-"));
    writeFakeGh(fakeBin, logDir, headSha);
    writeFileSync(path.join(fakeBin, "fakeshell"), `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j317-data-"));
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

  /** True when the row's box sits inside the #right pane's box. */
  async function rowInPane(page: import("@playwright/test").Page, line: number): Promise<boolean> {
    return page.evaluate((n) => {
      const row = document.querySelector(`.codefile [data-code-line="${n}"]`);
      const pane = document.getElementById("right");
      if (!row || !pane) return false;
      const r = row.getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      return r.top >= p.top && r.bottom <= p.bottom && r.height > 0;
    }, line);
  }

  /** True when the range's centre is within 20% of the pane's centre. */
  async function rangeCentred(page: import("@playwright/test").Page, start: number, end: number): Promise<boolean> {
    return page.evaluate(([s, e]) => {
      const first = document.querySelector(`.codefile [data-code-line="${s}"]`);
      const last = document.querySelector(`.codefile [data-code-line="${e}"]`);
      const pane = document.getElementById("right");
      if (!first || !last || !pane) return false;
      const p = pane.getBoundingClientRect();
      const rangeCentre = (first.getBoundingClientRect().top + last.getBoundingClientRect().bottom) / 2;
      const paneCentre = (p.top + p.bottom) / 2;
      return Math.abs(rangeCentre - paneCentre) <= 0.2 * p.height;
    }, [start, end]);
  }

  test("citation scrolls the cited range into view with syntax tokens; a second citation re-scrolls", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    type SnapProbe = {
      version: { headSha: string };
      ingest?: { status: string };
      jobs?: { state: string }[];
      pages: { id: string; cards: { id: string }[] }[];
    };
    let head = "";
    const settleDeadline = Date.now() + 90_000;
    for (;;) {
      const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const snap = res.json as unknown as SnapProbe;
      const active = (snap.jobs ?? []).some((j) => j.state === "queued" || j.state === "running" || j.state === "backing-off");
      if (snap.version.headSha !== "" && snap.ingest?.status === "ready" && !active) { head = snap.version.headSha; break; }
      if (Date.now() > settleDeadline) throw new Error("scratch ingest did not settle");
      await new Promise((r) => setTimeout(r, 250));
    }

    await svc.stop();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as { rev: number; snapshot: string } | undefined;
      if (!row) throw new Error("no snapshot row to seed");
      const snap = JSON.parse(row.snapshot) as {
        pages: { id: string; kind: string; title: string; cards: unknown[] }[];
        pipeline?: { stages: Record<string, string> };
        ingest?: { status: string };
      };
      snap.ingest = { status: "ready" };
      snap.pipeline = { stages: { reader: "done", base: "done", critic: "done", "hunk-pass": "done", "go-deeper": "done" } };
      let root = snap.pages.find((p) => p.id === "root");
      if (!root) { root = { id: "root", kind: "root", title: "Guide", cards: [] }; snap.pages.unshift(root); }
      const card = (id: string, text: string, target: string): unknown => ({
        id, pageId: "root", title: id, level: "standard", collapsed: false, revision: 1,
        blocks: [{ type: "paragraph", id: `b-${id}`, text: { standard: text }, citations: [{ target }] }],
        undoStack: [],
      });
      root.cards.push(
        card("c-deep", "Deep in the big file.", `code:big.py:2500-2502@${head}`),
        card("c-near", "Near the top of the big file.", `code:big.py:120-121@${head}`),
      );
      db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(row.rev + 1, JSON.stringify(snap), reviewId);
      stampDataFormat(db);
    } finally { db.close(); }
    svc = await start();
    await expect.poll(async () => {
      const res = await apiJson(svc as RunningService, "GET", `/api/reviews/${reviewId}`);
      return (res.json as unknown as SnapProbe).pages.some((p) => p.cards.some((c) => c.id === "c-deep"));
    }, { timeout: 60_000 }).toBe(true);

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.getByText("Deep in the big file.")).toBeVisible({ timeout: 60_000 });

    // First citation: far down a 3000-line non-diff file.
    const t0 = Date.now();
    await page.locator("#C-c-deep .lk[data-refs]").click();
    await expect(page.getByRole("tab", { name: "big.py" })).toBeVisible({ timeout: 30_000 });
    const tPaint = Date.now() - t0;
    await expect(page.locator('.codefile [data-code-line="2500"]')).toHaveClass(/cited/, { timeout: 30_000 });
    await expect.poll(() => rowInPane(page, 2500), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => rangeCentred(page, 2500, 2502), { timeout: 30_000 }).toBe(true);
    const tScroll = Date.now() - t0;
    console.log(`J317 timing: tab-visible=${tPaint}ms cited-in-view=${tScroll}ms`);
    const top1 = await page.evaluate(() => document.getElementById("right")?.scrollTop ?? -1);
    expect(top1).toBeGreaterThan(0);
    // Syntax tokens inside the cited rows (diff highlighter, shiki classes).
    await expect.poll(async () => page.locator('.codefile [data-code-line="2500"] [class*="shk-"]').count(), { timeout: 30_000 }).toBeGreaterThan(0);

    // Second citation into the same open tab scrolls to the new range.
    await page.locator("#C-c-near .lk[data-refs]").click();
    await expect(page.getByRole("tab", { name: "big.py" })).toHaveCount(1);
    await expect(page.locator('.codefile [data-code-line="120"]')).toHaveClass(/cited/, { timeout: 30_000 });
    await expect.poll(() => rowInPane(page, 120), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => rangeCentred(page, 120, 121), { timeout: 30_000 }).toBe(true);
    const top2 = await page.evaluate(() => document.getElementById("right")?.scrollTop ?? -1);
    expect(top2).toBeLessThan(top1);
    await expect.poll(async () => page.locator('.codefile [data-code-line="120"] [class*="shk-"]').count(), { timeout: 30_000 }).toBeGreaterThan(0);
  });
});
