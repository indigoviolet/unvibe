/**
 * Submit review: preview + post (PRD 4.12, 15).
 *
 * - Preview (`dryRun`) returns exactly what will be posted: each comment's
 *   location + text, the review body, the description diff, and the pinned
 *   `commit_id` — for the Submit panel. No GitHub calls except the head
 *   check on real submit (preview never posts).
 * - Real submit does ONE `gh api repos/{o}/{r}/pulls/{n}/reviews` call with
 *   `event=COMMENT` carrying every comment (JSON body via stdin), then
 *   `gh pr edit <n> --body-file <file>` for the description.
 * - The review is pinned to the head SHA the user reviewed (`commit_id`);
 *   submit refuses with a clear error when the PR head has moved since.
 * - After success, threads are marked posted (with GitHub URLs) so they
 *   are never posted twice. Partial failure (review posted, description
 *   failed) marks the review posted first, so a retry only retries the
 *   description.
 * - Branch reviews without a PR are disabled with a reason.
 *
 * This module + the submit route are the ONLY place that writes to GitHub
 * (see `test/gh-writes.test.ts`).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ReviewSnapshot,
  SubmitPreview,
  SubmitPreviewComment,
} from "@unvibe/shared";
import { ingestStatusOf, isReadySnapshot } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";
import { locatePendingThreads, postedThreadIds, type SubmitRepoRef } from "../comments/location.js";
import {
  SUBMIT_LEASE_GRACE_MS,
  clearSubmitLease,
  findLeasedReviewOnGitHub,
  markLeasePosted,
  readSubmitLease,
  writeSubmitLease,
} from "./lease.js";
import type { ReviewStore } from "../state/store.js";
import type { RepoStore } from "../repos/store.js";
import type { DatabaseSync } from "../store/index.js";
import { readReviewRow } from "../ingest/index.js";

export interface SubmitContext {
  runner: CommandRunner;
  db: DatabaseSync;
  repos: RepoStore;
  reviews: ReviewStore;
}

interface PrView {
  headRefOid: string;
  state: string;
}

async function fetchPrView(
  runner: CommandRunner,
  repoPath: string,
  prNumber: number,
): Promise<PrView> {
  const args = ["pr", "view", String(prNumber), "--json", "headRefOid,state"];
  const res = await runGh(runner, args, { args, cwd: repoPath });
  if (res.code !== 0) {
    throw new Error(`gh pr view ${prNumber} failed: ${res.stderr.trim() || res.stdout.trim()}`);
  }
  const json = JSON.parse(res.stdout) as { headRefOid?: string; state?: string };
  return { headRefOid: json.headRefOid ?? "", state: json.state ?? "" };
}

/** Build the preview for a snapshot (no GitHub calls). */
export function buildPreview(snapshot: ReviewSnapshot, repo?: SubmitRepoRef): SubmitPreview {
  const pending = locatePendingThreads(snapshot, repo);
  const alreadyPosted = postedThreadIds(snapshot);
  const inline: SubmitPreviewComment[] = [];
  const generalTexts: string[] = [];
  for (const p of pending) {
    const item: SubmitPreviewComment = {
      threadId: p.thread.id,
      location: p.location,
      text: p.text,
    };
    if (p.location.kind === "inline") inline.push(item);
    else generalTexts.push(p.text);
  }
  // Include inline items first (as posted), then general (in the body).
  const comments: SubmitPreviewComment[] = [
    ...inline,
    ...pending
      .filter((p) => p.location.kind !== "inline")
      .map((p) => ({
        threadId: p.thread.id,
        location: p.location,
        text: p.text,
        ...(p.thread.anchor.host.kind === "code" && (p.thread.anchor.quotedText ?? "") !== ""
          ? { quote: p.thread.anchor.quotedText as string }
          : {}),
      })),
  ];
  const reviewBody = generalTexts.filter((t) => t.trim() !== "").join("\n\n---\n\n");
  const desc = snapshot.description;
  const pendingMd = desc?.pendingMarkdown;
  const pendingHtml = desc?.pendingHtml;
  return {
    comments,
    alreadyPosted,
    reviewBody,
    commitId: snapshot.version?.headSha ?? "",
    ...(pendingMd !== undefined
      ? {
          description: {
            fromRev: desc?.rev ?? "1",
            markdown: pendingMd,
            html: pendingHtml ?? desc?.html ?? "",
          },
        }
      : {}),
  };
}

export interface SubmitResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Run submit (or dryRun preview). Returns an HTTP status + JSON body for
 * the route to send.
 */
