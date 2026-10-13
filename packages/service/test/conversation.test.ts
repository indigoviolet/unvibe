/**
 * Conversation cards, issue #136 (Explain is Ask with a default
 * question).
 *
 * With the scripted fake runner over HTTP (`POST
 * /api/reviews/:id/actions`) on the demo review:
 * - a follow-up turn reuses the card's session (no new session);
 * - a dead session (idle close + adapter loss, the restart path) rebuilds
 *   from the base with the stored turns as the transcript, and the card
 *   stores the new session id;
 * - depth on one answer leaves the other answer alone;
 * - a diagram in a follow-up answer renders through the diagrams route;
 * - a diagram in an Ask answer renders (#106: answers are blocks now,
 *   never flattened to thread HTML).
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot, Session } from "@unvibe/shared";
import { findDiagramByHash } from "@unvibe/shared";
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

const SECOND_ANSWER = `Second answer body about ordering.

\`\`\`json
{}
\`\`\`
`;

const DEPTH_SIMPLE = `A simpler first answer.

\`\`\`json
{"depth": {"level": "simple"}}
\`\`\`
`;

const ASK_WITH_DIAGRAM = `Follow-up answer with a diagram.

\`\`\`d2
direction: right
reply-demo-a -> reply-demo-b: hello
\`\`\`

\`\`\`json
{}
\`\`\`
`;

const ASK_FIRST_WITH_DIAGRAM = `Answer with a diagram.

\`\`\`d2
direction: right
ask-demo-a -> ask-demo-b: hello
\`\`\`

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

async function explainFirstTurn(
  app: App["app"],
  ctx: App["ctx"],
  id: string,
  reply: string = FIRST_ANSWER,
): Promise<{ annotationId: string; turnId: string }> {
  const res = await postAction(app, id, {
    kind: "explain",
    quote: "raw CRLF",
    anchor: { where: "block", blockId: "b1" },
  });
  expect(res.status).toBe(200);
  const annotationId = res.json.annotationId as string;
  const turnId = res.json.turnId as string;
  expect(annotationId).toMatch(/^ann_/);
  expect(turnId).toMatch(/^ans_/);
  if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
  await waitFor(() => {
    const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId);
    const turn = (a?.turns ?? []).find((t) => t.id === turnId);
    return !!turn && turn.blocks.length > 0 && turn.working == null;
  });
  void reply;
  return { annotationId, turnId };
}

function fakeAgents(askReply: string): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    { match: "## The question\n\nExplain this.", events: textEvents(FIRST_ANSWER) },
    { match: "# Ask", events: textEvents(askReply) },
    { match: "# Depth rewrite", events: textEvents(DEPTH_SIMPLE) },
  ]);
}

describe("conversation cards (#136)", () => {
  it("a follow-up turn reuses the card's session", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents(SECOND_ANSWER);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId } = await explainFirstTurn(app, ctx, id);
      const card = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(card.type).toBe("conversation");
      expect(card.sessionId).toBeTruthy();
      const sessionId = card.sessionId!;
      const promptsBefore = agents.prompts.filter((p) => p.sessionId === sessionId).length;
      expect(promptsBefore).toBe(1);
      const sessionsBefore = agents.sessions.size;

      const rep = await postAction(app, id, {
        kind: "reply",
        annotationId,
        message: "What about ordering?",
      });
      expect(rep.status).toBe(200);
      expect(rep.json.turnId).toMatch(/^ans_/);
      if (rep.json.jobId) await waitForJob(ctx, rep.json.jobId as string);
      await waitFor(() => {
        const turns = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)?.turns ?? [];
        return turns.length === 2 && turns[1].blocks.length > 0 && turns[1].working == null;
      });
      // Same session: no fork, one more prompt on it.
      expect(agents.sessions.size).toBe(sessionsBefore);
      expect(agents.prompts.filter((p) => p.sessionId === sessionId).length).toBe(promptsBefore + 1);
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(after.sessionId).toBe(sessionId);
      expect(after.turns?.[1]?.question).toBe("What about ordering?");
    } finally {
      await app.close();
    }
  });

  it("a dead session rebuilds with the stored turns as the transcript", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents(SECOND_ANSWER);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId } = await explainFirstTurn(app, ctx, id);
      const before = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      const sessionId = before.sessionId!;
      // Idle close + adapter loss: the manager's record goes cold and the
      // adapter no longer knows the session (what a restart looks like).
      await ctx.sessions.closeConversation(sessionId);
      agents.sessions.delete(sessionId);

      const rep = await postAction(app, id, {
        kind: "reply",
        annotationId,
        message: "What about ordering?",
      });
      expect(rep.status).toBe(200);
      if (rep.json.jobId) await waitForJob(ctx, rep.json.jobId as string);
      await waitFor(() => {
        const turns = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)?.turns ?? [];
        return turns.length === 2 && turns[1].blocks.length > 0 && turns[1].working == null;
      });
      const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      // Rebuilt under a new id, and the card follows it.
      expect(after.sessionId).toBeTruthy();
      expect(after.sessionId).not.toBe(sessionId);
      // The fresh fork got the stored turns, not just the new question.
      const lastPrompt = agents.prompts[agents.prompts.length - 1];
      expect(lastPrompt.sessionId).toBe(after.sessionId);
      expect(lastPrompt.text).toContain("First answer body about the fold");
      expect(after.turns?.[1]?.question).toBe("What about ordering?");
    } finally {
      await app.close();
    }
  });

  it("depth on one answer leaves the other answer alone", { timeout: 120000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents(SECOND_ANSWER);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, turnId } = await explainFirstTurn(app, ctx, id);
      const rep = await postAction(app, id, { kind: "reply", annotationId, message: "What about ordering?" });
      expect(rep.status).toBe(200);
      if (rep.json.jobId) await waitForJob(ctx, rep.json.jobId as string);
      const secondTurnId = rep.json.turnId as string;
      await waitFor(() => {
        const turns = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)?.turns ?? [];
        return turns.length === 2 && turns[1].blocks.length > 0;
      });
      const secondBefore = JSON.stringify(
        ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!.turns![1].blocks,
      );

      const depth = await postAction(app, id, { kind: "depth", cardId: turnId, direction: "simpler" });
      expect(depth.status).toBe(200);
      if (depth.json.jobId) await waitForJob(ctx, depth.json.jobId as string);
      const card = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      const [first, second] = card.turns!;
      expect(first.level).toBe("simple");
      expect(first.id).toBe(turnId);
      // The sibling answer is untouched: same blocks, same level.
      expect(second.id).toBe(secondTurnId);
      expect(second.level).toBe("standard");
      expect(JSON.stringify(second.blocks)).toBe(secondBefore);
    } finally {
      await app.close();
    }
  });

  it("a diagram in a follow-up answer renders through the diagrams route", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = "/nonexistent/d2-for-test";
    try {
      const agents = fakeAgents(ASK_WITH_DIAGRAM);
      const { app, ctx, id } = await openDemo(agents);
      try {
        const { annotationId } = await explainFirstTurn(app, ctx, id);
        // The first answer carries no diagram.
        const first = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
        expect(first.turns![0].blocks.some((b) => b.type === "diagram")).toBe(false);

        const rep = await postAction(app, id, { kind: "reply", annotationId, message: "Can you draw it?" });
        expect(rep.status).toBe(200);
        if (rep.json.jobId) await waitForJob(ctx, rep.json.jobId as string);
        await waitFor(() => {
          const turns = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)?.turns ?? [];
          return turns.length === 2 && turns[1].blocks.length > 0 && turns[1].working == null;
        });
        const snap = ctx.reviews.getSnapshot(id)!;
        const dg = snap.annotations
          .find((a) => a.id === annotationId)!
          .turns![1].blocks.find((b) => b.type === "diagram") as unknown as {
          source: string;
          render?: { hash: string; status: string };
        };
        expect(dg).toBeDefined();
        expect(dg.render?.hash).toMatch(/^[0-9a-f]{16}$/);
        // The turn walker finds it (liveBlockLists covers every turn).
        expect(findDiagramByHash(snap, dg.render!.hash)?.source).toBe(dg.source);
        // No d2 binary: found but unrendered → 409, never 404.
        const got = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/${dg.render!.hash}?theme=light`,
          headers: authed,
        } as never);
        expect(got.statusCode).toBe(409);
        expect((got.json() as { status?: string }).status).toBe("unavailable");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
    }
  });

  it("a diagram in an Ask answer renders instead of raw source (#106)", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = "/nonexistent/d2-for-test";
    try {
      const agents = fakeAgents(ASK_FIRST_WITH_DIAGRAM);
      const { app, ctx, id } = await openDemo(agents);
      try {
        const res = await postAction(app, id, {
          kind: "ask",
          quote: "raw CRLF",
          anchor: { where: "block", blockId: "b1" },
          message: "Can you draw the fold?",
        });
        expect(res.status).toBe(200);
        const annotationId = res.json.annotationId as string;
        const turnId = res.json.turnId as string;
        if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
        await waitFor(() => {
          const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId);
          const turn = (a?.turns ?? []).find((t) => t.id === turnId);
          return !!turn && turn.blocks.length > 0 && turn.working == null;
        });
        const snap = ctx.reviews.getSnapshot(id)!;
        const dg = snap.annotations
          .find((a) => a.id === annotationId)!
          .turns!.find((t) => t.id === turnId)!.blocks.find((b) => b.type === "diagram") as unknown as {
          source: string;
          render?: { hash: string; status: string };
        };
        expect(dg).toBeDefined();
        expect(dg.source).toContain("ask-demo-a -> ask-demo-b");
        expect(dg.render?.hash).toMatch(/^[0-9a-f]{16}$/);
        expect(findDiagramByHash(snap, dg.render!.hash)?.source).toBe(dg.source);
        // No d2 binary: found but unrendered → 409, never the raw-source
        // <pre> the old thread HTML served (#106).
        const got = await app.inject({
          method: "GET",
          url: `/api/reviews/${id}/diagrams/${dg.render!.hash}?theme=light`,
          headers: authed,
        } as never);
        expect(got.statusCode).toBe(409);
        expect((got.json() as { status?: string }).status).toBe("unavailable");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
    }
  });
});

/**
 * Open as page mid-fill (issue #152): opening a conversation as a page
 * never discards work. The fill job keeps running and lands on the new
 * page; the page shows the working state until then, and the
 * error-with-Retry state when the fill fails.
 */
