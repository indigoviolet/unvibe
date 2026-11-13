/**
 * Slower rewrites replace the body wholesale (issue #398).
 *
 * With the scripted fake runner over HTTP (`POST
 * /api/reviews/:id/actions`) on the demo review, plus pure-logic tests
 * of the replacement helper:
 * - a reply with more paragraphs than the card, plus a list and a
 *   `::: example`, replaces the body exactly, citations following their
 *   own paragraphs;
 * - undo restores the exact original blocks;
 * - a diagram the reply drops is kept at its old position;
 * - an invalid citation goes through the validator's repair turn;
 * - the same replacement lands on persona variants and thread replies;
 * - the #388 bulk path uses the same replacement.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent, Block, DiagramBlock, ParagraphBlock, ReviewSnapshot } from "@unvibe/shared";
import { questionRewriteTargetIds } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { replaceSlowerBody } from "../src/interaction/cards.js";
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

/**
 * A slower reply with more paragraphs than any guide card, plus a
 * numbered list and an example aside — every citation a real fixture
 * target, so the validator accepts the reply as written.
 */
const SLOWER_RICH = `A slower first paragraph, with the skipped step filled in. [[diff:src-urllib3-connection.py:80-88]]

A slower second paragraph, with the terms defined where they first matter. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:647-651]]

1. The server sends Set-Cookie split across two lines. [[diff:src-urllib3-connection.py:80-88]]
2. The regex joins the halves into one value. [[diff:src-urllib3-connection.py:91-110]]

::: example
\`\`\`
value: "a=1 \\r\\n path=/"
result: "a=1 path=/"
\`\`\`

A concrete walk-through with real values. [[diff:test-test_connection.py:218]]
:::

\`\`\`json
{"slower": {"cardId": "problem"}}
\`\`\`
`;

/** Two bogus citations: at the repair threshold, so one repair turn runs. */
const SLOWER_BAD = `A slower paragraph with bad citations. [[diff:no-such-file:1-2]] [[diff:no-such-file:3-4]]

\`\`\`json
{"slower": {"cardId": "problem"}}
\`\`\`
`;

const PERSONA = {
  id: "historian",
  name: "Historian",
  followMain: false,
  color: "#C2410C",
  lens: "You are the keeper of this codebase's history.",
  cardInstruction: "",
  provider: "codex",
  model: "codex-persona-model",
  enabled: true,
};

const PERSONA_CARD = `The persona's version of the card.

\`\`\`json
{}
\`\`\`
`;

const FIRST_ANSWER = `First answer body about the fold.

\`\`\`json
{}
\`\`\`
`;

const EXPLAIN_WITH_FOLLOWUP = `An answer paragraph about the fold.

### Follow-ups

- Why this folding?

\`\`\`json
{}
\`\`\`
`;

const DIAGRAM_REPLY = `A diagram of the unfolding.

\`\`\`d2
direction: right
reply-demo-a -> reply-demo-b: hello
\`\`\`

\`\`\`json
{}
\`\`\`
`;

function fakeWith(scripts: { match: string; events: AgentEvent[] }[]): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    ...scripts,
  ]);
}

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
    () =>
      !!ctx.reviews
        .getSnapshot(id)
        ?.pages.find((p) => p.id === "root")
        ?.cards.find((c) => c.id === "problem")?.blocks.length,
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

async function waitForJob(ctx: App["ctx"], jobId: string, timeoutMs = 60000): Promise<string> {
  let state = "";
  await waitFor(() => {
    const j = ctx.jobs.get(jobId);
    if (!j) return false;
    state = j.state;
    return state === "done" || state === "error" || state === "cancelled";
  }, timeoutMs);
  return state;
}

function cardBlocks(ctx: App["ctx"], id: string, cardId: string): Block[] {
  return ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === cardId)!.blocks;
}

function citationTargets(b: Block): string[] {
  if (b.type === "paragraph" || b.type === "code" || b.type === "diagram") {
    return b.citations.map((c) => c.target);
  }
  if (b.type === "list") {
    return b.items.flatMap((it) => it.citations.map((c) => c.target));
  }
  if (b.type === "aside") {
    return b.citations.map((c) => c.target);
  }
  return [];
}

