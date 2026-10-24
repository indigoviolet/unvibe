/**
 * M4 interaction actions end to end (PRD §4.3, §4.4, §4.6–§4.8, §12).
 *
 * With the replay runner and scripted fakes: every action over HTTP
 * (`POST /api/reviews/:id/actions`) on the demo review, asserting the
 * patches and final state — depth round-trip without a second agent
 * call, undo preserving annotations, promote, close-keeps-answer, dedupe,
 * ask follow-up reusing the session, malformed reply and retryable-error
 * paths, concurrent actions on different cards.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent, Card, McpServerConfig, ParagraphBlock, ReviewSnapshot, SecondOpinionResult, Session } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { NO_AGENT_MESSAGE } from "../src/agent/none.js";
import { ReplayAgentRunner } from "../src/replay/runner.js";
import { createApp } from "../src/server.js";
import { precheckD2Source } from "../src/diagrams/precheck.js";
import { applyUndo, insertExamples, mergeDepthText, pushUndo, type CardTarget } from "../src/interaction/cards.js";
import {
  getInteractionHandler,
  setInteractionHandler,
  type InteractionEvent,
} from "../src/sharedctx/hooks.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);
const authed = { authorization: "Bearer tok" };

function replay(): ReplayAgentRunner {
  return new ReplayAgentRunner({ fixturesDir, chunkChars: 256, delayMs: 0 });
}

async function waitFor(check: () => boolean, timeoutMs = 30000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

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

const VALID_EXPLAIN = `An explanation with no citations.

\`\`\`json
{}
\`\`\`
`;



const VALID_DEPTH_SIMPLE = `A simpler problem paragraph.

\`\`\`json
{"depth": {"level": "simple", "cardId": "problem"}}
\`\`\`
`;

const VALID_EXAMPLES = `::: example
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

/** Fake with static scripts (base ready + minimal reader + per-kind replies). */
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

