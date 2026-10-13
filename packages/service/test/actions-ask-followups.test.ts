/**
 * Ask threads never show follow-up suggestions (issue #103) end to end:
 * even when the model ends its reply with a `### Follow-ups` section (or
 * another heading shape the parser turns into a `follow-up` block), the
 * thread HTML carries the answer only — no bare bullets, no leftover
 * heading. Cards and Explain expansions still keep their follow-up chips.
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

function aiMessages(thread: unknown): { who: string; text?: string; html?: string }[] {
  return (thread as { messages: { who: string; text?: string; html?: string }[] }).messages.filter(
    (m) => m.who === "ai",
  );
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

describe("ask threads drop follow-up suggestions (issue #103)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("ask drops a trailing ### Follow-ups section from the thread HTML", { timeout: 90000 }, async () => {
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
      const thread = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.threadId as string))!;
      expect(thread.error).toBeNull();
      const [ai] = aiMessages(thread);
      expect(ai.html).toContain("rewritten in place");
      // No bare bullets, no leftover heading.
      expect(ai.html).not.toContain("<li>");
      expect(ai.html).not.toContain("bare LF");
      expect(ai.html).not.toContain("Follow-ups");
      // The stored reply text keeps what the model sent; only the
      // rendered thread drops the suggestions.
      expect(ai.text).toContain("### Follow-ups");
    } finally {
      await app.close();
    }
  });

  it("ask drops the other heading shapes the parser turns into follow-ups", { timeout: 90000 }, async () => {
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
      const thread = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.threadId as string))!;
      expect(thread.error).toBeNull();
      const [ai] = aiMessages(thread);
      expect(ai.html).toContain("rewritten in place");
      expect(ai.html).not.toContain("<li>");
      expect(ai.html).not.toContain("bare LF");
      expect(ai.html).not.toContain("Follow-up");
    } finally {
      await app.close();
    }
  });

  it("ask leaves no empty Follow-ups heading behind", { timeout: 90000 }, async () => {
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
      const thread = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.threadId as string))!;
      expect(thread.error).toBeNull();
      const [ai] = aiMessages(thread);
      expect(ai.html).toContain("rewritten in place");
      expect(ai.html).not.toContain("Follow-ups");
    } finally {
      await app.close();
    }
  });

  it("reply turns drop follow-ups through the same path", { timeout: 90000 }, async () => {
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
      const threadId = res.json.threadId as string;
      await waitForJob(ctx, res.json.jobId as string);

      const rep = await postAction(app, id, { kind: "reply", threadId, message: "What about ordering?" });
      expect(rep.status).toBe(200);
      await waitForJob(ctx, rep.json.jobId as string);
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === threadId)!;
      expect(after.error).toBeNull();
      const answers = aiMessages(after);
      expect(answers).toHaveLength(2);
      for (const ai of answers) {
        expect(ai.html).toContain("rewritten in place");
        expect(ai.html).not.toContain("<li>");
        expect(ai.html).not.toContain("bare LF");
        expect(ai.html).not.toContain("Follow-ups");
      }
    } finally {
      await app.close();
    }
  });

  it("explain expansions still store their follow-up chips", { timeout: 90000 }, async () => {
    const reply = `An explanation with two follow-ups.

### Follow-ups

- What about a bare LF? | ask: bare lf
- Does unfolding change header order?

\`\`\`json
{}
\`\`\`
`;
    const agents = fakeWith([{ match: "# Explain", events: textEvents(reply) }]);
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
      const blocks = (ann as unknown as { expansion: { blocks: { type: string }[] } }).expansion.blocks;
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
