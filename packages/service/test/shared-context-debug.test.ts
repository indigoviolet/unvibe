/**
 * Per-review shared-context debug endpoint (issue #32, PRD §9).
 *
 * `GET /api/reviews/:id/shared-context` renders the three parts as
 * Markdown: base (keys + stats + current pack fenced), log (every entry in
 * order with in-base/waiting markers via the existing formatters), and
 * contributions (thread fallback, replaces, status only where meaningful).
 * Fake command runner; no real agents or network.
 */
import { describe, expect, it } from "vitest";
import type { Contribution, LogEntry } from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/index.js";
import { guideRevisionForSnapshot } from "../src/routes/prompts.js";
import {
  buildContributionsMarkdown,
  buildLogMarkdown,
  fence,
  parseBaseKey,
  showContributionStatus,
} from "../src/sharedctx/debug.js";
import { setupReview } from "./m6-helpers.js";

const auth = { authorization: "Bearer tok" };

const LOG: LogEntry[] = [
  { seq: 1, kind: "new-card", payload: { summary: "central card written" }, scope: { scope: "global" } },
  { seq: 2, kind: "thread-summary", payload: { summary: "ask about retry settled" }, scope: { scope: "global" } },
  { seq: 3, kind: "depth-rewrite", payload: { summary: "central made simpler" }, scope: { scope: "card", cardId: "c-central" } },
];

const CONTRIBUTIONS: Contribution[] = [
  {
    id: "ct_fact",
    sourceSession: "sess-reader-1",
    items: [{ kind: "fact", text: "Retry uses exponential backoff.", citations: [{ target: "diff:a-py:2" }] }],
    status: "pending",
  },
  {
    id: "ct_corr",
    sourceSession: "sess-critic-9",
    sourceThread: "t-ask-1",
    replaces: "ct_old",
    items: [
      { kind: "correction", text: "The central card overstates the scope.", target: "card:c-central#b-rule", citations: [] },
      { kind: "open_question", text: "Is the helper covered by tests?", citations: [] },
    ],
    status: "pending",
  },
  {
    id: "ct_merged",
    sourceSession: "sess-reader-2",
    items: [{ kind: "reader_note", text: "The regex section was hard to follow.", citations: [] }],
    status: "merged",
  },
];

describe("GET /api/reviews/:id/shared-context", () => {
  it("404s for an unknown review", async () => {
    const { app } = await setupReview(new FakeCommandRunner());
    try {
      const res = await app.inject({ method: "GET", url: "/api/reviews/nope/shared-context", headers: auth });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("empty review: no-base note plus the pack that would be sent, empty log/contributions", async () => {
    const { app, reviewId } = await setupReview(new FakeCommandRunner());
    try {
      const res = await app.inject({ method: "GET", url: `/api/reviews/${reviewId}/shared-context`, headers: auth });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { reviewId: string; base: string; log: string; contributions: string };
      expect(body.reviewId).toBe(reviewId);
      // No base yet, but the pack that would be sent is still shown.
      expect(body.base).toContain("No base has been built yet");
      expect(body.base).toContain("## Pinned code");
      expect(body.base).toContain("a.py");
      expect(body.log).toContain("(log is empty)");
      expect(body.contributions).toContain("(no contributions yet)");
    } finally {
      await app.close();
    }
  });

  it("shows base stats, log markers, and contributions with the status rule", async () => {
    const { app, ctx, reviewId } = await setupReview(new FakeCommandRunner());
    try {
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.logTail = [...LOG];
        draft.contributions = [...CONTRIBUTIONS];
      });
      const snap = ctx.reviews.getSnapshot(reviewId)!;
      const key = `${reviewId}|v${snap.version.n}|${guideRevisionForSnapshot(snap)}|claude|claude-sonnet`;
      ctx.sharedctx.noteBaseBuilt(reviewId, key, 1234);

      const res = await app.inject({ method: "GET", url: `/api/reviews/${reviewId}/shared-context`, headers: auth });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { base: string; log: string; contributions: string };

      // Base: key parts + stats, then the fenced pack.
      expect(body.base).toContain(key);
      expect(body.base).toContain("provider/model: `claude/claude-sonnet`");
      expect(body.base).toContain("base tokens: 1234");
      expect(body.base).toContain("L1 + L1b + L2");

      // Log: every entry in order with seq/kind/scope, still waiting (no live base).
      expect(body.log).toContain("[1 new-card global]");
      expect(body.log).toContain("[2 thread-summary global]");
      expect(body.log).toContain("[3 depth-rewrite card:c-central]");
      expect(body.log).toContain("waiting for batch");

      // Contributions: thread fallback vs sourceThread, replaces, status rule.
      expect(body.contributions).toContain("### ct_fact");
      expect(body.contributions).toContain("session: `sess-reader-1`");
      expect(body.contributions).toContain("### ct_corr");
      expect(body.contributions).toContain("thread: `t-ask-1`");
      expect(body.contributions).toContain("replaces: `ct_old`");
      expect(body.contributions).toContain("card:c-central#b-rule");
      expect(body.contributions).toContain("cites: `diff:a-py:2`");
      // Plain pending fact: no status line; correction and merged keep theirs.
      const factBlock = body.contributions.split("### ct_fact")[1].split("### ct_corr")[0];
      expect(factBlock).not.toContain("status:");
      expect(body.contributions).toContain("status: pending");
      expect(body.contributions).toContain("status: merged");
    } finally {
      await app.close();
    }
  });

  it("debug base pack renders pinned code in L1b (#37)", async () => {
    const { app, ctx, reviewId } = await setupReview(new FakeCommandRunner());
    try {
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.pinnedCode = [
          { path: "a.py", start: 1, end: 2, sha: "a".repeat(40), text: "PIN-PROBE-37 y = 2", language: "python" },
        ];
      });
      const res = await app.inject({ method: "GET", url: `/api/reviews/${reviewId}/shared-context`, headers: auth });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { base: string };
      expect(body.base).toContain("PIN-PROBE-37");
      expect(body.base).toContain("code:a.py:1-2@");
    } finally {
      await app.close();
    }
  });
});

