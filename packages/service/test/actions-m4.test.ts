/**
 * M4 interaction actions end to end (PRD §4.3, §4.4, §4.6–§4.8, §12).
 *
 * With the replay runner and scripted fakes: every action over HTTP
 * (`POST /api/reviews/:id/actions`) on the demo review, asserting the
 * patches and final state — depth round-trip without a second agent
 * call, undo preserving annotations, promote, cancel-on-close, dedupe,
 * ask follow-up reusing the session, malformed reply and retryable-error
 * paths, concurrent actions on different cards.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { ReplayAgentRunner } from "../src/replay/runner.js";
import { createApp } from "../src/server.js";
import { isValidMermaid } from "../src/interaction/mermaid.js";
import { applyUndo, insertExamples } from "../src/interaction/cards.js";
import {
  noopRecorder,
  recordInteraction,
  setInteractionRecorder,
  type InteractionEvent,
} from "../src/interaction/types.js";

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
      expect(working.type).toBe("expansion");
      expect(working.open).toBe(true);
      expect(working.working === "Thinking…" || working.expansion!.blocks.length > 0).toBe(true);

      await waitForJob(ctx, res.json.jobId as string);
      const done = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(done.expansion!.blocks.length).toBeGreaterThan(0);
      expect(done.working).toBeNull();
      expect(done.expansion!.revision).toBe(2);
      // Stored targets are canonical (real file keys, no aliases).
      const targets = JSON.stringify(done.expansion!.blocks);
      expect(targets).not.toContain("diff:conn:");
      expect(targets).toContain("diff:");
      unsub();
      expect(patches.length).toBeGreaterThan(0);
      expect(patches[patches.length - 1].headRev).toBeGreaterThan(baseRev);
    } finally {
      await app.close();
    }
  });

  it("ask: thread, cited reply, session remembered; reply reuses the session", { timeout: 90000 }, async () => {
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
      const threadId = res.json.threadId as string;
      expect(threadId).toMatch(/^ann_/);
      await waitForJob(ctx, res.json.jobId as string);

      const thread = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === threadId)!;
      expect(thread.messages.length).toBe(2);
      expect(thread.messages[0]).toMatchObject({ who: "you" });
      expect(thread.messages[1].who).toBe("ai");
      expect(thread.working).toBeNull();
      expect(thread.error).toBeNull();
      expect(thread.sessionId).toBeTruthy();
      const sessionId = thread.sessionId!;
      const promptsOnSession = agents.prompts.filter((p) => p.sessionId === sessionId).length;
      expect(promptsOnSession).toBe(1);
      const sessionsBefore = agents.sessions.size;

      // Follow-up reply goes on the SAME conversation session.
      const rep = await postAction(app, id, { kind: "reply", threadId, message: "What about ordering?" });
      expect(rep.status).toBe(200);
      expect(rep.json.jobId).toBeTruthy();
      await waitForJob(ctx, rep.json.jobId as string);
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === threadId)!;
      expect(after.messages.length).toBe(4);
      expect(after.messages[3].who).toBe("ai");
      expect(agents.sessions.size).toBe(sessionsBefore);
      expect(agents.prompts.filter((p) => p.sessionId === sessionId).length).toBe(promptsOnSession + 1);
    } finally {
      await app.close();
    }
  });

  it("note creates a thread with no agent reply", { timeout: 30000 }, async () => {
    const { app, ctx } = await createApp("tok", { agents: replay() });
    try {
      const id = await createDemoReview(app);
      await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
      const events: InteractionEvent[] = [];
      setInteractionRecorder({ recordInteraction: (e) => events.push(e) });
      try {
        const res = await postAction(app, id, {
          kind: "note",
          quote: "fast path",
          anchor: { where: "block", blockId: "b1" },
          text: "A reader note.",
        });
        expect(res.status).toBe(200);
        expect(res.json.jobId).toBeUndefined();
        const thread = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.threadId as string))!;
        expect(thread.note).toBe(true);
        expect(thread.messages).toHaveLength(1);
        expect(events.some((e) => e.type === "note.created")).toBe(true);
      } finally {
        setInteractionRecorder(noopRecorder);
      }
      void recordInteraction;
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
      const withDiagram = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!;
      const diagrams = withDiagram.blocks.filter((b) => b.type === "diagram");
      expect(diagrams.length).toBe(1);
      expect(isValidMermaid((diagrams[0] as { mermaid: string }).mermaid)).toBe(true);

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
      expect(answer.type).toBe("expansion");
      expect(answer.expansion!.blocks.length).toBeGreaterThan(0);
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

  it("promote moves expansion content to a new page; read/collapse/bookmark/close/delete", { timeout: 120000 }, async () => {
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

      // read greys + collapses; unmarking expands.
      const read = await postAction(app, id, { kind: "read", cardId: "central", read: true });
      expect(read.status).toBe(200);
      const central = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!;
      expect(central.read).toBe(true);
      expect(central.collapsed).toBe(true);
      await postAction(app, id, { kind: "read", cardId: "central", read: false });
      expect(ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "central")!.collapsed).toBe(
        false,
      );

      const collapsed = await postAction(app, id, { kind: "collapse", cardId: "central", collapsed: true });
      expect(collapsed.status).toBe(200);

      const bookmark = await postAction(app, id, { kind: "bookmark", pageId: "root", saved: true });
      expect(bookmark.status).toBe(200);
      expect(ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.saved).toBe(true);

      // Expansion read closes it.
      const seed = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === "x-seed");
      if (seed?.type === "expansion" && seed.expansion) {
        await postAction(app, id, { kind: "read", cardId: "x-seed", read: true });
        expect(ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === "x-seed")!.open).toBe(false);
      }

      // close + delete on fresh note threads.
      const note = await postAction(app, id, {
        kind: "note",
        quote: "x",
        anchor: { where: "diff-line", fileKey: conn.fileKey, line: 80 },
        text: "to close",
      });
      const noteId = note.json.threadId as string;
      const closed = await postAction(app, id, { kind: "close", annotationId: noteId });
      expect(closed.status).toBe(200);
      expect(ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === noteId)!.open).toBe(false);

      const note2 = await postAction(app, id, {
        kind: "note",
        quote: "y",
        anchor: { where: "diff-line", fileKey: conn.fileKey, line: 80 },
      });
      const deleted = await postAction(app, id, { kind: "delete", targetId: note2.json.threadId as string });
      expect(deleted.status).toBe(200);
      expect(ctx.reviews.getSnapshot(id)!.annotations.some((a) => a.id === (note2.json.threadId as string))).toBe(false);
    } finally {
      await app.close();
    }
  });
});

describe("M4 dedupe + cancel-on-close (gated replay)", () => {
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
      if (text.includes("# Explain")) {
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

      // Closing cancels the job: no spinner forever, no error state.
      const closed = await postAction(app, id, { kind: "close", annotationId });
      expect(closed.status).toBe(200);
      await waitForJob(ctx, jobId);
      expect(ctx.jobs.get(jobId)?.state).toBe("cancelled");
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!;
      expect(after.open).toBe(false);
      expect(after.error).toBeNull();
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
    const agents = fakeWith([{ match: "# Explain", events: textEvents("Some text\n\n```json\n{not valid\n```\n") }]);
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
      const retry = await postAction(app, id, { kind: "retry", threadId: res.json.annotationId as string });
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
        if (text.includes("# Explain")) {
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

      const retry = await postAction(app, id, { kind: "retry", threadId: res.json.annotationId as string });
      expect(retry.status).toBe(200);
      await waitForJob(ctx, retry.json.jobId as string);
      const recovered = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (res.json.annotationId as string))!;
      expect(recovered.error).toBeNull();
      expect(recovered.expansion!.blocks.length).toBeGreaterThan(0);
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

describe("M4 interaction pure logic", () => {
  it("mermaid validation accepts flowcharts and rejects broken sources", () => {
    expect(isValidMermaid("flowchart LR\n    A --> B")).toBe(true);
    expect(isValidMermaid("sequenceDiagram\n    A->>B: hi")).toBe(true);
    expect(isValidMermaid("")).toBe(false);
    expect(isValidMermaid("just some text")).toBe(false);
    expect(isValidMermaid("flowchart LR\n    A[unclosed --> B")).toBe(false);
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
      read: false,
      collapsed: false,
      revision: 1,
      blocks: first.blocks,
      undoStack: [{ blocks: [para], level: "standard" as const }],
    };
    expect(applyUndo({ kind: "page-card", pageId: "root", card } as never)).toBe(true);
    expect(card.blocks).toHaveLength(1);
  });
});
