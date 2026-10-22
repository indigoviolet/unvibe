/**
 * Agents' open questions as AI-suggested comments (issue #181).
 *
 * With the scripted fake runner over HTTP on the demo review:
 * - a kept `open_questions` contribution becomes one AI-suggested
 *   comment, marked as a question and linked to its contribution item;
 * - the same question is never offered twice (anchor + stored text);
 * - dismissing the suggestion marks the contribution item dismissed, and
 *   a later turn raising it again creates nothing.
 *
 * Tests use made-up questions (public-repo rule).
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { formatContributionLines } from "../src/sharedctx/contributions.js";
import { createApp } from "../src/server.js";
import { resolveQuestionAnchor } from "../src/comments/questions.js";

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

const QUESTION = "Is the fast path covered by a dedicated test?";

const ANSWER_WITH_QUESTION = `First answer body about the fold.

\`\`\`json
{"contribute": {"open_questions": [${JSON.stringify(QUESTION)}]}}
\`\`\`
`;

const PLAIN_ANSWER = `First answer body about the fold.

\`\`\`json
{}
\`\`\`
`;

type App = Awaited<ReturnType<typeof createApp>>;

function fakeAgents(replyText: string): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    { match: "## The question\n\nExplain this.", events: textEvents(ANSWER_WITH_QUESTION) },
    { match: "# Ask follow-up", events: textEvents(replyText) },
  ]);
}

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

function questionSuggestions(ctx: App["ctx"], id: string): ReviewSnapshot["annotations"] {
  const snap = ctx.reviews.getSnapshot(id)!;
  return snap.annotations.filter(
    (a) =>
      a.type === "comment" &&
      a.messages.some((m) => m.who === "ai" && m.suggested === true && m.question === true),
  );
}

describe("open questions as suggested comments (#181)", () => {
  it("a kept open question becomes one suggested comment linked to its item", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents(PLAIN_ANSWER);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(res.status).toBe(200);
      if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
      await waitFor(() => {
        const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === (res.json.annotationId as string));
        const turn = a?.turns?.[0];
        return !!turn && turn.blocks.length > 0 && turn.working == null;
      });
      // The contribution is stored…
      const snap = ctx.reviews.getSnapshot(id)!;
      const found = snap.contributions.find((c) => c.items.some((i) => i.kind === "open_question" && i.text === QUESTION));
      expect(found).toBeTruthy();
      const itemIndex = found!.items.findIndex((i) => i.kind === "open_question" && i.text === QUESTION);
      // …and offered once as a suggested comment on the turn's anchor.
      const offered = questionSuggestions(ctx, id);
      expect(offered).toHaveLength(1);
      const sug = offered[0];
      expect(sug.messages).toEqual([{ who: "ai", text: QUESTION, suggested: true, question: true }]);
      expect(sug.post).toBe(false);
      expect(sug.anchor.host.kind).toBe("block");
      // Guide questions start closed (marker), like other guide threads.
      expect(sug.open).toBe(false);
      expect(sug.openQuestion).toEqual({ contributionId: found!.id, itemIndex });
    } finally {
      await app.close();
    }
  });

  it("the same question is never offered twice (anchor + stored text)", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents(PLAIN_ANSWER);
    const { app, ctx, id } = await openDemo(agents);
    try {
      // A matching suggestion already exists, but no contribution (so the
      // contribution dedupe passes and only the offer-once check can stop
      // a second suggestion). Anchored exactly where the explain below
      // lands: the first card holding block b1, like buildAnchor resolves.
      const snap0 = ctx.reviews.getSnapshot(id)!;
      const owner = snap0.pages
        .flatMap((p) => p.cards)
        .find((c) => c.blocks.some((b) => b.id === "b1"))!;
      await ctx.reviews.mutate(id, (draft) => {
        (draft.annotations as unknown as ReviewSnapshot["annotations"]).push({
          id: "ann_preseeded",
          type: "comment",
          anchor: {
            host: { kind: "block", blockId: `${owner.id}#b1` },
            quotedText: "",
            prefix: "",
            suffix: "",
            position: 0,
            version: 1,
          },
          open: false,
          messages: [{ who: "ai", text: QUESTION, suggested: true, question: true }],
          post: false,
        } as never);
      });
      const res = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(res.status).toBe(200);
      if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
      await waitFor(() => {
        const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === (res.json.annotationId as string));
        const turn = a?.turns?.[0];
        return !!turn && turn.blocks.length > 0 && turn.working == null;
      });
      // The contribution is stored, but no second suggestion is offered.
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.contributions.some((c) => c.items.some((i) => i.kind === "open_question"))).toBe(true);
      expect(questionSuggestions(ctx, id)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("dismissing the suggestion resolves its item; re-raises create nothing", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = fakeAgents(ANSWER_WITH_QUESTION);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(res.status).toBe(200);
      const annotationId = res.json.annotationId as string;
      if (res.json.jobId) await waitForJob(ctx, res.json.jobId as string);
      await waitFor(() => {
        const a = ctx.reviews.getSnapshot(id)!.annotations.find((x) => x.id === annotationId);
        const turn = a?.turns?.[0];
        return !!turn && turn.blocks.length > 0 && turn.working == null;
      });
      expect(questionSuggestions(ctx, id)).toHaveLength(1);
      const sugId = questionSuggestions(ctx, id)[0].id;
      // Dismiss = delete the suggestion, as for other suggestions.
      const del = await app.inject({
        method: "DELETE",
        url: `/api/reviews/${id}/comments/${sugId}`,
        headers: authed,
      } as never);
      expect(del.statusCode).toBe(200);
      const after = ctx.reviews.getSnapshot(id)!;
      expect(after.annotations.some((a) => a.id === sugId)).toBe(false);
      const item = after.contributions
        .flatMap((c) => c.items)
        .find((i) => i.kind === "open_question" && i.text === QUESTION);
      expect(item?.status).toBe("dismissed");
      // A later turn raising it again creates nothing.
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
      expect(questionSuggestions(ctx, id)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

describe("resolveQuestionAnchor (#181)", () => {
  function snapshot(): ReviewSnapshot {
    return {
      annotations: [
        {
          id: "ann_conv",
          type: "conversation",
          anchor: {
            host: { kind: "diff-line", fileKey: "conn", line: 82 },
            quotedText: "code",
            prefix: "",
            suffix: "",
            position: 82,
            version: 1,
          },
          open: true,
          messages: [],
          post: false,
          turns: [],
        },
      ],
      pages: [
        {
          id: "root",
          kind: "root",
          title: "Root",
          cards: [
            {
              id: "central",
              pageId: "root",
              title: "Central",
              level: "standard",
              collapsed: false,
              revision: 1,
              blocks: [{ type: "paragraph", id: "b1", text: { standard: "Body." }, citations: [] }],
              undoStack: [],
            },
          ],
        },
      ],
      files: [
        {
          fileKey: "conn",
          path: "src/conn.py",
          category: "source",
          hunks: [
            {
              contentHash: "h1",
              header: "@@",
              newStart: 80,
              newEnd: 90,
              oldStart: 80,
              oldEnd: 88,
              added: 1,
              removed: 0,
              lines: [
                { kind: "ctx", oldLine: 80, newLine: 80, text: "ctx" },
                { kind: "add", newLine: 81, text: "new" },
              ],
            },
          ],
        },
      ],
    } as unknown as ReviewSnapshot;
  }

  it("uses the conversation card's anchor verbatim", () => {
    expect(resolveQuestionAnchor(snapshot(), { annotationId: "ann_conv" })).toEqual({
      where: "diff-line",
      fileKey: "conn",
      line: 82,
    });
  });

  it("maps a hunk anchor to its first changed line", () => {
    const snap = snapshot();
    (snap.annotations[0] as { anchor: unknown }).anchor = {
      host: { kind: "hunk", fileKey: "conn", contentHash: "h1" },
      quotedText: "",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    };
    expect(resolveQuestionAnchor(snap, { annotationId: "ann_conv" })).toEqual({
      where: "diff-line",
      fileKey: "conn",
      line: 80,
    });
  });

  it("falls back to the card's first block, then the root's", () => {
    const snap = snapshot();
    expect(resolveQuestionAnchor(snap, { cardId: "central" })).toEqual({
      where: "block",
      blockId: "central#b1",
    });
    expect(resolveQuestionAnchor(snap, {})).toEqual({ where: "block", blockId: "central#b1" });
    expect(resolveQuestionAnchor(snapshot(), { annotationId: "ann_gone" })).toBeNull();
    expect(
      resolveQuestionAnchor({ annotations: [], pages: [], files: [] } as unknown as ReviewSnapshot, {}),
    ).toBeNull();
  });
});

describe("dismissed items stay out of agent context (#181)", () => {
  it("formatContributionLines skips dismissed items and emptied contributions", () => {
    const lines = formatContributionLines([
      {
        id: "ct_1",
        status: "pending",
        items: [
          { kind: "fact", text: "Kept fact.", citations: [] },
          { kind: "open_question", text: "Gone question?", citations: [], status: "dismissed" },
        ],
      },
      {
        id: "ct_2",
        status: "pending",
        items: [{ kind: "open_question", text: "Only question?", citations: [], status: "dismissed" }],
      },
    ]);
    expect(lines).toContain("Kept fact.");
    expect(lines).not.toContain("Gone question?");
    expect(lines).not.toContain("Only question?");
    expect(lines).not.toContain("ct_2");
  });
});
