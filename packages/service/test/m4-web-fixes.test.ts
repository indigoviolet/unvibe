/**
 * M4 web fixes (service side, additive):
 * - PATCH /comments/:id `open` applies to conversation cards (dotted-link
 *   click re-expands a closed card in place);
 * - concept jobs carry their stub card id so streamed text has a target.
 */
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { FakeCommandRunner } from "../src/exec/runner.js";
import { createApp } from "../src/server.js";

function fakeRunner(): FakeAgentRunner {
  return new FakeAgentRunner([]);
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
      type: "thread",
      anchor: {
        host: { kind: "block", blockId: "central#b1" },
        quotedText: "the thing",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: true,
      post: false,
      pinned: false,
      replies: [
        {
          id: "ans_exp1",
          kind: "explain",
          who: "agent",
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
  const agents = fakeRunner();
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
    review, version, files, description, pages, annotations, hunkStates: [], fileStates: [], viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false, hideLevel: "uninteresting" }, jobs: [], contributions: [], logTail: [], rev: 1, ingest: { status: "ready" },
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
      // Issue #273: post/draft apply to threads (comment-kind replies are
      // what Submit posts); reply drafts were always allowed.
      const marked = await s.app.inject({ method: "PATCH", url: `/api/reviews/${s.reviewId}/comments/ann_exp1`, headers: authed, payload: { post: true } } as never);
      expect(marked.statusCode).toBe(200);
      expect(s.ctx.reviews.getSnapshot(s.reviewId)!.annotations.find((a) => a.id === "ann_exp1")!.post).toBe(true);
    } finally {
      await s.app.close();
    }
  });

});
