/**
 * Issue #365: agent context — `get_item`, stable reply IDs, minimal turns.
 *
 * Fake runner only, no live spend: `get_item` runs through the real MCP
 * registry with a hand-built reader, and turn prompts are captured from
 * the fake agent on a demo review.
 */
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  findReplyIndexBySeq,
  isLiveReply,
  nextReplySeq,
  parseId,
  replyRef,
  type Reply,
  type Thread,
} from "@unvibe/shared";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/runner.js";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { McpRegistry, type IssuedSession, type McpReviewData } from "../src/mcp/index.js";
import { pushReplySeq } from "../src/comments/threads.js";
import { itemIdForAnchor, threadTextFor } from "../src/interaction/l4.js";
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

const SECOND_ANSWER = `Second answer body, nothing like the first.

\`\`\`json
{}
\`\`\`
`;

// -- get_item fixture ------------------------------------------------------

function plainReply(text: string, live = true): Reply {
  return {
    id: `ans_${Math.random().toString(36).slice(2, 8)}`,
    kind: "comment",
    who: "you",
    question: null,
    blocks: [{ type: "paragraph", id: "b1", text: { standard: text }, citations: [] }],
    level: "standard",
    revision: 1,
    undoStack: [],
    ...(live ? {} : { deletedAt: 1700000000000 }),
  };
}

const ITEM_REVIEW: McpReviewData = {
  reviewId: "r1",
  headSha: "abc123",
  hunks: [],
  cards: [
    {
      id: "c-central",
      title: "Central change",
      text: "retries with backoff",
      pageId: "root",
      blocks: [
        { id: "b1", type: "paragraph", text: "retries with backoff" },
        { id: "b2", type: "code", text: "backoff()" },
      ],
    },
  ],
  pages: [{ id: "root", title: "Guide", kind: "root", cardIds: ["c-central"] }],
  annotations: [
    {
      id: "ann_t1",
      type: "thread",
      anchorSummary: "backoff",
      anchorItemId: "card:c-central#b1",
      text: "",
      replies: [
        { seq: 1, id: "ans_live", kind: "ask", who: "agent", question: "Why backoff?", text: "Because retries.", live: true },
        { seq: 2, id: "ans_dead", kind: "ask", who: "agent", question: "Deleted?", text: "", live: false },
        { seq: 3, id: "ans_live3", kind: "comment", who: "you", question: null, text: "Makes sense.", live: true },
      ],
    },
  ],
  contributions: [],
  description: [{ id: "d1", text: "this PR adds backoff" }],
};

