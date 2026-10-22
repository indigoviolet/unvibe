/**
 * Second opinion (PRD §4.10, §12): isolation, blind topic, same-model
 * refusal, storage/replacement, depth+undo survival, dedupe, cancel, and
 * the MCP `search_review` role restriction.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AddressInfo } from "node:net";
import type { Job, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import { McpRegistry } from "../src/mcp/index.js";
import { buildSecondOpinionContext } from "../src/context/index.js";
import {
  buildSecondOpinionPrompt,
  checkDistinctModel,
  deriveBlindTopic,
  isNeutralTitle,
  requestSecondOpinion,
  resolveTarget,
} from "../src/secondopinion/index.js";
import { removeSecondOpinionAction } from "../src/pipeline/actions/second_opinion.js";
import { createApp } from "../src/server.js";
import type { ModelCatalog } from "../src/settings/index.js";
import { setupReview } from "./m6-helpers.js";

const SECOND_REPLY = (verdict: string): string =>
  `Independent check. The helper handles the fold. [[diff:a-py:1-2]]\n\n` +
  `\`\`\`json\n{"secondOpinion": {"verdict": "${verdict}", "reasoning": "Checked the helper.", "missed": "Nothing."}}\n\`\`\`\n`;

/** These tests expect a fresh (or deduped) job, never a stored-result reuse. */
function freshJob(job: Job | { reused: true }): Job {
  if (!("id" in job)) throw new Error("expected a job, got a reused second opinion");
  return job;
}

