/** J227 (#227): file tree — long paths truncate, indicators stay visible. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, git } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const LONG_DIR =
  "packages/very-long-component-directory-name/and-another-long-directory-level/with-a-deeply-nested-module/and-one-more-long-directory-level";
const LONG_FILE = `${LONG_DIR}/a_very_long_file_name_for_the_component_under_review_with_extra_words.py`;
const LONG_FILE_2 = `${LONG_DIR}/another_long_file_name_for_a_helper_module_with_extra_words.py`;
const keyFor = (p: string): string => p.replace(/[^A-Za-z0-9_.-]/g, "-");

async function write(dir: string, rel: string, text: string): Promise<void> {
  mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
}

test.describe("J227 file tree (#227)", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j227-repo-"));
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j227-data-"));
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "t@example.com");
    await git(repoDir, "config", "user.name", "T");
    await write(repoDir, "top.py", "VALUE = 1\n");
    await write(repoDir, LONG_FILE, "def a():\n    return 1\n");
    await write(repoDir, LONG_FILE_2, "def b():\n    return 2\n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "base");
    await git(repoDir, "checkout", "-b", "feature");
    await write(repoDir, "top.py", "VALUE = 1\nEXTRA = 2\n");
    await write(
      repoDir,
      LONG_FILE,
      ["def a():", "    return 10", ...Array.from({ length: 14 }, (_, i) => `ADDED_${i} = ${i}`), ""].join("\n"),
    );
    await write(repoDir, LONG_FILE_2, "def b():\n    return 22\n    \n");
    await git(repoDir, "add", ".");
    await git(repoDir, "commit", "-m", "feature work");

    svc = await startService(dataDir, { agent: "none" });
    const repos = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
    const list = (repos.json as { repos: { id: string; localPath: string }[] }).repos;
    const registered = list.find((r) => r.localPath === repoDir);
    if (!registered) throw new Error(`repo not registered: ${JSON.stringify(list)}`);
    const created = await apiJson(svc, "POST", "/api/reviews", { repoId: registered.id, branch: "feature" });
    if (created.status !== 201 && created.status !== 200 && created.status !== 202) {
      throw new Error(`review create failed: ${created.status} ${JSON.stringify(created.json)}`);
    }
    reviewId = (created.json as { review: { id: string } }).review.id;
    const deadline = Date.now() + 60_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const st = (snap.json as { ingest?: { status?: string } }).ingest?.status ?? "ready";
      if (st === "ready") break;
      if (Date.now() > deadline) throw new Error(`ingest not ready: ${JSON.stringify(snap.json)}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("long path: no horizontal scroll, indicators visible and aligned, full path on hover", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const longSection = page.locator(`[id="F-${keyFor(LONG_FILE)}"]`);
    await expect(longSection).toBeVisible({ timeout: 60_000 });

    // Diff file header: full path on hover, deepest directory and the
    // file name stay readable, indicators inside the header's right edge.
    await expect(longSection.locator(".dfile-h .path")).toHaveAttribute("title", LONG_FILE);
    await expect(longSection.locator(".dfile-h .path .dir-end")).toContainText("and-one-more-long-directory-level/");
    await expect(longSection.locator(".dfile-h .path b")).toHaveText("a_very_long_file_name_for_the_component_under_review_with_extra_words.py");
    await expect(longSection.locator(".dfile-h .st")).toContainText("+15");

    // Open the file list.
    if (!(await page.locator(".flist").isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Show file list" }).click();
    }
    const flist = page.locator(".flist");
    await expect(flist.locator(".fr.file")).toHaveCount(3, { timeout: 15_000 });
    await expect(flist.locator(`.fr.file[title="${LONG_FILE}"]`)).toHaveCount(1);
    await expect(flist.locator(".fr.dir .nm-end")).toContainText("and-one-more-long-directory-level");

    const geo = await flist.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll(".fr.file")].map((row) => {
        const st = row.querySelector(".st")!.getBoundingClientRect();
        const rv = row.querySelector(".rv")!.getBoundingClientRect();
        const nm = row.querySelector(".nm")!;
        return {
          stLeft: st.left, stRight: st.right, rvLeft: rv.left, rvRight: rv.right,
          nameTruncated: nm.scrollWidth > nm.clientWidth,
        };
      });
      const dirPre = el.querySelector(".fr.dir .nm-pre")!;
      return {
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        boxLeft: box.left, boxRight: box.right,
        rows,
        dirTruncated: dirPre.scrollWidth > dirPre.clientWidth,
      };
    });
    // No horizontal scroll in the tree panel.
    expect(geo.scrollW).toBeLessThanOrEqual(geo.clientW + 1);
    expect(geo.rows).toHaveLength(3);
    for (const r of geo.rows) {
      // Indicators inside the panel, never scrolled out of view.
      expect(r.stLeft).toBeGreaterThanOrEqual(geo.boxLeft - 1);
      expect(r.rvRight).toBeLessThanOrEqual(geo.boxRight + 1);
    }
    // The two long names truncate (tree order: the deep files first).
    expect(geo.rows[0].nameTruncated).toBe(true);
    expect(geo.rows[1].nameTruncated).toBe(true);
    // The indicator columns align across rows.
    const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
    expect(spread(geo.rows.map((r) => r.rvRight))).toBeLessThanOrEqual(2);
    expect(spread(geo.rows.map((r) => r.stRight))).toBeLessThanOrEqual(2);
    expect(spread(geo.rows.map((r) => r.rvLeft))).toBeLessThanOrEqual(2);
    // The long directory chain is shortened, not fully shown.
    expect(geo.dirTruncated).toBe(true);

    const header = await longSection.locator(".dfile-h").evaluate((el) => {
      const box = el.getBoundingClientRect();
      const pane = document.getElementById("right")!.getBoundingClientRect();
      const st = el.querySelector(".st")!.getBoundingClientRect();
      const revc = el.querySelector(".revc")!.getBoundingClientRect();
      const box2 = el.querySelector("input.revbox")!.getBoundingClientRect();
      const name = el.querySelector(".path b")!;
      const dirPre = el.querySelector(".dir-pre");
      return {
        stRight: st.right, revcRight: revc.right, boxRight: box.right, boxLeft: box.left,
        stLeft: st.left, dirTruncated: dirPre ? dirPre.scrollWidth > dirPre.clientWidth : false,
        paneRight: pane.right, checkRight: box2.right,
        nameTruncated: name.scrollWidth > name.clientWidth,
      };
    });
    expect(header.stLeft).toBeGreaterThanOrEqual(header.boxLeft - 1);
    expect(header.revcRight).toBeLessThanOrEqual(header.boxRight + 1);
    // The whole header — checkbox included — fits the pane.
    expect(header.boxRight).toBeLessThanOrEqual(header.paneRight + 1);
    expect(header.checkRight).toBeLessThanOrEqual(header.paneRight + 1);
    expect(header.nameTruncated).toBe(true);
    expect(header.dirTruncated).toBe(true);

    await page.screenshot({ path: "test-results/j227-file-tree-long-path.png", fullPage: false });
  });
});
