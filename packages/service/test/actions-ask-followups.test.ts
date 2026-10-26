/**
 * Follow-up suggestions on the unified card (#136 slice 2, owner
 * decisions on #136): one behaviour for every answer — the model may end
 * any answer with a `### Follow-ups` section (or another heading shape
 * the parser turns into a `follow-up` block), it is stored as chips on
 * that answer, and clicking one sends it as the next turn. Explain
 * answers keep them as before.
 *
 * Over HTTP on the demo review with scripted fakes (no real agents, no
 * network).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
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

function fakeWith(scripts: { match: string; events: AgentEvent[] }[]): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    ...scripts,
  ]);
}

async function createDemoReview(app: {
  inject: (o: never) => Promise<{ statusCode: number; json: () => unknown }>;
}): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
    payload: { repoId: "demo" },
  } as never);
  expect(created.statusCode).toBe(201);
  return (created.json() as ReviewSnapshot).review.id;
}

async function postAction(
  app: { inject: (o: never) => Promise<{ statusCode: number; json: () => unknown }> },
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

async function waitFor(check: () => boolean, timeoutMs = 30000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function waitForJob(
  ctx: { jobs: { get: (id: string) => { state: string } | undefined } },
  jobId: string,
  timeoutMs = 30000,
): Promise<string> {
  let state = "";
  await waitFor(() => {
    const j = ctx.jobs.get(jobId);
    if (!j) return false;
    state = j.state;
    return state === "done" || state === "error" || state === "cancelled";
  }, timeoutMs);
  return state;
}

function followUpItems(turn: unknown): { label: string; ask?: string }[] {
  const blocks = (turn as { blocks: { type: string }[] }).blocks;
  const follow = blocks.find((b) => b.type === "follow-up") as unknown as {
    items: { label: string; ask?: string }[];
  };
  return follow?.items ?? [];
}

/** An ask reply whose answer ends in a Follow-ups section with the given heading. */
function askReplyWithFollowUps(heading: string): string {
  return `Not with this PR. The message is rewritten in place.

${heading}

- What about a bare LF? | ask: bare lf
- Does unfolding change header order?

\`\`\`json
{}
\`\`\`
`;
}

describe("follow-up suggestions on answers (#136 slice 2)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("ask stores a trailing ### Follow-ups section as chips on the answer", { timeout: 90000 }, async () => {
    const agents = fakeWith([{ match: "# Ask", events: textEvents(askReplyWithFollowUps("### Follow-ups")) }]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

      const res = await postAction(app, id, {
        kind: "ask",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
        message: "Does Requests see the raw value?",
      });
      expect(res.status).toBe(200);
      await waitForJob(ctx, res.json.jobId as string);
      const card = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(card.error).toBeNull();
      const turn = (card.replies ?? []).find((t) => t.id === (res.json.turnId as string))!;
      expect(turn.blocks.length).toBeGreaterThan(0);
      const items = followUpItems(turn);
      expect(items).toHaveLength(2);
      expect(items[0].label).toContain("bare LF");
    } finally {
      await app.close();
    }
  });

  it("ask keeps a card-boundary Follow-up section as ordinary blocks", { timeout: 90000 }, async () => {
    const agents = fakeWith([{ match: "# Ask", events: textEvents(askReplyWithFollowUps("## Follow-up")) }]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

      const res = await postAction(app, id, {
        kind: "ask",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
        message: "Does Requests see the raw value?",
      });
      expect(res.status).toBe(200);
      await waitForJob(ctx, res.json.jobId as string);
      const card = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(card.error).toBeNull();
      const turn = (card.replies ?? []).find((t) => t.id === (res.json.turnId as string))!;
      // A "## Follow-up" line is a card boundary to the parser, not a
      // chip section: the items land as an ordinary list block — nothing
      // is lost, nothing becomes a chip.
      expect(followUpItems(turn)).toHaveLength(0);
      expect(turn.blocks.some((b) => b.type === "list")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("ask with an empty Follow-ups section stores no empty chip", { timeout: 90000 }, async () => {
    const reply = `Not with this PR. The message is rewritten in place.

### Follow-ups

\`\`\`json
{}
\`\`\`
`;
    const agents = fakeWith([{ match: "# Ask", events: textEvents(reply) }]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

      const res = await postAction(app, id, {
        kind: "ask",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
        message: "Does Requests see the raw value?",
      });
      expect(res.status).toBe(200);
      await waitForJob(ctx, res.json.jobId as string);
      const card = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(card.error).toBeNull();
      const turn = (card.replies ?? []).find((t) => t.id === (res.json.turnId as string))!;
      expect(turn.blocks.length).toBeGreaterThan(0);
      expect(followUpItems(turn)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("reply turns store follow-ups on the new turn", { timeout: 90000 }, async () => {
    const agents = fakeWith([{ match: "# Ask", events: textEvents(askReplyWithFollowUps("### Follow-ups")) }]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

      const res = await postAction(app, id, {
        kind: "ask",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
        message: "Does Requests see the raw value?",
      });
      expect(res.status).toBe(200);
      const annotationId = res.json.annotationId as string;
      await waitForJob(ctx, res.json.jobId as string);

      const rep = await postAction(app, id, { kind: "reply", annotationId, message: "What about ordering?" });
      expect(rep.status).toBe(200);
      await waitForJob(ctx, rep.json.jobId as string);
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(after.error).toBeNull();
      const turns = after.replies ?? [];
      expect(turns).toHaveLength(2);
      for (const turn of turns) {
        expect(followUpItems(turn)).toHaveLength(2);
      }
    } finally {
      await app.close();
    }
  });

  it("explain answers still store their follow-up chips", { timeout: 90000 }, async () => {
    const reply = `An explanation with two follow-ups.

### Follow-ups

- What about a bare LF? | ask: bare lf
- Does unfolding change header order?

\`\`\`json
{}
\`\`\`
`;
    const agents = fakeWith([{ match: "## The question\n\nExplain this.", events: textEvents(reply) }]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

      const res = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(res.status).toBe(200);
      await waitForJob(ctx, res.json.jobId as string);
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(ann.error).toBeNull();
      const turnId = res.json.turnId as string;
      const turn = (ann.replies ?? []).find((t) => t.id === turnId)!;
      const blocks = turn.blocks;
      const follow = blocks.find((b) => b.type === "follow-up") as unknown as {
        items: { label: string; ask?: string }[];
      };
      expect(follow).toBeDefined();
      expect(follow.items).toHaveLength(2);
      expect(follow.items[0].label).toContain("bare LF");
    } finally {
      await app.close();
    }
  });
});