function fakeWithVerdict(verdict = "agrees"): FakeAgentRunner {
  return new FakeAgentRunner([
    { match: "Read the review source", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
    {
      match: "Second opinion",
      events: [
        { type: "text", delta: SECOND_REPLY(verdict) },
        { type: "usage", inputTokens: 100, cachedReadTokens: 40, cachedWriteTokens: 0, outputTokens: 30 },
        { type: "done", stopReason: "end_turn" },
      ],
    },
  ]);
}

function cardSnapshot(): ReviewSnapshot["pages"] {
  return [
    {
      id: "root",
      kind: "root",
      title: "Guide",
      cards: [
        {
          id: "central",
          pageId: "root",
          title: "Central",
          level: "standard",
          collapsed: false,
          revision: 1,
          blocks: [
            {
              type: "paragraph",
              id: "b1",
              text: { standard: "Does the thing [[diff:a-py:1-2]]" },
              citations: [{ target: "diff:a-py:1-2" }],
            },
          ],
          undoStack: [],
        },
      ],
    },
  ];
}

describe("blind topic (PRD §4.10)", () => {
  it("fixture finding titles are non-neutral; location topic never contains the claim", () => {
    expect(isNeutralTitle("Folds that end in a bare LF are not unfolded")).toBe(false);
    expect(isNeutralTitle("The linear-time claim has no test")).toBe(false);
    expect(isNeutralTitle("How header values flow")).toBe(true);
    const claim =
      "http.client accepts header lines ending in LF alone, but the new code only looks for CRLF.";
    const topic = deriveBlindTopic({ citedIds: ["diff:conn:82", "diff:conn:86-88"], filePaths: ["src/urllib3/connection.py"] });
    expect(topic).not.toContain(claim);
    expect(topic).not.toContain("bare LF are not unfolded");
    expect(topic).toContain("[[diff:conn:82]]");
  });

  it("blind prompt for a finding contains no claim text", async () => {
    const runner = new FakeCommandRunner();
    const agents = fakeWithVerdict();
    const { app, ctx, reviewId } = await setupReview(runner, {
      pages: [
        {
          id: "f-lf",
          kind: "finding",
          title: "Folds that end in a bare LF are not unfolded",
          parent: "root",
          confidence: "medium",
          summary: "http.client accepts LF alone, but the new code only looks for CRLF.",
          cards: [
            {
              id: "flf-ev",
              pageId: "f-lf",
              title: "Evidence",
              level: "standard",
              collapsed: false,
              revision: 1,
              blocks: [
                {
                  type: "paragraph",
                  id: "b1",
                  text: { standard: "Fast path needs CRLF. [[diff:a-py:1-2]]" },
                  citations: [{ target: "diff:a-py:1-2" }],
                },
              ],
              undoStack: [],
            },
            {
              id: "flf-as",
              pageId: "f-lf",
              title: "Assessment",
              level: "standard",
              collapsed: false,
              revision: 1,
              blocks: [
                {
                  type: "paragraph",
                  id: "b1",
                  text: { standard: "SECRET-CLAIM-PROBE bare-LF verdict text" },
                  citations: [],
                },
              ],
              undoStack: [],
            },
          ],
        },
      ] as ReviewSnapshot["pages"],
    });
    try {
      const deps = {
        reviews: ctx.reviews,
        jobs: ctx.jobs,
        sessions: ctx.sessions,
        runner: agents,
        mcp: ctx.mcp,
        settings: ctx.settings,
        commands: runner,
        dataDir: ctx.dataDir,
        promptsDir: ctx.promptsDir,
        mcpBaseUrl: "http://127.0.0.1:4517",
      };
      const built = await buildSecondOpinionPrompt(deps, reviewId, "f-lf", "blind");
      expect(built.claim).toBe("");
      expect(built.turn).not.toContain("SECRET-CLAIM-PROBE");
      expect(built.turn).not.toContain("only looks for CRLF");
      expect(built.turn).toContain("[[diff:a-py:1-2]]");
      // Check mode does carry the claim.
      const check = await buildSecondOpinionPrompt(deps, reviewId, "f-lf", "check");
      expect(check.turn).toContain("SECRET-CLAIM-PROBE");
    } finally {
      await app.close();
    }
  });
});

describe("context isolation (PRD §12)", () => {
  it("guide, findings, contributions and uncited pins cannot leak via the helper", () => {
    const ctx = buildSecondOpinionContext({
      instructions: "L0",
      sourceText: "L1",
      codeExcerpts: [{ id: "code:a.py:1-2@s", text: "CITED" }],
      citedIds: ["code:a.py:1-2@s"],
    });
    for (const probe of ["GUIDE-PROBE", "FINDING-PROBE", "CONTRIBUTION-PROBE", "LOG-PROBE", "UNCITED-PIN"]) {
      expect(ctx.text).not.toContain(probe);
    }
    expect(ctx.text).toContain("CITED");
  });

  it("prompt snapshot for blind contains no guide text or log probes", async () => {
    const runner = new FakeCommandRunner();
    const agents = fakeWithVerdict();
    const { app, ctx, reviewId } = await setupReview(runner, {
      pages: [
        {
          id: "root",
          kind: "root",
          title: "Guide",
          cards: [
            {
              id: "central",
              pageId: "root",
              title: "Central GUIDE-PROBE-XYZ",
              level: "standard",
              collapsed: false,
              revision: 1,
              blocks: [
                {
                  type: "paragraph",
                  id: "b1",
                  text: { standard: "Central claim GUIDE-PROBE-XYZ [[diff:a-py:1-2]]" },
                  citations: [{ target: "diff:a-py:1-2" }],
                },
              ],
              undoStack: [],
            },
          ],
        },
        {
          id: "f-other",
          kind: "finding",
          title: "Other FINDING-PROBE-XYZ",
          parent: "root",
          confidence: "high",
          summary: "FINDING-PROBE-XYZ summary",
          cards: [
            {
              id: "fo-ev",
              pageId: "f-other",
              title: "Evidence",
              level: "standard",
              collapsed: false,
              revision: 1,
              blocks: [
                { type: "paragraph", id: "b1", text: { standard: "Other evidence" }, citations: [] },
              ],
              undoStack: [],
            },
          ],
        },
      ] as ReviewSnapshot["pages"],
    });
    try {
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.contributions.push({
          id: "ct1",
          sourceSession: "s1",
          items: [{ kind: "fact", text: "CONTRIBUTION-PROBE-XYZ", citations: [] }],
          status: "pending",
        });
        draft.logTail.push({ seq: 1, kind: "thread-summary", payload: { summary: "LOG-PROBE-XYZ" }, scope: { scope: "global" } });
        (draft.pinnedCode ??= []).push({ path: "secret.py", start: 1, end: 2, sha: "abc123", text: "UNCITED-PIN-XYZ" });
      });
      const deps = {
        reviews: ctx.reviews,
        jobs: ctx.jobs,
        sessions: ctx.sessions,
        runner: agents,
        mcp: ctx.mcp,
        settings: ctx.settings,
        commands: runner,
        dataDir: ctx.dataDir,
        promptsDir: ctx.promptsDir,
        mcpBaseUrl: "http://127.0.0.1:4517",
      };
      const built = await buildSecondOpinionPrompt(deps, reviewId, "central", "blind");
      for (const probe of ["GUIDE-PROBE-XYZ", "FINDING-PROBE-XYZ", "CONTRIBUTION-PROBE-XYZ", "LOG-PROBE-XYZ", "UNCITED-PIN-XYZ"]) {
        expect(built.turn, probe).not.toContain(probe);
      }
    } finally {
      await app.close();
    }
  });
});