describe("replaceSlowerBody pure logic (#398)", () => {
  const para = (id: string, text: string, targets: string[] = []): ParagraphBlock => ({
    type: "paragraph",
    id,
    text,
    citations: targets.map((target) => ({ target })),
  });
  const diagram = (id: string): DiagramBlock =>
    ({ type: "diagram", id, source: "a -> b", render: { hash: "h", status: "unavailable" } }) as DiagramBlock;

  it("replaces the body exactly: reply blocks, each with its own citations", () => {
    const current = [para("b1", "Old one."), para("b2", "Old two.")];
    const reply = [
      para("n1", "New one.", ["diff:f:1-2"]),
      { type: "list", id: "n2", ordered: true, items: [{ html: "step", citations: [{ target: "diff:f:3-4" }] }], citations: [] },
      para("n3", "New three.", ["diff:f:5-6"]),
    ] as Block[];
    const out = replaceSlowerBody(current, reply);
    expect(out).toEqual(reply);
  });

  it("drops blocks the reply does not echo; empty reply keeps the body", () => {
    const current = [para("b1", "Body one."), para("b-corr", "Accepted suggestion: use spaces.")];
    const out = replaceSlowerBody(current, [para("n1", "Fresh slower one.")]);
    expect(out.map((b) => (b as ParagraphBlock).text)).toEqual(["Fresh slower one."]);
    expect(replaceSlowerBody(current, [])).toEqual(current);
  });

  it("keeps a dropped diagram at its old index, without doubling one the reply keeps", () => {
    const dg = diagram("d1");
    const current = [para("b1", "One."), dg, para("b2", "Two.")];
    const reply = [para("n1", "New one."), para("n2", "New two."), para("n3", "New three.")];
    const out = replaceSlowerBody(current, reply);
    expect(out.map((b) => b.type)).toEqual(["paragraph", "diagram", "paragraph", "paragraph"]);
    expect(out[1]).toBe(dg);
    // The reply carries its own diagram: the old one is not re-inserted.
    const replyWithDg = [para("n1", "New one."), diagram("d2")];
    const kept = replaceSlowerBody(current, replyWithDg);
    expect(kept.filter((b) => b.type === "diagram")).toHaveLength(1);
  });

  it("keeps dropped follow-ups at their old index, but never other blocks the reply drops", () => {
    const followUp = { type: "follow-up", id: "b3", items: [{ label: "Why?", question: "Why?" }], citations: [] } as Block;
    const current = [
      para("b1", "One."),
      { type: "aside", id: "b2", kind: "Example", inner: [para("b2-b1", "ex")], citations: [] },
      followUp,
    ] as Block[];
    const out = replaceSlowerBody(current, [para("n1", "New.")]);
    expect(out.map((b) => b.type)).toEqual(["paragraph", "follow-up"]);
    expect(out[1]).toBe(followUp);
  });

  it("a reply block colliding with a kept block id is restamped; kept ids win", () => {
    const followUp = { type: "follow-up", id: "b2", items: [{ label: "Why?", question: "Why?" }], citations: [] } as Block;
    const current = [para("b1", "One."), followUp];
    const out = replaceSlowerBody(current, [para("b1", "New one."), para("b2", "New two.")]);
    expect(out.map((b) => b.id)).toEqual(["b1", "b2", "b2-c2"]);
    expect(out[1]).toBe(followUp);
  });

  it("a reply carrying its own follow-ups takes over; the old ones are not re-inserted", () => {
    const old = { type: "follow-up", id: "b9", items: [{ label: "Old?", question: "Old?" }], citations: [] } as Block;
    const fresh = { type: "follow-up", id: "n9", items: [{ label: "New?", question: "New?" }], citations: [] } as Block;
    const out = replaceSlowerBody([para("b1", "One."), old], [para("n1", "New."), fresh]);
    expect(out.filter((b) => b.type === "follow-up")).toEqual([fresh]);
  });
});

