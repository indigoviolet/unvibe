/**
 * Shared-context tests (PRD §9.3–§9.5, §12): deterministic, fake clock +
 * scripted runners. No real agents, no network.
 *
 * - log taxonomy per event kind;
 * - change-list filtering and the seen marker (including a failed turn);
 * - batch append vs change list with forks taken before/after a batch;
 * - every rebuild trigger and the consolidation merge;
 * - contributions validation/dedupe/replaces/limits;
 * - correction accept → new revision + undo, dismiss;
 * - deletion entry;
 * - second-opinion isolation (fails if log/contribution text can reach a
 *   second-opinion prompt);
 * - end-to-end demo-review run (replay runner): two conversations on
 *   different cards each see the other's settled-thread summary but not its
 *   card-local entries.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  Annotation,
  Card,
  Contribution,
  LogEntry,
  Review,
  ReviewSnapshot,
} from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { ReplayAgentRunner } from "../src/replay/runner.js";
import { FakeCommandRunner } from "../src/exec/index.js";
import { ManualClock } from "../src/jobs/clock.js";
import { writeReviewRows } from "../src/ingest/index.js";
import { createApp } from "../src/server.js";
import { createSnapshotLookup } from "../src/validate/index.js";
import { filterChangeList } from "../src/context/index.js";
import { loadTemplatesDirSync } from "../src/prompts/index.js";
import { expandAll, guideRevisionForSnapshot, toPromptSnapshot } from "../src/routes/prompts.js";
import { SessionManager } from "../src/sessions/manager.js";
import {
  assertSecondOpinionIsolated,
  assertSmallPromptIsolated,
  buildIsolatedSecondOpinionPrompt,
} from "../src/sharedctx/isolation.js";
import { applyConsolidation, processContribute } from "../src/sharedctx/contributions.js";
import { planGrowth } from "../src/sharedctx/growth.js";
import { logEntryForEvent } from "../src/sharedctx/taxonomy.js";
import { recordInteraction } from "../src/sharedctx/hooks.js";
import { planRebuild } from "../src/sharedctx/rebuild.js";
import { SharedContextService } from "../src/sharedctx/service.js";
import { SharedContextStore } from "../src/sharedctx/store.js";
import { isThreadSettled, summarizeSettledThread, toThreadSnapshot } from "../src/sharedctx/threads.js";
import {
  descriptionFor,
  repoRow,
  sourceFile,
  versionRow,
  type SetupOpts,
} from "./m6-helpers.js";

const authed = { authorization: "Bearer tok" };
const REPO_PROMPTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "prompts",
);
const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);

function card(id: string, standard: string): Card {
  return {
    id,
    pageId: "root",
    title: id,
    level: "standard",
    read: false,
    collapsed: false,
    revision: 1,
    blocks: [{ type: "paragraph", id: `b-${id}-1`, text: { standard }, citations: [] }],
    undoStack: [],
  };
}

function thread(id: string, agentText: string, open = true): Annotation {
  return {
    id,
    type: "thread",
    anchor: {
      host: { kind: "diff-line", fileKey: "a-py", line: 2 },
      quotedText: "y = 2",
      prefix: "",
      suffix: "",
      position: 2,
      version: 1,
    },
    open,
    messages: [
      { who: "you", text: "Why is y two?" },
      { who: "ai", text: agentText },
    ],
    post: false,
    note: false,
  };
}

interface Setup {
  app: Awaited<ReturnType<typeof createApp>>["app"];
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"];
  reviewId: string;
  svc: SharedContextService;
}

async function setupSharedCtx(
  agents?: FakeAgentRunner,
  opts: SetupOpts = {},
): Promise<Setup> {
  const { app, ctx } = await createApp("tok", {
    runner: new FakeCommandRunner(),
    ...(agents ? { agents: agents as unknown as never } : {}),
    autoPipeline: false,
  } as Parameters<typeof createApp>[1]);
  const repo = repoRow();
  (ctx.repos as { upsert: (r: unknown) => void }).upsert(repo);
  const reviewId = opts.reviewId ?? "rv_shared";
  const version = versionRow();
  const review: Review = {
    id: reviewId,
    repoId: repo.id,
    branch: "feature",
    prNumber: 7,
    versions: [version],
    currentVersion: 1,
    createdAt: 1,
  };
  const files = opts.files ?? [sourceFile()];
  const description = descriptionFor("First para.\n\nSecond para.\n");
  writeReviewRows(ctx.db, repo.id, { review, version, files, description, worktreePath: "/tmp" });
  const snapshot: ReviewSnapshot = {
    review,
    version,
    files,
    description,
    pages: opts.pages ?? [
      { id: "root", kind: "root", title: "Guide", saved: false, cards: [card("c-A", "Alpha body text."), card("c-B", "Beta body text.")] },
    ],
    annotations: opts.annotations ?? [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  };
  ctx.reviews.putSnapshot(reviewId, snapshot);
  const svc = new SharedContextService({
    reviews: ctx.reviews,
    sessions: ctx.sessions,
    settings: ctx.settings,
    store: new SharedContextStore(ctx.db),
    clock: new ManualClock(1_000_000),
    runConsolidate: async () => ({ kept: [], dropped: [] }),
    summarizeThreadSmall: async () => {
      throw new Error("no small model in this test");
    },
  });
  return { app, ctx, reviewId, svc };
}

async function appendEntries(
  setup: Setup,
  entries: { kind: string; payload: unknown; scope: LogEntry["scope"] }[],
): Promise<void> {
  for (const e of entries) {
    const added = await setup.svc.appendLog(setup.reviewId, e.kind, e.payload, e.scope);
    expect(added).not.toBeNull();
  }
}

describe("log taxonomy (PRD §9.3)", () => {
  it("never logs UI state", () => {
    for (const kind of ["read", "collapse", "depth-state", "open", "close", "mark-for-pr", "undo"] as const) {
      expect(logEntryForEvent({ kind, reviewId: "r", text: "x" }), kind).toBeNull();
    }
  });

  it("logs card-local kinds only with a card scope", () => {
    expect(logEntryForEvent({ kind: "example-added", reviewId: "r", text: "ex" })).toBeNull();
    const ex = logEntryForEvent({ kind: "example-added", reviewId: "r", cardId: "c-A", text: "ex" });
    expect(ex).toMatchObject({ kind: "example", scope: { scope: "card", cardId: "c-A" } });
    const dg = logEntryForEvent({ kind: "diagram-added", reviewId: "r", cardId: "c-A", text: "dg" });
    expect(dg).toMatchObject({ kind: "diagram", scope: { scope: "card", cardId: "c-A" } });
    const rw = logEntryForEvent({ kind: "depth-rewrite", reviewId: "r", cardId: "c-A", text: "rw" });
    expect(rw).toMatchObject({ kind: "depth-rewrite", scope: { scope: "card", cardId: "c-A" } });
  });

  it("logs settled threads as one global line, cards/findings/answers in full, deletions as one line", () => {
    const settled = logEntryForEvent({
      kind: "thread-settled",
      reviewId: "r",
      threadId: "ann_1",
      cardId: "c-A",
      text: "The thread concluded y is two.",
    });
    expect(settled).toMatchObject({ kind: "thread-summary", scope: { scope: "global" } });
    expect(logEntryForEvent({ kind: "new-card", reviewId: "r", cardId: "c-N", text: "full card body" })).toMatchObject({
      kind: "new-card",
      scope: { scope: "global" },
    });
    expect(
      logEntryForEvent({ kind: "new-finding", reviewId: "r", text: "full finding", citations: ["diff:a-py:2"] }),
    ).toMatchObject({ kind: "new-finding", scope: { scope: "global" } });
    expect(
      logEntryForEvent({ kind: "out-of-base-answer", reviewId: "r", text: "fetched code says…", sessionId: "s1" }),
    ).toMatchObject({ kind: "out-of-base-answer", scope: { scope: "global" } });
    expect(logEntryForEvent({ kind: "item-deleted", reviewId: "r", text: "card c-X deleted" })).toMatchObject({
      kind: "deletion",
      scope: { scope: "global" },
    });
  });
});

describe("change lists and the seen marker (PRD §9.3)", () => {
  it("filters global + own-card entries; the marker advances only on success", async () => {
    const setup = await setupSharedCtx();
    try {
      await appendEntries(setup, [
        { kind: "thread-summary", payload: { summary: "global one" }, scope: { scope: "global" } },
        { kind: "example", payload: { text: "ex A" }, scope: { scope: "card", cardId: "c-A" } },
        { kind: "diagram", payload: { text: "dg B" }, scope: { scope: "card", cardId: "c-B" } },
        { kind: "new-card", payload: { summary: "global two" }, scope: { scope: "global" } },
      ]);

      const forA = setup.svc.changeListFor(setup.reviewId, { conversationKey: "conv-A", cardId: "c-A" });
      expect(forA.entries.map((e) => e.seq)).toEqual([1, 2, 4]);
      expect(forA.text).toContain("global one");
      expect(forA.text).toContain("ex A");
      expect(forA.text).not.toContain("dg B");

      const forB = setup.svc.changeListFor(setup.reviewId, { conversationKey: "conv-B", cardId: "c-B" });
      expect(forB.entries.map((e) => e.seq)).toEqual([1, 3, 4]);

      // A successful turn advances the marker to the max seq…
      setup.svc.noteTurnSuccess(setup.reviewId, { conversationKey: "conv-A" });
      const again = setup.svc.changeListFor(setup.reviewId, { conversationKey: "conv-A", cardId: "c-A" });
      expect(again.entries).toEqual([]);

      // …while a failed turn (no noteTurnSuccess call) retries the same list.
      const failed = setup.svc.changeListFor(setup.reviewId, { conversationKey: "conv-B", cardId: "c-B" });
      expect(failed.entries.map((e) => e.seq)).toEqual([1, 3, 4]);
    } finally {
      await setup.app.close();
    }
  });

  it("runInFork advances the cursor and stores contributions on success, keeps both on failure", async () => {
    const ready = [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] as const;
    const forkReply =
      `## Answer\n\nBody with citation [[diff:a-py:1-2]].\n\n` +
      "```json\n" +
      JSON.stringify({ contribute: { facts: [{ text: "y equals two", citations: ["diff:a-py:2"] }] } }) +
      "\n```\n";
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: [...ready] },
      {
        match: "",
        events: [
          { type: "text", delta: forkReply },
          { type: "usage", inputTokens: 10, cachedTokens: 90, outputTokens: 5 },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    ]);
    const setup = await setupSharedCtx(agents);
    const explainVars = {
      anchor: { quote: "y = 2", block: "y = 2" },
      card: "Alpha body text.",
      thread: "(none)",
      message: "Why?",
    } as unknown as Record<string, string>;
    try {
      const res = await setup.ctx.pipeline.runInFork({
        reviewId: setup.reviewId,
        kind: "explain",
        template: "explain",
        variables: explainVars,
        priority: JOB_PRIORITY.userRequested,
        conversationKey: "conv-1",
        cardId: "c-A",
      });
      expect(res.text).toContain("Body with citation");
      // The first turn saw an empty change list…
      expect(agents.prompts[agents.prompts.length - 1].text).toContain("(no changes)");
      // #122: the answer resolves before post-turn bookkeeping; the
      // contributions land when the job settles.
      await setup.ctx.jobs.drain(5000);
      const snap = setup.ctx.reviews.getSnapshot(setup.reviewId)!;
      expect(snap.contributions.map((c) => c.id)).toEqual(["ct_1"]);
      expect(snap.contributions[0].sourceSession).toBeTruthy();
      expect(snap.logTail.some((e) => e.kind === "contribution")).toBe(true);
      // …and the cursor advanced past the turn's own entries: the next turn
      // is clean too.
      await setup.ctx.pipeline.runInFork({
        reviewId: setup.reviewId,
        kind: "explain",
        template: "explain",
        variables: explainVars,
        priority: JOB_PRIORITY.userRequested,
        conversationKey: "conv-1",
        cardId: "c-A",
      });
      await setup.ctx.jobs.drain(5000);
      const lastPrompt = agents.prompts[agents.prompts.length - 1].text;
      expect(lastPrompt).toContain("(no changes)");
      // The repeated fact is a duplicate: no second contribution.
      expect(setup.ctx.reviews.getSnapshot(setup.reviewId)!.contributions.map((c) => c.id)).toEqual([
        "ct_1",
      ]);
    } finally {
      await setup.app.close();
    }
  });

  it("runInFork failure stores nothing and advances nothing", async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
      { match: "", events: [{ type: "error", message: "boom", retryable: false }] },
    ]);
    const setup = await setupSharedCtx(agents);
    try {
      await expect(
        setup.ctx.pipeline.runInFork({
          reviewId: setup.reviewId,
          kind: "go-deeper",
          template: "go_deeper",
          variables: { direction: "flow" },
          priority: JOB_PRIORITY.userRequested,
          conversationKey: "conv-F",
          cardId: "c-A",
        }),
      ).rejects.toThrow(/boom/);
      const snap = setup.ctx.reviews.getSnapshot(setup.reviewId)!;
      expect(snap.contributions).toEqual([]);
      expect(snap.logTail).toEqual([]);
    } finally {
      await setup.app.close();
    }
  });
});

describe("batch append vs change list: forks before/after a batch", () => {
  it("no duplicates, nothing missed", async () => {
    const agents = new FakeAgentRunner([
      { match: "BASE PACK", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
      { match: "", events: [{ type: "done", stopReason: "end_turn" }] },
    ]);
    const mgr = new SessionManager({ runner: agents, clock: new ManualClock(1000) });
    const key = { reviewId: "r1", reviewVersion: "v1", guideRevision: "g1", provider: "p", model: "m" };
    const base = await mgr.getBase({ key, cwd: "/r", systemPrompt: "s", mcpServers: [], pack: "BASE PACK" });

    const forkBefore = await mgr.forkConversation(base.key, "hello");
    expect(mgr.lastSeen(forkBefore.session.id)).toBe(0);

    await mgr.appendLogBatch(base.key, { seq: 5, text: "LOG BATCH seq 1-5" });
    const forkAfter = await mgr.forkConversation(base.key, "hello");
    expect(mgr.lastSeen(forkAfter.session.id)).toBe(5);

    const log: LogEntry[] = [
      { seq: 1, kind: "thread-summary", payload: { summary: "pre-batch global" }, scope: { scope: "global" } },
      { seq: 2, kind: "example", payload: { text: "pre-batch local X" }, scope: { scope: "card", cardId: "c-X" } },
      { seq: 3, kind: "new-card", payload: { summary: "pre-batch global 2" }, scope: { scope: "global" } },
      { seq: 4, kind: "diagram", payload: { text: "pre-batch local Y" }, scope: { scope: "card", cardId: "c-Y" } },
      { seq: 5, kind: "new-finding", payload: { summary: "batched global" }, scope: { scope: "global" } },
      { seq: 6, kind: "thread-summary", payload: { summary: "post-batch global" }, scope: { scope: "global" } },
    ];
    const listBefore = filterChangeList(log, {
      lastSeenSeq: mgr.lastSeen(forkBefore.session.id),
      cardId: "c-X",
    });
    const listAfter = filterChangeList(log, {
      lastSeenSeq: mgr.lastSeen(forkAfter.session.id),
      cardId: "c-X",
    });
    // The early fork gets the batch through its change list…
    expect(listBefore.map((e) => e.seq)).toEqual([1, 2, 3, 5, 6]);
    // …the late fork starts past it: no duplicates…
    expect(listAfter.map((e) => e.seq)).toEqual([6]);
    // …and together they miss nothing visible to this card.
    const visible = filterChangeList(log, { lastSeenSeq: 0, cardId: "c-X" }).map((e) => e.seq);
    expect([...new Set([...listBefore, ...listAfter].map((e) => e.seq))].sort((a, b) => a - b)).toEqual(visible);
    expect(listAfter.every((e) => e.seq > 5)).toBe(true);
  });

  it("planGrowth holds under-threshold tails and releases full batches", () => {
    const log: LogEntry[] = [
      { seq: 1, kind: "thread-summary", payload: { summary: "a".repeat(200) }, scope: { scope: "global" } },
      { seq: 2, kind: "thread-summary", payload: { summary: "b".repeat(200) }, scope: { scope: "global" } },
      { seq: 3, kind: "thread-summary", payload: { summary: "c" }, scope: { scope: "global" } },
    ];
    const tiny = planGrowth(log, 0, { batchTokens: 10_000 });
    expect(tiny.batches).toEqual([]);
    expect(tiny.pending.map((e) => e.seq)).toEqual([1, 2, 3]);
    const small = planGrowth(log, 0, { batchTokens: 30 });
    expect(small.batches.flat().map((e) => e.seq)).toEqual([1, 2]);
    expect(small.pending.map((e) => e.seq)).toEqual([3]);
    const resumed = planGrowth(log, 2, { batchTokens: 30 });
    expect(resumed.batches).toEqual([]);
    expect(resumed.pending.map((e) => e.seq)).toEqual([3]);
  });
});

describe("rebuild triggers (PRD §9.4)", () => {
  const base = {
    baseVersion: 1,
    baseGuideRevision: "g1",
    baseTokens: 10_000,
    appendedTokens: 0,
    supersededTokens: 0,
    baseLastUsedAt: 1000,
    now: 2000,
    cacheLifetimeMs: 300_000,
    currentVersion: 1,
    currentGuideRevision: "g1",
    thresholds: { rebuildSupersededRatio: 0.2, rebuildAppendedTokens: 10_000 },
  };

  it("stays cold; fires per trigger", () => {
    expect(planRebuild(base).rebuild).toBe(false);
    expect(planRebuild({ ...base, currentVersion: 2 }).reasons).toContain("new-version");
    expect(planRebuild({ ...base, currentGuideRevision: "g2" }).reasons).toContain("guide-regenerated");
    expect(planRebuild({ ...base, baseLastUsedAt: 0, now: 400_000 }).reasons).toContain("cache-expired");
    expect(planRebuild({ ...base, supersededTokens: 2001 }).reasons).toContain("superseded-ratio");
    expect(planRebuild({ ...base, appendedTokens: 10_001 }).reasons).toContain("appended-tokens");
  });

  it("uses strict greater-than on size thresholds; cache expiry on the lifetime", () => {
    expect(planRebuild({ ...base, supersededTokens: 2000 }).rebuild).toBe(false);
    expect(planRebuild({ ...base, appendedTokens: 10_000 }).rebuild).toBe(false);
    expect(planRebuild({ ...base, baseLastUsedAt: 0, now: 299_999 }).rebuild).toBe(false);
    expect(planRebuild({ ...base, baseLastUsedAt: 0, now: 300_000 }).reasons).toContain("cache-expired");
  });

  it("consolidation merges in ID order and ignores unknown ids", () => {
    const existing: Contribution[] = [
      { id: "ct_2", sourceSession: "s", items: [{ kind: "fact", text: "b", citations: [] }], status: "pending" },
      { id: "ct_1", sourceSession: "s", items: [{ kind: "fact", text: "a", citations: [] }], status: "pending" },
      { id: "ct_3", sourceSession: "s", items: [{ kind: "fact", text: "c", citations: [] }], status: "pending" },
    ];
    const { merged, droppedIds } = applyConsolidation(existing, {
      kept: [{ id: "ct_2" }, { id: "ct_1" }],
      dropped: [
        { id: "ct_3", why: "duplicate of ct_1" },
        { id: "ct_nope", why: "unknown" },
      ],
    });
    expect(merged.map((c) => c.id)).toEqual(["ct_1", "ct_2"]);
    expect(droppedIds).toEqual(["ct_3"]);
  });

  it("maybeRebuildBase consolidates, rebuilds, and prunes (new-version trigger)", async () => {
    const setup = await setupSharedCtx();
    try {
      await setup.ctx.reviews.mutate(setup.reviewId, (draft) => {
        draft.contributions = [
          { id: "ct_1", sourceSession: "s", items: [{ kind: "fact", text: "keep", citations: [] }], status: "pending" },
          { id: "ct_2", sourceSession: "s", items: [{ kind: "fact", text: "drop", citations: [] }], status: "pending" },
        ];
      });
      const svc = new SharedContextService({
        reviews: setup.ctx.reviews,
        sessions: setup.ctx.sessions,
        settings: setup.ctx.settings,
        store: new SharedContextStore(setup.ctx.db),
        clock: new ManualClock(1_000_000),
        runConsolidate: async () => ({ kept: [{ id: "ct_1" }], dropped: [{ id: "ct_2", why: "duplicate" }] }),
      });
      const settings = setup.ctx.settings.get();
      const guideRev = guideRevisionForSnapshot(setup.ctx.reviews.getSnapshot(setup.reviewId)!);
      const staleKey = `${setup.reviewId}|v0|${guideRev}|${settings.main.provider}|${settings.main.model}`;
      let rebuiltKey = "";
      const res = await svc.maybeRebuildBase(setup.reviewId, {
        baseKey: staleKey,
        onRebuild: async (reasons) => {
          expect(reasons).toContain("new-version");
          rebuiltKey = `${setup.reviewId}|v1|${guideRev}|${settings.main.provider}|${settings.main.model}`;
          return { newBaseKey: rebuiltKey, newBaseTokens: 1234 };
        },
        pruneBases: (reviewId, keep) => setup.ctx.sessions.pruneBases(reviewId, keep),
      });
      expect(res.rebuilt).toBe(true);
      expect(rebuiltKey).not.toBe("");
      const snap = setup.ctx.reviews.getSnapshot(setup.reviewId)!;
      expect(snap.contributions.map((c) => c.id)).toEqual(["ct_1"]);
      expect(snap.logTail.some((e) => e.kind === "update-note")).toBe(true);
      const stats = svc.statsForReview(setup.reviewId);
      expect(stats.find((s) => s.baseKey === rebuiltKey)).toMatchObject({
        baseTokens: 1234,
        appendedTokens: 0,
        supersededRatio: 0,
        lastRebuildReason: expect.stringContaining("new-version"),
      });
    } finally {
      await setup.app.close();
    }
  });
});

describe("contributions (PRD §9.5)", () => {
  function lookupFor(setup: Setup) {
    const snap = setup.ctx.reviews.getSnapshot(setup.reviewId)!;
    return createSnapshotLookup(snap);
  }

  it("validates citations, dedupes, honours replaces, and caps at 3", async () => {
    const setup = await setupSharedCtx();
    try {
      const lookup = lookupFor(setup);
      const existing: Contribution[] = [
        {
          id: "ct_1",
          sourceSession: "old",
          items: [{ kind: "fact", text: "y equals two", citations: [{ target: "diff:a-py:2" }] }],
          status: "pending",
        },
      ];
      const out = processContribute(
        {
          reviewId: setup.reviewId,
          sessionId: "sess-1",
          threadId: "ann_1",
          contribute: {
            facts: [
              { text: "y equals two", citations: ["diff:a-py:2"] },
              { text: "uncited claim", citations: [] },
              { text: "off-hunk claim", citations: ["diff:a-py:99"] },
              { text: "z follows y", citations: ["diff:a-py:3"] },
              { text: "x starts it", citations: ["diff:a-py:1"] },
              { text: "extra one", citations: ["diff:a-py:2"] },
              { text: "extra two", citations: ["diff:a-py:2"] },
            ],
            corrections: [{ text: "fix the title", target: "card:c-A#b-c-A-1" }],
            open_questions: ["Is y tested?"],
            replaces: "ct_1",
          },
          contextText: "Alpha body text.",
          existing,
          nextId: "ct_2",
        },
        lookup,
      );
      // Duplicate of ct_1, uncited fact, and off-hunk fact are dropped…
      expect(out.dropped.map((d) => d.text)).toContain("y equals two");
      expect(out.dropped.map((d) => d.text)).toContain("uncited claim");
      expect(out.dropped.map((d) => d.text)).toContain("off-hunk claim");
      // …three items kept (cap), the rest dropped as over-limit…
      expect(out.kept).toHaveLength(1);
      expect(out.kept[0].items).toHaveLength(3);
      expect(out.dropped.some((d) => d.why.includes("per-turn limit"))).toBe(true);
      // …replaces retires ct_1, and the log entry names its source.
      expect(out.supersededIds).toEqual(["ct_1"]);
      expect(out.logEntries).toHaveLength(1);
      expect(out.logEntries[0].payload).toMatchObject({ sourceSession: "sess-1", sourceThread: "ann_1" });
      expect(out.kept[0]).toMatchObject({ id: "ct_2", sourceSession: "sess-1", sourceThread: "ann_1" });
    } finally {
      await setup.app.close();
    }
  });

  it("drops replaces pointing at unknown ids and corrections without targets", async () => {
    const setup = await setupSharedCtx();
    try {
      const out = processContribute(
        {
          reviewId: setup.reviewId,
          sessionId: "s",
          contribute: {
            corrections: [{ text: "vague fix" }],
            replaces: "ct_nope",
          },
          contextText: "",
          existing: [],
          nextId: "ct_1",
        },
        lookupFor(setup),
      );
      expect(out.kept).toEqual([]);
      expect(out.supersededIds).toEqual([]);
      expect(out.dropped.map((d) => d.why)).toContain("correction without a card:<id>#<block> target");
      expect(out.dropped.map((d) => d.why)).toContain("replaces an unknown contribution id");
    } finally {
      await setup.app.close();
    }
  });

  it("thread settling: closed settles at once; open settles after idle; summaries fall back to the first line", async () => {
    const open = thread("t-open", "First line here.\nSecond line.", true);
    const closed = thread("t-closed", "Done deal.", false);
    expect(isThreadSettled(toThreadSnapshot(closed, 1000), 1000)).toBe(true);
    expect(isThreadSettled(toThreadSnapshot(open, 1000), 1000 + 60_000)).toBe(false);
    expect(isThreadSettled(toThreadSnapshot(open, 1000), 1000 + 5 * 60_000)).toBe(true);
    // No agent reply yet: never settles by idle.
    const waiting = { ...toThreadSnapshot(open, 1000), messages: [{ who: "you" as const, text: "hello?" }] };
    expect(isThreadSettled(waiting, 1000 + 60 * 60_000)).toBe(false);
    await expect(summarizeSettledThread(toThreadSnapshot(open, 1000))).resolves.toBe("First line here.");
  });
});

describe("corrections accept/dismiss + deletion entry (PRD §9.5, §9.3)", () => {
  async function setupWithCorrection(): Promise<Setup> {
    const setup = await setupSharedCtx(undefined, {
      pages: [
        {
          id: "root",
          kind: "root",
          title: "Guide",
          saved: false,
          cards: [card("c-central", "Central body text.")],
        },
      ],
    });
    await setup.ctx.reviews.mutate(setup.reviewId, (draft) => {
      draft.contributions = [
        {
          id: "ct_corr",
          sourceSession: "sess-critic",
          sourceThread: "ann_9",
          items: [
            { kind: "correction", text: "The scope is narrower.", target: "card:c-central#b-c-central-1", citations: [] },
          ],
          status: "pending",
        },
      ];
    });
    return setup;
  }

  it("accept creates a new undoable revision; second accept conflicts", async () => {
    const setup = await setupWithCorrection();
    try {
      const before = setup.ctx.reviews.getSnapshot(setup.reviewId)!;
      const beforeBlocks = before.pages[0].cards[0].blocks.length;
      const res = await setup.app.inject({
        method: "POST",
        url: `/api/reviews/${setup.reviewId}/contributions/ct_corr/accept`,
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true, acceptedId: "ct_corr", cardId: "c-central", revision: 2 });
      const after = setup.ctx.reviews.getSnapshot(setup.reviewId)!;
      const cardAfter = after.pages[0].cards[0];
      expect(cardAfter.revision).toBe(2);
      expect(cardAfter.blocks.length).toBe(beforeBlocks + 1);
      expect(cardAfter.undoStack).toHaveLength(1);
      expect(after.contributions[0].status).toBe("accepted");

      const again = await setup.app.inject({
        method: "POST",
        url: `/api/reviews/${setup.reviewId}/contributions/ct_corr/accept`,
        headers: authed,
      });
      expect(again.statusCode).toBe(409);
    } finally {
      await setup.app.close();
    }
  });

  it("dismiss discards; unknown ids 404", async () => {
    const setup = await setupWithCorrection();
    try {
      const res = await setup.app.inject({
        method: "POST",
        url: `/api/reviews/${setup.reviewId}/contributions/ct_corr/dismiss`,
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, dismissedId: "ct_corr" });
      expect(setup.ctx.reviews.getSnapshot(setup.reviewId)!.contributions[0].status).toBe("dismissed");
      // No card change on dismiss.
      expect(setup.ctx.reviews.getSnapshot(setup.reviewId)!.pages[0].cards[0].revision).toBe(1);

      const unknown = await setup.app.inject({
        method: "POST",
        url: `/api/reviews/${setup.reviewId}/contributions/ct_nope/dismiss`,
        headers: authed,
      });
      expect(unknown.statusCode).toBe(404);
      const unknownReview = await setup.app.inject({
        method: "POST",
        url: `/api/reviews/nope/contributions/ct_corr/accept`,
        headers: authed,
      });
      expect(unknownReview.statusCode).toBe(404);
    } finally {
      await setup.app.close();
    }
  });

  it("DELETE keeps its contract and writes the one-line deletion entry", async () => {
    const setup = await setupWithCorrection();
    try {
      const list = await setup.app.inject({
        method: "GET",
        url: `/api/reviews/${setup.reviewId}/contributions`,
        headers: authed,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().contributions.map((c: Contribution) => c.id)).toEqual(["ct_corr"]);

      const del = await setup.app.inject({
        method: "DELETE",
        url: `/api/reviews/${setup.reviewId}/contributions/ct_corr`,
        headers: authed,
      });
      expect(del.statusCode).toBe(200);
      expect(del.json()).toEqual({ ok: true, deletedId: "ct_corr" });
      const snap = setup.ctx.reviews.getSnapshot(setup.reviewId)!;
      expect(snap.contributions).toEqual([]);
      const last = snap.logTail[snap.logTail.length - 1];
      expect(last.kind).toBe("deletion");
      expect(JSON.stringify(last.payload)).toContain("ct_corr");
    } finally {
      await setup.app.close();
    }
  });
});

describe("base growth observability (PRD §4.14, §9.3)", () => {
  it("maybeGrowBase appends ready batches as turns and observes stats", async () => {
    const agents = new FakeAgentRunner([
      { match: "BASE PACK", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
      { match: "", events: [{ type: "done", stopReason: "end_turn" }] },
    ]);
    const setup = await setupSharedCtx(agents);
    try {
      const settings = setup.ctx.settings.get();
      const guideRev = guideRevisionForSnapshot(setup.ctx.reviews.getSnapshot(setup.reviewId)!);
      const baseKey = `${setup.reviewId}|v1|${guideRev}|${settings.main.provider}|${settings.main.model}`;
      await setup.ctx.sessions.getBase({
        key: {
          reviewId: setup.reviewId,
          reviewVersion: "v1",
          guideRevision: guideRev,
          provider: settings.main.provider,
          model: settings.main.model,
        },
        cwd: "/tmp",
        systemPrompt: "s",
        mcpServers: [],
        pack: "BASE PACK (test)",
      });
      setup.svc.noteBaseBuilt(setup.reviewId, baseKey, 500);
      await appendEntries(setup, [
        { kind: "thread-summary", payload: { summary: "one" }, scope: { scope: "global" } },
        { kind: "thread-summary", payload: { summary: "two" }, scope: { scope: "global" } },
        { kind: "thread-summary", payload: { summary: "three" }, scope: { scope: "global" } },
      ]);
      const updated = setup.ctx.settings.update({ logBatchTokens: 5 });
      expect(updated.errors ?? []).toEqual([]);
      try {
        const grown = await setup.svc.maybeGrowBase(setup.reviewId, (k, b) =>
          setup.ctx.sessions.appendLogBatch(k, b),
        );
        expect(grown.appended).toBeGreaterThan(0);
      } finally {
        setup.ctx.settings.update({ logBatchTokens: 2000 });
      }
      expect(setup.ctx.sessions.baseInfo(baseKey)?.logSeq).toBeGreaterThan(0);
      const stats = setup.svc.statsForReview(setup.reviewId);
      const row = stats.find((s) => s.baseKey === baseKey)!;
      expect(row.baseTokens).toBe(500);
      expect(row.appendedTokens).toBeGreaterThan(0);
      expect(row.supersededRatio).toBe(0);
      expect(row.lastRebuildReason).toBeNull();

      const doc = await setup.app.inject({
        method: "GET",
        url: `/api/reviews/${setup.reviewId}/shared-context`,
        headers: authed,
      });
      expect(doc.statusCode).toBe(200);
      expect(doc.json().base).toContain(baseKey);
      expect(doc.json().base).toContain("base tokens: 500");
    } finally {
      await setup.app.close();
    }
  });

  it("prompts Expanded view shows the real L3 for the review", async () => {
    const setup = await setupSharedCtx();
    try {
      await appendEntries(setup, [
        { kind: "thread-summary", payload: { summary: "REAL-L3-PROBE settled topic" }, scope: { scope: "global" } },
      ]);
      const res = await setup.app.inject({
        method: "GET",
        url: `/api/prompts?review=${setup.reviewId}`,
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
      const expanded = (res.json() as { expanded: { name: string; expanded: string }[] }).expanded;
      const explain = expanded.find((e) => e.name === "explain")!;
      expect(explain.expanded).toContain("REAL-L3-PROBE settled topic");
    } finally {
      await setup.app.close();
    }
  });
});

describe("isolation (PRD §12)", () => {
  const probes = [
    { label: "guide", text: "GUIDE-PROBE central prose must not leak" },
    { label: "finding", text: "FINDING-PROBE linear-time claim" },
    { label: "contribution", text: "CONTRIBUTION-PROBE reads the original message" },
    { label: "log", text: "LOG-PROBE settled-thread summary line" },
    { label: "uncited pin", text: "UNCITED-PIN-PROBE secret helper body" },
  ];

  it("second-opinion contexts never include L2, L3, contributions or uncited pins", () => {
    const text = buildIsolatedSecondOpinionPrompt({
      instructions: "L0 instructions",
      sourceText: "L1 source",
      codeExcerpts: [
        { id: "code:a.py:1-2@s", text: "CITED-CODE-PROBE normalized = True" },
        { id: "code:b.py:9-9@s", text: "UNCITED-PIN-PROBE secret helper body" },
      ],
      citedIds: ["code:a.py:1-2@s"],
    });
    expect(text).toContain("CITED-CODE-PROBE");
    // The guard passes on the isolated text…
    expect(() => assertSecondOpinionIsolated(text, probes)).not.toThrow();
    // …and fails when log/contribution text is present (the test can fail).
    expect(() =>
      assertSecondOpinionIsolated(`${text}\nLOG-PROBE settled-thread summary line`, probes),
    ).toThrow(/leaks log/);
    expect(() =>
      assertSecondOpinionIsolated(`${text}\nCONTRIBUTION-PROBE reads the original message`, probes),
    ).toThrow(/leaks contribution/);
  });

  it("expanded second-opinion prompts carry no L2/L3/contribution text", () => {
    const lib = loadTemplatesDirSync(REPO_PROMPTS);
    const snap = toPromptSnapshot({
      review: { id: "r", repoId: "rp", branch: "b", versions: [], currentVersion: 1, createdAt: 1 },
      version: { n: 1, headSha: "a".repeat(40), mergeBaseSha: "b".repeat(40), baseRef: "main", fetchedAt: 1, idMapping: {} },
      files: [],
      pages: [
        {
          id: "root",
          kind: "root",
          title: "Guide",
          saved: false,
          cards: [
            {
              id: "c1",
              pageId: "root",
              title: "T",
              level: "standard",
              read: false,
              collapsed: false,
              revision: 1,
              blocks: [
                {
                  type: "paragraph",
                  id: "b1",
                  text: { standard: "GUIDE-PROBE central prose must not leak" },
                  citations: [],
                },
              ],
              undoStack: [],
            },
          ],
        },
      ],
      annotations: [],
      hunkStates: [],
      jobs: [],
      contributions: [
        {
          id: "ct_1",
          sourceSession: "s",
          items: [{ kind: "fact", text: "CONTRIBUTION-PROBE reads the original message", citations: [] }],
          status: "pending",
        },
      ],
      logTail: [{ seq: 1, kind: "thread-summary", payload: { summary: "LOG-PROBE settled-thread summary line" }, scope: { scope: "global" } }],
      rev: 1,
    });
    const expanded = expandAll(lib, snap);
    for (const name of ["second_opinion_blind", "second_opinion_check"]) {
      const prompt = expanded.find((e) => e.name === name)!.expanded;
      expect(() => assertSecondOpinionIsolated(prompt, probes), name).not.toThrow();
    }
    // Sanity: the probes do exist elsewhere (L2/L3), so the test is not vacuous.
    const base = expanded.find((e) => e.name === "base_pack")!.expanded;
    expect(base).toContain("GUIDE-PROBE");
  });

  it("small-model prompts carry only their task", async () => {
    const setup = await setupSharedCtx(new FakeAgentRunner());
    try {
      await setup.ctx.reviews.mutate(setup.reviewId, (draft) => {
        draft.pages[0].cards[0].blocks = [
          {
            type: "paragraph",
            id: "b-g",
            text: { standard: "GUIDE-PROBE central prose must not leak" },
            citations: [],
          },
        ];
        draft.contributions = [
          {
            id: "ct_1",
            sourceSession: "s",
            items: [{ kind: "fact", text: "CONTRIBUTION-PROBE reads the original message", citations: [] }],
            status: "pending",
          },
        ];
        draft.logTail.push({
          seq: 1,
          kind: "thread-summary",
          payload: { summary: "LOG-PROBE settled-thread summary line" },
          scope: { scope: "global" },
        });
      });
      const agents = setup.ctx.agents as unknown as FakeAgentRunner;
      const before = agents.prompts.length;
      await setup.ctx.pipeline.runSmall({
        reviewId: setup.reviewId,
        kind: "hunk-pass",
        template: "hunk_pass",
        variables: { hunk: "### [[h:a-py:h1]] a.py\n@@ -1,3 +1,4 @@\n x", path: "a.py" },
        priority: JOB_PRIORITY.background,
      });
      const sent = agents.prompts.slice(before).map((p) => p.text).join("\n");
      expect(() =>
        assertSmallPromptIsolated(sent, probes.filter((p) => p.label !== "finding")),
      ).not.toThrow();
    } finally {
      await setup.app.close();
    }
  });
});

describe("end-to-end demo review (replay): settled summaries are global, card-local stays local", () => {
  it("two conversations on different cards share summaries but not locals", async () => {
    const replay = new ReplayAgentRunner({ fixturesDir: FIXTURES, chunkChars: 256, delayMs: 0 });
    const { app, ctx } = await createApp("tok", { agents: replay as unknown as never });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;

      // Wait for the reader: root cards exist, then stop waiting (the rest
      // of the pipeline may keep running in the background).
      const start = Date.now();
      for (;;) {
        const s = ctx.reviews.getSnapshot(id);
        const root = s?.pages.find((p) => p.id === "root");
        if (root && root.cards.length >= 2) break;
        if (Date.now() - start > 60_000) throw new Error("demo reader timed out");
        await new Promise((r) => setTimeout(r, 50));
      }
      const snap = ctx.reviews.getSnapshot(id)!;
      const [cardA, cardB] = snap.pages.find((p) => p.id === "root")!.cards;
      expect(cardA.id).not.toBe(cardB.id);

      // Two settled threads (closed ⇒ settled at once), one per card topic.
      const tA = `ann_e2e_a`;
      const tB = `ann_e2e_b`;
      await ctx.reviews.mutate(id, (draft) => {
        const firstFile = draft.files[0];
        const line = firstFile.hunks[0].lines.find((l) => l.newLine !== undefined)?.newLine ?? 1;
        draft.annotations.push(
          {
            id: tA,
            type: "thread",
            anchor: { host: { kind: "diff-line", fileKey: firstFile.fileKey, line }, quotedText: "q", prefix: "", suffix: "", position: line, version: 1 },
            open: false,
            messages: [
              { who: "you", text: "What about A?" },
              { who: "ai", text: "SETTLED-A-SUMMARY the A thread concluded first." },
            ],
            post: false,
            note: false,
          },
          {
            id: tB,
            type: "thread",
            anchor: { host: { kind: "diff-line", fileKey: firstFile.fileKey, line }, quotedText: "q", prefix: "", suffix: "", position: line, version: 1 },
            open: false,
            messages: [
              { who: "you", text: "What about B?" },
              { who: "ai", text: "SETTLED-B-SUMMARY the B thread concluded second." },
            ],
            post: false,
            note: false,
          },
        );
      });
      const settledA = await ctx.sharedctx.maybeSettleThread(id, tA);
      const settledB = await ctx.sharedctx.maybeSettleThread(id, tB);
      expect(settledA.settled).toBe(true);
      expect(settledB.settled).toBe(true);

      // Card-local entries, one per card, through the interaction hook
      // (buildApp already routes it to this review's shared-context service).
      await recordInteraction({ kind: "example-added", reviewId: id, cardId: cardA.id, text: "LOCAL-EXAMPLE-A only for A" });
      await recordInteraction({ kind: "diagram-added", reviewId: id, cardId: cardB.id, text: "LOCAL-DIAGRAM-B only for B" });

      const convA = ctx.sharedctx.changeListFor(id, { conversationKey: "e2e-A", cardId: cardA.id });
      const convB = ctx.sharedctx.changeListFor(id, { conversationKey: "e2e-B", cardId: cardB.id });
      // Each sees both settled-thread summaries (global)…
      expect(convA.text).toContain("SETTLED-A-SUMMARY");
      expect(convA.text).toContain("SETTLED-B-SUMMARY");
      expect(convB.text).toContain("SETTLED-A-SUMMARY");
      expect(convB.text).toContain("SETTLED-B-SUMMARY");
      // …but only its own card's local entries.
      expect(convA.text).toContain("LOCAL-EXAMPLE-A");
      expect(convA.text).not.toContain("LOCAL-DIAGRAM-B");
      expect(convB.text).toContain("LOCAL-DIAGRAM-B");
      expect(convB.text).not.toContain("LOCAL-EXAMPLE-A");
    } finally {
      await app.close();
    }
  }, 90000);
});
