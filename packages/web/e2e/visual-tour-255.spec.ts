/**
 * #255 tour: fenced code blocks highlight with the diff Shiki setup.
 *
 * Two frames — a guide card holding a python block (seeded into the
 * demo review's problem card) and a document review with a python block
 * plus an unknown-language block — at 1440px and ~960px, light and dark.
 * Each frame waits for the token spans, runs `checkLayout`, and
 * screenshots for the owner. Requires `mise run build` first.
 * Run via `mise run visual-tour -- e2e/visual-tour-255.spec.ts`
 * (or the journeys task).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import { checkLayout } from "./layout-check.js";
import { apiJson, git, makeScratchRepo, stampDataFormat } from "./journeys/journey-helpers.js";

const SHOTS = fileURLToPath(new URL("../visual-tour/255", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });

const PY_CODE = ['def fold(value):', '    # collapse repeated whitespace', '    return " ".join(value.split())'].join("\n");

const DOC_MARKDOWN = [
  "# Code sample",
  "",
  "A fenced Python block highlights with the guide palette.",
  "",
  "```python",
  PY_CODE,
  "```",
  "",
  "```mysterylang",
  "this language is not shipped, so it stays plain",
  "```",
  "",
].join("\n");

let dataDir = "";
let repoDir = "";
let svc: RunningService | null = null;
let guideReviewId = "";
let docReviewId = "";

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour255-data-"));
  repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour255-repo-"));
  await makeScratchRepo(repoDir);
  await git(repoDir, "update-ref", "refs/remotes/origin/main", "HEAD");
  svc = await startService(dataDir, { agent: "replay" });

  // Guide review: the bundled demo (replay agent), then a python code
  // block seeded into its problem card (DB seed, the J222 pattern —
  // agent recordings carry no fenced code).
  const created = await apiJson(svc, "POST", "/api/reviews", { repoId: "demo" });
  expect(created.status).toBe(201);
  guideReviewId = (created.json as { review: { id: string } }).review.id;
  const deadline = Date.now() + 90_000;
  for (;;) {
    const snapRes = await apiJson(svc, "GET", `/api/reviews/${guideReviewId}`);
    const snap = snapRes.json as unknown as {
      pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
    };
    const root = snap.pages.find((p) => p.id === "root");
    if (root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0)) break;
    if (Date.now() > deadline) throw new Error("guide did not fill in time");
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Document review with a python block + an unknown-language block.
  const added = await apiJson(svc, "POST", "/api/repos", { path: repoDir });
  expect(added.status).toBe(200);
  const repoId = (added.json as { repos: { id: string; localPath: string }[] }).repos.find(
    (r) => r.localPath === repoDir,
  )!.id;
  const doc = await apiJson(svc, "POST", "/api/reviews", {
    kind: "document",
    markdown: DOC_MARKDOWN,
    contextRepos: [{ repoId, source: "local" }],
  });
  expect(doc.status).toBe(201);
  docReviewId = (doc.json as { review: { id: string } }).review.id;

  // Let the replay pipeline settle before the restart: stopping with
  // a D2 render in flight orphans its `unvibe-d2-*` temp dir (the
  // render cleans up in `finally`), which fails the per-run temp guard.
  const quietDeadline = Date.now() + 90_000;
  for (;;) {
    const jobsRes = await apiJson(svc, "GET", `/api/jobs?review=${guideReviewId}`);
    const jobs = (jobsRes.json as { jobs: { state: string }[] }).jobs ?? [];
    if (jobs.every((j) => j.state === "done" || j.state === "error" || j.state === "cancelled")) break;
    if (Date.now() > quietDeadline) throw new Error("replay jobs never settled before the seed restart");
    await new Promise((r) => setTimeout(r, 500));
  }

  // Seed the guide card, then restart (J222 pattern).
  await svc.stop();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(guideReviewId) as
      | { rev: number; snapshot: string }
      | undefined;
    if (!row) throw new Error("no snapshot row to seed");
    const seeded = JSON.parse(row.snapshot) as {
      pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
    };
    const problem = seeded.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem");
    if (!problem) throw new Error("no problem card to seed");
    problem.blocks.push({ type: "code", id: "b255py", language: "python", code: PY_CODE, citations: [] });
    db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
      row.rev + 1,
      JSON.stringify(seeded),
      guideReviewId,
    );
    stampDataFormat(db);
  } finally {
    db.close();
  }
  svc = await startService(dataDir, { agent: "replay" });
});

test.afterAll(async () => {
  await svc?.stop().catch(() => {});
  svc = null;
  for (const d of [dataDir, repoDir]) rmSync(d, { recursive: true, force: true });
});

for (const combo of [
  { name: "1440-light", width: 1440, dark: false },
  { name: "1440-dark", width: 1440, dark: true },
  { name: "960-light", width: 960, dark: false },
  { name: "960-dark", width: 960, dark: true },
] as const) {
  test(`code blocks (${combo.name}, #255)`, async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(240_000);
    await page.setViewportSize({ width: combo.width, height: 900 });
    if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
    const suffix = combo.name;
    await page.evaluate(() => document.fonts.ready).catch(() => {});

    // Guide card with code.
    await page.goto(`${svc.origin}/review/${guideReviewId}?token=${svc.token}`);
    const guideCode = page.locator("#C-problem pre.code");
    await guideCode.scrollIntoViewIfNeeded();
    await expect(guideCode.locator("[class*='shk-']").first()).toBeVisible({ timeout: 20_000 });
    await checkLayout(page, `code-guide-${suffix}`);
    await page.screenshot({ path: path.join(SHOTS, `code-guide-${suffix}.png`) });

    // Document with a python block (highlighted) + unknown (plain).
    await page.goto(`${svc.origin}/review/${docReviewId}?token=${svc.token}`);
    await expect(page.getByTestId("document-view")).toBeVisible({ timeout: 30_000 });
    const blocks = page.locator("#C-document pre.code");
    await expect(blocks).toHaveCount(2);
    await expect(blocks.nth(0).locator("[class*='shk-']").first()).toBeVisible({ timeout: 20_000 });
    expect(await blocks.nth(1).locator("[class*='shk-']").count()).toBe(0);
    await blocks.nth(0).scrollIntoViewIfNeeded();
    await checkLayout(page, `code-document-${suffix}`);
    await page.screenshot({ path: path.join(SHOTS, `code-document-${suffix}.png`) });
  });
}
