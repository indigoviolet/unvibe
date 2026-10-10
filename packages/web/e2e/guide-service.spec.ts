/**
 * Guide over the real service (web-guide owner, dev-only verification).
 *
 * The guide pipeline is still being built, so this spec seeds the
 * generated `fixtures/urllib3-5020/snapshot.json` straight into the
 * service's ReviewStore (`review_snapshots` row — the same row
 * `ReviewStore.putSnapshot` writes; see `packages/service/src/state/store.ts`
 * and migration 002) and loads it through the real HTTP API:
 * pages navigate, and card actions against the unwired M3 stub fail
 * gracefully with a toast.
 *
 * The seed rewrites the fixture's short citation keys (`diff:conn:…`) to
 * canonical file keys using `meta.json` `keyAliases`. That rewrite stands
 * in for the pipeline fix (citations must be stored canonical or the
 * snapshot must carry the alias map); without it diff reveals cannot
 * resolve in live mode.
 *
 * Requires `mise run build` first (runs `packages/service/dist/index.js`
 * and serves `packages/web/dist`). Skipped when the service isn't built.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const SERVICE_ENTRY = fileURLToPath(new URL("../../service/dist/index.js", import.meta.url));
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
  const seeded = JSON.parse(json) as typeof snapshot;
  seeded.review.id = REVIEW_ID;
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS review_snapshots (
        review_id TEXT PRIMARY KEY,
        rev INTEGER NOT NULL,
        snapshot JSON NOT NULL,
        updated_at INTEGER NOT NULL
      );`,
    );
    db.prepare(
      "INSERT INTO review_snapshots (review_id, rev, snapshot, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(review_id) DO UPDATE SET rev = excluded.rev, snapshot = excluded.snapshot",
    ).run(REVIEW_ID, seeded.rev, JSON.stringify(seeded), Date.now());
  } finally {
    db.close();
  }
}

interface RunningService {
  origin: string;
  token: string;
  stop: () => Promise<void>;
}

/** Spawn the built service on an ephemeral port; parse origin + token. */
async function startService(dataDir: string): Promise<RunningService> {
  const { spawn } = await import("node:child_process");
  const proc = spawn(process.execPath, [SERVICE_ENTRY], {
    env: { ...process.env, UNVIBE_DATA_DIR: dataDir, UNVIBE_PORT: "0", UNVIBE_REPO_ROOTS: "", UNVIBE_AGENT: "replay", },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const started = new Promise<{ origin: string; token: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service did not start: ${out}`)), 30_000);
    proc.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
      const m = out.match(/Unvibe listening on (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ origin: m[1], token: m[2] });
      }
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`service exited with ${code}: ${out}`));
      }
    });
  });
  const { origin, token } = await started;
  return {
    origin,
    token,
    stop: () =>
      new Promise<void>((resolve) => {
        proc.on("exit", () => resolve());
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill("SIGKILL");
          resolve();
        }, 5000).unref?.();
      }),
  };
}

test.describe("guide over real service", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-guide-data-"));
    await seedFixture(dataDir);
    svc = await startService(dataDir);
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

  test("pages navigate and citations reveal over the real API", async ({ page }) => {
    test.setTimeout(120_000);
    await openSeededReview(page);
    await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
    await expect(page).toHaveURL(/\/review\/guide-seed\/page\/c-obs-fold/);
    await expect(page.locator("#page h1.title")).toContainText("Obsolete line folding");
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

  test("unwired actions fail gracefully with a toast", async ({ page }) => {
    test.setTimeout(120_000);
    await openSeededReview(page);
    // The M3 actions stub answers 501: optimistic update rolls back.
    await page.locator("#C-central").getByRole("button", { name: "Mark read" }).click();
    await expect(page.locator("#toast")).toContainText(/failed|service/i, { timeout: 10_000 });
    await expect(page.locator("#C-central")).not.toHaveClass(/read/, { timeout: 10_000 });
  });
});
