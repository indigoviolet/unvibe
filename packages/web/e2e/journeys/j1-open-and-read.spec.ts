/** J1 (#188): open a PR/demo review and read the guide — real service, replay. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { fileKeyForPath } from "@unvibe/shared";
import { apiJson, createDemoReview, createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J1 open and read the guide", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j1-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("demo reader finishes non-degraded and its working copy serves code beyond the diff (#176)", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    // The reader job ends `done` with no degraded reason kept on it.
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
    expect(reader.state).toBe("done");
    expect(reader.degradedReason).toBeUndefined();
    expect(reader.error).toBeUndefined();

    // The working copy serves real head code (the new helper the guide
    // cites), through the same file route diff expansion uses. Before
    // #176 this answered 404 `no-content` (empty working copy).
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const headSha = (snap.json as { version: { headSha: string } }).version.headSha;
    const slice = await apiJson(
      svc,
      "GET",
      `/api/reviews/${reviewId}/file?path=src/urllib3/connection.py&commit=${headSha}&start=91&end=95`,
    );
    expect(slice.status).toBe(200);
    expect(JSON.stringify(slice.json)).toContain("_normalize_header_value");

    // No degraded note rides the guide in the browser.
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Some references in this answer could not be linked to the code.")).toHaveCount(0);
    await page.screenshot({ path: "test-results/j1-demo-176.png", fullPage: true });
  });

  test("demo guide reads, citation reveals diff, reload keeps it; scratch repo opens with no agent", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    // Start page lists the demo entry.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    // The opened demo review is listed on the start page; open it from there.
    await page.getByRole("button", { name: /Unfold obsolete folded response headers/ }).first().click();
    await page.waitForURL(new RegExp(`/review/${reviewId}`), { timeout: 30_000 });
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#C-problem")).toBeVisible();
    // Explain-first reader order (#198/#212): build-up, then the renamed
    // decisions card. The demo introduces no name with reach (only
    // private helpers), so it correctly has no Names card.
    await expect(page.locator("#C-buildup")).toBeVisible();
    await expect(page.locator("#C-decisions")).toBeVisible();
    await expect(page.locator("#C-decisions")).toContainText("Decisions and questions");
    await expect(page.locator("#C-names")).toHaveCount(0);
    // Contents lists the renamed card under its stable id.
    await expect(page.locator('[data-tocard="decisions"]')).toContainText("Decisions and questions");

    // Follow a citation into the diff (proven selector from guide-service).
    const seeded = page.locator("#C-problem [data-expansion]");
    if ((await seeded.count()) > 0) {
      const closer = page.locator('#C-problem [data-expansion]').getByRole("button", { name: "Close" });
      if ((await closer.count()) > 0) await closer.first().click().catch(() => {});
    }
    await page.locator("#C-central .lk[data-refs]").first().click();
    await expect(page.locator('[id="L-src-urllib3-connection.py-91"].hl')).toBeVisible({ timeout: 15_000 });

    // Reload: same guide page.
    await page.reload();
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // #274 hover toolbars: the card toolbar lives in the heading row and
    // stays hidden until the card is hovered or keyboard-focused.
    const cardToolbar = page.locator("#C-central .chead .ctl");
    await expect(cardToolbar).toHaveCSS("opacity", "0");
    await page.locator("#C-central").hover();
    await expect(cardToolbar).toHaveCSS("opacity", "1");
    // Keyboard: focusing a toolbar control reveals it via :focus-within.
    await page.mouse.move(0, 0);
    await cardToolbar.getByRole("button", { name: "Use examples" }).focus();
    await expect(cardToolbar).toHaveCSS("opacity", "1");

    // Variant with no agent: a scratch repo opens as diff + metadata, no guide promised.
    const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j1-repo-"));
    const noneData = mkdtempSync(path.join(os.tmpdir(), "unvibe-j1-none-"));
    let noneSvc: RunningService | null = null;
    try {
      await makeScratchRepo(repoDir);
      noneSvc = await startService(noneData, { agent: "none" });
      const scratchId = await createScratchReview(noneSvc, repoDir);
      await page.goto(`${noneSvc.origin}/review/${scratchId}?token=${noneSvc.token}`);
      const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;
      await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(appFile).getByText("return 2")).toBeVisible({ timeout: 30_000 });
    } finally {
      await noneSvc?.stop().catch(() => {});
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(noneData, { recursive: true, force: true });
    }
  });

  // Merged from real-service.spec.ts (#256): on a scratch branch review
  // the real snapshot renders, hunk state survives reload and a service
  // restart, and an out-of-band PATCH arrives over WS with no reload.
  // (The start-page repo-adding UI flow itself is covered by
  // J225-start-pr-list/J228/J230; this test opens the review directly.)
  test("scratch branch review: snapshot renders, hunk state survives reload + restart, WS PATCH arrives", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j1-real-repo-"));
    const scratchData = mkdtempSync(path.join(os.tmpdir(), "unvibe-j1-real-data-"));
    let scratch: RunningService | null = null;
    try {
      await makeScratchRepo(repoDir);
      scratch = await startService(scratchData);
      const scratchId = await createScratchReview(scratch, repoDir);
      await page.goto(`${scratch.origin}/review/${scratchId}?token=${scratch.token}`);
      const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;
      const utilFile = `[id="F-${fileKeyForPath("src/util.py")}"]`;
      await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(utilFile)).toBeVisible();
      await expect(page.locator(appFile).getByText("return 2")).toBeVisible();
      const snap = await apiJson(scratch, "GET", `/api/reviews/${scratchId}`);
      const file = ((snap.json as { files: { path: string; hunks: { contentHash: string }[] }[] }).files ?? []).find(
        (f) => f.path === "src/app.py",
      );
      expect(file).toBeDefined();
      const hash = file!.hunks[0].contentHash;

      // Mark the first hunk reviewed through the UI: its code folds behind
      // the header chevron.
      await page.locator(appFile).getByRole("checkbox", { name: "Mark reviewed" }).first().click();
      await expect(page.locator(appFile).getByRole("button", { name: "Show code" })).toBeVisible();
      await expect(page.locator(appFile).getByText("return 2")).toHaveCount(0);

      // State survives a page reload (durable ReviewStore).
      await page.reload();
      await expect(page.locator(appFile)).toBeVisible();
      await expect(page.locator(appFile).getByRole("button", { name: "Show code" })).toBeVisible();

      // State survives a service restart (SQLite, same data dir).
      await scratch.stop();
      scratch = await startService(scratchData);
      await page.goto(`${scratch.origin}/review/${scratchId}?token=${scratch.token}`);
      await expect(page.locator(appFile)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(appFile).getByRole("button", { name: "Show code" })).toBeVisible();

      // Out-of-band change arrives over WS with no reload.
      await apiJson(scratch, "PATCH", `/api/reviews/${scratchId}/hunks/${hash}`, {
        reviewed: false,
        folded: false,
      });
      await expect(page.locator(appFile).getByRole("button", { name: "Show code" })).toHaveCount(0);
      await expect(page.locator(appFile).getByText("return 2")).toBeVisible();
    } finally {
      await scratch?.stop().catch(() => {});
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(scratchData, { recursive: true, force: true });
    }
  });
});

// Merged from guide-service.spec.ts (#256): the guide pipeline's seed
// path — a fixture snapshot seeded straight into the ReviewStore row
// loads through the real HTTP API with canonical citations. (J1's demo
// tests above prove the same citation-reveal through the replay
// pipeline; these seeded tests prove the concept-page write-on-open and
// the card collapse action.)
const GUIDE_FIXTURE_DIR = fileURLToPath(new URL("../../../../fixtures/urllib3-5020", import.meta.url));
const GUIDE_REVIEW_ID = "guide-seed";

async function seedGuideFixture(dataDir: string): Promise<void> {
  const snapshot = JSON.parse(readFileSync(path.join(GUIDE_FIXTURE_DIR, "snapshot.json"), "utf8")) as {
    rev: number;
    review: { id: string };
  };
  const meta = JSON.parse(readFileSync(path.join(GUIDE_FIXTURE_DIR, "meta.json"), "utf8")) as {
    keyAliases: Record<string, string>;
  };
  let json = JSON.stringify(snapshot);
  for (const [alias, real] of Object.entries(meta.keyAliases)) {
    json = json.split(`diff:${alias}:`).join(`diff:${real}:`);
  }
  const seeded = JSON.parse(json) as typeof snapshot & {
    review: { repoId: string; branch?: string; prNumber?: number; createdAt?: number };
    version: { n: number; headSha: string; mergeBaseSha: string; baseRef: string; fetchedAt?: number };
  };
  seeded.review.id = GUIDE_REVIEW_ID;
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
        local_path TEXT NOT NULL, last_opened INTEGER NOT NULL DEFAULT 0,
        managed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, repo_id TEXT NOT NULL REFERENCES repos(id),
        branch TEXT NOT NULL, pr_number INTEGER,
        current_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, data JSON NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS versions (
        review_id TEXT NOT NULL REFERENCES reviews(id), n INTEGER NOT NULL,
        head_sha TEXT NOT NULL, merge_base_sha TEXT NOT NULL,
        base_ref TEXT NOT NULL, fetched_at INTEGER NOT NULL,
        id_mapping JSON NOT NULL DEFAULT '{}', PRIMARY KEY (review_id, n)
      );
      CREATE TABLE IF NOT EXISTS review_snapshots (
        review_id TEXT PRIMARY KEY,
        rev INTEGER NOT NULL,
        snapshot JSON NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
    );
    db.prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    ).run(seeded.review.repoId, "urllib3", "urllib3", "/tmp", Date.now());
    db.prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(GUIDE_REVIEW_ID, seeded.review.repoId, seeded.review.branch ?? "main", seeded.review.prNumber ?? null, seeded.version.n, seeded.review.createdAt ?? Date.now(), "{}");
    db.prepare(
      "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(GUIDE_REVIEW_ID, seeded.version.n, seeded.version.headSha, seeded.version.mergeBaseSha, seeded.version.baseRef, seeded.version.fetchedAt ?? Date.now(), "{}");
    db.prepare(
      "INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot",
    ).run(GUIDE_REVIEW_ID, seeded.rev, JSON.stringify(seeded), Date.now());
  } finally {
    db.close();
  }
}

test.describe("J1 seeded guide over the real API", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j1-guide-data-"));
    await seedGuideFixture(dataDir);
    svc = await startService(dataDir, { agent: "replay" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("concept page writes on open; diff citation reveals the canonical hunk", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${GUIDE_REVIEW_ID}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText(
      "Unfold obsolete folded response headers",
      { timeout: 30_000 },
    );
    // #167: the seed carries an open pinned card under C-problem that
    // overlays the controls below it — close it first, as a reader would.
    const closer = page.locator("#C-problem [data-expansion]").getByRole("button", { name: "Close" });
    if ((await closer.count()) > 0) await closer.first().click();
    // #216: no concept page exists yet; opening the link writes it
    // (replayed concept_page job), and the title lands when it's written.
    await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
    await expect(page).toHaveURL(/\/review\/guide-seed\/page\/c-obs-fold/);
    await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding", { timeout: 60_000 });
    // Description tab serves the fixture HTML with stable paragraph ids.
    await page.locator('#right [role="tab"]').getByText("PR description").click();
    await expect(page.locator("#right #d-p1")).toBeVisible();
    // Back on the root page, a diff citation reveals the canonical hunk row.
    await page.locator("#page nav.crumbs button").first().click();
    await expect(page.locator("#C-central")).toBeVisible();
    await page.locator("#C-central .lk[data-refs]").first().click();
    await expect(page.locator('[id="L-src-urllib3-connection.py-91"].hl')).toBeVisible({ timeout: 10_000 });
  });

  test("card collapse action applies over the real API", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${GUIDE_REVIEW_ID}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText(
      "Unfold obsolete folded response headers",
      { timeout: 30_000 },
    );
    const closer = page.locator("#C-problem [data-expansion]").getByRole("button", { name: "Close" });
    if ((await closer.count()) > 0) await closer.first().click();
    await page.locator("#C-central > .chead").getByRole("button", { name: "Collapse" }).click();
    await expect(page.locator("#C-central")).toHaveClass(/collapsed/, { timeout: 10_000 });
    await page.locator("#C-central").getByRole("button", { name: "Expand" }).click();
    await expect(page.locator("#C-central")).not.toHaveClass(/collapsed/, { timeout: 10_000 });
  });
});