describe("M4 actions on the demo review (replay)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("explain: working state, streams, fills, patches, canonical citations", { timeout: 90000 }, async () => {
    const agents = replay();
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        const root = s?.pages.find((p) => p.id === "root");
        return !!root?.cards.find((c) => c.id === "problem")?.blocks.length;
      });

      const patches: { headRev: number; ops: unknown[] }[] = [];
      const unsub = ctx.bus.subscribe(id, (ev) => {
        if (ev.type === "patch") patches.push({ headRev: ev.headRev, ops: ev.ops });
      });
      const baseRev = ctx.reviews.getSnapshot(id)!.rev;

      const res = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(res.status).toBe(200);
      expect(res.json.accepted).toBe(true);
      const annotationId = res.json.annotationId as string;
      expect(annotationId).toMatch(/^ann_/);
      expect(res.json.jobId).toBeTruthy();

      // Immediately visible working state (or already filled: the replay
      // runner answers in milliseconds, so a fast poll may see it done).
      const working = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(working.type).toBe("conversation");
      expect(working.open).toBe(true);
      expect(working.working === "Thinking" || (working.turns?.[0]?.blocks.length ?? 0) > 0).toBe(true);

      await waitForJob(ctx, res.json.jobId as string);
      const done = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(done.turns?.[0]?.blocks.length ?? 0).toBeGreaterThan(0);
      expect(done.working).toBeNull();
      expect(done.turns?.[0]?.revision).toBe(2);
      // Stored targets are canonical (real file keys, no aliases).
      const targets = JSON.stringify(done.turns?.[0]?.blocks);
      expect(targets).not.toContain("diff:conn:");
      expect(targets).toContain("diff:");
      unsub();
      expect(patches.length).toBeGreaterThan(0);
      expect(patches[patches.length - 1].headRev).toBeGreaterThan(baseRev);
    } finally {
      await app.close();
    }
  });

  it("ask: card, cited answer, session remembered; reply reuses the session", { timeout: 90000 }, async () => {
    const agents = replay();
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "central")?.blocks.length;
      });

      const res = await postAction(app, id, {
        kind: "ask",
        quote: "fast path",
        anchor: { where: "block", blockId: "central#b4" },
        message: "Does the fast path still catch a fold that uses a bare LF?",
      });
      expect(res.status).toBe(200);
      const annotationId = res.json.annotationId as string;
      expect(annotationId).toMatch(/^ann_/);
      const turnId = res.json.turnId as string;
      expect(turnId).toMatch(/^ans_/);
      await waitForJob(ctx, res.json.jobId as string);

      const card = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(card.type).toBe("conversation");
      const first = (card.turns ?? [])[0]!;
      expect(first.question).toBe("Does the fast path still catch a fold that uses a bare LF?");
      expect(first.blocks.length).toBeGreaterThan(0);
      expect(card.working).toBeNull();
      expect(card.error).toBeNull();
      expect(card.sessionId).toBeTruthy();
      const sessionId = card.sessionId!;
      const promptsOnSession = agents.prompts.filter((p) => p.sessionId === sessionId).length;
      expect(promptsOnSession).toBe(1);
      const sessionsBefore = agents.sessions.size;

      // Follow-up reply goes on the SAME conversation session, with the
      // short prompt (no resend of the anchor, card and history).
      const rep = await postAction(app, id, { kind: "reply", annotationId, message: "What about ordering?" });
      expect(rep.status).toBe(200);
      expect(rep.json.jobId).toBeTruthy();
      await waitForJob(ctx, rep.json.jobId as string);
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect((after.turns ?? []).length).toBe(2);
      expect(after.turns![1].blocks.length).toBeGreaterThan(0);
      expect(agents.sessions.size).toBe(sessionsBefore);
      expect(agents.prompts.filter((p) => p.sessionId === sessionId).length).toBe(promptsOnSession + 1);
      const lastPrompt = agents.prompts.filter((p) => p.sessionId === sessionId).at(-1)!;
      expect(lastPrompt.text).toContain("# Ask follow-up");
      expect(lastPrompt.text).not.toContain("## Selected text");
    } finally {
      await app.close();
    }
  });

  it("note creates a comment with no agent reply", { timeout: 30000 }, async () => {
    const { app, ctx } = await createApp("tok", { agents: replay() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
      // Notes emit nothing at creation (no shared knowledge yet); they
      // settle to one log line on close.
      const events: InteractionEvent[] = [];
      const prev = getInteractionHandler();
      setInteractionHandler(async (e) => {
        events.push(e);
      });
      try {
        const res = await postAction(app, id, {
          kind: "note",
          quote: "fast path",
          anchor: { where: "block", blockId: "b1" },
          text: "A reader note.",
        });
        expect(res.status).toBe(200);
        expect(res.json.jobId).toBeUndefined();
        const thread = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
        expect(thread.type).toBe("comment");
        expect(thread.messages).toHaveLength(1);
        expect(events).toHaveLength(0);
      } finally {
        setInteractionHandler(prev);
      }
    } finally {
      await app.close();
    }
  });

  it("depth round-trips instantly when the level is cached (no second agent call)", { timeout: 60000 }, async () => {
    const agents = replay();
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "central")?.blocks.length;
      });
      const promptsBefore = agents.prompts.length;

      const down = await postAction(app, id, { kind: "depth", cardId: "central", direction: "simpler" });
      expect(down.status).toBe(200);
      expect(down.json.jobId).toBeUndefined();
      expect(ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!.level).toBe(
        "simple",
      );

      const up = await postAction(app, id, { kind: "depth", cardId: "central", direction: "deeper" });
      expect(up.status).toBe(200);
      expect(up.json.jobId).toBeUndefined();
      const central = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!;
      expect(central.level).toBe("standard");
      expect(central.revision).toBeGreaterThanOrEqual(3);
      expect(central.undoStack.length).toBe(2);
      // Switching back cost no agent call.
      expect(agents.prompts.length).toBe(promptsBefore);
    } finally {
      await app.close();
    }
  });

  it("examples and diagram insert without duplicating; undo preserves annotations", { timeout: 90000 }, async () => {
    const { app, ctx } = await createApp("tok", { agents: replay() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "central")?.blocks.length;
      });
      const annCountBefore = ctx.reviews.getSnapshot(id)!.annotations.length;

      const ex = await postAction(app, id, { kind: "examples", cardId: "central" });
      expect(ex.status).toBe(200);
      await waitForJob(ctx, ex.json.jobId as string);
      const withExamples = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!;
      const exampleCount = withExamples.blocks.filter((b) => b.type === "aside" && b.kind === "Example").length;
      expect(exampleCount).toBe(2);

      // A second request never duplicates.
      const ex2 = await postAction(app, id, { kind: "examples", cardId: "central" });
      expect(ex2.status).toBe(200);
      if (ex2.json.jobId) await waitForJob(ctx, ex2.json.jobId as string);
      const again = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!;
      expect(again.blocks.filter((b) => b.type === "aside" && b.kind === "Example").length).toBe(2);

      const dg = await postAction(app, id, { kind: "diagram", cardId: "central" });
      expect(dg.status).toBe(200);
      await waitForJob(ctx, dg.json.jobId as string);
      // The D2 finalize (compile-check + render) lands just after the job
      // settles; wait for the block, not just the job.
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        const c = s?.pages.find((p) => p.id === "root")?.cards.find((x) => x.id === "central");
        return !!c?.blocks.some((b) => b.type === "diagram");
      });
      const withDiagram = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!;
      const diagrams = withDiagram.blocks.filter((b) => b.type === "diagram");
      expect(diagrams.length).toBe(1);
      const dgb = diagrams[0] as { source: string; render?: { hash: string; status: string } };
      expect(dgb.source).toContain("->");
      expect(precheckD2Source(dgb.source).ok).toBe(true);
      expect(["ok", "unavailable"]).toContain(dgb.render?.status);

      // Undo reverts the diagram; annotations attached to the card survive.
      const undo = await postAction(app, id, { kind: "undo", cardId: "central" });
      expect(undo.status).toBe(200);
      const undone = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!;
      expect(undone.blocks.some((b) => b.type === "diagram")).toBe(false);
      expect(undone.blocks.filter((b) => b.type === "aside" && b.kind === "Example").length).toBe(2);
      expect(ctx.reviews.getSnapshot(id)!.annotations.length).toBeGreaterThanOrEqual(annCountBefore);
    } finally {
      await app.close();
    }
  });

  it("followup answers under the suggestion and consumes it; concept pages fill from a stub", { timeout: 90000 }, async () => {
    const { app, ctx } = await createApp("tok", { agents: replay() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        const flow = s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "g-flow");
        return !!flow && !flow.pending;
      });

      const before = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "g-flow")!;
      const follow = before.blocks.find((b) => b.type === "follow-up")!;
      expect(follow.items.length).toBe(2);
      const res = await postAction(app, id, { kind: "followup", cardId: "g-flow", blockId: follow.id, index: 0 });
      expect(res.status).toBe(200);
      const annotationId = res.json.annotationId as string;
      await waitForJob(ctx, res.json.jobId as string);
      const snap = ctx.reviews.getSnapshot(id)!;
      const answer = snap.annotations.find((a) => a.id === annotationId)!;
      expect(answer.type).toBe("conversation");
      expect(answer.turns?.[0]?.blocks.length ?? 0).toBeGreaterThan(0);
      const consumed = snap.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "g-flow")!.blocks.find(
        (b) => b.type === "follow-up",
      )!;
      expect(consumed.items.length).toBe(1);

      // Concept page on first open: stub, then filled.
      const concept = await postAction(app, id, { kind: "concept", slug: "unfolding" });
      expect(concept.status).toBe(200);
      expect(concept.json.pageId).toBe("c-unfolding");
      if (concept.json.jobId) await waitForJob(ctx, concept.json.jobId as string);
      await waitFor(() => {
        const p = ctx.reviews.getSnapshot(id)!.pages.find((x) => x.id === "c-unfolding");
        return !!p && p.cards.length > 0 && p.cards[0].blocks.length > 0;
      });
    } finally {
      await app.close();
    }
  });

  it("promote moves conversation content to a new page; collapse/close/delete", { timeout: 120000 }, async () => {
    const { app, ctx } = await createApp("tok", { agents: replay() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem")?.blocks.length;
      });
      const files = ctx.reviews.getSnapshot(id)!.files;
      const conn = files.find((f) => f.path.includes("connection") && !f.path.includes("test")) ?? files[0];

      const ex = await postAction(app, id, {
        kind: "explain",
        quote: "_OBSOLETE_FOLD_RE",
        anchor: { where: "diff-line", fileKey: conn.fileKey, line: 82 },
      });
      expect(ex.status).toBe(200);
      await waitForJob(ctx, ex.json.jobId as string);
      const annotationId = ex.json.annotationId as string;

      const promoted = await postAction(app, id, { kind: "promote", annotationId });
      expect(promoted.status).toBe(200);
      const pageId = promoted.json.pageId as string;
      const snap = ctx.reviews.getSnapshot(id)!;
      const page = snap.pages.find((p) => p.id === pageId)!;
      expect(page.kind).toBe("opened-expansion");
      expect(page.title).toContain("_OBSOLETE_FOLD_RE");
      expect(page.parent).toBe("root");
      expect(page.cards[0].blocks.length).toBeGreaterThan(0);
      const link = snap.annotations.find((a) => a.id === annotationId)!;
      expect(link.type).toBe("link");
      expect(link.promotedToPage).toBe(pageId);

      const collapsed = await postAction(app, id, { kind: "collapse", cardId: "central", collapsed: true });
      expect(collapsed.status).toBe(200);
      expect(ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!.collapsed).toBe(
        true,
      );

      // close + delete on fresh note threads.
      const note = await postAction(app, id, {
        kind: "note",
        quote: "x",
        anchor: { where: "diff-line", fileKey: conn.fileKey, line: 80 },
        text: "to close",
      });
      const noteId = note.json.annotationId as string;
      const closed = await postAction(app, id, { kind: "close", annotationId: noteId });
      expect(closed.status).toBe(200);
      expect(ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === noteId)!.open).toBe(false);

      const note2 = await postAction(app, id, {
        kind: "note",
        quote: "y",
        anchor: { where: "diff-line", fileKey: conn.fileKey, line: 80 },
      });
      const deleted = await postAction(app, id, { kind: "delete", targetId: note2.json.annotationId as string });
      expect(deleted.status).toBe(200);
      expect(ctx.reviews.getSnapshot(id)!.annotations.some((a) => a.id === (note2.json.annotationId as string))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("interaction log: explain/depth/example land with the right scope; closed threads settle", { timeout: 120000 }, async () => {
    const { app, ctx } = await createApp("tok", { agents: replay() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem")?.blocks.length;
      });
      const myEntries = () =>
        ctx
          .reviews.getSnapshot(id)!
          .logTail.filter(
            (e) =>
              (e.kind === "new-card" && JSON.stringify(e.payload).includes("raw CRLF")) ||
              e.kind === "depth-rewrite" ||
              e.kind === "example" ||
              e.kind === "thread-summary",
          );

      // Explain → `new-card`, global scope.
      const ex = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(ex.status).toBe(200);
      await waitForJob(ctx, ex.json.jobId as string);
      await waitFor(() => myEntries().some((e) => e.kind === "new-card"));
      const newCard = myEntries().find((e) => e.kind === "new-card")!;
      expect(newCard.scope).toEqual({ scope: "global" });

      // Depth rewrite via agent → `depth-rewrite`, card scope. g-design
      // only carries standard text, so the agent path runs.
      const depth = await postAction(app, id, { kind: "depth", cardId: "g-design", direction: "simpler" });
      expect(depth.status).toBe(200);
      if (depth.json.jobId) await waitForJob(ctx, depth.json.jobId as string);
      await waitFor(() => myEntries().some((e) => e.kind === "depth-rewrite"));
      const rewrite = myEntries().find((e) => e.kind === "depth-rewrite")!;
      expect(rewrite.scope).toEqual({ scope: "card", cardId: "g-design" });

      // Examples → `example`, card scope.
      const examples = await postAction(app, id, { kind: "examples", cardId: "central" });
      expect(examples.status).toBe(200);
      if (examples.json.jobId) await waitForJob(ctx, examples.json.jobId as string);
      await waitFor(() => myEntries().some((e) => e.kind === "example"));
      const example = myEntries().find((e) => e.kind === "example")!;
      expect(example.scope).toEqual({ scope: "card", cardId: "central" });

      // Ask + close → `thread-summary`, global scope (one line, once).
      const ask = await postAction(app, id, {
        kind: "ask",
        quote: "fast path",
        anchor: { where: "block", blockId: "central#b4" },
        message: "Does the fast path still catch a fold that uses a bare LF?",
      });
      expect(ask.status).toBe(200);
      await waitForJob(ctx, ask.json.jobId as string);
      const threadId = ask.json.annotationId as string;
      const closed = await postAction(app, id, { kind: "close", annotationId: threadId });
      expect(closed.status).toBe(200);
      await waitFor(() =>
        myEntries().some(
          (e) =>
            e.kind === "thread-summary" &&
            (e.payload as { annotationId?: string }).annotationId === threadId,
        ),
      );
      const summary = myEntries().find((e) => e.kind === "thread-summary")!;
      expect(summary.scope).toEqual({ scope: "global" });

      // UI state never lands in the log: collapse adds nothing.
      const countBefore = myEntries().length;
      await postAction(app, id, { kind: "collapse", cardId: "central", collapsed: true });
      await new Promise((r) => setTimeout(r, 300));
      expect(myEntries()).toHaveLength(countBefore);
    } finally {
      await app.close();
    }
  });
});

