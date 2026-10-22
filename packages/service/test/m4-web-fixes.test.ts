/**
 * M4 web fixes (service side, additive):
 * - PATCH /comments/:id `open` applies to conversation cards (dotted-link
 *   click re-expands a closed card in place);
 * - second opinion resolves answer targets and stores the result on the
 *   turn (survives depth/undo; removable by mode or stored id);
 * - concept jobs carry their stub card id so streamed text has a target.
 */
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import { createApp } from "../src/server.js";
import {
  removeSecondOpinion,
  requestSecondOpinion,
  resolveTarget,
} from "../src/secondopinion/index.js";

const SECOND_REPLY = (verdict: string): string =>
  `Independent check. The helper handles the fold. [[diff:a-py:1-2]]\n\n` +
  `\`\`\`json\n{"secondOpinion": {"verdict": "${verdict}", "reasoning": "Checked the helper.", "missed": "Nothing."}}\n\`\`\`\n`;

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

function pagesWithConversation(): { pages: ReviewSnapshot["pages"]; annotations: ReviewSnapshot["annotations"] } {
  const pages = [
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
  ] as unknown as ReviewSnapshot["pages"];
  const annotations = [
    {
      id: "ann_exp1",
      type: "conversation",
      anchor: {
        host: { kind: "block", blockId: "central#b1" },
        quotedText: "the thing",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: true,
      messages: [],
      post: false,
      note: false,
      turns: [
        {
          id: "ans_exp1",
          question: null,
          blocks: [
            {
              type: "paragraph",
              id: "e1",
              text: { standard: "Explanation [[diff:a-py:1-2]]" },
              citations: [{ target: "diff:a-py:1-2" }],
            },
          ],
          level: "standard",
          revision: 1,
          undoStack: [],
        },
      ],
    },
  ] as unknown as ReviewSnapshot["annotations"];
  return { pages, annotations };
}

async function setupWith(pages: ReviewSnapshot["pages"], annotations: ReviewSnapshot["annotations"] = []) {
  const runner = new FakeCommandRunner();
  const agents = fakeWithVerdict();
  const { app, ctx } = await createApp("tok", { runner, agents: agents as unknown as never });
  const { repoRow, versionRow } = await import("./m6-helpers.js");
  const { writeReviewRows } = await import("../src/ingest/index.js");
  const { descriptionFor, sourceFile } = await import("./m6-helpers.js");
  const repo = repoRow();
  ctx.repos.upsert(repo);
  const reviewId = `rv_m4_${Math.random().toString(36).slice(2, 8)}`;
  const version = versionRow();
  const review = { id: reviewId, repoId: repo.id, branch: "feature", prNumber: 7, versions: [version], currentVersion: 1, createdAt: 1 };
  const files = [sourceFile()];
  const description = descriptionFor("First para.\n\nSecond para.\n");
  writeReviewRows(ctx.db, repo.id, { review, version, files, description, commits: [], title: review.branch, worktreePath: "/tmp" });
  ctx.reviews.putSnapshot(reviewId, {
    review, version, files, description, pages, annotations, hunkStates: [], fileStates: [], viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false }, jobs: [], contributions: [], logTail: [], rev: 1, ingest: { status: "ready" },
  });
  return { app, ctx, reviewId, agents };
}

describe("M4 web fixes", () => {
  it("PATCH comments open applies to conversation cards", async () => {
    const { pages, annotations } = pagesWithConversation();
    const s = await setupWith(pages, annotations);
    try {
      const authed = { authorization: "Bearer tok" };
      // Close via the actions route, then re-open via the comments PATCH.
      const closed = await s.app.inject({ method: "POST", url: `/api/reviews/${s.reviewId}/actions`, headers: authed, payload: { kind: "close", annotationId: "ann_exp1" } } as never);
      expect(closed.statusCode).toBe(200);
      expect(s.ctx.reviews.getSnapshot(s.reviewId)!.annotations.find((a) => a.id === "ann_exp1")!.open).toBe(false);
      const opened = await s.app.inject({ method: "PATCH", url: `/api/reviews/${s.reviewId}/comments/ann_exp1`, headers: authed, payload: { open: true } } as never);
      expect(opened.statusCode).toBe(200);
      expect(s.ctx.reviews.getSnapshot(s.reviewId)!.annotations.find((a) => a.id === "ann_exp1")!.open).toBe(true);
      // post/draft stay thread-only on conversation cards (reply drafts are allowed).
      const bad = await s.app.inject({ method: "PATCH", url: `/api/reviews/${s.reviewId}/comments/ann_exp1`, headers: authed, payload: { post: true } } as never);
      expect(bad.statusCode).toBe(400);
    } finally {
      await s.app.close();
    }
  });

  it("second opinion works on answers and survives depth/undo", async () => {
    const { pages, annotations } = pagesWithConversation();
    const s = await setupWith(pages, annotations);
    try {
      const snap = s.ctx.reviews.getSnapshot(s.reviewId)!;
      const target = resolveTarget(snap, "ans_exp1");
      expect(target.answerId).toBe("ans_exp1");
      expect(target.annotationId).toBe("ann_exp1");
      expect(target.claimText).toContain("the thing");
      const deps = {
        reviews: s.ctx.reviews, jobs: s.ctx.jobs, sessions: s.ctx.sessions, runner: s.agents,
        mcp: s.ctx.mcp, settings: s.ctx.settings, commands: s.ctx.runner,
        dataDir: s.ctx.dataDir, promptsDir: s.ctx.promptsDir, mcpBaseUrl: "http://127.0.0.1:4517",
      };
      const job = await requestSecondOpinion(deps, { reviewId: s.reviewId, cardId: "ans_exp1", mode: "check" });
      if (!("id" in job)) throw new Error("expected a job, got a reused second opinion");
      await s.ctx.jobs.drain(10000);
      expect(s.ctx.jobs.get(job.id)?.state).toBe("done");
      const stored = s.ctx.reviews.getSnapshot(s.reviewId)!.annotations.find((a) => a.id === "ann_exp1")!;
      expect(stored.type).toBe("conversation");
      expect((stored.turns?.[0]?.secondOpinions ?? []) as { verdict: string }[]).toHaveLength(1);
      // Removal by mode and by stored id both work.
      await removeSecondOpinion({ reviews: s.ctx.reviews }, s.reviewId, "ans_exp1", "check");
      expect(
        (s.ctx.reviews.getSnapshot(s.reviewId)!.annotations.find((a) => a.id === "ann_exp1")!.turns?.[0]?.secondOpinions ?? []).length,
      ).toBe(0);
    } finally {
      await s.app.close();
    }
  });

  it("unknown answer second-opinion targets fail like unknown cards", async () => {
    const { pages } = pagesWithConversation();
    const s = await setupWith(pages, []);
    try {
      const snap = s.ctx.reviews.getSnapshot(s.reviewId)!;
      expect(() => resolveTarget(snap, "ann_missing")).toThrow(/unknown card/);
    } finally {
      await s.app.close();
    }
  });
});