describe("promote mid-fill keeps the fill (issue #152)", () => {
  const VALID_MIDFILL = `An answer about the fold with no citations.

\`\`\`json
{}
\`\`\`
`;

  const MALFORMED_ONCE = `Some text

\`\`\`json
{not valid
\`\`\`
`;

  function baseScripts(): { match: string; events: AgentEvent[] }[] {
    return [
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    ];
  }

  /** Fake whose ask answer stays held until released (the held job). */
  class HeldAskFake extends FakeAgentRunner {
    release!: () => void;
    private gate: Promise<void>;
    constructor() {
      super(baseScripts());
      this.gate = new Promise<void>((r) => {
        this.release = r;
      });
    }
    override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
      if (text.includes("mid-fill question")) {
        await this.gate;
        yield* textEvents(VALID_MIDFILL);
        return;
      }
      yield* super.prompt(session, text);
    }
  }

  /** Fake whose first ask answer is malformed, later ones valid. */
  class FailOnceAskFake extends FakeAgentRunner {
    private calls = 0;
    constructor() {
      super(baseScripts());
    }
    override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
      if (text.includes("flaky question")) {
        this.calls += 1;
        yield* textEvents(this.calls === 1 ? MALFORMED_ONCE : VALID_MIDFILL);
        return;
      }
      yield* super.prompt(session, text);
    }
  }

  async function askQuestion(
    app: App["app"],
    ctx: App["ctx"],
    id: string,
    message: string,
  ): Promise<{ annotationId: string; turnId: string; jobId: string }> {
    const res = await postAction(app, id, {
      kind: "ask",
      quote: "fold",
      anchor: { where: "block", blockId: "b1" },
      message,
    });
    expect(res.status).toBe(200);
    return {
      annotationId: res.json.annotationId as string,
      turnId: res.json.turnId as string,
      jobId: res.json.jobId as string,
    };
  }

  it("promote mid-fill: the job keeps running and fills the page", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = new HeldAskFake();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, turnId, jobId } = await askQuestion(app, ctx, id, "mid-fill question about folds");
      expect(jobId).toBeTruthy();
      // The fill started and is held: the turn carries the working state.
      await waitFor(() => !!ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)?.jobId);

      const promoted = await postAction(app, id, { kind: "promote", annotationId });
      expect(promoted.status).toBe(200);
      const pageId = promoted.json.pageId as string;

      // Nothing cancelled: the job still runs, re-targeted at the page card.
      expect(ctx.jobs.get(jobId)?.state).toMatch(/^(queued|running)$/);
      const snap1 = ctx.reviews.getSnapshot(id)!;
      const page1 = snap1.pages.find((p) => p.id === pageId)!;
      expect(page1.kind).toBe("opened-expansion");
      expect(page1.cards.length).toBe(1);
      expect(page1.cards[0].blocks.length).toBe(0);
      expect(ctx.jobs.get(jobId)?.cardId).toBe(page1.cards[0].id);
      const link1 = snap1.annotations.find((a) => a.id === annotationId)!;
      expect(link1.type).toBe("link");
      expect(link1.promotedToPage).toBe(pageId);
      expect(link1.turns?.map((t) => t.id)).toEqual([turnId]);
      expect(link1.promotedTurns).toEqual([{ turnId, cardId: page1.cards[0].id }]);

      agents.release();
      expect(await waitForJob(ctx, jobId)).toBe("done");
      await waitFor(() => {
        const p = ctx.reviews.getSnapshot(id)!.pages.find((x) => x.id === pageId)!;
        return p.cards[0].blocks.length > 0;
      });
      const snap2 = ctx.reviews.getSnapshot(id)!;
      const page2 = snap2.pages.find((p) => p.id === pageId)!;
      expect(page2.cards[0].blocks.length).toBeGreaterThan(0);
      // Settled: the link drops the turns (the page holds the content)
      // and the session closes with them.
      const link2 = snap2.annotations.find((a) => a.id === annotationId)!;
      expect(link2.turns).toBeUndefined();
      expect(link2.promotedTurns).toBeUndefined();
      expect(link2.sessionId).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("promote mid-fill then failure: the page shows the error and Retry refills it", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = new FailOnceAskFake();
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, turnId, jobId } = await askQuestion(app, ctx, id, "flaky question about folds");
      expect(await waitForJob(ctx, jobId)).toBe("error");
      const failed = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!;
      expect(failed.turns?.find((t) => t.id === turnId)?.error).toBeTruthy();

      const promoted = await postAction(app, id, { kind: "promote", annotationId });
      expect(promoted.status).toBe(200);
      const pageId = promoted.json.pageId as string;
      const snap1 = ctx.reviews.getSnapshot(id)!;
      const link1 = snap1.annotations.find((a) => a.id === annotationId)!;
      expect(link1.type).toBe("link");
      expect(link1.turns?.find((t) => t.id === turnId)?.error).toBeTruthy();
      expect(link1.promotedTurns).toEqual([
        { turnId, cardId: snap1.pages.find((p) => p.id === pageId)!.cards[0].id },
      ]);

      const retried = await postAction(app, id, { kind: "retry", annotationId });
      expect(retried.status).toBe(200);
      const retryJobId = retried.json.jobId as string;
      expect(retryJobId).toBeTruthy();
      expect(await waitForJob(ctx, retryJobId)).toBe("done");
      await waitFor(() => {
        const p = ctx.reviews.getSnapshot(id)!.pages.find((x) => x.id === pageId)!;
        return p.cards[0].blocks.length > 0;
      });
      const snap2 = ctx.reviews.getSnapshot(id)!;
      expect(snap2.pages.find((p) => p.id === pageId)!.cards[0].blocks.length).toBeGreaterThan(0);
      const link2 = snap2.annotations.find((a) => a.id === annotationId)!;
      expect(link2.turns).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("promote after completion moves second opinions and drops the turns", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = new FakeAgentRunner([
      ...baseScripts(),
      { match: "# Ask", events: textEvents(VALID_MIDFILL) },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, turnId, jobId } = await askQuestion(app, ctx, id, "settled question about folds");
      expect(await waitForJob(ctx, jobId)).toBe("done");
      await waitFor(() => {
        const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId);
        return (a?.turns?.find((t) => t.id === turnId)?.blocks.length ?? 0) > 0;
      });
      // A reader-made second opinion on the answer.
      await ctx.reviews.mutate(id, (draft) => {
        const ann = (draft.annotations as unknown as ReviewSnapshot["annotations"]).find((a) => a.id === annotationId);
        const turn = ann?.type === "conversation" ? (ann.turns ?? []).find((t) => t.id === turnId) : undefined;
        if (!turn) throw new Error("turn missing");
        turn.secondOpinions = [
          {
            id: `so-${turnId}-check-mock`,
            cardId: turnId,
            mode: "check",
            provider: "codex",
            model: "mock-second",
            verdict: "agrees",
            reasoning: "Checked the helper.",
            blocks: [],
          },
        ];
      });

      const promoted = await postAction(app, id, { kind: "promote", annotationId });
      expect(promoted.status).toBe(200);
      const pageId = promoted.json.pageId as string;
      const snap = ctx.reviews.getSnapshot(id)!;
      const page = snap.pages.find((p) => p.id === pageId)!;
      expect(page.cards[0].secondOpinions?.map((s) => s.id)).toEqual([`so-${turnId}-check-mock`]);
      const link = snap.annotations.find((a) => a.id === annotationId)!;
      expect(link.type).toBe("link");
      expect(link.turns).toBeUndefined();
      expect(link.promotedTurns).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
