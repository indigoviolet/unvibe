/**
 * Hunk summaries as content cards (issue #138): the first interaction
 * with an idle summary activates it into a real conversation card hosted
 * on the hunk (`h:<fileKey>:<contentHash>`), created from the stored
 * summary text with no agent call — then the action runs nested on the
 * selected summary text. A Comment attaches to the hunk's first changed
 * line and never activates the summary.
 *
 * Over HTTP on the demo review with scripted fakes (no real agents, no
 * network). Summaries are seeded straight into `hunkStates` (the hunk
 * pass that writes them is not under test here).
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

const NESTED_ANSWER = `The fold wording covers line breaks.

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

async function postAction(
  app: App["app"],
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

function fakeAgents(): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    { match: "# Ask", events: textEvents(NESTED_ANSWER) },
    { match: "## The question", events: textEvents(NESTED_ANSWER) },
  ]);
}

/** First hunk of the demo connection file + a seeded summary for it. */
async function seedSummary(
  ctx: App["ctx"],
  id: string,
  summary: string,
): Promise<{ fileKey: string; contentHash: string; firstNewLine: number }> {
  const snap = ctx.reviews.getSnapshot(id)!;
  const file = snap.files.find((f) => f.path.includes("connection") && !f.path.includes("test")) ?? snap.files[0];
  const hunk = file.hunks[0];
  await ctx.reviews.mutate(id, (draft) => {
    const states = draft.hunkStates as ReviewSnapshot["hunkStates"];
    const existing = states.find((s) => s.contentHash === hunk.contentHash);
    if (existing) existing.summary = summary;
    else states.push({ contentHash: hunk.contentHash, folded: false, reviewed: false, summary });
  });
  const firstNewLine = hunk.lines.find((l) => l.kind === "add" && l.newLine !== undefined)?.newLine ?? hunk.newStart;
  return { fileKey: file.fileKey, contentHash: hunk.contentHash, firstNewLine };
}

function hunkCards(ctx: App["ctx"], id: string, fileKey: string, contentHash: string): ReviewSnapshot["annotations"] {
  return ctx
    .reviews.getSnapshot(id)!
    .annotations.filter(
      (a) =>
        a.type === "conversation" &&
        a.anchor.host.kind === "hunk" &&
        a.anchor.host.fileKey === fileKey &&
        a.anchor.host.contentHash === contentHash,
    );
}

