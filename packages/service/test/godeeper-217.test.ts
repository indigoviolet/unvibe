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
{"cardIds": ["problem", "central"], "pendingCards": [{"id": "g-flow", "label": "Data flow", "why": "follow it"}, {"id": "g-other", "label": "Other direction", "why": "check it"}, {"id": "g-third", "label": "Third direction", "why": "check it too"}], "plotlines": [{"id": "main-thread", "name": "Main thread", "description": "d", "hunks": []}]}
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

async function setup(agents: FakeAgentRunner, auto: boolean, extra: Record<string, unknown> = {}) {
  const { app, ctx } = await createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
  ctx.settings.update({ autoGoDeeper: auto, ...extra });
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
    { match: "Third direction", events: textEvents(FILL) },
    { match: "Changed direction", events: textEvents(FILL) },
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
      // Every placeholder (the reader writes 3-5 directions; here 3).
      const jobs = ctx.jobs.listByReview(id).filter((j: Job) => j.kind === "go-deeper");
      expect(jobs).toHaveLength(3);
      expect(jobs.every((j) => j.priority === JOB_PRIORITY.background)).toBe(true);
      expect(jobs.map((j) => j.cardId).sort()).toEqual(["g-flow", "g-other", "g-third"]);
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
      expect(root.cards.filter((c) => c.pending).map((c) => c.id).sort()).toEqual(["g-flow", "g-other", "g-third"]);
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

  it("runs after the hunk summaries and the critic (#217 order)", { timeout: 90000 }, async () => {
    const agents = baseAgents();
    const { app, ctx, id } = await setup(agents, true, { sessionsPerProvider: 1 });
    try {
      await ctx.pipeline.startReview(id);
      await waitFor(() => ctx.jobs.listByReview(id).filter((j: Job) => j.kind === "go-deeper").every((j: Job) => j.state === "done")
        && ctx.jobs.listByReview(id).filter((j: Job) => j.kind === "go-deeper").length === 3);
      const kinds = agents.prompts.map((pr) =>
        pr.text.includes("# Hunk pass") ? "hunk"
        : pr.text.includes("# Critic task") ? "critic"
        : pr.text.includes("# Go deeper") ? "go-deeper"
        : "other",
      ).filter((k) => k !== "other");
      expect(kinds.indexOf("critic")).toBeGreaterThan(kinds.indexOf("hunk"));
      expect(kinds.indexOf("go-deeper")).toBeGreaterThan(kinds.indexOf("critic"));
      // Enqueue order in the background band is hunk < critic < go-deeper.
      const listed = ctx.jobs.listByReview(id).map((j: Job) => j.kind);
      expect(listed.indexOf("critic")).toBeGreaterThan(listed.indexOf("hunk-pass"));
      expect(listed.indexOf("go-deeper")).toBeGreaterThan(listed.indexOf("critic"));
    } finally {
      await app.close();
    }
  });

  it("on resume, go-deeper is enqueued before other background work (plotline assign)", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "Seeded direction", events: textEvents(FILL) },
      { match: "# Plotline assign", events: textEvents("{\"assignments\": {}}\n") },
    ]);
    const { app, ctx, id } = await setup(agents, true, { sessionsPerProvider: 1 });
    try {
      // Seed a finished guide with one pending placeholder, named
      // plotlines, and a diff too large for the reader to have seen its
      // hunks (so plotline assign is the other background job in play).
      await ctx.reviews.mutate(id, (draft) => {
        draft.pipeline = { stages: { reader: "done", base: "done", critic: "done", "hunk-pass": "done", "go-deeper": "done" } };
        draft.plotlines = [{ id: "main-thread", name: "Main thread", description: "d", hunks: [] }];
        const root = draft.pages.find((pg) => pg.id === "root")!;
        root.cards = [{
          id: "g-seeded", pageId: "root", title: "Seeded direction", level: "standard", collapsed: false,
          revision: 1, blocks: [], undoStack: [], pending: { label: "Seeded direction", why: "seeded" },
        } as typeof root.cards[number]];
        const hunk = draft.files[0].hunks[0];
        // A header this large pushes even the hunk-summary rows past the
        // prompt cap, so the reader never saw this hunk (assign territory).
        hunk.header = "x".repeat(400_000);
      });
      await ctx.pipeline.resumeReview(id);
      await waitFor(() => {
        const list = ctx.jobs.listByReview(id);
        return list.some((j: Job) => j.kind === "plotline-assign" && j.state === "done")
          && list.some((j: Job) => j.kind === "go-deeper" && j.state === "done");
      });
      const listed = ctx.jobs.listByReview(id).map((j: Job) => j.kind);
      expect(listed.indexOf("go-deeper")).toBeGreaterThanOrEqual(0);
      expect(listed.indexOf("go-deeper")).toBeLessThan(listed.indexOf("plotline-assign"));
      const kinds = agents.prompts.map((pr) =>
        pr.text.includes("# Go deeper") ? "go-deeper" : pr.text.includes("# Plotline assign") ? "plotline" : "other",
      ).filter((k) => k !== "other");
      expect(kinds.indexOf("go-deeper")).toBeLessThan(kinds.indexOf("plotline"));
    } finally {
      await app.close();
    }
  });

  it("after a refresh, only the replaced placeholder is generated; the kept written card is reused", { timeout: 90000 }, async () => {
    const agents = baseAgents();
    const { app, ctx, id } = await setup(agents, true);
    try {
      await ctx.pipeline.startReview(id);
      await waitFor(() => {
        const root = ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root");
        return !!root && root.cards.length >= 5 && root.cards.every((c) => !c.pending);
      });
      const before = ctx.reviews.getSnapshot(id)!;
      const keptBefore = before.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "g-flow")!;
      const keptBlocks = JSON.stringify(keptBefore.blocks);
      const keptRevision = keptBefore.revision;
      const flowFillsBefore = agents.prompts.filter((pr) => pr.text.includes("# Go deeper") && pr.text.includes("Data flow")).length;
      // Refresh to a new version: g-flow's written card is kept; g-other is
      // replaced by a new pending placeholder (new direction).
      await ctx.reviews.mutate(id, (draft) => {
        draft.version = { ...draft.version, n: 2 };
        draft.review.currentVersion = 2;
        const root = draft.pages.find((p) => p.id === "root")!;
        const changed = root.cards.find((c) => c.id === "g-other")!;
        changed.pending = { label: "Changed direction", why: "new why" };
        changed.blocks = [];
      });
      await ctx.pipeline.resumeReview(id);
      await waitFor(() => {
        const root = ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root");
        const changed = root?.cards.find((c) => c.id === "g-other");
        return !!changed && !changed.pending && changed.blocks.length > 0;
      });
      const after = ctx.reviews.getSnapshot(id)!;
      const keptAfter = after.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "g-flow")!;
      expect(keptAfter.revision).toBe(keptRevision);
      expect(JSON.stringify(keptAfter.blocks)).toBe(keptBlocks);
      expect(agents.prompts.filter((pr) => pr.text.includes("# Go deeper") && pr.text.includes("Data flow")).length).toBe(flowFillsBefore);
      const gdJobs = ctx.jobs.listByReview(id).filter((j: Job) => j.kind === "go-deeper");
      expect(gdJobs.filter((j: Job) => j.cardId === "g-flow")).toHaveLength(1);
      expect(gdJobs.filter((j: Job) => j.cardId === "g-other")).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});

