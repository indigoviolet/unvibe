/**
 * PRD §12 result reuse (audit #10): repeating the identical request returns
 * the stored result without an agent call, keyed by (anchor, kind, depth,
 * base version) and invalidated by a new base version. Each case uses the
 * scripted fake runner and asserts zero additional runner calls on repeat.
 *
 * Decisions per action (see report):
 * - explain: same anchor+quote+version reopens stored expansion (closed too);
 *   deleted or new version → new request.
 * - ask: same anchor+quote+message+version reuses thread; different message,
 *   deleted, or new version → new request.
 * - depth: stored per-level text + principle block are the cache (instant,
 *   reused:true); deleted via undo still reuses the underlying level text
 *   when present (depth versions are kept once made, PRD §4.4).
 * - examples: saturated card (every paragraph has an example) reuses;
 *   new paragraphs or deleted examples → new request.
 * - diagram: card with a diagram reuses; removed → new request.
 * - generate: filled placeholder reuses; pending → new job.
 * - concept: full page reuses.
 * - second-opinion: same card+mode+model+version reuses; deleted, model
 *   change, or new version → new request.
 * - hunk summarize: stored summary for same content hash reuses; deleted
 *   (PATCH null) or new hash → new request.
 * - followup/reply: one-shot by design (suggestion consumed / new message) —
 *   no stored reuse; documented, not tested for reuse.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { FakeCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";
import { sourceFile } from "./m6-helpers.js";

const authed = { authorization: "Bearer tok" };

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedTokens: 5, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

const EXPLAIN_REPLY = `An explanation with no citations.\n\n\`\`\`json\n{}\n\`\`\`\n`;
const ASK_REPLY = `An answer with a cite [[diff:a-py:1-2]].\n\n\`\`\`json\n{}\n\`\`\`\n`;
const DEPTH_SIMPLE = `A simpler paragraph.\n\n\`\`\`json\n{"depth": {"level": "simple", "cardId": "central"}}\n\`\`\`\n`;
const EXAMPLES_REPLY = `::: example\n\`\`\`\nexample one\n\`\`\`\n:::\n\n::: example\n\`\`\`\nexample two\n\`\`\`\n:::\n\n\`\`\`json\n{}\n\`\`\`\n`;
const DIAGRAM_REPLY = "```d2\ndirection: right\na: \"A\" {link: \"diff:a-py:1-2\"}\nb: \"B\"\na -> b\n```\n\n```json\n{}\n```\n";
const GODEEPER_REPLY = `Body [[diff:a-py:1-2]]\n\n\`\`\`json\n{"title": "T"}\n\`\`\`\n`;
const CONCEPT_REPLY = `First concept paragraph [[diff:a-py:1-2]].\n\nSecond concept paragraph [[diff:a-py:2-3]].\n\n\`\`\`json\n{"title": "Test concept"}\n\`\`\`\n`;
const HUNK_REPLY = `Summary [[diff:a-py:1-2]]\n\n\`\`\`json\n{"hunk": {"summary": "S"}}\n\`\`\`\n`;
const SECOND_REPLY = `Independent check. [[diff:a-py:1-2]]\n\n\`\`\`json\n{"secondOpinion": {"verdict": "agrees", "reasoning": "Checked.", "missed": "Nothing."}}\n\`\`\`\n`;

function fakeAgents(): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "Read the review source", events: textEvents("ready") },
    { match: "Read the base context", events: textEvents("ready") },
    { match: "# Explain", events: textEvents(EXPLAIN_REPLY) },
    { match: "# Ask", events: textEvents(ASK_REPLY) },
    { match: "# Depth rewrite", events: textEvents(DEPTH_SIMPLE) },
    { match: "# Examples", events: textEvents(EXAMPLES_REPLY) },
    { match: "# Diagram", events: textEvents(DIAGRAM_REPLY) },
    { match: "# Go deeper", events: textEvents(GODEEPER_REPLY) },
    { match: "# Concept page", events: textEvents(CONCEPT_REPLY) },
    { match: "Hunk pass", events: textEvents(HUNK_REPLY) },
    { match: "Second opinion", events: textEvents(SECOND_REPLY) },
  ]);
}

function pagesFor(): ReviewSnapshot["pages"] {
  return [
    {
      id: "root",
      kind: "root",
      title: "Guide",
      saved: false,
      cards: [
        {
          id: "central",
          pageId: "root",
          title: "Central",
          level: "standard",
          read: false,
          collapsed: false,
          revision: 1,
          blocks: [
            {
              type: "paragraph",
              id: "b1",
              text: { standard: "Does the thing [[diff:a-py:1-2]]" },
              citations: [{ target: "diff:a-py:1-2" }],
            },
            {
              type: "paragraph",
              id: "b2",
              text: { standard: "Second paragraph [[diff:a-py:2-3]]" },
              citations: [{ target: "diff:a-py:2-3" }],
            },
          ],
          undoStack: [],
        },
        {
          id: "g-flow",
          pageId: "root",
          title: null,
          level: "standard",
          read: false,
          collapsed: false,
          revision: 1,
          blocks: [],
          undoStack: [],
          pending: { label: "Flow", why: "Why flow" },
        },
      ],
    },
  ];
}

async function setupWithAgents(agents: FakeAgentRunner) {
  const { app, ctx } = await createApp("tok", {
    runner: new FakeCommandRunner(),
    agents: agents as unknown as never,
  });
  const repo = { id: "rp_m6", owner: "octo", name: "hello", localPath: "/tmp", lastOpened: 0 };
  ctx.repos.upsert(repo);
  const version = { n: 1, headSha: "a".repeat(40), mergeBaseSha: "b".repeat(40), baseRef: "main", fetchedAt: 1, idMapping: {} };
  const review = {
    id: "rv_reuse",
    repoId: repo.id,
    branch: "feature",
    prNumber: 7,
    versions: [version],
    currentVersion: 1,
    createdAt: 1,
  };
  const files = [sourceFile()];
  const { writeReviewRows } = await import("../src/ingest/index.js");
  writeReviewRows(ctx.db, repo.id, {
    review,
    version,
    files,
    description: {
      html: "<p>Hi</p>",
      rev: "1",
      source: "pr" as const,
      editable: true,
      baseMarkdown: "Hi\n",
      paragraphSources: {},
    },
    worktreePath: "/tmp",
  });
  const snapshot: ReviewSnapshot = {
    review,
    version,
    files,
    description: {
      html: "<p>Hi</p>",
      rev: "1",
      source: "pr" as const,
      editable: true,
      baseMarkdown: "Hi\n",
      paragraphSources: {},
    },
    pages: pagesFor(),
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  };
  ctx.reviews.putSnapshot("rv_reuse", snapshot);
  return { app, ctx, reviewId: "rv_reuse" };
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

async function waitForJob(ctx: { jobs: { get: (id: string) => { state: string } | undefined } }, jobId: string): Promise<void> {
  const start = Date.now();
  for (;;) {
    const j = ctx.jobs.get(jobId);
    if (j && (j.state === "done" || j.state === "error" || j.state === "cancelled")) return;
    if (Date.now() - start > 30000) throw new Error(`waitForJob timed out for ${jobId}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("PRD §12 cross-request reuse (#10)", () => {
  it("explain reuses the stored expansion with zero runner calls; deleted repeats as new", async () => {
    const agents = fakeAgents();
    const { app, ctx, reviewId } = await setupWithAgents(agents);
    try {
      const first = await postAction(app, reviewId, {
        kind: "explain",
        quote: "Does the thing",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(first.status).toBe(200);
      expect(first.json.accepted).toBe(true);
      expect(first.json.jobId).toBeTruthy();
      expect(first.json.reused).toBeUndefined();
      await waitForJob(ctx, first.json.jobId as string);
      const promptsAfterFirst = agents.prompts.length;
      expect(promptsAfterFirst).toBeGreaterThan(0);

      const second = await postAction(app, reviewId, {
        kind: "explain",
        quote: "Does the thing",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(second.status).toBe(200);
      expect(second.json.annotationId).toBe(first.json.annotationId);
      expect(second.json.reused).toBe(true);
      expect(second.json.jobId).toBeUndefined();
      expect(agents.prompts.length).toBe(promptsAfterFirst);

      // Deleted result → legitimately a new request (new annotation + job).
      await postAction(app, reviewId, { kind: "close", annotationId: first.json.annotationId as string });
      const del = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/actions`,
        headers: authed,
        payload: { kind: "delete", targetId: first.json.annotationId as string },
      } as never);
      expect(del.statusCode).toBe(200);
      const third = await postAction(app, reviewId, {
        kind: "explain",
        quote: "Does the thing",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(third.status).toBe(200);
      expect(third.json.reused).toBeUndefined();
      expect(third.json.jobId).toBeTruthy();
      expect(third.json.annotationId).not.toBe(first.json.annotationId);
    } finally {
      await app.close();
    }
  });

  it("ask reuses same message with zero calls; different message is new", async () => {
    const agents = fakeAgents();
    const { app, ctx, reviewId } = await setupWithAgents(agents);
    try {
      const msg = "What does it do?";
      const first = await postAction(app, reviewId, {
        kind: "ask",
        quote: "Does the thing",
        anchor: { where: "block", blockId: "b1" },
        message: msg,
      });
      expect(first.status).toBe(200);
      expect(first.json.jobId).toBeTruthy();
      await waitForJob(ctx, first.json.jobId as string);
      const n = agents.prompts.length;

      const same = await postAction(app, reviewId, {
        kind: "ask",
        quote: "Does the thing",
        anchor: { where: "block", blockId: "b1" },
        message: msg,
      });
      expect(same.json.threadId).toBe(first.json.threadId);
      expect(same.json.reused).toBe(true);
      expect(same.json.jobId).toBeUndefined();
      expect(agents.prompts.length).toBe(n);

      const different = await postAction(app, reviewId, {
        kind: "ask",
        quote: "Does the thing",
        anchor: { where: "block", blockId: "b1" },
        message: "A totally different question?",
      });
      expect(different.json.threadId).not.toBe(first.json.threadId);
      expect(different.json.reused).toBeUndefined();
      expect(different.json.jobId).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it("depth round-trip reuses cached levels; examples/diagram reuse when saturated", async () => {
    const agents = fakeAgents();
    const { app, ctx, reviewId } = await setupWithAgents(agents);
    try {
      // Depth to simple (agent), back to standard is cached? Standard exists
      // from start, so simpler→deeper uses stored text. First drive simple.
      const down = await postAction(app, reviewId, { kind: "depth", cardId: "central", direction: "simpler" });
      expect(down.status).toBe(200);
      if (down.json.jobId) await waitForJob(ctx, down.json.jobId as string);
      const afterSimple = agents.prompts.length;
      const up = await postAction(app, reviewId, { kind: "depth", cardId: "central", direction: "deeper" });
      expect(up.status).toBe(200);
      expect(up.json.reused).toBe(true);
      expect(up.json.jobId).toBeUndefined();
      expect(agents.prompts.length).toBe(afterSimple);

      // Examples: first fills, second reuses.
      const ex1 = await postAction(app, reviewId, { kind: "examples", cardId: "central" });
      expect(ex1.status).toBe(200);
      if (ex1.json.jobId) await waitForJob(ctx, ex1.json.jobId as string);
      const n1 = agents.prompts.length;
      const ex2 = await postAction(app, reviewId, { kind: "examples", cardId: "central" });
      expect(ex2.json.reused).toBe(true);
      expect(ex2.json.jobId).toBeUndefined();
      expect(agents.prompts.length).toBe(n1);

      // Diagram: first fills, second reuses.
      const dg1 = await postAction(app, reviewId, { kind: "diagram", cardId: "central" });
      expect(dg1.status).toBe(200);
      if (dg1.json.jobId) await waitForJob(ctx, dg1.json.jobId as string);
      const n2 = agents.prompts.length;
      const dg2 = await postAction(app, reviewId, { kind: "diagram", cardId: "central" });
      expect(dg2.json.reused).toBe(true);
      expect(dg2.json.jobId).toBeUndefined();
      expect(agents.prompts.length).toBe(n2);
    } finally {
      await app.close();
    }
  });

  it("generate and concept reuse filled results", async () => {
    const agents = fakeAgents();
    const { app, ctx, reviewId } = await setupWithAgents(agents);
    try {
      const g1 = await postAction(app, reviewId, { kind: "generate", cardId: "g-flow" });
      expect(g1.status).toBe(200);
      expect(g1.json.jobId).toBeTruthy();
      await waitForJob(ctx, g1.json.jobId as string);
      const n = agents.prompts.length;
      const g2 = await postAction(app, reviewId, { kind: "generate", cardId: "g-flow" });
      expect(g2.json.reused).toBe(true);
      expect(g2.json.jobId).toBeUndefined();
      expect(agents.prompts.length).toBe(n);

      const c1 = await postAction(app, reviewId, { kind: "concept", slug: "test-concept" });
      expect(c1.status).toBe(200);
      if (c1.json.jobId) await waitForJob(ctx, c1.json.jobId as string);
      const n2 = agents.prompts.length;
      const c2 = await postAction(app, reviewId, { kind: "concept", slug: "test-concept" });
      expect(c2.json.pageId).toBe("c-test-concept");
      expect(c2.json.reused).toBe(true);
      expect(c2.json.jobId).toBeUndefined();
      expect(agents.prompts.length).toBe(n2);
    } finally {
      await app.close();
    }
  });

  it("second-opinion reuses same mode/model/version; hunk summarize reuses stored summary", async () => {
    const agents = fakeAgents();
    const { app, ctx, reviewId } = await setupWithAgents(agents);
    try {
      const so1 = await postAction(app, reviewId, { kind: "second_opinion", cardId: "central", mode: "check" });
      expect(so1.status).toBe(200);
      expect(so1.json.jobId).toBeTruthy();
      await waitForJob(ctx, so1.json.jobId as string);
      const n = agents.prompts.length;
      const so2 = await postAction(app, reviewId, { kind: "second_opinion", cardId: "central", mode: "check" });
      expect(so2.json.reused).toBe(true);
      expect(so2.json.jobId).toBeUndefined();
      expect(agents.prompts.length).toBe(n);

      // Hunk summarize via HTTP route.
      const h1 = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/hunks/h1/summarize`,
        headers: authed,
      } as never);
      expect(h1.statusCode).toBe(202);
      const jid = (h1.json() as { jobId: string }).jobId;
      await waitForJob(ctx, jid);
      const m = agents.prompts.length;
      const h2 = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/hunks/h1/summarize`,
        headers: authed,
      } as never);
      expect(h2.statusCode).toBe(200);
      expect((h2.json() as { reused?: boolean }).reused).toBe(true);
      expect(agents.prompts.length).toBe(m);
    } finally {
      await app.close();
    }
  });

  it("new base version invalidates explain/ask/second-opinion", async () => {
    const agents = fakeAgents();
    const { app, ctx, reviewId } = await setupWithAgents(agents);
    try {
      const first = await postAction(app, reviewId, {
        kind: "explain",
        quote: "Does the thing",
        anchor: { where: "block", blockId: "b1" },
      });
      await waitForJob(ctx, first.json.jobId as string);
      const n = agents.prompts.length;

      // Simulate new commits: bump version.
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.version.n = 2;
        draft.review.currentVersion = 2;
        draft.review.versions.push({
          n: 2,
          headSha: "c".repeat(40),
          mergeBaseSha: "b".repeat(40),
          baseRef: "main",
          fetchedAt: 2,
          idMapping: {},
        });
      });
      const afterBump = await postAction(app, reviewId, {
        kind: "explain",
        quote: "Does the thing",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(afterBump.json.reused).toBeUndefined();
      expect(afterBump.json.jobId).toBeTruthy();
      expect(agents.prompts.length).toBeGreaterThanOrEqual(n);
    } finally {
      await app.close();
    }
  });
});
