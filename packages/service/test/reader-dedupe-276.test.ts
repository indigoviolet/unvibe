/**
 * Missing reader rows (issue #276).
 *
 * The job dedupe namespace used to be global, so a review whose reader
 * was queued while another review's reader (same base version) was
 * still running attached to the foreign job: the job ran for the other
 * review while this one waited forever with no reader row of its own —
 * hunk passes proceeded, the guide stayed on "Building the guide", and
 * a later attempt (foreign job done) worked, matching the intermittent
 * report. Dedupe is now scoped per review: every review gets its own
 * reader job.
 *
 * Through the real stack (live HTTP + pipeline + queue) with a
 * scripted fake runner. No real agents, no network.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot, Session } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

const MINIMAL_READER = `## The problem

The problem paragraph.

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

const HUNK_REPLY =
  `Toy summary\n\n\`\`\`json\n{"hunk": {"summary": "Toy summary", "hiddenReason": null}}\n\`\`\`\n`;

async function waitFor(check: () => boolean, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

type App = Awaited<ReturnType<typeof createApp>>;

function seedSnapshot(ctx: App["ctx"], id: string): void {
  ctx.db
    .prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run("demo", "demo", "demo", "/tmp", Date.now());
  ctx.db
    .prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run(id, "demo", "main", null, 1, Date.now(), JSON.stringify({}));
  ctx.db
    .prepare(
      "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING",
    )
    .run(id, 1, "abc1234def5678abc1234def5678abc1234def5", "0000000", "main", Date.now(), JSON.stringify({}));
  ctx.reviews.putSnapshot(id, {
    review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
    version: {
      n: 1,
      headSha: "abc1234def5678abc1234def5678abc1234def5",
      mergeBaseSha: "0000000",
      baseRef: "main",
      fetchedAt: Date.now(),
      idMapping: {},
    },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Guide", cards: [] }],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
    pipeline: {
      stages: { reader: "pending", base: "pending", critic: "pending", "hunk-pass": "pending", "go-deeper": "pending" },
    },
  } as never);
}

/** Fake that parks the first reader turn on a gate; later readers run free. */
class GatedReader extends FakeAgentRunner {
  readerCalls = 0;
  release!: () => void;
  gate: Promise<void>;
  constructor() {
    super([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "Hunk pass", events: textEvents(HUNK_REPLY) },
    ]);
    this.gate = new Promise<void>((r) => {
      this.release = r;
    });
  }
  override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
    if (text.includes("# Reader task")) {
      this.readerCalls += 1;
      this.prompts.push({ sessionId: session.id, text });
      if (this.readerCalls === 1) await this.gate;
      yield* textEvents(MINIMAL_READER);
      return;
    }
    yield* super.prompt(session, text);
  }
}

describe("reader jobs are per-review (#276)", () => {
  it("a second review started while another review's reader runs gets its own reader job", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = new GatedReader();
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      expect(created.statusCode).toBe(201);
      const idA = (created.json() as ReviewSnapshot).review.id;
      // A's reader is open (parked on the gate).
      await waitFor(() => agents.readerCalls >= 1);
      const readerA = ctx.jobs.listByReview(idA).find((j) => j.kind === "reader")!;
      expect(readerA).toBeTruthy();
      expect(["queued", "running", "backing-off"]).toContain(readerA.state);

      // B starts while A's reader is still open.
      seedSnapshot(ctx, "rv_b_276");
      await ctx.pipeline.startReview("rv_b_276");
      // B's hunk pass proceeds...
      await waitFor(() => ctx.jobs.listByReview("rv_b_276").length > 1);
      // ...and B has its OWN reader job (not A's): the failure mode was
      // B attaching to A's live reader, leaving B with no reader row.
      const readersB = ctx.jobs.listByReview("rv_b_276").filter((j) => j.kind === "reader");
      expect(readersB).toHaveLength(1);
      expect(readersB[0]!.reviewId).toBe("rv_b_276");
      expect(readersB[0]!.id).not.toBe(readerA.id);

      // Release A: both guides land on their own readers' cards.
      agents.release();
      await waitFor(() => ctx.reviews.getSnapshot(idA)?.pages.find((p) => p.id === "root")?.cards.length === 2, 60000);
      await waitFor(() => ctx.reviews.getSnapshot("rv_b_276")?.pages.find((p) => p.id === "root")?.cards.length === 2, 60000);
      expect(ctx.jobs.get(readersB[0]!.id)?.state).toBe("done");

      // A later review (no live foreign reader) gets its own reader too.
      seedSnapshot(ctx, "rv_c_276");
      await ctx.pipeline.startReview("rv_c_276");
      await waitFor(() => ctx.jobs.listByReview("rv_c_276").some((j) => j.kind === "reader"));
      const readersC = ctx.jobs.listByReview("rv_c_276").filter((j) => j.kind === "reader");
      expect(readersC).toHaveLength(1);
      expect(readersC[0]!.reviewId).toBe("rv_c_276");
    } finally {
      agents.release();
      await app.close();
    }
  });

  it("a reader that cannot be queued fails the stage with Retry", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "Hunk pass", events: textEvents(HUNK_REPLY) },
    ]);
    // Job persistence that refuses reader inserts: enqueueReader throws.
    const failingPersist = {
      save: (job: { kind: string }) => {
        if (job.kind === "reader") throw new Error("store unavailable");
      },
      listAll: () => [],
      get: () => undefined,
    };
    const { JobQueue } = await import("../src/jobs/index.js");
    const throwingJobs = new JobQueue({ persist: failingPersist as never });
    const { app, ctx } = await createApp("tok", { agents, jobs: throwingJobs });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;
      // The guide shows the failed state with Retry instead of sitting
      // on "Building the guide" forever with no reader job.
      await waitFor(() => {
        const stages = (ctx.reviews.getSnapshot(id)?.pipeline?.stages ?? {}) as Record<string, string>;
        return stages["reader"] === "error";
      });
      const errors = (ctx.reviews.getSnapshot(id)?.pipeline as { errors?: Record<string, string> } | undefined)?.errors;
      expect(errors?.["reader"]).toMatch(/store unavailable/);
      expect(ctx.jobs.listByReview(id)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
