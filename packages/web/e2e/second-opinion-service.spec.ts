/**
 * Second opinion over the real service with the replay runner
 * (`UNVIBE_AGENT=replay`) on the demo fixture.
 *
 * Seeds the generated `fixtures/urllib3-5020/snapshot.json` (canonicalized,
 * like `guide-service.spec.ts`) into a fresh data dir, starts the built
 * service, runs a blind second opinion on the bare-LF finding via
 * `POST /api/reviews/:id/actions`, waits for the job, and verifies the
 * stored result (verdict, citations, missed) plus that the job's prompt
 * snapshot contains no guide text. Then opens the finding page in the UI
 * and checks the verdict chip renders.
 *
 * Requires `mise run build` first. Skipped when the service isn't built.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/urllib3-5020", import.meta.url));
const REVIEW_ID = "so-seed";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

async function seedFixture(dataDir: string): Promise<void> {
  const snapshot = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "snapshot.json"), "utf8")) as {
    rev: number;
    review: { id: string };
  };
  const meta = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "meta.json"), "utf8")) as {
    keyAliases: Record<string, string>;
  };
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
    // Jobs persist with a FOREIGN KEY to reviews(id): insert the minimal
    // parent rows so second-opinion jobs can enqueue (same as
    // pipeline.test.ts makeDemoReview).
    db.exec(
      `CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
        local_path TEXT NOT NULL, last_opened INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, repo_id TEXT NOT NULL REFERENCES repos(id),
        branch TEXT NOT NULL, pr_number INTEGER, current_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, data JSON NOT NULL DEFAULT '{}'
      );`,
    );
    db.prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO NOTHING",
    ).run("seed-repo", "seed", "repo", "/tmp", Date.now());
    db.prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO NOTHING",
    ).run(REVIEW_ID, "seed-repo", "main", 5020, 1, Date.now(), JSON.stringify({}));
  } finally {
    db.close();
  }
}

async function apiFetch(
  origin: string,
  token: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${origin}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, json };
}

test.describe("second opinion over real service (replay)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-so-data-"));
    await seedFixture(dataDir);
    svc = await startService(dataDir, { agent: "replay" });
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("blind second opinion on a finding completes, cites code, prompt has no guide text", async ({ page }) => {
    test.setTimeout(120_000);
    if (!svc) throw new Error("service not running");
    const { origin, token } = svc;

    // Run a blind second opinion on the bare-LF finding (Evidence card).
    const acted = await apiFetch(origin, token, "POST", `/api/reviews/${REVIEW_ID}/actions`, {
      kind: "second_opinion",
      cardId: "flf-ev",
      mode: "blind",
    });
    expect(acted.status).toBe(200);
    const jobId = (acted.json as { jobId?: string }).jobId;
    expect(jobId).toBeTruthy();

    // Wait for the job to finish via the jobs API.
    let job: { state?: string; error?: string } | null = null;
    for (let i = 0; i < 100; i++) {
      const res = await apiFetch(origin, token, "GET", `/api/jobs?review=${REVIEW_ID}`);
      expect(res.status).toBe(200);
      const jobs = (res.json as { jobs: { id: string; state: string; error?: string }[] }).jobs;
      job = jobs.find((j) => j.id === jobId) ?? null;
      if (job && (job.state === "done" || job.state === "error" || job.state === "cancelled")) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(job?.state).toBe("done");

    // Prompt snapshot contains no guide text.
    const promptRes = await apiFetch(origin, token, "GET", `/api/jobs/${jobId}/prompt`);
    expect(promptRes.status).toBe(200);
    const prompt = (promptRes.json as { promptSnapshot: string }).promptSnapshot;
    expect(prompt).toContain("Second opinion");
    expect(prompt).not.toContain("are not unfolded");
    expect(prompt).not.toContain("The central change");

    // Snapshot carries the stored result with citations + missed.
    const snapRes = await apiFetch(origin, token, "GET", `/api/reviews/${REVIEW_ID}`);
    expect(snapRes.status).toBe(200);
    const snap = snapRes.json as {
      pages: { id: string; cards: { id: string; secondOpinions?: { verdict: string; blocks: unknown[]; missed?: string; model: string }[] }[] }[];
    };
    const finding = snap.pages.find((p) => p.id === "f-lf");
    expect(finding).toBeDefined();
    const opinions = finding!.cards.flatMap((c) => c.secondOpinions ?? []);
    expect(opinions).toHaveLength(1);
    expect(opinions[0].verdict).toBe("partly");
    expect(opinions[0].blocks.length).toBeGreaterThan(0);
    expect(opinions[0].missed).toBeTruthy();

    // UI renders the verdict chip on the finding page.
    await page.goto(`${origin}/review/${REVIEW_ID}/page/f-lf?token=${token}`);
    await expect(page.locator("#page .eyebrow")).toContainText("Agent finding", { timeout: 30_000 });
    await expect(page.locator('[data-so][data-verdict="partly"]')).toBeVisible({ timeout: 30_000 });
  });
});
