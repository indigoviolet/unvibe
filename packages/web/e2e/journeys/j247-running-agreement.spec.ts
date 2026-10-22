/**
 * J247 (#247): the start page dots and the review bar pill agree.
 *
 * Real service, replay runner. The reviews list and the review page count
 * the same thing — live jobs — so they agree while work runs and after
 * it stops, including after queued jobs are cancelled (their runs never
 * execute, so the stored pipeline stages stay `running`). No polling was
 * added: both sides read the live job list on fetch/patch.
 *
 * The replay pipeline drains in well under a second on a fast machine
 * (its jobs resolve without yielding to HTTP, so no poll can catch them
 * mid-flight), so the while-running agreement is asserted at the API
 * level in a tight sample loop. The stuck state — stages `running` with
 * no live job, exactly what cancelling queued pipeline jobs leaves behind
 * (pinned by `reviews-running-247.test.ts` at the service level) — is
 * seeded straight into the snapshot store while the service is stopped,
 * the same pattern the visual tour uses; both pages then read the same
 * current state deterministically.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const LIVE = new Set(["queued", "running", "backing-off"]);

type JobRow = { id: string; kind: string; state: string };

test.describe("J247 start dots and review pill agree", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j247-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "j247" });
    // Serialize the pipeline so queued jobs exist long enough to cancel.
    const put = await apiJson(svc, "PUT", "/api/settings", { sessionsPerProvider: 1 });
    if (put.status !== 200) throw new Error(`settings update failed: ${put.status}`);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function createDemo(): Promise<string> {
    if (!svc) throw new Error("no service");
    const created = await apiJson(svc, "POST", "/api/reviews", { repoId: "demo" });
    if (created.status !== 201 && created.status !== 200 && created.status !== 202) {
      throw new Error(`demo create failed: ${created.status} ${JSON.stringify(created.json)}`);
    }
    return (created.json as { review: { id: string } }).review.id;
  }

  async function liveJobs(on: RunningService, reviewId: string): Promise<JobRow[]> {
    const res = await apiJson(on, "GET", `/api/jobs?review=${reviewId}`);
    return (res.json as { jobs: JobRow[] }).jobs.filter((j) => LIVE.has(j.state));
  }

  async function listStatus(on: RunningService, reviewId: string): Promise<string> {
    const res = await apiJson(on, "GET", "/api/reviews");
    const found = (res.json as { reviews: { id: string; guideStatus: string }[] }).reviews.find(
      (r) => r.id === reviewId,
    );
    if (!found) throw new Error("review missing from the list");
    return found.guideStatus;
  }

  async function snapshotLive(on: RunningService, reviewId: string): Promise<JobRow[]> {
    const res = await apiJson(on, "GET", `/api/reviews/${reviewId}`);
    const jobs = (res.json as { jobs?: JobRow[] }).jobs ?? [];
    return jobs.filter((j) => LIVE.has(j.state));
  }

  test("list and snapshot agree through a live pipeline and after it drains", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    const reviewId = await createDemo();

    // Sample the agreement from creation until the pipeline drains: the
    // list says running exactly when the snapshot carries live jobs.
    let sawLive = false;
    const start = Date.now();
    for (;;) {
      const live = await snapshotLive(svc, reviewId);
      const status = await listStatus(svc, reviewId);
      expect(status === "running", `list=${status} with ${live.length} live jobs`).toBe(live.length > 0);
      if (live.length > 0) sawLive = true;
      else if (sawLive && Date.now() - start > 2000) break;
      if (Date.now() - start > 90_000) throw new Error("pipeline never drained");
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!sawLive) throw new Error("never observed live jobs (pipeline drained first)");
    expect(await liveJobs(svc, reviewId)).toHaveLength(0);

    // Settled: neither page shows anything running.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    const row = page.locator(`[data-testid="session-${reviewId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByRole("status", { name: "Working" })).toHaveCount(0);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#reviewbar").getByRole("link", { name: /running, .* queued/ })).toHaveCount(0);
  });

  test("list and review agree with stages stuck at running and no live job", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    // Separate service so it can be stopped for seeding. The demo review
    // runs its pipeline to a drained, guided state first.
    const stuckDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j247-stuck-"));
    let stuck: RunningService | null = null;
    try {
      stuck = await startService(stuckDir, { agent: "replay", label: "j247stuck" });
      const created = await apiJson(stuck, "POST", "/api/reviews", { repoId: "demo" });
      if (created.status !== 201 && created.status !== 200 && created.status !== 202) {
        throw new Error(`demo create failed: ${created.status}`);
      }
      const reviewId = (created.json as { review: { id: string } }).review.id;
      // Quiesce: guide filled and nothing live.
      {
        const start = Date.now();
        for (;;) {
          const snap = await apiJson(stuck, "GET", `/api/reviews/${reviewId}`);
          const pages = (snap.json as { pages?: { id: string; cards: unknown[] }[] }).pages ?? [];
          const root = pages.find((p) => p.id === "root");
          const live = ((snap.json as { jobs?: JobRow[] }).jobs ?? []).filter((j) => LIVE.has(j.state));
          if (root && root.cards.length > 0 && live.length === 0) break;
          if (Date.now() - start > 120_000) throw new Error("demo pipeline never drained");
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      // Stop and seed the stuck shape: pipeline stages `running` with no
      // live job behind them (what cancelling queued pipeline jobs leaves;
      // the stored jobs are all terminal, so nothing reruns on boot).
      await stuck.stop();
      stuck = null;
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(path.join(stuckDir, "unvibe.db"));
      try {
        const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get(reviewId) as
          | { rev: number; snapshot: string }
          | undefined;
        if (!row) throw new Error("no snapshot row to seed");
        const seeded = JSON.parse(row.snapshot) as {
          pages: unknown[];
          pipeline?: { stages: Record<string, string> };
        };
        if (seeded.pages.length === 0) throw new Error("seed needs the finished guide");
        seeded.pipeline = { stages: { reader: "done", base: "running", critic: "running", "hunk-pass": "running" } };
        db.prepare("UPDATE review_snapshots SET rev = ?, snapshot = ? WHERE review_id = ?").run(
          row.rev + 1,
          JSON.stringify(seeded),
          reviewId,
        );
      } finally {
        db.close();
      }
      stuck = await startService(stuckDir, { agent: "replay", label: "j247stuck2" });
      const origin = stuck.origin;
      const token = stuck.token;

      // Nothing live: the list stops saying running, and fresh loads of
      // both pages show nothing running — while the finished guide itself
      // still renders (the owner's report: dots outside, silence inside).
      expect(await listStatus(stuck, reviewId)).not.toBe("running");
      await page.goto(`${origin}/?token=${token}`);
      const row = page.locator(`[data-testid="session-${reviewId}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row.getByRole("status", { name: "Working" })).toHaveCount(0);
      await page.goto(`${origin}/review/${reviewId}?token=${token}`);
      await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("#reviewbar").getByRole("link", { name: /running, .* queued/ })).toHaveCount(0);
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    } finally {
      await stuck?.stop().catch(() => {});
      rmSync(stuckDir, { recursive: true, force: true });
    }
  });
});
