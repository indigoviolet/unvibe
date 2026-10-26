/**
 * M6 submit: preview (dryRun) payloads, exact `gh` invocations + JSON,
 * double-submit protection, head-moved refusal, branch-disabled reason,
 * partial failure without double-posting, existing-comments fetch.
 */
import { describe, expect, it } from "vitest";
import type { Thread } from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/index.js";
import type { ScriptedResult } from "../src/exec/runner.js";
import { HEAD_SHA, OWNER, PR_NUMBER, REPO_NAME, setupReview, threadOnDiffLine } from "./m6-helpers.js";

const authed = { authorization: "Bearer tok" };
const REVIEW_URL = `https://github.com/${OWNER}/${REPO_NAME}/pull/${PR_NUMBER}#discussion_1`;

function descThread(text: string): Thread {
  return {
    id: "ann_desc",
    type: "thread",
    anchor: { host: { kind: "description", paragraphId: "d-p1" }, quotedText: "", prefix: "", suffix: "", position: 0, version: 1 },
    open: true,
    pinned: false,
    replies: [{
      id: "ans_desc1",
      kind: "comment",
      who: "you",
      question: null,
      blocks: [{ type: "paragraph", id: "b1", text: { standard: text }, citations: [] }],
      level: "standard",
      revision: 1,
      undoStack: [],
    }],
    post: true,
  };
}