async function callItem(client: Client, id: string): Promise<{ err: boolean; text: string }> {
  const res = (await client.callTool({ name: "get_item", arguments: { id } })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { err: res.isError === true, text: res.content.map((c) => c.text).join("\n") };
}

describe("get_item (issue #365)", () => {
  async function setup(): Promise<{ base: string; issued: IssuedSession; close: () => Promise<void> }> {
    const registry = new McpRegistry({
      reader: {
        getReview: async (id) => (id === "r1" ? ITEM_REVIEW : null),
        getWorktreePath: () => "/repo",
      },
      commands: new FakeCommandRunner(),
    });
    const { app } = await createApp("test-token", { mcp: registry });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const issued = registry.issueSession("r1", "s", "session");
    return { base, issued, close: () => app.close() };
  }

  async function connect(base: string, issued: IssuedSession): Promise<Client> {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(base + issued.path)));
    return client;
  }

  it("returns each kind with its parent chain and child IDs", async () => {
    const { base, issued, close } = await setup();
    const client = await connect(base, issued);
    try {
      const card = await callItem(client, "card:c-central");
      expect(card.err).toBe(false);
      expect(card.text).toContain("kind: card");
      expect(card.text).toContain("parent: page:root (Guide)");
      expect(card.text).toContain("children: card:c-central#b1, card:c-central#b2");
      expect(card.text).toContain("retries with backoff");

      const block = await callItem(client, "card:c-central#b2");
      expect(block.err).toBe(false);
      expect(block.text).toContain("kind: block");
      expect(block.text).toContain("parents: page:root (Guide), card:c-central (Central change)");
      expect(block.text).toContain("backoff()");

      const page = await callItem(client, "page:root");
      expect(page.err).toBe(false);
      expect(page.text).toContain("kind: page");
      expect(page.text).toContain("children: card:c-central");

      const thread = await callItem(client, "ann:ann_t1");
      expect(thread.err).toBe(false);
      expect(thread.text).toContain("kind: thread");
      expect(thread.text).toContain("parent: card:c-central#b1");
      // Children are live replies only: the tombstoned r2 is absent.
      expect(thread.text).toContain("children: ann:ann_t1#r1, ann:ann_t1#r3");
      expect(thread.text).not.toContain("#r2");
      expect(thread.text).toContain("Because retries.");
      expect(thread.text).not.toContain("Deleted?");

      const reply = await callItem(client, "ann:ann_t1#r1");
      expect(reply.err).toBe(false);
      expect(reply.text).toContain("kind: reply");
      expect(reply.text).toContain("parent: ann:ann_t1");
      expect(reply.text).toContain("Why backoff?");
      expect(reply.text).toContain("Because retries.");

      const desc = await callItem(client, "desc:d1");
      expect(desc.err).toBe(false);
      expect(desc.text).toContain("kind: description");
      expect(desc.text).toContain("this PR adds backoff");

      // Every ID the tool emits parses in the shared grammar.
      for (const id of [
        "card:c-central",
        "card:c-central#b2",
        "page:root",
        "ann:ann_t1",
        "ann:ann_t1#r1",
        "ann:ann_t1#r3",
        "desc:d1",
      ]) {
        expect(parseId(id), id).not.toBeNull();
      }
    } finally {
      await client.close().catch(() => {});
      await close();
    }
  });

  it("hides tombstoned replies and refuses code IDs", async () => {
    const { base, issued, close } = await setup();
    const client = await connect(base, issued);
    try {
      const dead = await callItem(client, "ann:ann_t1#r2");
      expect(dead.err).toBe(true);
      expect(dead.text).toMatch(/deleted/);

      const unknownReply = await callItem(client, "ann:ann_t1#r9");
      expect(unknownReply.err).toBe(true);

      const unknown = await callItem(client, "card:nope");
      expect(unknown.err).toBe(true);

      const hunk = await callItem(client, "h:conn:9f2c");
      expect(hunk.err).toBe(true);
      expect(hunk.text).toMatch(/get_hunk/);

      const bad = await callItem(client, "bogus");
      expect(bad.err).toBe(true);
    } finally {
      await client.close().catch(() => {});
      await close();
    }
  });
});

