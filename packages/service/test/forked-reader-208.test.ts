/**
 * Spike #208: forked reader (UNVIBE_FORKED_READER=1) — the reader writes
 * the problem card + a card plan, parallel forks of its session write the
 * planned cards, and the assembled guide lands in plan order.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { FakeCommandRunner } from "../src/exec/index.js";
import { setupReview } from "./m6-helpers.js";

function text(delta: string): AgentEvent[] {
  return [
    { type: "text", delta },
    { type: "usage", inputTokens: 10, cachedReadTokens: 4, cachedWriteTokens: 0, outputTokens: 5 },
    { type: "done", stopReason: "end_turn" },
  ];
}

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("forked reader (#208 spike)", () => {
  it("assembles problem + forked cards in plan order", async () => {
    process.env.UNVIBE_FORKED_READER = "1";
    let forks = 0;
    const agents = new FakeAgentRunner([
      { match: "Kind: central", events: text("## The central change\n\nNow it works [[diff:a-py:1-2]].\n") },
      { match: "Kind: decisions", events: text("## Decisions and alternatives\n\nThis way was chosen [[diff:a-py:2-3]].\n") },
      {
        match: "forked spike",
        events: text(
          "## The problem\n\nIt was broken [[diff:a-py:1-2]].\n\n```json\n" +
            JSON.stringify({
              pendingCards: [{ id: "g-flow", label: "Data flow", why: "w" }],
              concepts: [],
              plotlines: [],
              cardPlan: [
                { kind: "central", title: "The central change", points: ["state the helper"] },
                { kind: "decisions", title: "Decisions and alternatives", points: ["name the alternative"] },
              ],
            }) +
            "\n```\n",
        ),
      },
    ]);
    const origFork = agents.fork.bind(agents);
    agents.fork = async (s) => {
      forks += 1;
      return origFork(s);
    };
    const { app, ctx, reviewId } = await setupReview(new FakeCommandRunner(), { agents });
    try {
      await ctx.pipeline.startReview(reviewId);
      await waitFor(() => ctx.jobs.listByReview(reviewId).some((j) => j.kind === "reader" && j.state === "done"));
      const root = ctx.reviews.getSnapshot(reviewId)!.pages.find((p) => p.id === "root")!;
      expect(root.cards.map((c) => c.title)).toEqual([
        "The problem",
        "The central change",
        "Decisions and alternatives",
        "Data flow",
      ]);
      expect(forks).toBe(2);
      const reader = ctx.jobs.listByReview(reviewId).find((j) => j.kind === "reader")!;
      expect((reader.turns ?? []).map((t) => t.label)).toEqual(expect.arrayContaining(["fork:0", "fork:1"]));
    } finally {
      delete process.env.UNVIBE_FORKED_READER;
      await app.close();
    }
  });

  it("without a card plan, the single-turn reply stands (baseline fallback)", async () => {
    process.env.UNVIBE_FORKED_READER = "1";
    const agents = new FakeAgentRunner([
      {
        match: "forked spike",
        events: text("## The problem\n\nBroken [[diff:a-py:1-2]].\n\n## The central change\n\nFixed [[diff:a-py:1-2]].\n\n```json\n{}\n```\n"),
      },
    ]);
    const { app, ctx, reviewId } = await setupReview(new FakeCommandRunner(), { agents });
    try {
      await ctx.pipeline.startReview(reviewId);
      await waitFor(() => ctx.jobs.listByReview(reviewId).some((j) => j.kind === "reader" && j.state === "done"));
      const root = ctx.reviews.getSnapshot(reviewId)!.pages.find((p) => p.id === "root")!;
      expect(root.cards.map((c) => c.title)).toEqual(["The problem", "The central change"]);
    } finally {
      delete process.env.UNVIBE_FORKED_READER;
      await app.close();
    }
  });
});
