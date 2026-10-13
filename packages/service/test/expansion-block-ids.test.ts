/**
 * Block IDs stay unique within one answer body (#116, #136).
 *
 * `parseCards` numbers blocks per card, so a multi-card agent reply
 * flattened into an explanation used to repeat IDs (`["b1","b1"]`) — and
 * one nested anchor then matched two blocks, drawing its card twice.
 * End to end over HTTP with the scripted fake runner: a two-card Explain
 * reply, then a depth change, examples and diagram inserts on the
 * expansion, then a follow-up answer and a nested Explain per paragraph.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, Block } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";
import { insertDiagrams, insertExamples } from "../src/interaction/cards.js";

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

/** Two `##` cards plus a follow-up chip: flattens to duplicate IDs pre-fix. */
const TWO_CARD_EXPLAIN = `## First part

First paragraph about the folded header.

## Second part

Second paragraph about the folded header.

### Follow-ups

- Why this folding?

\`\`\`json
{}
\`\`\`
`;

const DEPTH_SIMPLE = `A simpler first paragraph.

A simpler second paragraph.

\`\`\`json
{"depth": {"level": "simple", "cardId": "problem"}}
\`\`\`
`;

const EXAMPLES_REPLY = `::: example
\`\`\`
example one
\`\`\`
:::

::: example
\`\`\`
example two
\`\`\`
:::

\`\`\`json
{}
\`\`\`
`;

const ASK_REPLY = `An answer with no citations.

\`\`\`json
{}
\`\`\`
`;

function fakeAgents(): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    { match: "## The question\n\nExplain this.", events: textEvents(TWO_CARD_EXPLAIN) },
    { match: "# Depth rewrite", events: textEvents(DEPTH_SIMPLE) },
    { match: "# Examples", events: textEvents(EXAMPLES_REPLY) },
    { match: "# Ask", events: textEvents(ASK_REPLY) },
  ]);
}

type App = {
  inject: (o: never) => Promise<{ statusCode: number; json: () => unknown }>;
  close: () => Promise<void>;
};

async function createDemoReview(app: App): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
    payload: { repoId: "demo" },
  } as never);
  expect(created.statusCode).toBe(201);
  return ((created.json() as { review: { id: string } }).review.id);
}