describe("hunk summaries as content cards (#138)", () => {
  it("explain on a summary activates the hunk card with no agent call, then answers nested", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { fileKey, contentHash } = await seedSummary(ctx, id, "Adds a fast path that skips values without CRLF.");
      const promptsBefore = agents.prompts.length;
      const res = await postAction(app, id, {
        kind: "explain",
        quote: "fast path",
        anchor: { where: "hunk", fileKey, contentHash },
      });
      expect(res.status).toBe(200);
      const nestedId = res.json.annotationId as string;
      const nestedTurnId = res.json.turnId as string;
      expect(nestedId).toMatch(/^ann_/);
      if (res.json.jobId) expect(await waitForJob(ctx, res.json.jobId as string)).toBe("done");

      // One hunk card, built from the summary with no agent prompt: the
      // only new prompts are the nested answer's own.
      const cards = hunkCards(ctx, id, fileKey, contentHash);
      expect(cards.length).toBe(1);
      expect(cards[0].id).not.toBe(nestedId);
      expect(cards[0].open).toBe(true);
      expect(cards[0].sessionId).toBeUndefined();
      const firstTurn = (cards[0].turns ?? [])[0];
      expect(firstTurn?.question).toBeNull();
      expect(firstTurn?.blocks.length).toBeGreaterThan(0);
      // Activating the hunk card itself is a pure store write: the only
      // new agent prompt is the nested answer's own (it carries the
      // summary as its card context, like any nested turn).
      const newPrompts = agents.prompts.slice(promptsBefore);
      expect(newPrompts.length).toBe(1);
      expect(newPrompts[0].text).toContain("fast path");

      // The nested answer anchors on the summary's block and filled.
      const nested = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === nestedId)!;
      expect(nested.anchor.host.kind).toBe("block");
      if (nested.anchor.host.kind === "block") {
        expect(nested.anchor.host.blockId).toBe(`${firstTurn?.id}#b1`);
      }
      expect(nested.anchor.quotedText).toBe("fast path");
      const nestedTurn = (nested.turns ?? []).find((t) => t.id === nestedTurnId)!;
      expect(nestedTurn.blocks.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("ask on a summary asks the nested question; a repeat explain reuses the hunk card", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { fileKey, contentHash } = await seedSummary(ctx, id, "Normalizes folded header values.");
      const ask = await postAction(app, id, {
        kind: "ask",
        quote: "folded",
        anchor: { where: "hunk", fileKey, contentHash },
        message: "Why fold at all?",
      });
      expect(ask.status).toBe(200);
      if (ask.json.jobId) expect(await waitForJob(ctx, ask.json.jobId as string)).toBe("done");
      const nested = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (ask.json.annotationId as string))!;
      expect((nested.turns ?? [])[0]?.question).toBe("Why fold at all?");

      const again = await postAction(app, id, {
        kind: "explain",
        quote: "folded values",
        anchor: { where: "hunk", fileKey, contentHash },
      });
      expect(again.status).toBe(200);
      if (again.json.jobId) expect(await waitForJob(ctx, again.json.jobId as string)).toBe("done");
      // Still one hunk card; the second action nested under it.
      expect(hunkCards(ctx, id, fileKey, contentHash).length).toBe(1);
      expect(again.json.annotationId).not.toBe(ask.json.annotationId);
    } finally {
      await app.close();
    }
  });

  it("hunk_card activates with no job; summary citations parse into the turn", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const snap = ctx.reviews.getSnapshot(id)!;
      const file = snap.files.find((f) => f.path.includes("connection") && !f.path.includes("test")) ?? snap.files[0];
      const { fileKey, contentHash } = await seedSummary(
        ctx,
        id,
        `Unfolds values before reading. [[diff:${file.fileKey}:80-82]]`,
      );
      const res = await postAction(app, id, { kind: "hunk_card", fileKey, contentHash });
      expect(res.status).toBe(200);
      expect(res.json.jobId).toBeUndefined();
      const card = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(card.type).toBe("conversation");
      expect(card.anchor.host).toEqual({ kind: "hunk", fileKey, contentHash });
      const turn = (card.turns ?? [])[0];
      expect(turn?.blocks.length).toBe(1);
      // The token leaves the display text and lands in citations.
      const text = JSON.stringify(turn?.blocks[0]);
      expect(text).not.toContain("[[diff:");
      expect((turn?.blocks[0] as { citations?: { target: string }[] }).citations?.length).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("a comment on a hunk anchor is rejected; a diff-line note never activates", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { fileKey, contentHash, firstNewLine } = await seedSummary(ctx, id, "Skips values without CRLF.");
      const bad = await postAction(app, id, {
        kind: "note",
        quote: "Skips",
        anchor: { where: "hunk", fileKey, contentHash },
        text: "should map client-side",
      });
      expect(bad.status).not.toBe(200);

      const note = await postAction(app, id, {
        kind: "note",
        quote: "Skips",
        anchor: { where: "diff-line", fileKey, line: firstNewLine },
        text: "A quiet comment",
      });
      expect(note.status).toBe(200);
      // No hunk card was activated by the comment.
      expect(hunkCards(ctx, id, fileKey, contentHash).length).toBe(0);
      const thread = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (note.json.annotationId as string))!;
      expect(thread.type).toBe("comment");
      expect(thread.anchor.host).toEqual({ kind: "diff-line", fileKey, line: firstNewLine });
    } finally {
      await app.close();
    }
  });

  it("unknown hunk and missing summary fail plainly", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const snap = ctx.reviews.getSnapshot(id)!;
      const file = snap.files[0];
      const noSummary = await postAction(app, id, {
        kind: "hunk_card",
        fileKey: file.fileKey,
        contentHash: file.hunks[0].contentHash,
      });
      expect(noSummary.status).not.toBe(200);
      const unknown = await postAction(app, id, {
        kind: "hunk_card",
        fileKey: file.fileKey,
        contentHash: "deadbeefdeadbeef",
      });
      expect(unknown.status).not.toBe(200);
    } finally {
      await app.close();
    }
  });
});
