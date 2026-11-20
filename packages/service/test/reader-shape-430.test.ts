/**
 * Required reader-guide shape (#430): a reader turn that stops after its
 * first card is repaired once in the same session, and a still-incomplete
 * guide is stored but marked degraded — never presented as done. Fake
 * runner only — no live spend.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, Job, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { READER_STOPPED_EARLY_MESSAGE } from "../src/pipeline/runner.js";
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

const PROBLEM = `## The problem\n\nThe change reworks how headers unfold.\n`;
const CENTRAL = `## The central idea\n\nUnfold every fold right after parsing, before anything reads the headers.\n`;
const DECISIONS = `## Decisions and questions\n\n**Decisions**\n- **Normalize in getresponse.** Chosen over cleaning the copy.\n`;

const FULL_DATA = `{"pendingCards":[{"id":"g-a","label":"A direction","why":"why a"},{"id":"g-b","label":"B direction","why":"why b"},{"id":"g-c","label":"C direction","why":"why c"}]}`;
const ONE_DIRECTION_DATA = `{"pendingCards":[{"id":"g-a","label":"A direction","why":"why a"}]}`;

const COMPLETE_READER = `${PROBLEM}\n${CENTRAL}\n${DECISIONS}\n\`\`\`json\n${FULL_DATA}\n\`\`\`\n`;
// The #430 stop: one card plus the trailing block, then silence.
const ONE_CARD_READER = `${PROBLEM}\n\`\`\`json\n${ONE_DIRECTION_DATA}\n\`\`\`\n`;
const FULL_REPAIR = `${PROBLEM}\n${CENTRAL}\n${DECISIONS}\n\`\`\`json\n${FULL_DATA}\n\`\`\`\n`;

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

function rootCards(ctx: { reviews: { getSnapshot(id: string): ReviewSnapshot | null } }, id: string) {
  return ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards;
}

describe("reader required shape (#430)", () => {
  it("complete reply: no repair turn, no degraded reason", { timeout: 90000 }, async () => {
    const { agents, app, ctx, id } = await openWith([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(COMPLETE_READER) },
    ]);
    try {
      const job = readerJob(ctx, id);
      await waitReaderDone(ctx, job.id);
      expect(ctx.jobs.get(job.id)?.state).toBe("done");
      expect(ctx.jobs.get(job.id)?.degradedReason).toBeUndefined();
      expect(agents.prompts.filter((p) => p.text.includes("You stopped early"))).toHaveLength(0);
      expect(rootCards(ctx, id).map((c) => c.id)).toEqual(
        expect.arrayContaining(["problem", "central", "decisions", "g-a", "g-b", "g-c"]),
      );
    } finally {
      await app.close();
    }
  });

  it("one-card reply: one repair turn names the missing cards, full guide lands", { timeout: 90000 }, async () => {
    const { agents, app, ctx, id } = await openWith([
      { match: "You stopped early", events: textEvents(FULL_REPAIR) },
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(ONE_CARD_READER) },
    ]);
    try {
      const job = readerJob(ctx, id);
      await waitReaderDone(ctx, job.id);
      expect(ctx.jobs.get(job.id)?.state).toBe("done");
      expect(ctx.jobs.get(job.id)?.degradedReason).toBeUndefined();
      // Exactly one repair turn, naming what was missing.
      const repairs = agents.prompts.filter((p) => p.text.includes("You stopped early"));
      expect(repairs).toHaveLength(1);
      expect(repairs[0]!.text).toContain("The central idea");
      expect(repairs[0]!.text).toContain("Go deeper directions");
      expect(ctx.jobs.get(job.id)?.promptSnapshot).toContain("--- repair turn ---");
      // The missing cards appended in prompt order; directions from the repair's block.
      expect(rootCards(ctx, id).map((c) => c.id)).toEqual(
        expect.arrayContaining(["problem", "central", "decisions", "g-a", "g-b", "g-c"]),
      );
    } finally {
      await app.close();
    }
  });

  it("still incomplete after the repair: guide stored, job degraded with the plain message", { timeout: 90000 }, async () => {
    const { agents, app, ctx, id } = await openWith([
      { match: "You stopped early", events: textEvents(ONE_CARD_READER) },
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(ONE_CARD_READER) },
    ]);
    try {
      const job = readerJob(ctx, id);
      await waitReaderDone(ctx, job.id);
      expect(ctx.jobs.get(job.id)?.state).toBe("done");
      expect(agents.prompts.filter((p) => p.text.includes("You stopped early"))).toHaveLength(1);
      // Stored, not failed — but never presented as done.
      expect(ctx.jobs.get(job.id)?.degradedReason).toBe(READER_STOPPED_EARLY_MESSAGE);
      const ids = rootCards(ctx, id).map((c) => c.id);
      expect(ids).toContain("problem");
      expect(ids).not.toContain("central");
    } finally {
      await app.close();
    }
  });
});
