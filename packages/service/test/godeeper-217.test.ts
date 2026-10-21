/**
 * #217: go-deeper placeholders are written automatically after the guide
 * when `autoGoDeeper` is on (default), at background priority, through the
 * same fill path as Generate; an on-click Generate while the automatic
 * job is queued/running reuses that job. Fake runner only.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, Job, ReviewSnapshot, Session } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
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

async function waitFor(check: () => boolean, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const READER = `## The problem

It was broken.

## The central change

Now it works.

\`\`\`json
{"cardIds": ["problem", "central"], "pendingCards": [{"id": "g-flow", "label": "Data flow", "why": "follow it"}, {"id": "g-other", "label": "Other direction", "why": "check it"}]}
\`\`\`
`;

const FILL = `Filled body.

\`\`\`json
{"title": "Filled"}
\`\`\`
`;

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
    pages: [{ id: "root", kind: "root", title: "Guide", saved: false, cards: [] }],
    annotations: [], hunkStates: [], fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [], contributions: [], logTail: [], rev: 1, ingest: { status: "ready" },
  };
}

async function setup(agents: FakeAgentRunner, auto: boolean) {
  const { app, ctx } = await createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
  ctx.settings.update({ autoGoDeeper: auto });
  const id = `rv_gd${Math.random().toString(36).slice(2, 8)}`;
  ctx.db.prepare("INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run("demo", "demo", "urllib3-5020", "/tmp", Date.now());
  ctx.db.prepare("INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run(id, "demo", "main", null, 1, Date.now(), JSON.stringify({}));
  ctx.db.prepare("INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING").run(id, 1, "abc1234def5678abc1234def5678abc1234def5", "0000000", "main", Date.now(), JSON.stringify({}));
  ctx.reviews.putSnapshot(id, makeSnapshot(id));
  return { app, ctx, id };
}

function baseAgents(extra: { match: string; events: AgentEvent[] }[] = []): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    ...extra,
    { match: "Data flow", events: textEvents(FILL) },
    { match: "Other direction", events: textEvents(FILL) },
    { match: "Reader", events: textEvents(READER) },
  ]);
}

describe("auto go-deeper (#217)", () => {
  it("enqueues every placeholder at background priority when on, and fills them", { timeout: 90000 }, async () => {
    const { app, ctx, id } = await setup(baseAgents(), true);
    try {
      await ctx.pipeline.startReview(id);
      await waitFor(() => {
        const root = ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root");
        return !!root && root.cards.length >= 4 && root.cards.every((c) => !c.pending);
      });
      const jobs = ctx.jobs.listByReview(id).filter((j: Job) => j.kind === "go-deeper");
      expect(jobs).toHaveLength(2);
      expect(jobs.every((j) => j.priority === JOB_PRIORITY.background)).toBe(true);
      expect(jobs.map((j) => j.cardId).sort()).toEqual(["g-flow", "g-other"]);
    } finally {
      await app.close();
    }
  });

  it("enqueues nothing when off; placeholders wait for a click", { timeout: 90000 }, async () => {
    const { app, ctx, id } = await setup(baseAgents(), false);
    try {
      await ctx.pipeline.startReview(id);
      await waitFor(() => ctx.jobs.listByReview(id).some((j: Job) => j.kind === "reader" && j.state === "done"));
      // Reader's follow-ups (critic etc.) may still run; go-deeper must not.
      await new Promise((r) => setTimeout(r, 300));
      expect(ctx.jobs.listByReview(id).filter((j: Job) => j.kind === "go-deeper")).toHaveLength(0);
      const root = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!;
      expect(root.cards.filter((c) => c.pending).map((c) => c.id).sort()).toEqual(["g-flow", "g-other"]);
    } finally {
      await app.close();
    }
  });

  it("on-click Generate while the automatic job runs reuses that job", { timeout: 90000 }, async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    class Gated extends FakeAgentRunner {
      override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
        if (text.includes("# Go deeper")) {
          this.prompts.push({ sessionId: session.id, text });
          await gate;
          yield* textEvents(FILL);
          return;
        }
        yield* super.prompt(session, text);
      }
    }
    const agents = new Gated([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "Other direction", events: textEvents(FILL) },
      { match: "Reader", events: textEvents(READER) },
    ]);
    const { app, ctx, id } = await setup(agents, true);
    try {
      await ctx.pipeline.startReview(id);
      await waitFor(() => ctx.jobs.listByReview(id).some((j: Job) => j.kind === "go-deeper" && j.cardId === "g-flow" && j.state === "running"));
      const autoJob = ctx.jobs.listByReview(id).find((j: Job) => j.kind === "go-deeper" && j.cardId === "g-flow")!;
      const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/actions`, headers: authed, payload: { kind: "generate", cardId: "g-flow" } } as never);
      expect(res.statusCode).toBe(200);
      expect((res.json() as { jobId?: string }).jobId).toBe(autoJob.id);
      expect(ctx.jobs.listByReview(id).filter((j: Job) => j.kind === "go-deeper" && j.cardId === "g-flow")).toHaveLength(1);
      release();
      await waitFor(() => {
        const root = ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root");
        const card = root?.cards.find((c) => c.id === "g-flow");
        return !!card && !card.pending;
      });
      const root = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!;
      expect(root.cards.filter((c) => c.id === "g-flow")).toHaveLength(1);
    } finally {
      release();
      await app.close();
    }
  });
});
