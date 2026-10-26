/**
 * #213: a reader reply whose trailing data block does not parse keeps its
 * cards. One repair turn on the same session asks for just the data block;
 * if that also fails, the guide lands without plotlines/directions and the
 * job's degraded note says so. Fake runner only — no live spend.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, Job, ReviewSnapshot } from "@unvibe/shared";
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

const CARDS = `## The problem

The problem paragraph.

## The central change

The central paragraph.
`;

const BROKEN_READER = `${CARDS}
\`\`\`json
{"cardIds": ["problem",, "central"], "pendingCards": [{"id": "g-flow", "label": "Flow", "why": "why"}], "plotlines": [{"id": "unfold", "name": "Unfold", "description": "d", "hunks": []}]}
\`\`\`
`;

const GOOD_DATA_REPAIR = `\`\`\`json
{"cardIds": ["problem", "central"], "pendingCards": [{"id": "g-flow", "label": "Flow", "why": "why"}], "plotlines": [{"id": "unfold", "name": "Unfold", "description": "d", "hunks": []}]}
\`\`\`
`;

const BROKEN_REPAIR = `\`\`\`json
{"cardIds": [,,]}
\`\`\`
`;

const GOOD_READER = `${CARDS}
\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

async function openWith(scripts: { match: string; events: AgentEvent[] }[]) {
  const agents = new FakeAgentRunner(scripts);
  const { app, ctx } = await createApp("tok", { agents });
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
    payload: { repoId: "demo" },
  } as never);
  expect(created.statusCode).toBe(201);
  const id = (created.json() as ReviewSnapshot).review.id;
  return { agents, app, ctx, id };
}

function readerJob(ctx: { jobs: { listByReview(id: string): Job[] } }, id: string): Job {
  const jobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "reader");
  return jobs[jobs.length - 1];
}

async function waitReaderDone(ctx: { jobs: { get(id: string): Job | undefined } }, jobId: string) {
  await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""));
}

describe("reader trailing data block (#213)", () => {
  it("broken block fixed by the repair: cards kept, plotlines and directions applied", { timeout: 90000 }, async () => {
    const { agents, app, ctx, id } = await openWith([
      { match: "Resend just the data block", events: textEvents(GOOD_DATA_REPAIR) },
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(BROKEN_READER) },
    ]);
    try {
      const job = readerJob(ctx, id);
      await waitReaderDone(ctx, job.id);
      expect(ctx.jobs.get(job.id)?.state).toBe("done");
      const snap = ctx.reviews.getSnapshot(id)!;
      const root = snap.pages.find((p) => p.id === "root")!;
      expect(root.cards.map((c) => c.id)).toEqual(expect.arrayContaining(["problem", "central", "g-flow"]));
      // The direction landed as a go-deeper card (demo fill may already
      // have filled it, clearing `pending`).
      expect(root.cards.find((c) => c.id === "g-flow")).toBeDefined();
      expect((snap.plotlines ?? []).map((p) => p.id)).toContain("unfold");
      // One repair turn, recorded on the job's prompt snapshot.
      expect(agents.prompts.filter((p) => p.text.includes("Resend just the data block"))).toHaveLength(1);
      expect(ctx.jobs.get(job.id)?.promptSnapshot).toContain("--- repair turn ---");
      expect(ctx.jobs.get(job.id)?.promptSnapshot).toContain("Resend just the data block");
    } finally {
      await app.close();
    }
  });

  it("broken block and broken repair: cards kept, no plotlines/directions, degraded note says so", { timeout: 90000 }, async () => {
    const { agents, app, ctx, id } = await openWith([
      { match: "Resend just the data block", events: textEvents(BROKEN_REPAIR) },
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(BROKEN_READER) },
    ]);
    try {
      const job = readerJob(ctx, id);
      await waitReaderDone(ctx, job.id);
      expect(ctx.jobs.get(job.id)?.state).toBe("done");
      const snap = ctx.reviews.getSnapshot(id)!;
      const root = snap.pages.find((p) => p.id === "root")!;
      expect(root.cards.map((c) => c.id).sort()).toEqual(["central", "problem"]);
      expect(snap.plotlines ?? []).toHaveLength(0);
      expect(ctx.jobs.get(job.id)?.degradedReason).toContain("no plotlines, glossary or go-deeper directions");
      expect(agents.prompts.filter((p) => p.text.includes("Resend just the data block"))).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("good block: no repair turn", { timeout: 90000 }, async () => {
    const { agents, app, ctx, id } = await openWith([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(GOOD_READER) },
    ]);
    try {
      const job = readerJob(ctx, id);
      await waitReaderDone(ctx, job.id);
      expect(ctx.jobs.get(job.id)?.state).toBe("done");
      expect(agents.prompts.filter((p) => p.text.includes("Resend just the data block"))).toHaveLength(0);
      expect(ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.map((c) => c.id).sort()).toEqual(["central", "problem"]);
    } finally {
      await app.close();
    }
  });
});
