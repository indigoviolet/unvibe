/**
 * Echo stripping (issue #50) end to end: a leading body line that
 * exactly repeats the selection, the question or the card title is
 * dropped when the reply is parsed — over HTTP on the demo review with
 * scripted fakes (no real agents, no network).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedTokens: 5, outputTokens: 10 },
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

describe("echo stripping on actions (issue #50)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("explain drops a leading line echoing the selection", { timeout: 90000 }, async () => {
    const reply = `within the margin

"Within the margin" means the two channels agree.

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
        quote: "within the margin",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(res.status).toBe(200);
      await waitForJob(ctx, res.json.jobId as string);
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(ann.error).toBeNull();
      const blocks = (ann as unknown as { expansion: { blocks: { type: string }[] } }).expansion.blocks;
      expect(blocks).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("ask drops a leading line echoing the question", { timeout: 90000 }, async () => {
    const reply = `Does Requests see the raw value?

Not with this PR. The message is rewritten in place.

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
      const ai = (thread as unknown as { messages: { who: string; html?: string }[] }).messages.find(
        (m) => m.who === "ai",
      )!;
      expect(ai.html).not.toContain("Does Requests see the raw value?</p>");
      expect(ai.html).toContain("rewritten in place");
    } finally {
      await app.close();
    }
  });

  it("depth drops a leading line echoing the card title", { timeout: 90000 }, async () => {
    const reply = `The problem

A simpler problem paragraph.

\`\`\`json
{"depth": {"level": "simple", "cardId": "problem"}}
\`\`\`
`;
    const agents = fakeWith([{ match: "# Depth rewrite", events: textEvents(reply) }]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

      const res = await postAction(app, id, { kind: "depth", cardId: "problem", direction: "simpler" });
      expect(res.status).toBe(200);
      await waitForJob(ctx, res.json.jobId as string);
      const card = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "problem")!;
      const first = card.blocks[0];
      expect(first.type).toBe("paragraph");
      if (first.type !== "paragraph") return;
      expect(first.text.simple).toContain("A simpler problem paragraph.");
      expect(first.text.simple).not.toContain("The problem\n");
    } finally {
      await app.close();
    }
  });
});