describe("stable reply IDs (issue #365)", () => {
  function threadWith(n: number): Thread {
    const replies: Reply[] = [];
    for (let i = 0; i < n; i++) pushReplySeq(replies, plainReply(`reply ${i + 1}`));
    return { id: "ann_t", type: "thread", anchor: {} as Thread["anchor"], replies, open: true, pinned: false, post: false };
  }

  it("stamps incrementing seqs that survive a tombstone and a restore", () => {
    const thread = threadWith(3);
    expect(thread.replies.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect([0, 1, 2].map((i) => replyRef(thread.id, thread, i))).toEqual([
      "ann:ann_t#r1",
      "ann:ann_t#r2",
      "ann:ann_t#r3",
    ]);

    // Tombstone the middle reply (#364 soft delete): the others keep
    // their IDs, and the tombstone resolves to the same ID throughout.
    thread.replies[1]!.deletedAt = 1700000000000;
    expect(isLiveReply(thread.replies[1]!)).toBe(false);
    expect(replyRef(thread.id, thread, 0)).toBe("ann:ann_t#r1");
    expect(replyRef(thread.id, thread, 2)).toBe("ann:ann_t#r3");
    expect(findReplyIndexBySeq(thread.replies, 2)).toBe(1);
    expect(findReplyIndexBySeq(thread.replies, 9)).toBe(-1);

    // The tombstone is absent from the transcript and from get_item
    // children; restoring it restores the same ID.
    expect(threadTextFor(thread)).not.toContain("reply 2");
    expect(threadTextFor(thread)).toContain("[[ann:ann_t#r1]]");
    expect(threadTextFor(thread)).toContain("[[ann:ann_t#r3]]");
    delete thread.replies[1]!.deletedAt;
    expect(isLiveReply(thread.replies[1]!)).toBe(true);
    expect(threadTextFor(thread)).toContain("[[ann:ann_t#r2]]");
    expect(threadTextFor(thread)).toContain("reply 2");

    // Appends after a delete never reuse the gap.
    const next = nextReplySeq(thread.replies);
    expect(next).toBe(4);
  });

  it("falls back to the position for pre-#365 rows without a seq", () => {
    const bare = { id: "ans_old", kind: "comment" } as Reply;
    const thread = {
      id: "ann_old",
      type: "thread",
      anchor: {},
      replies: [bare],
      open: true,
      pinned: false,
      post: false,
    } as unknown as Thread;
    expect(replyRef(thread.id, thread, 0)).toBe("ann:ann_old#r1");
    expect(findReplyIndexBySeq(thread.replies, 1)).toBe(0);
  });
});

// -- minimal turns through the app ------------------------------------------

type App = Awaited<ReturnType<typeof createApp>>;

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function postAction(
  app: App["app"],
  id: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/actions`, headers: authed, payload: body } as never);
  return { status: res.statusCode, json: (res.json() ?? {}) as Record<string, unknown> };
}

async function waitForJob(ctx: App["ctx"], jobId: string): Promise<void> {
  await waitFor(() => {
    const j = ctx.jobs.get(jobId);
    return !!j && (j.state === "done" || j.state === "error" || j.state === "cancelled");
  });
}

function questionPrompts(agents: FakeAgentRunner): string[] {
  return agents.prompts.map((p) => p.text).filter((t) => t.startsWith("# Ask"));
}

describe("minimal Ask/Explain turns (issue #365)", () => {
  async function demoApp(agents: FakeAgentRunner): Promise<{ app: App["app"]; ctx: App["ctx"]; id: string }> {
    process.env.UNVIBE_REPO_ROOTS = "";
    const { app, ctx } = await createApp("tok", { agents });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: "demo" } } as never);
    expect(created.statusCode).toBe(201);
    const id = (created.json() as ReviewSnapshot).review.id;
    await waitFor(
      () =>
        !!ctx.reviews
          .getSnapshot(id)
          ?.pages.find((p) => p.id === "root")
          ?.cards.find((c) => c.id === "problem")?.blocks.length,
    );
    return { app, ctx, id };
  }

  it("an Explain turn carries quote, item ID, offsets and question — and no other thread's answer", async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "## The question", events: textEvents(FIRST_ANSWER) },
    ]);
    const { app, ctx, id } = await demoApp(agents);
    try {
      // Seed another thread whose answer must never leak into this turn.
      const other = await postAction(app, id, {
        kind: "explain",
        quote: "OTHER_THREAD_QUOTE",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(other.status).toBe(200);
      await waitForJob(ctx, other.json.jobId as string);
      const otherAnn = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (other.json.annotationId as string))!;
      const otherAnswer = "First answer body about the fold.";
      expect(otherAnn.replies[0]!.blocks.length).toBeGreaterThan(0);

      const ex = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
        offsets: { start: 3, end: 7 },
      });
      expect(ex.status).toBe(200);
      await waitForJob(ctx, ex.json.jobId as string);

      const snap = ctx.reviews.getSnapshot(id)!;
      const ann = snap.annotations.find((a) => a.id === (ex.json.annotationId as string))!;
      const expectedItem = itemIdForAnchor(snap, ann.anchor);
      expect(expectedItem).toMatch(/^card:/);

      const prompts = questionPrompts(agents);
      expect(prompts.length).toBeGreaterThanOrEqual(2);
      const turn = prompts[prompts.length - 1];
      expect(turn).toContain("## Selected text");
      expect(turn).toContain("raw CRLF");
      expect(turn).toContain(expectedItem);
      expect(turn).toContain("3–7");
      expect(turn).toContain("Explain this.");
      expect(turn).toContain("## Changed hunks");
      expect(turn).toContain("(no changes)");
      // Minimal: no pasted card, block, thread-transcript or log text —
      // the section heads render with their empty placeholders.
      expect(turn).toContain("## Conversation so far\n\n(none)");
      expect(turn).not.toContain("## Host block");
      expect(turn).not.toContain("## Card it belongs to");
      expect(turn).not.toContain("## What changed");
      expect(turn).not.toContain(otherAnswer);
      expect(turn).not.toContain("OTHER_THREAD_QUOTE");
    } finally {
      await app.close();
    }
  });

  it("an in-thread Ask carries the source reply ID and the chip quote", async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "## The question", events: textEvents(SECOND_ANSWER) },
    ]);
    const { app, ctx, id } = await demoApp(agents);
    try {
      const ex = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(ex.status).toBe(200);
      await waitForJob(ctx, ex.json.jobId as string);
      const threadId = ex.json.annotationId as string;
      const first = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === threadId)!;
      const sourceReplyId = first.replies[0]!.id;
      const sourceSeq = first.replies[0]!.seq;
      expect(sourceSeq).toBe(1);

      const ask = await postAction(app, id, {
        kind: "ask",
        quote: "chip quote",
        threadId,
        sourceReplyId,
        message: "What does this imply?",
        offsets: { start: 0, end: 10 },
      });
      expect(ask.status).toBe(200);
      if (ask.json.jobId) await waitForJob(ctx, ask.json.jobId as string);

      const prompts = questionPrompts(agents);
      const turn = prompts[prompts.length - 1];
      expect(turn).toContain("chip quote");
      expect(turn).toContain(`ann:${threadId}#r${sourceSeq}`);
      expect(turn).toContain("0–10");
      expect(turn).toContain("What does this imply?");
      // The in-thread link points at the new reply.
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === threadId)!;
      expect(after.replies.length).toBe(2);
      expect(after.replies[0]!.linkTo).toBe(after.replies[1]!.id);
    } finally {
      await app.close();
    }
  });

  it("changed hunk IDs ride a follow-up only when the code changed since", async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "# Ask", events: textEvents(FIRST_ANSWER) },
    ]);
    const { app, ctx, id } = await demoApp(agents);
    try {
      // Same version: no hunk list.
      const first = await postAction(app, id, {
        kind: "explain",
        quote: "same-version quote",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(first.status).toBe(200);
      await waitForJob(ctx, first.json.jobId as string);
      expect(questionPrompts(agents).at(-1)).toContain("(no changes)");
      const threadId = first.json.annotationId as string;

      // Newer version with a recorded delta: a follow-up in the same
      // (v1-anchored) thread carries the changed hunk IDs.
      await ctx.reviews.mutate(id, (draft) => {
        draft.version.n = 2;
        draft.sinceHunks = { added: [], changed: ["h:conn:deadbeef"] };
      });
      const followup = await postAction(app, id, {
        kind: "reply",
        annotationId: threadId,
        message: "Still true?",
      });
      expect(followup.status).toBe(200);
      if (followup.json.jobId) await waitForJob(ctx, followup.json.jobId as string);
      const turn = questionPrompts(agents).at(-1)!;
      expect(turn).toContain("h:conn:deadbeef");
      expect(turn).not.toContain("(no changes)");
    } finally {
      await app.close();
    }
  });
});