describe("submit", () => {
  it("dryRun returns the exact preview without gh calls", async () => {
    const runner = new FakeCommandRunner();
    const { app, reviewId } = await setupReview(runner, {
      baseMarkdown: "Body here.\n",
      annotations: [threadOnDiffLine("a-py", 2, "inline text"), descThread("general text")],
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: { dryRun: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { preview: { comments: Array<{ threadId: string; location: { kind: string; path?: string }; text: string }>; reviewBody: string; commitId: string } };
      expect(body.preview.comments).toHaveLength(2);
      const inline = body.preview.comments.find((c) => c.location.kind === "inline");
      expect(inline?.location).toMatchObject({ path: "a.py", line: 2, side: "RIGHT" });
      expect(inline?.text).toBe("inline text");
      expect(body.preview.reviewBody).toBe("general text");
      expect(body.preview.commitId).toBe(HEAD_SHA);
      expect(runner.calls).toHaveLength(0);

      const get = await app.inject({
        method: "GET",
        url: `/api/reviews/${reviewId}/submit/preview`,
        headers: authed,
      });
      expect(get.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("posts one review + description, then double-submit is a no-op", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner, {
      baseMarkdown: "Original body.\n",
      annotations: [threadOnDiffLine("a-py", 2, "inline text"), descThread("general text")],
    });
    await ctx.reviews.mutate(reviewId, (draft) => {
      if (!draft.description) return;
      draft.description.pendingHtml = "<div class=\"desc\"><p class=\"para\" id=\"d-p1\">Edited body.</p></div>";
      draft.description.pendingMarkdown = "Edited body.\n";
    });
    runner.enqueue({
      cmd: "gh",
      args: ["pr", "view", String(PR_NUMBER), "--json", "headRefOid,state"],
      stdout: JSON.stringify({ headRefOid: HEAD_SHA, state: "OPEN" }),
      stderr: "",
      code: 0,
    });
    runner.enqueue({
      cmd: "gh",
      args: ["api", `repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`, "-X", "POST", "--input", "-"],
      stdout: JSON.stringify({ html_url: REVIEW_URL, id: 1 }),
      stderr: "",
      code: 0,
    });
    runner.enqueue({ cmd: "gh", stdout: "", stderr: "", code: 0 });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ posted: true, commentCount: 2, descriptionUpdated: true, reviewUrl: REVIEW_URL });

      // Exact review payload via stdin.
      const apiCall = runner.calls.find((c) => c.opts.args.includes("--input"));
      expect(apiCall).toBeTruthy();
      const payload = JSON.parse((apiCall?.opts.stdin ?? "{}") as string) as {
        commit_id: string;
        body: string;
        event: string;
        comments: Array<{ path: string; line: number; side: string; body: string }>;
      };
      expect(payload.commit_id).toBe(HEAD_SHA);
      expect(payload.event).toBe("COMMENT");
      expect(payload.body).toBe("general text");
      expect(payload.comments).toEqual([{ path: "a.py", line: 2, side: "RIGHT", body: "inline text" }]);

      // Description via --body-file.
      const editCall = runner.calls.find((c) => c.opts.args[0] === "pr" && c.opts.args[1] === "edit");
      expect(editCall?.opts.args.slice(0, 4)).toEqual(["pr", "edit", String(PR_NUMBER), "--body-file"]);

      const snap = ctx.reviews.getSnapshot(reviewId);
      expect(snap?.annotations.every((a) => a.type !== "comment" || !a.post || a.postedAt)).toBe(true);
      expect(snap?.annotations[0].postedUrl).toBe(REVIEW_URL);
      expect(snap?.description?.pendingMarkdown).toBeUndefined();
      expect(snap?.description?.baseMarkdown).toBe("Edited body.\n");

      const callsBefore = runner.calls.length;
      const again = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ posted: false, commentCount: 0, descriptionUpdated: false });
      expect(runner.calls.length).toBe(callsBefore);
    } finally {
      await app.close();
    }
  });

  it("posts a file-tab comment in the review body with a permalink (#81)", async () => {
    const codeThread: Thread = {
      id: "ann_code",
      type: "thread",
      anchor: {
        host: { kind: "code", path: "helper.py", commit: HEAD_SHA, line: 2, endLine: 3 },
        quotedText: "beta = 2\ngamma = 3",
        prefix: "",
        suffix: "",
        position: 2,
        version: 1,
      },
      open: true,
      pinned: false,
      replies: [{ id: "ans_t1", kind: "comment", who: "you", question: null, blocks: [{ type: "paragraph", id: "b1", text: { standard: "Is beta still the right default?" }, citations: [] }], level: "standard", revision: 1, undoStack: [] }],
      post: true,
    };
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner, { annotations: [codeThread] });
    const expectedBody = `https://github.com/${OWNER}/${REPO_NAME}/blob/${HEAD_SHA}/helper.py#L2-L3\n\n> beta = 2\n> gamma = 3\n\nIs beta still the right default?`;
    try {
      const dry = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: { dryRun: true },
      });
      expect(dry.statusCode).toBe(200);
      const preview = (dry.json() as { preview: { comments: Array<{ location: { kind: string }; text: string; quote?: string }>; reviewBody: string } }).preview;
      expect(preview.comments).toHaveLength(1);
      expect(preview.comments[0].location.kind).toBe("general");
      expect(preview.comments[0].text).toBe(expectedBody);
      expect(preview.comments[0].quote).toBe("beta = 2\ngamma = 3");
      expect(preview.reviewBody).toBe(expectedBody);
      expect(runner.calls).toHaveLength(0);

      runner.enqueue({
        cmd: "gh",
        args: ["pr", "view", String(PR_NUMBER), "--json", "headRefOid,state"],
        stdout: JSON.stringify({ headRefOid: HEAD_SHA, state: "OPEN" }),
        stderr: "",
        code: 0,
      });
      runner.enqueue({
        cmd: "gh",
        args: ["api", `repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`, "-X", "POST", "--input", "-"],
        stdout: JSON.stringify({ html_url: REVIEW_URL, id: 1 }),
        stderr: "",
        code: 0,
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ posted: true, commentCount: 1 });
      const apiCall = runner.calls.find((c) => c.opts.args.includes("--input"));
      const payload = JSON.parse((apiCall?.opts.stdin ?? "{}") as string) as {
        body: string;
        comments: unknown[];
      };
      expect(payload.body).toBe(expectedBody);
      expect(payload.comments).toEqual([]);
      const snap = ctx.reviews.getSnapshot(reviewId);
      expect(snap?.annotations[0].postedAt).toBeTypeOf("number");
    } finally {
      await app.close();
    }
  });

  it("refuses when the head moved; disabled for branches", async () => {
    const runner = new FakeCommandRunner();
    const { app, reviewId } = await setupReview(runner, { annotations: [threadOnDiffLine("a-py", 2, "x")] });
    runner.enqueue({
      cmd: "gh",
      args: ["pr", "view", String(PR_NUMBER), "--json", "headRefOid,state"],
      stdout: JSON.stringify({ headRefOid: "f".repeat(40), state: "OPEN" }),
      stderr: "",
      code: 0,
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toMatch(/new commits/i);
      expect(res.json()).toMatchObject({ code: "head-moved", reason: "head moved" });
      expect(runner.calls).toHaveLength(1);
    } finally {
      await app.close();
    }

    const runner2 = new FakeCommandRunner();
    const branch = await setupReview(runner2, { prNumber: null });
    try {
      const denied = await branch.app.inject({
        method: "POST",
        url: `/api/reviews/${branch.reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(denied.statusCode).toBe(400);
      expect((denied.json() as { reason: string }).reason).toMatch(/no PR/);
      const preview = await branch.app.inject({
        method: "GET",
        url: `/api/reviews/${branch.reviewId}/submit/preview`,
        headers: authed,
      });
      expect(preview.statusCode).toBe(200);
      expect((preview.json() as { reason: string }).reason).toMatch(/no PR/);
      expect(runner2.calls).toHaveLength(0);
    } finally {
      await branch.app.close();
    }
  });

  it("survives partial failure without double-posting on retry", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner, {
      baseMarkdown: "Base.\n",
      annotations: [threadOnDiffLine("a-py", 2, "inline")],
    });
    await ctx.reviews.mutate(reviewId, (draft) => {
      if (!draft.description) return;
      draft.description.pendingHtml = "h";
      draft.description.pendingMarkdown = "New body.\n";
    });
    runner.enqueue({
      cmd: "gh",
      args: ["pr", "view", String(PR_NUMBER), "--json", "headRefOid,state"],
      stdout: JSON.stringify({ headRefOid: HEAD_SHA, state: "OPEN" }),
      stderr: "",
      code: 0,
    });
    runner.enqueue({
      cmd: "gh",
      args: ["api", `repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`, "-X", "POST", "--input", "-"],
      stdout: JSON.stringify({ html_url: REVIEW_URL }),
      stderr: "",
      code: 0,
    });
    runner.enqueue({ cmd: "gh", stdout: "boom", stderr: "boom", code: 1 });
    try {
      const first = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(first.statusCode).toBe(502);
      expect(first.json()).toMatchObject({ posted: true, partial: true, commentCount: 1, descriptionUpdated: false });

      // Retry: review skipped (already posted), description retried.
      runner.enqueue({
        cmd: "gh",
        args: ["pr", "view", String(PR_NUMBER), "--json", "headRefOid,state"],
        stdout: JSON.stringify({ headRefOid: HEAD_SHA, state: "OPEN" }),
        stderr: "",
        code: 0,
      });
      runner.enqueue({ cmd: "gh", stdout: "", stderr: "", code: 0 });
      const second = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ posted: true, commentCount: 0, descriptionUpdated: true });
      const apiCalls = runner.calls.filter((c) => c.opts.args.includes("--input"));
      expect(apiCalls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("fetches existing PR comments read-only into the snapshot", async () => {    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    runner.enqueue({
      cmd: "gh",
      args: ["api", `repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/comments`],
      stdout: JSON.stringify([
        { id: 11, path: "a.py", line: 2, side: "RIGHT", body: "already **there**", user: { login: " alice " }, created_at: "2026-01-01", html_url: "https://x/11" },
        { id: 12, path: "a.py", line: 2, side: "RIGHT", body: "a reply <b>with html</b>", in_reply_to_id: 11, user: { login: "bob" } },
      ]),
      stderr: "",
      code: 0,
    });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/reviews/${reviewId}/pr-comments`,
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { comments: Array<{ id: number; body: string; bodyHtml: string; replyTo?: number }> };
      expect(body.comments).toHaveLength(2);
      expect(body.comments[0].body).toBe("already **there**");
      // Rendered once at fetch with the shared sanitiser: Markdown
      // renders, raw HTML from GitHub never passes through.
      expect(body.comments[0].bodyHtml).toContain("<strong>there</strong>");
      expect(body.comments[1].bodyHtml).toContain("&lt;b&gt;with html&lt;/b&gt;");
      expect(body.comments[1].bodyHtml).not.toContain("<b>");
      // Replies group under their root.
      expect(body.comments[1].replyTo).toBe(11);
      expect(body.comments[0].replyTo).toBeUndefined();
      expect(ctx.reviews.getSnapshot(reviewId)?.existingComments).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});

describe("submit crash safety (in-flight lease)", () => {
  it("retry after a crash reconciles the posted review instead of double-posting", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner, {
      annotations: [threadOnDiffLine("a-py", 2, "inline")],
    });
    const threadId = ctx.reviews.getSnapshot(reviewId)!.annotations[0].id;
    // Simulate the crash window: the review POST reached GitHub, but the
    // local posted-mark never ran. The lease is all the retry has.
    const { writeSubmitLease } = await import("../src/submit/lease.js");
    writeSubmitLease(ctx.db, {
      reviewId,
      startedAt: Date.now() - 5000,
      commitId: HEAD_SHA,
      body: "",
      comments: [{ threadId, path: "a.py", line: 2, body: "inline" }],
    });
    runner.enqueue({
      cmd: "gh",
      args: ["pr", "view", String(PR_NUMBER), "--json", "headRefOid,state"],
      stdout: JSON.stringify({ headRefOid: HEAD_SHA, state: "OPEN" }),
      stderr: "",
      code: 0,
    });
    runner.enqueue({
      cmd: "gh",
      args: ["api", `repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`],
      stdout: JSON.stringify([{ id: 99, commit_id: HEAD_SHA, body: "", html_url: REVIEW_URL }]),
      stderr: "",
      code: 0,
    });
    runner.enqueue({
      cmd: "gh",
      args: ["api", `repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews/99/comments`],
      stdout: JSON.stringify([{ id: 5, path: "a.py", line: 2, body: "inline" }]),
      stderr: "",
      code: 0,
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ posted: true, recovered: true, commentCount: 1, reviewUrl: REVIEW_URL });
      // No second POST: the only writes would carry --input.
      expect(runner.calls.filter((c) => c.opts.args.includes("--input"))).toHaveLength(0);
      const snap = ctx.reviews.getSnapshot(reviewId)!;
      expect(snap.annotations[0].postedAt).toBeTruthy();
      expect(snap.annotations[0].postedUrl).toBe(REVIEW_URL);
      // Lease cleared: the next submit is a plain no-op, not a recovery.
      const again = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect((again.json() as { reason: string }).reason).toMatch(/already on GitHub/);
    } finally {
      await app.close();
    }
  });

  it("a fresh lease blocks a concurrent second submit (409), a stale one proceeds", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner, {
      annotations: [threadOnDiffLine("a-py", 2, "inline")],
    });
    const threadId = ctx.reviews.getSnapshot(reviewId)!.annotations[0].id;
    const { writeSubmitLease } = await import("../src/submit/lease.js");
    const leaseOf = (startedAt: number) => ({
      reviewId,
      startedAt,
      commitId: HEAD_SHA,
      body: "",
      comments: [{ threadId, path: "a.py", line: 2, body: "inline" }],
    });
    const prView = {
      cmd: "gh",
      args: ["pr", "view", String(PR_NUMBER), "--json", "headRefOid,state"],
      stdout: JSON.stringify({ headRefOid: HEAD_SHA, state: "OPEN" }),
      stderr: "",
      code: 0,
    } satisfies ScriptedResult;
    const emptyReviews: ScriptedResult = {
      cmd: "gh",
      args: ["api", `repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`],
      stdout: "[]",
      stderr: "",
      code: 0,
    };
    try {
      // Fresh lease + nothing on GitHub: in progress, do not post.
      writeSubmitLease(ctx.db, leaseOf(Date.now()));
      runner.enqueue({ ...prView });
      runner.enqueue({ ...emptyReviews });
      const busy = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(busy.statusCode).toBe(409);
      expect((busy.json() as { reason: string }).reason).toMatch(/in progress/);
      expect(runner.calls.filter((c) => c.opts.args.includes("--input"))).toHaveLength(0);

      // Stale lease + nothing on GitHub: the poster died; proceed.
      writeSubmitLease(ctx.db, leaseOf(Date.now() - 3600_000));
      runner.enqueue({ ...prView });
      runner.enqueue({ ...emptyReviews });
      runner.enqueue({
        cmd: "gh",
        args: ["api", `repos/${OWNER}/${REPO_NAME}/pulls/${PR_NUMBER}/reviews`, "-X", "POST", "--input", "-"],
        stdout: JSON.stringify({ html_url: REVIEW_URL }),
        stderr: "",
        code: 0,
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/submit`,
        headers: authed,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ posted: true, commentCount: 1 });
      expect(runner.calls.filter((c) => c.opts.args.includes("--input"))).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
