/**
 * Remove one review's local data: the start page's "Remove", Settings →
 * Data "Reset data" and (issue #428) removing a repo with its reviews all
 * go through this one path. Never touches GitHub or the user's checkout;
 * removes the managed worktree.
 */
import { outboxThreads, type ReviewSnapshot } from "@unvibe/shared";
import { deleteReviewLocal } from "../reviews/index.js";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";

export type ReviewRemover = (id: string) => Promise<boolean>;

export function createReviewRemover(ctx: ServiceContext, deps: RouteDeps): ReviewRemover {
  return async (id: string): Promise<boolean> => {
    const jobs = deps.jobs;
    const result = await deleteReviewLocal({
      db: ctx.db,
      runner: ctx.runner,
      dataDir: ctx.dataDir,
      ...(jobs
        ? {
            cancelJobs: (reviewId: string) => {
              try {
                for (const j of jobs.listByReview(reviewId)) {
                  if (j.state !== "done" && j.state !== "error" && j.state !== "cancelled") {
                    try {
                      jobs.cancel(j.id);
                    } catch {
                      // Best effort.
                    }
                  }
                }
              } catch {
                // Ignore.
              }
            },
          }
        : {}),
    }, id);
    if (!result.deleted) return false;
    // #115: finished jobs outlive the delete (their rows are gone but the
    // queue still lists them), so drop the review's entries too — a review
    // added again for the same change starts with no jobs.
    try {
      jobs?.dropReview(id);
    } catch {
      // Best effort: the rows are already gone.
    }
    // Close the review's agent sessions (base + conversations) so a review
    // added again for the same change starts from new ones.
    try {
      await deps.sessions?.closeReview(id);
    } catch {
      // Best effort: the sessions also close on idle.
    }
    // The review's agent sessions are gone: its MCP secrets die with it, so
    // a stale agent URL can never reach another review's data.
    try {
      deps.mcp?.revokeForReview(id);
    } catch {
      // Best effort: secrets are process-local and die on restart anyway.
    }
    return true;
  };
}

/**
 * Issue #428: unsent Outbox drafts across the given reviews, from their
 * stored snapshots. An unreadable snapshot counts as zero (the count
 * informs the confirm text; it never gates the delete).
 */
export function countUnsentDrafts(ctx: ServiceContext, reviewIds: readonly string[]): number {
  let n = 0;
  const stmt = ctx.db.prepare("SELECT snapshot FROM review_snapshots WHERE review_id = ?");
  for (const id of reviewIds) {
    try {
      const row = stmt.get(id) as { snapshot: string } | undefined;
      if (!row) continue;
      n += outboxThreads(JSON.parse(row.snapshot) as ReviewSnapshot).length;
    } catch {
      // See above.
    }
  }
  return n;
}