async function postAction(
  app: App,
  id: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/reviews/${id}/actions`,
    headers: authed,
    payload: body,
  } as never);
  return { status: res.statusCode, json: (res.json() ?? {}) as Record<string, unknown> };
}

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function waitForJob(ctx: { jobs: { get: (id: string) => { state: string } | undefined } }, jobId: string): Promise<void> {
  await waitFor(() => {
    const s = ctx.jobs.get(jobId)?.state;
    return s === "done" || s === "error" || s === "cancelled";
  });
}

function topIds(blocks: { id: string }[]): string[] {
  return blocks.map((b) => b.id);
}

function assertUnique(ids: string[]): void {
  expect(new Set(ids).size).toBe(ids.length);
}

function para(id: string): Block {
  return { type: "paragraph", id, text: { standard: "Body text." }, citations: [] };
}

function exampleAside(id: string, text = "Example text."): Block {
  return {
    type: "aside",
    id,
    kind: "Example",
    inner: [{ type: "paragraph", id: `${id}-b1`, text: { standard: text }, citations: [] }],
    citations: [],
  };
}

describe("inserted block IDs (#116)", () => {
  it("example and diagram inserts stamp IDs no block in the body uses", () => {
    const body: Block[] = [para("b1"), para("b2")];
    const ex = insertExamples(body, [exampleAside("b9", "First."), exampleAside("b9", "Second.")]);
    expect(ex.added).toBe(2);
    assertUnique(topIds(ex.blocks));
    const diagram = insertDiagrams(ex.blocks, [
      { type: "diagram", id: "b7", source: "a -> b", citations: [] },
    ]);
    expect(diagram.added).toBe(1);
    assertUnique(topIds(diagram.blocks));
  });

  it("a timestamp collision falls back to a suffixed ID, inner IDs move along", () => {
    const FIXED = 1760000000000;
    const base = `b-ex-${FIXED.toString(36)}-0`;
    const body: Block[] = [para("b1"), para(base)];
    vi.spyOn(Date, "now").mockReturnValue(FIXED);
    try {
      const out = insertExamples(body, [exampleAside("b3")]);
      expect(out.added).toBe(1);
      const added = out.blocks.find((b) => b.id !== "b1" && b.id !== base)!;
      expect(added.id).toBe(`${base}-c2`);
      assertUnique(topIds(out.blocks));
      expect(added.type).toBe("aside");
      if (added.type === "aside") {
        expect(added.inner.map((b) => b.id)).toEqual([`${added.id}-b1`]);
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("answer body block IDs (#116, #136)", () => {
  it("a multi-card explain stores unique, first-stable block IDs", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const { app, ctx } = await createApp("tok", { agents: fakeAgents() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem")?.blocks.length);
      const res = await postAction(app, id, {
        kind: "explain",
        quote: "problem",
        anchor: { where: "block", blockId: "problem#b1" },
      });
      expect(res.status).toBe(200);
      if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
      else await new Promise((r) => setTimeout(r, 500));
      const turnId = res.json.turnId as string;
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      const ids = topIds((ann.turns ?? []).find((t) => t.id === turnId)!.blocks);
      expect(ids.length).toBeGreaterThan(2);
      assertUnique(ids);
      // First occurrences keep their parser IDs.
      expect(ids[0]).toBe("b1");
    } finally {
      await app.close();
    }
  });

  it("IDs stay unique and stable through depth and examples rewrites", { timeout: 180000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const { app, ctx } = await createApp("tok", { agents: fakeAgents() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem")?.blocks.length);
      const res = await postAction(app, id, {
        kind: "explain",
        quote: "problem",
        anchor: { where: "block", blockId: "problem#b1" },
      });
      expect(res.status).toBe(200);
      if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
      const annId = res.json.annotationId as string;
      const turnId = res.json.turnId as string;
      const turnBlocks = () =>
        (ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annId)!.turns ?? []).find((t) => t.id === turnId)!.blocks;
      const atFirst = topIds(turnBlocks());
      assertUnique(atFirst);

      // Depth and examples act on the answer alone: the card id is the
      // answer id, and the sibling-free rewrite keeps every block id.
      const depth = await postAction(app, id, { kind: "depth", cardId: turnId, direction: "simpler" });
      expect(depth.status).toBe(200);
      if (depth.json.jobId) await waitForJob(ctx, depth.json.jobId as string);
      const atDepth = topIds(turnBlocks());
      assertUnique(atDepth);
      for (const kept of atFirst) expect(atDepth).toContain(kept);

      const examples = await postAction(app, id, { kind: "examples", cardId: turnId });
      expect(examples.status).toBe(200);
      if (examples.json.jobId) await waitForJob(ctx, examples.json.jobId as string);
      const atExamples = topIds(turnBlocks());
      assertUnique(atExamples);
      expect(atExamples.length).toBeGreaterThan(atDepth.length);
    } finally {
      await app.close();
    }
  });

  it("follow-up answers anchor qualified; nested explains address distinct blocks", { timeout: 180000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const { app, ctx } = await createApp("tok", { agents: fakeAgents() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem")?.blocks.length);
      const res = await postAction(app, id, {
        kind: "explain",
        quote: "problem",
        anchor: { where: "block", blockId: "problem#b1" },
      });
      expect(res.status).toBe(200);
      if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
      const annId = res.json.annotationId as string;
      const turnId = res.json.turnId as string;
      const body = (ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annId)!.turns ?? []).find(
        (t) => t.id === turnId,
      )!.blocks;
      const followUp = body.find((b) => b.type === "follow-up");
      expect(followUp).toBeTruthy();

      // A suggestion on the conversation card is the next turn in the
      // same conversation (the item stays).
      const turnsBefore = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annId)!.turns!.length;
      const follow = await postAction(app, id, { kind: "followup", cardId: turnId, blockId: followUp!.id, index: 0 });
      expect(follow.status).toBe(200);
      if (follow.json.jobId) await waitForJob(ctx, follow.json.jobId as string);
      const card = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (follow.json.annotationId as string))!;
      expect(card.id).toBe(annId);
      expect(card.turns!.length).toBe(turnsBefore + 1);
      expect(card.turns!.at(-1)!.blocks.length).toBeGreaterThan(0);
      const kept = (card.turns ?? []).find((t) => t.id === turnId)!.blocks.find((b) => b.type === "follow-up");
      expect(kept).toBeTruthy();

      // A nested Explain on each paragraph addresses a distinct host
      // (stored qualified by the answer id).
      const paras = body.filter((b) => b.type === "paragraph");
      expect(paras.length).toBeGreaterThanOrEqual(2);
      const hosts: string[] = [];
      for (const [i, p] of paras.entries()) {
        const text = (p as { text: { standard: string } }).text.standard.replace(/<[^>]*>/g, " ").trim();
        const quote = text.split(/\s+/).slice(0, 3).join(" ");
        const nested = await postAction(app, id, {
          kind: "explain",
          quote: `${quote} #${i}`,
          anchor: { where: "block", blockId: `${turnId}#${(p as { id: string }).id}` },
        });
        expect(nested.status).toBe(200);
        const stored = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (nested.json.annotationId as string))!;
        const host = (stored.anchor.host as { blockId: string }).blockId;
        expect(host).toBe(`${turnId}#${(p as { id: string }).id}`);
        hosts.push(host);
      }
      expect(new Set(hosts).size).toBe(hosts.length);
    } finally {
      await app.close();
    }
  });
});
