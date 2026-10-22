/**
 * #247: start-page dots and review-bar pill agree on "running".
 *
 * `guideStatus` (GET /api/reviews) and the review bar's `showJobs`
 * (snapshot jobs) both count live jobs only: a stored `running` pipeline
 * stage with no live job behind it (a queued job was cancelled before it
 * ran, so its run never marked the stage) is stuck, not work. Before the
 * fix the list reported `running` from the stages while the review showed
 * nothing live.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot, Session } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

/** Runner whose turns hang until released (abort-ignoring, like a stuck call). */
class HangingRunner extends FakeAgentRunner {
  gate: Promise<void>;
  release!: () => void;
  constructor() {
    super();
    this.gate = new Promise<void>((r) => {
      this.release = r;
    });
  }
  override async *prompt(
    session: Session,
    text: string,
    _signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    this.prompts.push({ sessionId: session.id, text });
    void _signal;
    await this.gate;
    yield { type: "done", stopReason: "end_turn" };
  }
}

function makeSnapshot(id: string): ReviewSnapshot {
  return {
    review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
    version: { n: 1, headSha: "abc1234def5678abc1234def5678abc1234def5", mergeBaseSha: "0000000", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files: [{
      fileKey: "a-py", path: "a.py", category: "source",
      hunks: [{
        contentHash: "h111", header: "@@ -1,2 +1,3 @@", newStart: 1, newEnd: 3, oldStart: 1, oldEnd: 2, added: 1, removed: 0,
        lines: [
          { kind: "ctx", oldLine: 1, newLine: 1, text: "x = 1" },
          { kind: "add", newLine: 2, text: "y = 2" },
          { kind: "ctx", oldLine: 2, newLine: 3, text: "z = 3" },
        ],
      }],
    }],
    pages: [{ id: "root", kind: "root", title: "Guide", cards: [] }],
    annotations: [], hunkStates: [], fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [], contributions: [], logTail: [], rev: 1, ingest: { status: "ready" },
  };
}

async function waitFor(check: () => boolean, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const LIVE = new Set(["queued", "running", "backing-off"]);

describe("running agreement between the reviews list and the review page (#247)", () => {
  it("reports running while jobs are live, and stops when no job is live even with stages stuck at running", async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = new HangingRunner();
    const { app, ctx } = await createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
    try {
      ctx.settings.update({ autoGoDeeper: false });
      const id = `rv_run${Math.random().toString(36).slice(2, 8)}`;
      ctx.db.prepare("INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run("demo", "demo", "urllib3-5020", "/tmp", Date.now());
      ctx.db.prepare("INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run(id, "demo", "main", null, 1, Date.now(), JSON.stringify({}));
      ctx.db.prepare("INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING").run(id, 1, "abc1234def5678abc1234def5678abc1234def5", "0000000", "main", Date.now(), JSON.stringify({}));
      ctx.reviews.putSnapshot(id, makeSnapshot(id));

      await ctx.pipeline.startReview(id);
      await waitFor(() => ctx.jobs.listByReview(id).some((j) => j.state === "running"));

      const listStatus = async (): Promise<string> => {
        const res = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
        return (res.json() as { reviews: { id: string; guideStatus: string }[] }).reviews.find((r) => r.id === id)!.guideStatus;
      };
      const snapshotLive = async () => {
        const res = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
        return ((res.json() as ReviewSnapshot).jobs ?? []).filter((j) => LIVE.has(j.state));
      };

      // While work runs, both sides say so (the bar reads snapshotLive).
      expect(ctx.jobs.listByReview(id).filter((j) => LIVE.has(j.state)).length).toBeGreaterThan(0);
      expect(await listStatus()).toBe("running");
      expect((await snapshotLive()).length).toBeGreaterThan(0);

      // Cancel everything: queued cancels never execute, so no run marks
      // its stage and the stored stages stay `running`.
      for (const j of ctx.jobs.listByReview(id)) {
        if (LIVE.has(j.state)) await app.inject({ method: "POST", url: `/api/jobs/${j.id}/cancel`, headers: authed });
      }
      await waitFor(() => ctx.jobs.listByReview(id).filter((j) => LIVE.has(j.state)).length === 0);
      expect(ctx.reviews.getSnapshot(id)?.pipeline?.stages["reader"]).toBe("running");

      // Nothing live: neither side reports running.
      expect(await snapshotLive()).toHaveLength(0);
      expect(await listStatus()).not.toBe("running");
    } finally {
      agents.release();
      await app.close();
    }
  });
});
