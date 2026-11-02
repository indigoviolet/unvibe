/**
 * Issue #339: the Outbox toggle must work on any thread with comment
 * replies, whatever kind of annotation started the thread — the #273
 * one-thread model. Only `kind === "comment"` replies ever post.
 *
 * Real-service path: an Explain-started thread that later gains a
 * reviewer comment reply toggles into the Outbox (PATCH `post: true`
 * succeeds), and the Submit preview for that thread carries only the
 * reviewer comment — never the agent's answer text.
 */
import { describe, expect, it } from "vitest";
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

const FIRST_ANSWER = `First answer body about the fold.

\`\`\`json
{}
\`\`\`
`;

type App = Awaited<ReturnType<typeof createApp>>;

async function openDemo(agents: FakeAgentRunner): Promise<{ app: App["app"]; ctx: App["ctx"]; id: string }> {
  const { app, ctx } = await createApp("tok", { agents });
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
    payload: { repoId: "demo" },
  } as never);
  expect(created.statusCode).toBe(201);
  const id = (created.json() as ReviewSnapshot).review.id;
  await waitFor(
    () => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem")?.blocks.length,
  );
  return { app, ctx, id };
}

async function waitFor(check: () => boolean, timeoutMs = 30000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function waitForJob(ctx: App["ctx"], jobId: string, timeoutMs = 30000): Promise<string> {
  let state = "";
  await waitFor(() => {
    const j = ctx.jobs.get(jobId);
    if (!j) return false;
    state = j.state;
    return state === "done" || state === "error" || state === "cancelled";
  }, timeoutMs);
  return state;
}

describe("Outbox toggle on agent-started threads (#339)", () => {
  it("an Explain-started thread with a reviewer comment toggles into the Outbox with only the comment", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "## The question\n\nExplain this.", events: textEvents(FIRST_ANSWER) },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const started = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/actions`,
        headers: authed,
        payload: { kind: "explain", quote: "raw CRLF", anchor: { where: "block", blockId: "b1" } },
      } as never);
      expect(started.statusCode).toBe(200);
      const annotationId = (started.json() as { annotationId: string }).annotationId;
      const jobId = (started.json() as { jobId?: string }).jobId;
      if (jobId) await waitForJob(ctx, jobId);
      await waitFor(() => {
        const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId);
        return !!a && a.replies.length > 0 && a.replies.every((r) => r.blocks.length > 0) && a.working == null;
      });
      const thread = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!;
      expect(thread.type).toBe("thread");
      expect(thread.replies[0]?.kind).not.toBe("comment");

      const replied = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/comments/${annotationId}/replies`,
        headers: authed,
        payload: { text: "Reviewer note" },
      } as never);
      expect(replied.statusCode).toBe(200);

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/comments/${annotationId}`,
        headers: authed,
        payload: { post: true },
      } as never);
      expect(patched.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)?.post).toBe(true);

      const preview = await app.inject({
        method: "GET",
        url: `/api/reviews/${id}/submit/preview`,
        headers: authed,
      } as never);
      expect(preview.statusCode).toBe(200);
      const body = preview.json() as { preview: { comments: { threadId: string; text: string }[] } };
      const entry = body.preview.comments.find((c) => c.threadId === annotationId);
      expect(entry).toBeDefined();
      expect(entry?.text).toContain("Reviewer note");
      expect(entry?.text).not.toContain("First answer body about the fold");
    } finally {
      await app.close();
    }
  });
});
