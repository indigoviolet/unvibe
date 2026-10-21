/**
 * Guide over the real service (web-guide owner, dev-only verification).
 *
 * The guide pipeline is still being built, so this spec seeds the
 * generated `fixtures/urllib3-5020/snapshot.json` straight into the
 * service's ReviewStore (`review_snapshots` row — the same row
 * `ReviewStore.putSnapshot` writes; see `packages/service/src/state/store.ts`
 * and migration 002) and loads it through the real HTTP API:
 * pages navigate, and card actions run against the M4 actions route.
 *
 * The seed rewrites the fixture's short citation keys (`diff:conn:…`) to
 * canonical file keys using `meta.json` `keyAliases`. That rewrite stands
 * in for the pipeline fix (citations must be stored canonical or the
 * snapshot must carry the alias map); without it diff reveals cannot
 * resolve in live mode. Card actions run against the real M4 actions
 * route (read applies; only second_opinion is still unwired).
 *
 * Requires `mise run build` first (runs `packages/service/dist/index.js`
 * and serves `packages/web/dist`). Skipped when the service isn't built.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import type { Page } from "@playwright/test";

const FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/urllib3-5020", import.meta.url));
const REVIEW_ID = "guide-seed";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Seed the fixture snapshot into a fresh data dir's ReviewStore row. */
async function seedFixture(dataDir: string): Promise<void> {
  const snapshot = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "snapshot.json"), "utf8")) as {
    rev: number;
    review: { id: string };
  };
  const meta = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "meta.json"), "utf8")) as {
    keyAliases: Record<string, string>;
  };
  // Canonicalize alias-form citations (see module docs).
  let json = JSON.stringify(snapshot);
  for (const [alias, real] of Object.entries(meta.keyAliases)) {
    json = json.split(`diff:${alias}:`).join(`diff:${real}:`);
  }
  const seeded = JSON.parse(json) as typeof snapshot & {
    review: { repoId: string; branch?: string; prNumber?: number; createdAt?: number };
    version: { n: number; headSha: string; mergeBaseSha: string; baseRef: string; fetchedAt?: number };
  };
  seeded.review.id = REVIEW_ID;
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    // The review's own rows too: jobs persist against reviews(id), so a
    // snapshot-only seed could never enqueue the on-demand concept job
    // (#216). Tables mirror migration 001 (the service's migrate keeps
    // IF NOT EXISTS tables as-is).
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
    ).run(REVIEW_ID, seeded.review.repoId, seeded.review.branch ?? "main", seeded.review.prNumber ?? null, seeded.version.n, seeded.review.createdAt ?? Date.now(), "{}");
    db.prepare(
      "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(REVIEW_ID, seeded.version.n, seeded.version.headSha, seeded.version.mergeBaseSha, seeded.version.baseRef, seeded.version.fetchedAt ?? Date.now(), "{}");
    db.prepare(
      "INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot",
    ).run(REVIEW_ID, seeded.rev, JSON.stringify(seeded), Date.now());
  } finally {
    db.close();
  }
}

test.describe("guide over real service", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-guide-data-"));
    await seedFixture(dataDir);
    svc = await startService(dataDir, { agent: "replay" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function openSeededReview(page: Page): Promise<void> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/review/${REVIEW_ID}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText(
      "Unfold obsolete folded response headers",
      { timeout: 30_000 },
    );
  }

  /**
   * Issue #167: the seed carries an open pinned card under C-problem
   * that overlays the controls below it — close it first, as a reader
   * would.
   */
  async function closeSeedCard(page: Page): Promise<void> {
    // The seeded service is shared by this file's tests: the card may
    // already be closed by an earlier test.
    const closer = page.locator('#C-problem [data-expansion]').getByRole("button", { name: "Close" });
    if ((await closer.count()) > 0) await closer.click();
  }

  test("pages navigate and citations reveal over the real API", async ({ page }) => {
    test.setTimeout(120_000);
    await openSeededReview(page);
    await closeSeedCard(page);
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
    await expect(
      page.locator('[id="L-src-urllib3-connection.py-91"].hl'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("card collapse action applies over the real API", async ({ page }) => {
    test.setTimeout(120_000);
    await openSeededReview(page);
    await closeSeedCard(page);
    // The actions route collapses the card to its title row; expanding restores it.
    await page.locator("#C-central > .chead").getByRole("button", { name: "Collapse" }).click();
    await expect(page.locator("#C-central")).toHaveClass(/collapsed/, { timeout: 10_000 });
    await page.locator("#C-central").getByRole("button", { name: "Expand" }).click();
    await expect(page.locator("#C-central")).not.toHaveClass(/collapsed/, { timeout: 10_000 });
  });
});