describe("debug markdown builders", () => {
  it("parseBaseKey splits review|version|guide|provider|model", () => {
    expect(parseBaseKey("rv_1|v2|guide-abc123|codex|gpt-5.4")).toEqual({
      version: "v2",
      guideRevision: "guide-abc123",
      provider: "codex",
      model: "gpt-5.4",
    });
  });

  it("fence grows past inner fenced blocks", () => {
    const inner = "## Pinned code\n\n```python\nx = 1\n```\n";
    const fenced = fence(inner);
    expect(fenced.startsWith("````text")).toBe(true);
    expect(fenced).toContain(inner);
    expect(fenced.endsWith("````")).toBe(true);
  });

  it("log markers distinguish in-base, ready, and waiting entries", () => {
    const log: LogEntry[] = [
      { seq: 1, kind: "new-card", payload: { summary: "a" }, scope: { scope: "global" } },
      { seq: 2, kind: "new-card", payload: { summary: "b" }, scope: { scope: "global" } },
    ];
    // Nothing appended yet and a huge threshold: everything waits.
    const waiting = buildLogMarkdown({ log, appendedThroughSeq: 0, currentKey: "k", hasBase: false, batchTokens: 2000 });
    expect(waiting).toContain("· waiting for batch");
    // First entry already in the base.
    const partial = buildLogMarkdown({ log, appendedThroughSeq: 1, currentKey: "k", hasBase: true, batchTokens: 2000 });
    expect(partial).toContain("[1 new-card global] a · in base");
    expect(partial).toContain("[2 new-card global] b · waiting for batch");
    // Forced tiny threshold: the tail is a full ready batch.
    const ready = buildLogMarkdown({ log, appendedThroughSeq: 0, currentKey: "k", hasBase: true, batchTokens: 1 });
    expect(ready).toContain("· ready to append");
  });

  it("showContributionStatus only where it means something", () => {
    const fact: Contribution = {
      id: "c1",
      sourceSession: "s",
      items: [{ kind: "fact", text: "t", citations: [] }],
      status: "pending",
    };
    expect(showContributionStatus(fact)).toBe(false);
    expect(buildContributionsMarkdown([fact])).not.toContain("status:");
    const corr: Contribution = { ...fact, items: [{ kind: "correction", text: "t", citations: [] }] };
    expect(showContributionStatus(corr)).toBe(true);
    const merged: Contribution = { ...fact, status: "merged" };
    expect(showContributionStatus(merged)).toBe(true);
  });
});