describe("MCP search_review restriction (PRD §12)", () => {
  async function queryRole(role: "session" | "second-opinion"): Promise<string> {
    const commands = new FakeCommandRunner();
    const registry = new McpRegistry({
      reader: {
        getReview: async () => ({
          reviewId: "r1",
          headSha: "abc123",
          hunks: [],
          cards: [{ id: "c-central", title: "Central change", text: "GUIDE-SECRET backoff in src/conn.py" }],
          annotations: [{ id: "a1", type: "comment", anchorSummary: "src/conn.py:148", text: "THREAD-SECRET why backoff?" }],
          contributions: [{ id: "k1", sourceSession: "s1", text: "CONTRIB-SECRET fact" }],
          description: [{ id: "d1", text: "DESC-VISIBLE this PR adds backoff" }],
        }),
        getWorktreePath: () => "/repo",
      },
      commands,
    });
    const { app } = await createApp("tok", { mcp: registry });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${addr.port}`;
    const issued = registry.issueSession("r1", "s", role);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(base + issued.path)));
    try {
      const res = await client.callTool({ name: "search_review", arguments: { query: "backoff" } });
      const text = (res as { content: { text: string }[] }).content.map((c) => c.text).join("\n");
      const res2 = await client.callTool({ name: "search_review", arguments: { query: "GUIDE-SECRET" } });
      const text2 = (res2 as { content: { text: string }[] }).content.map((c) => c.text).join("\n");
      const res3 = await client.callTool({ name: "resolve", arguments: { description: "Central change" } });
      const text3 = (res3 as { content: { text: string }[] }).content.map((c) => c.text).join("\n");
      return `${text}\n---\n${text2}\n---\n${text3}`;
    } finally {
      await client.close().catch(() => {});
      await app.close();
    }
  }

  it("session role sees cards; second-opinion role sees only description", async () => {
    const sessText = await queryRole("session");
    expect(sessText).toContain("card:c-central");
    const soText = await queryRole("second-opinion");
    expect(soText).not.toContain("card:c-central");
    expect(soText).not.toContain("GUIDE-SECRET");
    expect(soText).not.toContain("THREAD-SECRET");
    expect(soText).not.toContain("CONTRIB-SECRET");
    // Description is still searchable (already in L1).
    expect(soText).toContain("DESC-VISIBLE");
    // resolve() returns no card candidates for the role.
    expect(soText).not.toContain("card:");
  });
});

describe("same-model refusal (PRD §4.10)", () => {
  it("checkDistinctModel points at Settings", () => {
    expect(() => checkDistinctModel({ provider: "claude", model: "m" }, { provider: "claude", model: "m" })).toThrow(
      /Settings/,
    );
    expect(() =>
      checkDistinctModel({ provider: "claude", model: "m" }, { provider: "codex", model: "m" }),
    ).not.toThrow();
  });

  it("request refuses when settings resolve to the same model", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner, { pages: cardSnapshot() });
    try {
      ctx.settings.update({ main: { provider: "claude", model: "same", effort: "" }, secondOpinion: { provider: "claude", model: "same", effort: "" } });
      const deps = {
        reviews: ctx.reviews,
        jobs: ctx.jobs,
        sessions: ctx.sessions,
        runner: fakeWithVerdict(),
        mcp: ctx.mcp,
        settings: ctx.settings,
        commands: runner,
        dataDir: ctx.dataDir,
        promptsDir: ctx.promptsDir,
        mcpBaseUrl: "http://127.0.0.1:4517",
      };
      await expect(requestSecondOpinion(deps, { reviewId, cardId: "central", mode: "check" })).rejects.toThrow(
        /Settings/,
      );
    } finally {
      await app.close();
    }
  });
});

describe("result storage, replacement, survival, dedupe, cancel", () => {
  async function setupWithAgents(
    agents: FakeAgentRunner,
    pages: ReviewSnapshot["pages"] = cardSnapshot(),
  ): Promise<Awaited<ReturnType<typeof setupReview>>> {
    const runner = new FakeCommandRunner();
    // createApp with the fake agents so SessionManager bases also use fakes
    // (the default ACP runner would try to set real models and fail).
    const { app, ctx } = await createApp("tok", { runner, agents: agents as unknown as never });
    const { repoRow, versionRow } = await import("./m6-helpers.js");
    const { writeReviewRows } = await import("../src/ingest/index.js");
    const { descriptionFor } = await import("./m6-helpers.js");
    const { sourceFile } = await import("./m6-helpers.js");
    const repo = repoRow();
    ctx.repos.upsert(repo);
    const reviewId = `rv_so_${Math.random().toString(36).slice(2, 8)}`;
    const version = versionRow();
    const review = {
      id: reviewId,
      repoId: repo.id,
      branch: "feature",
      prNumber: 7,
      versions: [version],
      currentVersion: 1,
      createdAt: 1,
    };
    const files = [sourceFile()];
    const description = descriptionFor("First para.\n\nSecond para.\n");
    writeReviewRows(ctx.db, repo.id, { review, version, files, description, commits: [], title: review.branch, worktreePath: "/tmp" });
    ctx.reviews.putSnapshot(reviewId, {
      review,
      version,
      files,
      description,
      ingest: { status: "ready" },
      pages,
      annotations: [],
      hunkStates: [],
      fileStates: [],
      viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
    });
    return { app, ctx, reviewId } as unknown as Awaited<ReturnType<typeof setupReview>>;
  }

  async function setup(): Promise<Awaited<ReturnType<typeof setupReview>>> {
    return setupWithAgents(fakeWithVerdict(), cardSnapshot());
  }

  function depsFor(s: Awaited<ReturnType<typeof setupReview>>, agents: FakeAgentRunner): Parameters<typeof requestSecondOpinion>[0] {
    return {
      reviews: s.ctx.reviews,
      jobs: s.ctx.jobs,
      sessions: s.ctx.sessions,
      runner: agents,
      mcp: s.ctx.mcp,
      settings: s.ctx.settings,
      commands: s.ctx.runner,
      dataDir: s.ctx.dataDir,
      promptsDir: s.ctx.promptsDir,
      mcpBaseUrl: "http://127.0.0.1:4517",
    };
  }

  it("stores the result with verdict, citations, usage and prompt snapshot; repeat reuses without a job", async () => {
    const s = await setup();
    try {
      const agents = fakeWithVerdict("agrees");
      const deps = depsFor(s, agents);
      const job = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" }));
      if (!("id" in job)) throw new Error("first run should enqueue a job");
      expect(job.kind).toBe("second-opinion");
      expect(job.provider).toBe(s.ctx.settings.get().secondOpinion.provider);
      await s.ctx.jobs.drain(10000);
      const done = s.ctx.jobs.get(job.id);
      expect(done?.state, `job error: ${done?.error}`).toBe("done");
      const snap = s.ctx.reviews.getSnapshot(s.reviewId)!;
      const card = snap.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      expect(card.secondOpinions).toHaveLength(1);
      const so = card.secondOpinions![0];
      expect(so.verdict).toBe("agrees");
      expect(so.provider).toBe(s.ctx.settings.get().secondOpinion.provider);
      expect(so.blocks.length).toBeGreaterThan(0);
      expect(so.missed).toContain("Nothing");
      // Prompt snapshot stored, usage recorded.
      const storedJob = s.ctx.jobs.get(job.id)!;
      expect(storedJob.promptSnapshot).toContain("Second opinion");
      expect(storedJob.promptSnapshot).not.toContain("GUIDE-PROBE");
      expect(storedJob.usage?.inputTokens).toBeGreaterThan(0);
      expect(snap.usageTotals?.inputTokens).toBeGreaterThan(0);
      // Repeat of the identical request (same card, mode, model, version)
      // reuses the stored result: no job, no runner call (PRD §12, #10).
      const promptsBefore = agents.prompts.length;
      const jobsBefore = s.ctx.jobs.listByReview(s.reviewId).length;
      const job2 = await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" });
      expect(job2).toMatchObject({ reused: true });
      expect(agents.prompts.length).toBe(promptsBefore);
      expect(s.ctx.jobs.listByReview(s.reviewId).length).toBe(jobsBefore);
      const snap2 = s.ctx.reviews.getSnapshot(s.reviewId)!;
      const card2 = snap2.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      expect(card2.secondOpinions).toHaveLength(1);
      // Other mode coexists (one per mode).
      const job3 = await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "blind" });
      if (!("id" in job3)) throw new Error("other mode should enqueue a job");
      await s.ctx.jobs.drain(10000);
      expect(s.ctx.jobs.get(job3.id)?.state).toBe("done");
      const snap3 = s.ctx.reviews.getSnapshot(s.reviewId)!;
      const card3 = snap3.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      expect(card3.secondOpinions).toHaveLength(2);
    } finally {
      await s.app.close();
    }
  });

  it("runs on the live second-opinion default, not the stored static one (issue #88)", async () => {
    const s = await setup();
    try {
      const agents = fakeWithVerdict("agrees");
      // No gpt-6.1-sol offered: the live second opinion (main is Claude) is
      // gpt-6-sol. The stored static pick is gpt-6.1-sol and must not win.
      const liveClaude = [
        "default",
        "opus",
        "sonnet",
        "haiku",
        "claude-opus-5-5",
        "claude-opus-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "claude-haiku-4-5",
      ];
      const liveCodex = ["gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
      const norm = (id: string): { id: string } => ({ id });
      const models: ModelCatalog = {
        listModels: (p: string) => Promise.resolve((p === "claude" ? liveClaude : liveCodex).map(norm)),
        offered: (p: string) =>
          Promise.resolve({ models: (p === "claude" ? liveClaude : liveCodex).map(norm), defaultId: null }),
      };
      const deps = { ...depsFor(s, agents), models };
      const job = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" }));
      if (!("id" in job)) throw new Error("expected a job");
      expect(job.provider).toBe("codex");
      expect(job.model).toBe("gpt-6-sol");
      await s.ctx.jobs.drain(10000);
      expect(s.ctx.jobs.get(job.id)?.state).toBe("done");
      const snap = s.ctx.reviews.getSnapshot(s.reviewId)!;
      const card = snap.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      expect(card.secondOpinions![0].model).toBe("gpt-6-sol");
    } finally {
      await s.app.close();
    }
  });

  it("survives depth changes and undo (attached, not revisable)", async () => {
    const s = await setup();
    try {
      const deps = depsFor(s, fakeWithVerdict("partly"));
      const job = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "blind" }));
      await s.ctx.jobs.drain(10000);
      const done = s.ctx.jobs.get(job.id);
      if (done?.state !== "done") console.log("second-opinion job error:", done?.error);
      expect(done?.state).toBe("done");
      // Simulate a depth rewrite: push undo, change blocks/level.
      await s.ctx.reviews.mutate(s.reviewId, (draft) => {
        const card = draft.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
        card.undoStack.push({ blocks: card.blocks, level: card.level });
        card.level = "deep";
        card.blocks = [
          { type: "paragraph", id: "b1", text: { standard: "Deeper text [[diff:a-py:1-2]]" }, citations: [{ target: "diff:a-py:1-2" }] },
        ];
        card.revision += 1;
      });
      let snap = s.ctx.reviews.getSnapshot(s.reviewId)!;
      let card = snap.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      expect(card.level).toBe("deep");
      expect(card.secondOpinions).toHaveLength(1);
      expect(card.secondOpinions![0].verdict).toBe("partly");
      // Simulate undo: restore blocks/level from the stack.
      await s.ctx.reviews.mutate(s.reviewId, (draft) => {
        const c = draft.pages.flatMap((p) => p.cards).find((x) => x.id === "central")!;
        const prev = c.undoStack.pop();
        if (prev) {
          c.blocks = prev.blocks;
          c.level = prev.level;
        }
      });
      snap = s.ctx.reviews.getSnapshot(s.reviewId)!;
      card = snap.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      expect(card.secondOpinions).toHaveLength(1);
    } finally {
      await s.app.close();
    }
  });

  it("dedupes by (card, mode, model, version)", async () => {
    const s = await setup();
    try {
      const agents = fakeWithVerdict();
      const deps = depsFor(s, agents);
      const j1 = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" }));
      const j2 = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" }));
      expect(j2.id).toBe(j1.id);
      // Different mode is a different job.
      const j3 = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "blind" }));
      expect(j3.id).not.toBe(j1.id);
      await s.ctx.jobs.drain(10000);
    } finally {
      await s.app.close();
    }
  });

  it("is cancellable with no stored result", async () => {
    // Sessions must build on fakes too (issue #119): the app is built on
    // the slow fake below, so ensureBase answers "ready" without agents.
    const agents = new FakeAgentRunner([
      { match: "Read the review source", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
    ]);
    const s = await setupWithAgents(agents, cardSnapshot());
    try {
      // Slow turn: streams with delays so cancel lands mid-flight.
      agents.prompt = (async function* (session, text, _signal?: AbortSignal) {
        void _signal;
        agents.prompts.push({ sessionId: session.id, text });
        if (text.includes("Read the review source")) {
          yield { type: "text", delta: "ready" };
          yield { type: "done", stopReason: "end_turn" };
          return;
        }
        for (let i = 0; i < 50; i++) {
          yield { type: "text", delta: "word " };
          await new Promise((r) => setTimeout(r, 20));
        }
        yield { type: "text", delta: SECOND_REPLY("agrees") };
        yield { type: "done", stopReason: "end_turn" };
      }) as FakeAgentRunner["prompt"];
      const deps = depsFor(s, agents);
      const job = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" }));
      await new Promise((r) => setTimeout(r, 60));
      s.ctx.jobs.cancel(job.id);
      await s.ctx.jobs.drain(10000).catch(() => {});
      expect(s.ctx.jobs.get(job.id)?.state).toBe("cancelled");
      const snap = s.ctx.reviews.getSnapshot(s.reviewId)!;
      const card = snap.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
      expect(card.secondOpinions ?? []).toHaveLength(0);
    } finally {
      await s.app.close();
    }
  });

  it("resolves finding page ids and unknown cards fail", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner, { pages: cardSnapshot() });
    try {
      const snap = ctx.reviews.getSnapshot(reviewId)!;
      expect(() => resolveTarget(snap, "nope")).toThrow(/unknown card/);
      expect(resolveTarget(snap, "central").kind).toBe("card");
    } finally {
      await app.close();
    }
  });

  it("a re-run resolving after Remove stays removed (issue #76)", async () => {
    const s = await setup();
    try {
      const agents = fakeWithVerdict("agrees");
      // Hold the re-run's turn on an explicit gate: no timing involved,
      // the test releases it after Remove.
      let holdRerun = false;
      let rerunTurnStarted = false;
      let releaseRerun: (() => void) | null = null;
      const basePrompt = agents.prompt.bind(agents);
      agents.prompt = (async function* (session, text, signal) {
        if (holdRerun && text.includes("Second opinion")) {
          rerunTurnStarted = true;
          await new Promise<void>((r) => {
            releaseRerun = r;
          });
        }
        yield* basePrompt(session, text, signal);
      }) as FakeAgentRunner["prompt"];
      const deps = depsFor(s, agents);
      const pipeline = { opts: deps } as unknown as Parameters<typeof removeSecondOpinionAction>[0];

      // First run completes and stores its result.
      const j1 = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" }));
      if (!("id" in j1)) throw new Error("first run should enqueue a job");
      await s.ctx.jobs.drain(10000);
      expect(s.ctx.jobs.get(j1.id)?.state).toBe("done");
      const stored = (): unknown[] =>
        s.ctx.reviews.getSnapshot(s.reviewId)!.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!
          .secondOpinions ?? [];
      expect(stored()).toHaveLength(1);

      // A model change makes the re-run a new request (same card+mode, so
      // the stored result is what Remove deletes); hold its turn mid-flight.
      const cur = s.ctx.settings.get();
      s.ctx.settings.update({
        secondOpinion: { provider: cur.secondOpinion.provider, model: `${cur.secondOpinion.model}-rerun`, effort: cur.secondOpinion.effort },
      });
      holdRerun = true;
      const j2 = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" }));
      if (!("id" in j2)) throw new Error("re-run should enqueue a job, not reuse");
      const start = Date.now();
      while (!rerunTurnStarted) {
        if (Date.now() - start > 10000) throw new Error("re-run turn never started");
        await new Promise((r) => setTimeout(r, 25));
      }

      // Remove while the re-run is in flight, then let it resolve.
      await removeSecondOpinionAction(pipeline, s.ctx.jobs, s.ctx.reviews, s.reviewId, "central", "check");
      expect(stored()).toHaveLength(0);
      releaseRerun!();
      const end = Date.now();
      for (;;) {
        const state = s.ctx.jobs.get(j2.id)?.state;
        if (state === "done" || state === "error" || state === "cancelled") break;
        if (Date.now() - end > 10000) throw new Error("re-run job never settled");
        await new Promise((r) => setTimeout(r, 25));
      }

      // Remove means gone: the in-flight run is cancelled and its late
      // result is dropped, never re-stored.
      expect(s.ctx.jobs.get(j2.id)?.state).toBe("cancelled");
      expect(stored()).toHaveLength(0);
    } finally {
      await s.app.close();
    }
  });
});

/**
 * Reasoning diagrams go through finalize + one repair turn (issue #145).
 *
 * Fake `d2` (no real binary needed): version ok, rejects sources with an
 * inline `{.class` like the real compiler, renders everything else.
 */
function writeSmartD2(): { dir: string; bin: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-smartd2-"));
  const bin = path.join(dir, "d2");
  fs.writeFileSync(
    bin,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "d2 v0.9.0"; exit 0; fi\n' +
      'src=$(cat)\ncase "$src" in\n"{.class"*|*"{.class"*) echo "err: invalid text beginning unquoted key" >&2; exit 1;;\n' +
      "esac\n" +
      'if [ "$1" = "validate" ]; then echo "Success!"; exit 0; fi\n' +
      'echo \'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text>ok</text></svg>\'\nexit 0\n',
  );
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
}

const SO_BAD_DIAGRAM =
  `Independent check with a diagram. [[diff:a-py:1-2]]\n\n` +
  "```d2\ndirection: right\nstart: \"request in\"\ngone: \"unmount cleanup\" {.class: [bad]}\nstart -> gone: finish\n```\n\n" +
  '```json\n{"secondOpinion": {"verdict": "agrees", "reasoning": "Checked the helper.", "missed": "Nothing."}}\n```\n';

const SO_FIXED_DIAGRAM =
  `A fixed diagram.\n\n` +
  "```d2\ndirection: right\nstart: \"request in\"\ngone: \"unmount cleanup\"\ngone.class: [bad]\nstart -> gone: finish\n```\n\n" +
  "```json\n{}\n```\n";

function soEvents(text: string): { type: string; delta?: string; inputTokens?: number; cachedReadTokens?: number; cachedWriteTokens?: number; outputTokens?: number; stopReason?: string }[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 100, cachedReadTokens: 40, cachedWriteTokens: 0, outputTokens: 30 },
    { type: "done", stopReason: "end_turn" },
  ];
}

describe("reasoning diagrams (#145)", () => {
  async function setupWithTurn(
    turnEvents: { type: string; delta?: string; inputTokens?: number; cachedReadTokens?: number; cachedWriteTokens?: number; outputTokens?: number; stopReason?: string }[],
    repairEvents: { type: string; delta?: string; inputTokens?: number; cachedReadTokens?: number; cachedWriteTokens?: number; outputTokens?: number; stopReason?: string }[],
  ): Promise<{ s: Awaited<ReturnType<typeof setupReview>>; turnAgents: FakeAgentRunner; appAgents: FakeAgentRunner }> {
    // Turns run on deps.runner; the base pack and the diagram repair turn
    // run on the app's (pipeline's) runner — script both. Commands stay
    // real (no override): the fake `d2` binary must actually execute, as in
    // the #130 app-level tests (a bare FakeCommandRunner would fail the
    // version probe and mark diagrams unavailable).
    const turnAgents = new FakeAgentRunner([{ match: "Second opinion", events: turnEvents as never }]);
    const appAgents = new FakeAgentRunner([
      { match: "failed validation", events: repairEvents as never },
      {
        match: "Read the review source",
        events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] as never,
      },
    ]);
    const { app, ctx } = await createApp("tok", { agents: appAgents as unknown as never });
    const { repoRow, versionRow, descriptionFor, sourceFile } = await import("./m6-helpers.js");
    const { writeReviewRows } = await import("../src/ingest/index.js");
    const repo = repoRow();
    ctx.repos.upsert(repo);
    const reviewId = `rv_so_${Math.random().toString(36).slice(2, 8)}`;
    const version = versionRow();
    const review = {
      id: reviewId,
      repoId: repo.id,
      branch: "feature",
      prNumber: 7,
      versions: [version],
      currentVersion: 1,
      createdAt: 1,
    };
    const files = [sourceFile()];
    const description = descriptionFor("First para.\n\nSecond para.\n");
    writeReviewRows(ctx.db, repo.id, { review, version, files, description, commits: [], title: review.branch, worktreePath: "/tmp" });
    ctx.reviews.putSnapshot(reviewId, {
      review,
      version,
      files,
      description,
      ingest: { status: "ready" },
      pages: cardSnapshot(),
      annotations: [],
      hunkStates: [],
      fileStates: [],
      viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
    });
    const s = { app, ctx, reviewId } as unknown as Awaited<ReturnType<typeof setupReview>>;
    return { s, turnAgents, appAgents };
  }

  function depsForDiagram(s: Awaited<ReturnType<typeof setupReview>>, turnAgents: FakeAgentRunner): Parameters<typeof requestSecondOpinion>[0] {
    return {
      reviews: s.ctx.reviews,
      jobs: s.ctx.jobs,
      sessions: s.ctx.sessions,
      runner: turnAgents,
      mcp: s.ctx.mcp,
      settings: s.ctx.settings,
      commands: s.ctx.runner,
      dataDir: s.ctx.dataDir,
      promptsDir: s.ctx.promptsDir,
      mcpBaseUrl: "http://127.0.0.1:4517",
      pipeline: s.ctx.pipeline,
    };
  }

  async function storedOpinion(s: Awaited<ReturnType<typeof setupReview>>): Promise<{
    verdict: string;
    blocks: { type: string; render?: { status: string } }[];
  }> {
    const snap = s.ctx.reviews.getSnapshot(s.reviewId)!;
    const card = snap.pages.flatMap((p) => p.cards).find((c) => c.id === "central")!;
    expect(card.secondOpinions).toHaveLength(1);
    const so = card.secondOpinions![0];
    return { verdict: so.verdict, blocks: so.blocks as { type: string; render?: { status: string } }[] };
  }

  it("a bad diagram gets exactly one repair turn on the second-opinion session and lands drawn", async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const { s, turnAgents, appAgents } = await setupWithTurn(soEvents(SO_BAD_DIAGRAM), soEvents(SO_FIXED_DIAGRAM));
      try {
        const deps = depsForDiagram(s, turnAgents);
        const job = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" }));
        if (!("id" in job)) throw new Error("expected a job");
        await s.ctx.jobs.drain(30000);
        expect(s.ctx.jobs.get(job.id)?.state, `job error: ${s.ctx.jobs.get(job.id)?.error}`).toBe("done");
        // Exactly one repair turn, and it ran on the second-opinion side
        // (the app's runner, which also serves the pipeline): the turn
        // runner never saw the repair prompt.
        const repairs = (agents: FakeAgentRunner): number =>
          agents.prompts.filter((p) => p.text.includes("failed validation")).length;
        expect(repairs(appAgents)).toBe(1);
        expect(repairs(turnAgents)).toBe(0);
        const so = await storedOpinion(s);
        expect(so.verdict).toBe("agrees");
        const dg = so.blocks.find((b) => b.type === "diagram");
        expect(dg).toBeDefined();
        expect(dg!.render?.status).toBe("ok");
        // Isolation: the repair turn wrote no shared-log entries beyond the
        // run's own stored result.
        const snap = s.ctx.reviews.getSnapshot(s.reviewId)!;
        expect(snap.logTail).toHaveLength(1);
        expect(snap.logTail[0].kind).toBe("second-opinion");
      } finally {
        await s.app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unrepairable diagram keeps an error block and the prose", async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const { s, turnAgents, appAgents } = await setupWithTurn(
        soEvents(SO_BAD_DIAGRAM),
        soEvents("Still prose, no diagram here.\n\n```json\n{}\n```\n"),
      );
      try {
        const deps = depsForDiagram(s, turnAgents);
        const job = freshJob(await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "central", mode: "check" }));
        if (!("id" in job)) throw new Error("expected a job");
        await s.ctx.jobs.drain(30000);
        expect(s.ctx.jobs.get(job.id)?.state, `job error: ${s.ctx.jobs.get(job.id)?.error}`).toBe("done");
        expect(appAgents.prompts.filter((p) => p.text.includes("failed validation"))).toHaveLength(1);
        const so = await storedOpinion(s);
        const dg = so.blocks.find((b) => b.type === "diagram");
        expect(dg).toBeDefined();
        expect(dg!.render?.status).toBe("error");
        // The prose is unaffected.
        expect(JSON.stringify(so.blocks)).toContain("Independent check with a diagram.");
      } finally {
        await s.app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