export async function runSubmit(
  ctx: SubmitContext,
  reviewId: string,
  opts: { dryRun?: boolean; expectedCount?: number },
): Promise<SubmitResult> {
  const snapshot = ctx.reviews.getSnapshot(reviewId);
  if (!snapshot) return { status: 404, body: { error: "unknown review" } };
  if (!isReadySnapshot(snapshot)) {
    const st = ingestStatusOf(snapshot);
    if (st === "loading") return { status: 409, body: { error: "the review is still opening" } };
    return {
      status: 409,
      body: { error: snapshot.ingest?.error ?? "the review couldn't be opened" },
    };
  }
  const row = readReviewRow(ctx.db, reviewId);
  const prNumber = row?.prNumber ?? snapshot.review.prNumber;
  const repo = row ? ctx.repos.get(row.repoId) : null;
  const repoRef: SubmitRepoRef | undefined = repo ? { owner: repo.owner, name: repo.name } : undefined;
  if (prNumber === null || prNumber === undefined) {
    const reason = "This branch has no PR, so there is nothing to submit to.";
    if (opts.dryRun) {
      const preview = buildPreview(snapshot, repoRef);
      return { status: 200, body: { posted: false, preview: { ...preview, disabledReason: reason }, reason } };
    }
    return { status: 400, body: { error: reason, reason } };
  }
  if (!repo) return { status: 404, body: { error: "unknown repo" } };

  const pending = locatePendingThreads(snapshot, repoRef);
  const preview = buildPreview(snapshot, repoRef);
  const hasPendingDescription = snapshot.description?.pendingMarkdown !== undefined;
  const emptyText = pending.filter((p) => p.text.trim() === "");
  const inflight = readSubmitLease(ctx.db, reviewId);
  if (opts.dryRun) {
    return {
      status: 200,
      body: {
        posted: false,
        commentCount: 0,
        descriptionUpdated: false,
        preview: inflight ? { ...preview, inflight: true } : preview,
      },
    };
  }

  if (opts.expectedCount !== undefined && opts.expectedCount !== pending.length) {
    return {
      status: 409,
      body: {
        error: `the comments changed since this list was loaded — close the panel and open it again`,
      },
    };
  }
  if (emptyText.length > 0) {
    return {
      status: 400,
      body: {
        error: `a comment in the Outbox is empty — write its text under Comments → Outbox, then submit`,
      },
    };
  }
  if (pending.length === 0 && !hasPendingDescription) {
    const already = postedThreadIds(snapshot);
    // Nothing left to post: any lease is a leftover (its posted-mark
    // landed). Clear it so it never blocks a future submit.
    clearSubmitLease(ctx.db, reviewId);
    return {
      status: 200,
      body: {
        posted: false,
        commentCount: 0,
        descriptionUpdated: false,
        alreadyPosted: already,
        reason: already.length > 0 ? "Everything here is already on GitHub." : "Nothing is in the Outbox.",
      },
    };
  }

  // Pin to the reviewed head SHA; refuse when the PR moved.
  let view: PrView;
  try {
    view = await fetchPrView(ctx.runner, repo.localPath, prNumber);
  } catch (err) {
    return { status: 502, body: { error: (err as Error).message } };
  }
  if (view.state !== "" && view.state !== "OPEN") {
    return { status: 409, body: { error: `the PR is ${view.state.toLowerCase()}, so a review can't be submitted`, reason: `PR is ${view.state}` } };
  }
  if (view.headRefOid && view.headRefOid !== snapshot.version.headSha) {
    return {
      status: 409,
      body: {
        error: `the PR has new commits since this review was loaded (${snapshot.version.headSha.slice(0, 7)} → ${view.headRefOid.slice(0, 7)}) — refresh the review, then submit`,
        // Machine code for the Submit panel (issue #86, finding 10);
        // `reason` stays for older clients.
        code: "head-moved",
        reason: "head moved",
        reviewedCommit: snapshot.version.headSha,
        currentHead: view.headRefOid,
      },
    };
  }

  const commitId = snapshot.version.headSha;
  let reviewUrl: string | undefined;
  let postedCount = 0;

  // Post the single review when any thread is pending.
  if (pending.length > 0) {
    const inline = pending.filter((p) => p.location.kind === "inline");
    const general = pending.filter((p) => p.location.kind !== "inline");
    const reviewBody = general.map((p) => p.text).filter((t) => t.trim() !== "").join("\n\n---\n\n");
    // Crash safety: a lease means a previous attempt may have posted
    // without marking. Reconcile against GitHub before posting again —
    // never silently double-post.
    const prior = readSubmitLease(ctx.db, reviewId);
    if (prior) {
      let found: { id: number; url?: string } | null = null;
      try {
        found = await findLeasedReviewOnGitHub(ctx.runner, repo, prNumber, prior);
      } catch (err) {
        return { status: 502, body: { error: (err as Error).message } };
      }
      if (found) {
        const at = Date.now();
        const recovered = await markLeasePosted(ctx.reviews, reviewId, prior, found.url, at);
        clearSubmitLease(ctx.db, reviewId);
        return {
          status: 200,
          body: {
            posted: true,
            recovered: true,
            commentCount: recovered.marked,
            descriptionUpdated: false,
            ...(recovered.stillPending > 0 ? { stillPending: recovered.stillPending } : {}),
            ...(found.url ? { reviewUrl: found.url } : {}),
          },
        };
      }
      if (Date.now() - prior.startedAt < SUBMIT_LEASE_GRACE_MS) {
        return {
          status: 409,
          body: {
            error: "this review is already being submitted — wait for it to finish, then try again",
            reason: "submit in progress",
          },
        };
      }
      // Stale lease with nothing matching on GitHub: the poster died
      // before posting. Clear it and proceed.
      clearSubmitLease(ctx.db, reviewId);
    }
    const comments = inline.map((p) => {
      const loc = p.location;
      if (loc.kind !== "inline") throw new Error("unreachable");
      return {
        path: loc.path,
        line: loc.line,
        side: loc.side,
        ...(loc.startLine !== undefined ? { start_line: loc.startLine } : {}),
        ...(loc.startSide !== undefined ? { start_side: loc.startSide } : {}),
        body: p.text,
      };
    });
    const payload = {
      commit_id: commitId,
      body: reviewBody,
      event: "COMMENT",
      comments,
    };
    const apiArgs = ["api", `repos/${repo.owner}/${repo.name}/pulls/${prNumber}/reviews`, "-X", "POST", "--input", "-"];
    // The lease covers the crash window between the POST and the local
    // posted-mark (see lease.ts). Payload mirrors exactly what we post so
    // the retry can reconcile against GitHub.
    writeSubmitLease(ctx.db, {
      reviewId,
      startedAt: Date.now(),
      commitId,
      body: reviewBody,
      comments: pending.map((p) => ({
        threadId: p.thread.id,
        ...(p.location.kind === "inline" ? { path: p.location.path, line: p.location.line } : {}),
        body: p.text,
      })),
    });
    let apiRes;
    try {
      apiRes = await runGh(ctx.runner, apiArgs, {
        args: apiArgs,
        cwd: repo.localPath,
        stdin: JSON.stringify(payload),
      });
    } catch (err) {
      clearSubmitLease(ctx.db, reviewId);
      return { status: 502, body: { error: `GitHub didn't accept the review: ${(err as Error).message}` } };
    }
    if (apiRes.code !== 0) {
      clearSubmitLease(ctx.db, reviewId);
      return {
        status: 502,
        body: { error: `GitHub didn't accept the review: ${apiRes.stderr.trim() || apiRes.stdout.trim()}` },
      };
    }
    try {
      const json = JSON.parse(apiRes.stdout) as { html_url?: string };
      reviewUrl = json.html_url;
    } catch {
      reviewUrl = undefined;
    }
    postedCount = pending.length;
    // Mark posted BEFORE the description update so a retry never
    // double-posts the review (partial-failure safety).
    const at = Date.now();
    await ctx.reviews.mutate(reviewId, (draft) => {
      for (const a of draft.annotations) {
        if (!a.post || a.postedAt || !a.replies.some((r) => r.kind === "comment")) continue;
        if (!pending.some((p) => p.thread.id === a.id)) continue;
        a.postedAt = at;
        if (reviewUrl) a.postedUrl = reviewUrl;
      }
    });
    // The POST is now durably recorded: the lease has served its purpose.
    clearSubmitLease(ctx.db, reviewId);
  }

  // Description update (when a pending edit exists).
  let descriptionUpdated = false;
  if (hasPendingDescription) {
    const markdown = snapshot.description?.pendingMarkdown ?? "";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-desc-"));
    const bodyFile = path.join(tmpDir, "body.md");
    try {
      fs.writeFileSync(bodyFile, markdown, "utf8");
      const editArgs = ["pr", "edit", String(prNumber), "--body-file", bodyFile];
      const editRes = await runGh(ctx.runner, editArgs, { args: editArgs, cwd: repo.localPath });
      if (editRes.code !== 0) {
        return {
          status: 502,
          body: {
            error: `The review was posted, but GitHub didn't accept the description update: ${editRes.stderr.trim() || editRes.stdout.trim()}`,
            posted: true,
            partial: true,
            commentCount: postedCount,
            descriptionUpdated: false,
            ...(reviewUrl ? { reviewUrl } : {}),
          },
        };
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    descriptionUpdated = true;
    const pendingHtml = snapshot.description?.pendingHtml ?? snapshot.description?.html ?? "";
    const { buildParagraphSources } = await import("./description.js");
    const rebuilt = buildParagraphSources(markdown);
    await ctx.reviews.mutate(reviewId, (draft) => {
      if (!draft.description) return;
      draft.description.html = pendingHtml;
      draft.description.baseMarkdown = markdown;
      draft.description.paragraphSources = rebuilt.paragraphSources;
      delete draft.description.pendingHtml;
      delete draft.description.pendingMarkdown;
    });
  }

  return {
    status: 200,
    body: {
      posted: true,
      commentCount: postedCount,
      descriptionUpdated,
      ...(reviewUrl ? { reviewUrl } : {}),
    },
  };
}