describe("M4 dedupe + close-keeps-answer / delete-cancels (gated runners)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  /** Replay runner that blocks explain prompts until aborted (cancel test). */
  class GatedReplay extends ReplayAgentRunner {
    override async *prompt(
      session: { id: string; provider: string; model: string },
      text: string,
      signal?: AbortSignal,
    ): AsyncIterable<AgentEvent> {
      if (text.includes("## The question\n\nExplain this.")) {
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) reject(new Error("aborted"));
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      yield* super.prompt(session, text, signal);
    }
  }

  it("dedupes identical explains and cancels the job on close", { timeout: 60000 }, async () => {
    const agents = new GatedReplay({ fixturesDir, chunkChars: 256, delayMs: 0 });
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem")?.blocks.length;
      });

      const first = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(first.status).toBe(200);
      const annotationId = first.json.annotationId as string;
      await waitFor(() => {
        const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId);
        return !!a?.jobId;
      });
      const jobId = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!.jobId!;

      // Identical request reuses the active job: no second annotation.
      const countBefore = ctx.reviews.getSnapshot(id)!.annotations.length;
      const second = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(second.status).toBe(200);
      expect(second.json.deduplicated).toBe(true);
      expect(second.json.jobId).toBe(jobId);
      expect(ctx.reviews.getSnapshot(id)!.annotations.length).toBe(countBefore);

      // Deleting still cancels the job and removes the card.
      const deleted = await postAction(app, id, { kind: "delete", targetId: annotationId });
      expect(deleted.status).toBe(200);
      await waitForJob(ctx, jobId);
      expect(ctx.jobs.get(jobId)?.state).toBe("cancelled");
      expect(ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("close while a turn runs keeps the job: it fills, and reopening shows the answer", { timeout: 60000 }, async () => {
    // Fake runner whose explain turn waits on a gate the test releases.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    class GatedFake extends FakeAgentRunner {
      override async *prompt(
        session: Session,
        text: string,
        signal?: AbortSignal,
      ): AsyncIterable<AgentEvent> {
        if (text.includes("## The question\n\nExplain this.")) await gate;
        yield* super.prompt(session, text, signal);
      }
    }
    const agents = new GatedFake([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "## The question\n\nExplain this.", events: textEvents(VALID_EXPLAIN) },
    ]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
      const first = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(first.status).toBe(200);
      const annotationId = first.json.annotationId as string;
      const jobId = first.json.jobId as string;
      await waitFor(() => ctx.jobs.get(jobId)?.state === "running");

      // Close mid-turn: only hides the card. The job is not cancelled and
      // the working marker stays, so a reopened card shows it is working.
      const closed = await postAction(app, id, { kind: "close", annotationId });
      expect(closed.status).toBe(200);
      const whileClosed = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!;
      expect(whileClosed.open).toBe(false);
      expect(whileClosed.working).not.toBeNull();
      expect(ctx.jobs.get(jobId)?.state).not.toBe("cancelled");

      release();
      expect(await waitForJob(ctx, jobId)).toBe("done");
      const filled = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!;
      expect(filled.open).toBe(false);
      expect((filled.turns ?? [])[0]?.blocks.length).toBeGreaterThan(0);

      // Reopening (the comments route the web uses) shows the answer.
      const reopened = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/comments/${annotationId}`,
        headers: authed,
        payload: { open: true },
      } as never);
      expect(reopened.statusCode).toBe(200);
      const shown = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!;
      expect(shown.open).toBe(true);
      expect((shown.turns ?? [])[0]?.blocks.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});

describe("M4 failure paths (scripted fakes)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("malformed reply leaves a visible error with a retry path", { timeout: 60000 }, async () => {
    const agents = fakeWith([{ match: "## The question\n\nExplain this.", events: textEvents("Some text\n\n```json\n{not valid\n```\n") }]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

      const res = await postAction(app, id, {
        kind: "explain",
        quote: "q",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(res.status).toBe(200);
      await waitForJob(ctx, res.json.jobId as string);
      const failed = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(failed.working).toBeNull();
      expect(failed.error).toMatch(/trailing JSON/);

      // Retry rebuilds on the same annotation (and fails the same way here).
      const retry = await postAction(app, id, { kind: "retry", annotationId: res.json.annotationId as string });
      expect(retry.status).toBe(200);
      expect(retry.json.jobId).not.toBe(res.json.jobId);
      await waitForJob(ctx, retry.json.jobId as string);
      const again = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(again.error).toMatch(/trailing JSON/);
    } finally {
      await app.close();
    }
  });

  it("retryable errors surface, then recover on retry", { timeout: 60000 }, async () => {
    let explainCalls = 0;
    class CountingFake extends FakeAgentRunner {
      override async *prompt(
        session: { id: string; provider: string; model: string },
        text: string,
      ): AsyncIterable<AgentEvent> {
        if (text.includes("## The question\n\nExplain this.")) {
          explainCalls += 1;
          // Fail the whole first job (4 internal attempts), then recover.
          if (explainCalls <= 4) {
            yield { type: "error", message: "rate limited", retryable: true };
            return;
          }
          for (const e of textEvents(VALID_EXPLAIN)) yield e;
          return;
        }
        yield* super.prompt(session, text);
      }
    }
    const agents = new CountingFake([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    ]);
    // Bounded queue: no queue-level retry, so the first job settles fast
    // with a visible error after its 4 internal attempts.
    const { JobQueue } = await import("../src/jobs/queue.js");
    const jobs = new JobQueue({ maxAttempts: 1, backoffBaseMs: 10 });
    const { app, ctx } = await createApp("tok", { agents, jobs });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

      const res = await postAction(app, id, {
        kind: "explain",
        quote: "q",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(res.status).toBe(200);
      await waitForJob(ctx, res.json.jobId as string);
      // Four attempts (initial + 3 retries) all failed → visible error.
      expect(explainCalls).toBe(4);
      const failed = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(failed.working).toBeNull();
      expect(failed.error).toMatch(/rate limited/);

      const retry = await postAction(app, id, { kind: "retry", annotationId: res.json.annotationId as string });
      expect(retry.status).toBe(200);
      await waitForJob(ctx, retry.json.jobId as string);
      const recovered = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(recovered.error).toBeNull();
      expect(recovered.turns?.[0]?.blocks.length ?? 0).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("depth via agent fills the level; concurrent actions on different cards", { timeout: 90000 }, async () => {
    const agents = fakeWith([
      { match: "# Depth rewrite", events: textEvents(VALID_DEPTH_SIMPLE) },
      { match: "# Examples", events: textEvents(VALID_EXAMPLES) },
    ]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);

      // The fake reader only wrote standard text: depth needs the agent.
      const depth = await postAction(app, id, { kind: "depth", cardId: "problem", direction: "simpler" });
      expect(depth.status).toBe(200);
      expect(depth.json.jobId).toBeTruthy();
      await waitForJob(ctx, depth.json.jobId as string);
      const simple = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "problem")!;
      expect(simple.level).toBe("simple");

      // Concurrent actions on different cards stay independent.
      const [a, b, c] = await Promise.all([
        postAction(app, id, { kind: "examples", cardId: "problem" }),
        postAction(app, id, { kind: "examples", cardId: "central" }),
        postAction(app, id, { kind: "depth", cardId: "central", direction: "simpler" }),
      ]);
      expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
      for (const r of [a, b, c]) {
        if (r.json.jobId) await waitForJob(ctx, r.json.jobId as string);
      }
      const snap = ctx.reviews.getSnapshot(id)!;
      const problem = snap.pages.find((p) => p.id === "root")!.cards.find((x) => x.id === "problem")!;
      const central = snap.pages.find((p) => p.id === "root")!.cards.find((x) => x.id === "central")!;
      expect(problem.blocks.filter((x) => x.type === "aside").length).toBe(2);
      expect(central.blocks.filter((x) => x.type === "aside").length).toBe(2);
      expect(central.level).toBe("simple");
    } finally {
      await app.close();
    }
  });
});

describe("M4 actions under UNVIBE_AGENT=none", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  /**
   * Replay until the guide exists, then none semantics with the exact
   * production message (NoAgentRunner fails the same way: start throws,
   * prompts yield a non-retryable error).
   */
  class FlippableRunner extends ReplayAgentRunner {
    useNone = false;
    /** Marker for `isNoneRunner`, like the real `NoAgentRunner` (#122: runInFork fails fast before enqueueing). */
    get none(): boolean {
      return this.useNone;
    }
    override async start(opts: {
      provider: string;
      model: string;
      cwd: string;
      systemPrompt: string;
      mcpServers: McpServerConfig[];
    }): Promise<Session> {
      if (this.useNone) throw new Error(NO_AGENT_MESSAGE);
      return super.start(opts);
    }
    override async fork(session: Session): Promise<Session> {
      if (this.useNone) throw new Error(NO_AGENT_MESSAGE);
      return super.fork(session);
    }
    override async *prompt(session: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
      if (this.useNone) {
        yield { type: "error", message: NO_AGENT_MESSAGE, retryable: false };
        return;
      }
      yield* super.prompt(session, text, signal);
    }
  }

  function firstDiffLine(snapshot: ReviewSnapshot): { fileKey: string; line: number } {
    for (const f of snapshot.files) {
      for (const h of f.hunks) {
        const row = h.lines.find((l) => l.newLine !== undefined);
        if (row?.newLine) return { fileKey: f.fileKey, line: row.newLine };
      }
    }
    throw new Error("demo review has no diff lines");
  }

  /**
   * Strict RFC 6902 applier mirroring the web store contract: throws on
   * missing parents and out-of-bounds indices instead of corrupting state.
   */
  function strictApply(root: unknown, op: { op: string; path: string; value?: unknown }): unknown {
    const clone = (v: unknown): unknown =>
      Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...(v as object) } : v;
    const segs = op.path.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (segs.length === 0) {
      if (op.op === "remove") return undefined;
      return (op as { value: unknown }).value;
    }
    const newRoot = clone(root);
    let node = newRoot as Record<string, unknown> & unknown[];
    for (let i = 0; i < segs.length - 1; i++) {
      const next = (node as Record<string, unknown>)[segs[i]];
      if (next === null || typeof next !== "object") throw new Error(`patch parent missing at ${op.path}`);
      const copy = clone(next);
      (node as Record<string, unknown>)[segs[i]] = copy;
      node = copy as never;
    }
    const last = segs[segs.length - 1];
    if (Array.isArray(node)) {
      const idx = last === "-" ? node.length : Number(last);
      if (!Number.isInteger(idx) || idx < 0) throw new Error(`patch index out of bounds at ${op.path}`);
      if (op.op === "remove") {
        if (idx >= node.length) throw new Error(`patch index out of bounds at ${op.path}`);
        node.splice(idx, 1);
      } else if (op.op === "add") {
        if (idx > node.length) throw new Error(`patch index out of bounds at ${op.path}`);
        node.splice(idx, 0, (op as { value: unknown }).value);
      } else {
        if (idx >= node.length) throw new Error(`patch index out of bounds at ${op.path}`);
        node[idx] = (op as { value: unknown }).value;
      }
    } else {
      if (op.op === "remove") delete (node as Record<string, unknown>)[last];
      else (node as Record<string, unknown>)[last] = (op as { value: unknown }).value;
    }
    return newRoot;
  }

  it("non-agent actions work and every patch chains + applies strictly", { timeout: 90000 }, async () => {
    const agents = new FlippableRunner({ fixturesDir, chunkChars: 256, delayMs: 0 });
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "central")?.blocks.length;
      });
      // Flip to none: background pipeline jobs fail fast from here on.
      agents.useNone = true;

      // Collect every patch from here. Subscribe-then-clone is atomic
      // (the bus delivers synchronously; no publish can interleave), so
      // the observed chain must be gapless starting at the clone's rev.
      const patches: { baseRev: number; headRev: number; ops: { op: string; path: string; value?: unknown }[] }[] = [];
      const unsub = ctx.bus.subscribe(id, (ev) => {
        if (ev.type === "patch") patches.push(ev);
      });
      const base = JSON.parse(JSON.stringify(ctx.reviews.getSnapshot(id)!)) as ReviewSnapshot;
      const diff = firstDiffLine(ctx.reviews.getSnapshot(id)!);

      const note = await postAction(app, id, {
        kind: "note",
        quote: "",
        anchor: { where: "diff-line", fileKey: diff.fileKey, line: diff.line },
        text: "none-mode note",
      });
      expect(note.status).toBe(200);
      const noteId = note.json.annotationId as string;

      expect((await postAction(app, id, { kind: "collapse", cardId: "central", collapsed: true })).status).toBe(200);
      // Cached depth switch needs no agent.
      const depth = await postAction(app, id, { kind: "depth", cardId: "central", direction: "simpler" });
      expect(depth.status).toBe(200);
      expect(depth.json.jobId).toBeUndefined();
      expect((await postAction(app, id, { kind: "undo", cardId: "central" })).status).toBe(200);
      expect((await postAction(app, id, { kind: "close", annotationId: noteId })).status).toBe(200);
      const note2 = await postAction(app, id, {
        kind: "note",
        quote: "",
        anchor: { where: "diff-line", fileKey: diff.fileKey, line: diff.line },
      });
      expect((await postAction(app, id, { kind: "delete", targetId: note2.json.annotationId as string })).status).toBe(200);

      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!.level).toBe("standard");
      expect(snap.annotations.find((a) => a.id === noteId)!.open).toBe(false);
      expect(snap.annotations.some((a) => a.id === (note2.json.annotationId as string))).toBe(false);
      unsub();

      // Gapless rev chain from the clone…
      expect(patches.length).toBeGreaterThan(0);
      expect(patches[0].baseRev).toBe(base.rev);
      let cur: unknown = base;
      for (const p of patches) {
        expect(p.baseRev).toBe((cur as ReviewSnapshot).rev);
        // …and every op applies strictly (missing parents and
        // out-of-bounds indices throw, like the web store). The rev
        // itself travels outside the ops (headRev), as on the client.
        for (const op of p.ops) cur = strictApply(cur, op);
        (cur as ReviewSnapshot).rev = p.headRev;
      }
      // Replaying the observed patches from the clone converges exactly
      // on the live server snapshot.
      expect(cur).toEqual(snap);
    } finally {
      await app.close();
    }
  });

  it("agent actions fail fast with a clear state under none (no stuck working)", { timeout: 90000 }, async () => {
    const agents = new FlippableRunner({ fixturesDir, chunkChars: 256, delayMs: 0 });
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        return !!s?.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === "central")?.blocks.length;
      });
      agents.useNone = true;
      const diff = firstDiffLine(ctx.reviews.getSnapshot(id)!);

      // Ask with an EMPTY quote (diff-line clicks carry none): accepted
      // (not 400), thread created, then the clear no-agent error with no
      // stuck working state — and no 10 s job-id wait.
      const t0 = Date.now();
      const ask = await postAction(app, id, {
        kind: "ask",
        quote: "",
        anchor: { where: "diff-line", fileKey: diff.fileKey, line: diff.line },
        message: "Why?",
      });
      const askMs = Date.now() - t0;
      expect(ask.status).toBe(200);
      expect(ask.json.jobId).toBeUndefined();
      expect(askMs).toBeLessThan(8000);
      const threadId = ask.json.annotationId as string;
      await waitFor(() => {
        const t = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === threadId);
        const turn = t?.type === "conversation" ? (t.turns ?? [])[0] : undefined;
        return !!t && (t.error != null || (turn?.blocks.length ?? 0) > 0);
      });
      const thread = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === threadId)!;
      expect(thread.working).toBeNull();
      expect(thread.error).toContain("no agent configured");

      // Explain behaves the same way.
      const ex = await postAction(app, id, {
        kind: "explain",
        quote: "",
        anchor: { where: "diff-line", fileKey: diff.fileKey, line: diff.line },
      });
      expect(ex.status).toBe(200);
      expect(ex.json.jobId).toBeUndefined();
      const expansionId = ex.json.annotationId as string;
      await waitFor(() => {
        const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === expansionId);
        return !!a && (a.error != null || ((a.turns?.[0]?.blocks.length ?? 0) > 0));
      });
      const expansion = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === expansionId)!;
      expect(expansion.working).toBeNull();
      expect(expansion.error).toContain("no agent configured");

      // Card rewrites needing generation fail fast with the message in
      // the response; the card is unchanged.
      const depth = await postAction(app, id, { kind: "depth", cardId: "g-design", direction: "simpler" });
      expect(depth.status).toBe(500);
      expect(String(depth.json.error)).toContain("no agent configured");
      expect(depth.json.code).toBe("no-agent");
      expect(
        ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "g-design")!.level,
      ).toBe("standard");

      const examples = await postAction(app, id, { kind: "examples", cardId: "central" });
      expect(examples.status).toBe(500);
      expect(String(examples.json.error)).toContain("no agent configured");
      expect(examples.json.code).toBe("no-agent");

      // Retry rebuilds and fails the same fast way (error state persists,
      // nothing stuck working; still 200 — the error lives on the thread).
      const retry = await postAction(app, id, { kind: "retry", annotationId: threadId });
      expect(retry.status).toBe(200);
      expect(retry.json.jobId).toBeUndefined();
      await waitFor(() => {
        const t = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === threadId);
        const turn = t?.type === "conversation" ? (t.turns ?? [])[0] : undefined;
        return !!t?.error && t.working === null && (turn?.error != null || (turn?.blocks.length ?? 0) > 0);
      });
      expect(
        ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === threadId)!.error,
      ).toContain("no agent configured");
    } finally {
      await app.close();
    }
  });
});

describe("M4 interaction pure logic", () => {
  it("d2 precheck accepts clean sources and rejects denied constructs", () => {
    expect(precheckD2Source('direction: right\na -> b: go {link: "diff:conn:1-2"}').ok).toBe(true);
    expect(precheckD2Source("").ok).toBe(false);
    expect(precheckD2Source('a: {icon: https://example.com/x.svg}\na -> b').ok).toBe(false);
    expect(precheckD2Source('a -> b: x\n  link: "diff:conn:1"').ok).toBe(true);
  });

  it("insertExamples never duplicates; applyUndo restores without touching annotations", () => {
    const para = { type: "paragraph", id: "b1", text: { standard: "hi" }, citations: [] };
    const aside = {
      type: "aside",
      id: "b2",
      kind: "Example",
      inner: [{ type: "code", id: "b2-b1", code: "x", citations: [] }],
      citations: [],
    };
    const first = insertExamples([para] as never[], [aside] as never[]);
    expect(first.added).toBe(1);
    const second = insertExamples(first.blocks as never[], [aside] as never[]);
    expect(second.added).toBe(0);

    const card = {
      id: "c",
      pageId: "root",
      title: null,
      level: "standard",
      collapsed: false,
      revision: 1,
      blocks: first.blocks,
      undoStack: [{ blocks: [para], level: "standard" as const }],
    };
    expect(applyUndo({ kind: "page-card", pageId: "root", card } as never)).toBe(true);
    expect(card.blocks).toHaveLength(1);
  });

  it("second opinions and accepted corrections survive depth rewrites and undo", () => {
    const para = (id: string, standard: string, extra: Record<string, string> = {}): ParagraphBlock => ({
      type: "paragraph",
      id,
      text: { standard, ...extra },
      citations: [],
    });
    const opinion: SecondOpinionResult = {
      id: "so-central-check-test-test",
      cardId: "central",
      mode: "check",
      provider: "test",
      model: "test",
      effort: "",
      verdict: "agrees",
      reasoning: "Looks right.",
      blocks: [],
      version: 1,
      createdAt: 0,
    };
    const corr = para("b-corr-ct_1", "Accepted suggestion (from ct_1): use spaces.");
    const card: Card = {
      id: "central",
      pageId: "root",
      title: "The central change",
      level: "standard",
      collapsed: false,
      revision: 2,
      blocks: [para("b1", "Body one.", { simple: "Simple one." }), corr],
      undoStack: [],
      secondOpinions: [opinion],
    };
    const target: CardTarget = { kind: "page-card", pageId: "root", card };

    // Agent depth rewrite with a correction paragraph present: the merge
    // fills per-level text positionally and never drops blocks; the
    // second-opinion array lives beside blocks and is untouched.
    const reply = [para("b1", "Ignored standard.", { simple: "Fresh simple one." })];
    pushUndo(target, [...card.blocks], "standard");
    const merged = mergeDepthText(card.blocks, reply, "simple");
    card.blocks = merged;
    card.level = "simple";
    card.revision += 1;
    expect(card.blocks.map((b) => b.id)).toEqual(["b1", "b-corr-ct_1"]);
    const firstBlock = card.blocks[0];
    const secondBlock = card.blocks[1];
    if (firstBlock?.type !== "paragraph" || secondBlock?.type !== "paragraph") throw new Error("expected paragraphs");
    expect(firstBlock.text.simple).toBe("Fresh simple one.");
    expect(secondBlock.text.standard).toContain("Accepted suggestion");
    expect(card.secondOpinions).toHaveLength(1);
    expect(card.secondOpinions?.[0]?.verdict).toBe("agrees");

    // Undo restores the pre-rewrite blocks; opinions and corrections ride
    // along (annotations live outside cards regardless).
    expect(applyUndo(target)).toBe(true);
    expect(card.level).toBe("standard");
    expect(card.blocks.map((b) => b.id)).toEqual(["b1", "b-corr-ct_1"]);
    expect(card.secondOpinions).toHaveLength(1);
  });
});