describe("slower wholesale replacement over HTTP (#398)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("a richer reply replaces the body exactly, citations following their paragraphs", { timeout: 90000 }, async () => {
    const { app, ctx, id } = await openDemo(fakeWith([{ match: "# Help me understand", events: textEvents(SLOWER_RICH) }]));
    try {
      const before = JSON.stringify(cardBlocks(ctx, id, "problem"));
      const res = await postAction(app, id, { kind: "slower", cardId: "problem" });
      expect(res.status).toBe(200);
      expect(res.json.jobId).toBeTruthy();
      expect(await waitForJob(ctx, res.json.jobId as string)).toBe("done");
      const blocks = cardBlocks(ctx, id, "problem");
      // Three paragraphs became two paragraphs + an ordered list + an example.
      expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "list", "aside"]);
      const [p1, p2, list, aside] = blocks;
      expect((p1 as ParagraphBlock).text).toContain("skipped step filled in");
      expect(citationTargets(p1)).toEqual(["diff:src-urllib3-connection.py:80-88"]);
      expect((p2 as ParagraphBlock).text).toContain("terms defined where they first matter");
      expect(citationTargets(p2)).toEqual([
        "diff:src-urllib3-connection.py:91-110",
        "diff:src-urllib3-connection.py:647-651",
      ]);
      if (list.type !== "list") throw new Error("expected a list block");
      expect(list.ordered).toBe(true);
      expect(list.items).toHaveLength(2);
      expect(list.items[0].html).toContain("split across two lines");
      expect(citationTargets(list)).toContain("diff:src-urllib3-connection.py:80-88");
      if (aside.type !== "aside") throw new Error("expected an Example aside");
      expect(aside.kind).toBe("Example");
      expect(JSON.stringify(aside)).toContain("walk-through with real values");
      expect(JSON.stringify(aside)).toContain("diff:test-test_connection.py:218");
      // The original body is gone, and the press is one undo entry.
      expect(JSON.stringify(blocks)).not.toContain("The reported case");
      const card = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!;
      expect(card.undoStack).toHaveLength(1);
      expect(JSON.stringify(card.undoStack[0].blocks)).toBe(before);
      expect(card.revision).toBeGreaterThan(1);
    } finally {
      await app.close();
    }
  });

  it("undo restores the exact original body", { timeout: 90000 }, async () => {
    const { app, ctx, id } = await openDemo(fakeWith([{ match: "# Help me understand", events: textEvents(SLOWER_RICH) }]));
    try {
      const before = JSON.stringify(cardBlocks(ctx, id, "central"));
      const res = await postAction(app, id, { kind: "slower", cardId: "central" });
      expect(res.status).toBe(200);
      if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
      expect(JSON.stringify(cardBlocks(ctx, id, "central"))).not.toBe(before);
      const undo = await postAction(app, id, { kind: "undo", cardId: "central" });
      expect(undo.status).toBe(200);
      expect(JSON.stringify(cardBlocks(ctx, id, "central"))).toBe(before);
    } finally {
      await app.close();
    }
  });

  it("a dropped diagram is kept at its old position through rewrite and undo", { timeout: 180000 }, async () => {
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = "/nonexistent/d2-for-test";
    try {
      const { app, ctx, id } = await openDemo(
        fakeWith([
          { match: "# Diagram", events: textEvents(DIAGRAM_REPLY) },
          { match: "# Help me understand", events: textEvents(SLOWER_RICH) },
        ]),
      );
      try {
        const dg = await postAction(app, id, { kind: "diagram", cardId: "central" });
        expect(dg.status).toBe(200);
        if (dg.json.jobId) await waitForJob(ctx, dg.json.jobId as string);
        await waitFor(() => cardBlocks(ctx, id, "central").some((b) => b.type === "diagram"));
        const withDiagram = cardBlocks(ctx, id, "central");
        const at = withDiagram.findIndex((b) => b.type === "diagram");
        expect(at).toBeGreaterThan(0);

        const slower = await postAction(app, id, { kind: "slower", cardId: "central" });
        expect(slower.status).toBe(200);
        if (slower.json.jobId) await waitForJob(ctx, slower.json.jobId as string);
        const rewritten = cardBlocks(ctx, id, "central");
        // The reply (4 blocks) carries no diagram: the old one is kept at
        // its old index among blocks.
        const expected = ["paragraph", "paragraph", "list", "aside"];
        expected.splice(Math.min(at, expected.length), 0, "diagram");
        expect(rewritten.map((b) => b.type)).toEqual(expected);
        expect(rewritten[at]).toEqual(withDiagram[at]);

        const undo = await postAction(app, id, { kind: "undo", cardId: "central" });
        expect(undo.status).toBe(200);
        expect(JSON.stringify(cardBlocks(ctx, id, "central"))).toBe(JSON.stringify(withDiagram));
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
    }
  });

  it("an invalid citation goes through the validator's single repair turn", { timeout: 90000 }, async () => {
    const agents = fakeWith([
      { match: "could not be verified", events: textEvents(SLOWER_RICH) },
      { match: "# Help me understand", events: textEvents(SLOWER_BAD) },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app, id, { kind: "slower", cardId: "problem" });
      expect(res.status).toBe(200);
      if (res.json.jobId) expect(await waitForJob(ctx, res.json.jobId as string)).toBe("done");
      // The repair turn ran, and the stored body is the repaired reply.
      expect(agents.prompts.some((p) => p.text.includes("could not be verified"))).toBe(true);
      const stored = JSON.stringify(cardBlocks(ctx, id, "problem"));
      expect(stored).not.toContain("no-such-file");
      expect(stored).toContain("skipped step filled in");
    } finally {
      await app.close();
    }
  });

  it("persona variant: the same replacement, guide untouched, undo restores", { timeout: 180000 }, async () => {
    const agents = fakeWith([
      { match: "# Persona card", events: textEvents(PERSONA_CARD) },
      { match: "# Help me understand", events: textEvents(SLOWER_RICH) },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const seed = ctx.settings.get().personas ?? [];
      const patched = await app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: authed,
        payload: { personas: [...seed, PERSONA] },
      } as never);
      expect(patched.statusCode).toBe(200);
      const run = await postAction(app, id, { kind: "persona", cardId: "problem", personaId: "historian" });
      expect(run.status).toBe(200);
      if (run.json.jobId) await waitForJob(ctx, run.json.jobId as string);
      await waitFor(() => {
        const card = ctx.reviews.getSnapshot(id)?.pages.flatMap((p) => p.cards).find((c) => c.id === "problem");
        const variant = card?.variants?.["historian"];
        return !!variant && variant.blocks.length > 0 && !variant.working;
      });
      const guideBefore = JSON.stringify(cardBlocks(ctx, id, "problem"));
      const variantBefore = JSON.stringify(
        ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!.variants!["historian"]
          .blocks,
      );

      const slower = await postAction(app, id, { kind: "slower", cardId: "problem", personaId: "historian" });
      expect(slower.status).toBe(200);
      if (slower.json.jobId) await waitForJob(ctx, slower.json.jobId as string);
      await waitFor(() => {
        const variant = ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!
          .variants!["historian"];
        return (variant.revision ?? 0) >= 2 && !variant.working;
      });
      const snap = ctx.reviews.getSnapshot(id)!;
      const card = snap.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!;
      // The Guide version is untouched; the variant carries the rewrite.
      expect(JSON.stringify(card.blocks)).toBe(guideBefore);
      const variant = card.variants!["historian"];
      expect(variant.blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "list", "aside"]);
      expect(JSON.stringify(variant.blocks)).toContain("skipped step filled in");
      expect(variant.undoStack).toHaveLength(1);

      const undo = await postAction(app, id, { kind: "undo", cardId: "problem", personaId: "historian" });
      expect(undo.status).toBe(200);
      expect(
        JSON.stringify(
          ctx.reviews.getSnapshot(id)!.pages.flatMap((p) => p.cards).find((c) => c.id === "problem")!.variants![
            "historian"
          ].blocks,
        ),
      ).toBe(variantBefore);
    } finally {
      await app.close();
    }
  });

  it("an unconsumed follow-up survives a press; undo still byte-identical", { timeout: 120000 }, async () => {
    const { app, ctx, id } = await openDemo(
      fakeWith([
        { match: "## The question\n\nExplain this.", events: textEvents(EXPLAIN_WITH_FOLLOWUP) },
        { match: "# Help me understand", events: textEvents(SLOWER_RICH) },
      ]),
    );
    try {
      const ex = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(ex.status).toBe(200);
      const annotationId = ex.json.annotationId as string;
      const turnId = ex.json.turnId as string;
      if (ex.json.jobId) await waitForJob(ctx, ex.json.jobId as string);
      const turnBlocks = (): Block[] =>
        ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!.replies!.find((t) => t.id === turnId)!
          .blocks;
      await waitFor(() => turnBlocks().length > 0);
      const followBefore = turnBlocks().find((b) => b.type === "follow-up");
      expect(followBefore).toBeTruthy();
      const before = JSON.stringify(turnBlocks());

      const slower = await postAction(app, id, { kind: "slower", cardId: turnId });
      expect(slower.status).toBe(200);
      if (slower.json.jobId) await waitForJob(ctx, slower.json.jobId as string);
      const after = turnBlocks();
      // The reply became the body; the unconsumed follow-up survived.
      expect(after.filter((b) => b.type === "paragraph").map((b) => (b as ParagraphBlock).text)).toEqual([
        expect.stringContaining("skipped step filled in"),
        expect.stringContaining("terms defined where they first matter"),
      ]);
      expect(after.filter((b) => b.type === "follow-up")).toEqual([followBefore]);

      const undo = await postAction(app, id, { kind: "undo", cardId: turnId });
      expect(undo.status).toBe(200);
      expect(JSON.stringify(turnBlocks())).toBe(before);
    } finally {
      await app.close();
    }
  });

  it("thread reply: slower replaces the answer body, undo restores it", { timeout: 120000 }, async () => {
    const { app, ctx, id } = await openDemo(
      fakeWith([
        { match: "## The question\n\nExplain this.", events: textEvents(FIRST_ANSWER) },
        { match: "# Ask", events: textEvents(FIRST_ANSWER) },
        { match: "# Help me understand", events: textEvents(SLOWER_RICH) },
      ]),
    );
    try {
      const ex = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(ex.status).toBe(200);
      const annotationId = ex.json.annotationId as string;
      const turnId = ex.json.turnId as string;
      if (ex.json.jobId) await waitForJob(ctx, ex.json.jobId as string);
      await waitFor(() => {
        const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId);
        const turn = (a?.replies ?? []).find((t) => t.id === turnId);
        return !!turn && turn.blocks.length > 0 && turn.working == null;
      });
      const turnBlocks = (): Block[] =>
        ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId)!.replies!.find((t) => t.id === turnId)!
          .blocks;
      const before = JSON.stringify(turnBlocks());

      const slower = await postAction(app, id, { kind: "slower", cardId: turnId });
      expect(slower.status).toBe(200);
      if (slower.json.jobId) await waitForJob(ctx, slower.json.jobId as string);
      const after = turnBlocks();
      expect(after.map((b) => b.type)).toEqual(["paragraph", "paragraph", "list", "aside"]);
      expect(JSON.stringify(after)).toContain("skipped step filled in");

      const undo = await postAction(app, id, { kind: "undo", cardId: turnId });
      expect(undo.status).toBe(200);
      expect(JSON.stringify(turnBlocks())).toBe(before);
    } finally {
      await app.close();
    }
  });

  it("bulk rewrite (#388) uses the same replacement on every guide card", { timeout: 180000 }, async () => {
    const { app, ctx, id } = await openDemo(fakeWith([{ match: "# Help me understand", events: textEvents(SLOWER_RICH) }]));
    try {
      const before = ctx.reviews.getSnapshot(id)!;
      const targets = questionRewriteTargetIds(before);
      expect(targets.length).toBeGreaterThan(1);
      const res = await postAction(app, id, { kind: "question-rewrite", terms: ["obs-fold", "HTTPMessage"] });
      expect(res.status).toBe(200);
      const cardJobs = res.json.cardJobs as { cardId: string; jobId?: string }[];
      expect(cardJobs.map((j) => j.cardId).sort()).toEqual([...targets].sort());
      for (const j of cardJobs) {
        expect(j.jobId).toBeTruthy();
        await waitForJob(ctx, j.jobId as string);
      }
      const after = ctx.reviews.getSnapshot(id)!;
      for (const c of targets) {
        const blocks = after.pages.flatMap((p) => p.cards).find((x) => x.id === c)!.blocks;
        expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "list", "aside"]);
        expect(JSON.stringify(blocks)).toContain("skipped step filled in");
        const card = after.pages.flatMap((p) => p.cards).find((x) => x.id === c)!;
        expect(card.undoStack).toHaveLength(1);
        expect(card.variants ?? {}).toEqual({});
      }
    } finally {
      await app.close();
    }
  });
});
