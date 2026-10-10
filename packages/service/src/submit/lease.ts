/**
 * Submit in-flight leases (hardening, PRD §4.12 crash safety).
 *
 * Crash window: `gh api …/reviews` POST succeeds, then SIGKILL lands before
 * the local posted-mark. Without a lease the retry would post a second
 * GitHub review. The lease (one SQLite row per review, migration 004) is
 * written before the POST and cleared after the posted-mark, so a retry
 * always reconciles first:
 * - matching review found on GitHub (same commit + same body/comments) →
 *   mark posted locally, clear the lease, report `recovered: true`;
 * - no match and the lease is fresh (< grace) → 409 "submit in progress"
 *   (covers double-clicks racing the first POST);
 * - no match and the lease is stale → the poster died before posting;
 *   clear it and proceed.
 *
 * Reconciliation only reads GitHub (`gh api …/reviews` list + per-review
 * comments); it never writes (see `test/gh-writes.test.ts`).
 */
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";
import { locateThreadWithText } from "../comments/location.js";
import type { ReviewStore } from "../state/store.js";
import type { DatabaseSync } from "../store/index.js";

/** Fresh leases block a second submit (double-click / concurrent retry). */
export const SUBMIT_LEASE_GRACE_MS = 120_000;

export interface LeaseComment {
  threadId: string;
  path?: string;
  line?: number;
  body: string;
}

export interface SubmitLease {
  reviewId: string;
  startedAt: number;
  commitId: string;
  body: string;
  comments: LeaseComment[];
}

function tableExists(db: DatabaseSync): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='submit_leases'")
      .get() as { name: string } | undefined;
    return !!row;
  } catch {
    return false;
  }
}

export function readSubmitLease(db: DatabaseSync, reviewId: string): SubmitLease | null {
  if (!tableExists(db)) return null;
  try {
    const row = db
      .prepare("SELECT started_at, commit_id, payload FROM submit_leases WHERE review_id = ?")
      .get(reviewId) as { started_at: number; commit_id: string; payload: string } | undefined;
    if (!row) return null;
    const payload = JSON.parse(row.payload) as { body?: string; comments?: LeaseComment[] };
    return {
      reviewId,
      startedAt: row.started_at,
      commitId: row.commit_id,
      body: payload.body ?? "",
      comments: payload.comments ?? [],
    };
  } catch {
    return null;
  }
}

export function writeSubmitLease(db: DatabaseSync, lease: SubmitLease): void {
  if (!tableExists(db)) return;
  db.prepare(
    `INSERT INTO submit_leases (review_id, started_at, commit_id, payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(review_id) DO UPDATE SET
       started_at = excluded.started_at, commit_id = excluded.commit_id, payload = excluded.payload`,
  ).run(
    lease.reviewId,
    lease.startedAt,
    lease.commitId,
    JSON.stringify({ body: lease.body, comments: lease.comments }),
  );
}

export function clearSubmitLease(db: DatabaseSync, reviewId: string): void {
  if (!tableExists(db)) return;
  try {
    db.prepare("DELETE FROM submit_leases WHERE review_id = ?").run(reviewId);
  } catch {
    // best effort
  }
}

interface GhReview {
  id: number;
  commit_id?: string;
  body?: string | null;
  html_url?: string;
}

interface GhReviewComment {
  path?: string;
  line?: number | null;
  original_line?: number | null;
  start_line?: number | null;
  body?: string;
}

function commentKey(c: { path?: string; line?: number; body: string }): string {
  return `${c.path ?? ""}:${c.line ?? ""}:${c.body}`;
}

/**
 * Look for the leased submit on GitHub. Returns the matching review (with
 * its URL) when the same commit carries the same body and the same inline
 * comments, else null. Read-only.
 */
export async function findLeasedReviewOnGitHub(
  runner: CommandRunner,
  repo: { owner: string; name: string; localPath: string },
  prNumber: number,
  lease: SubmitLease,
): Promise<{ id: number; url?: string } | null> {
  const listArgs = ["api", `repos/${repo.owner}/${repo.name}/pulls/${prNumber}/reviews`];
  const listRes = await runGh(runner, listArgs, { args: listArgs, cwd: repo.localPath });
  if (listRes.code !== 0) throw new Error(`submit reconcile failed: ${listRes.stderr.trim() || listRes.stdout.trim()}`);
  let reviews: GhReview[];
  try {
    reviews = JSON.parse(listRes.stdout) as GhReview[];
  } catch {
    throw new Error("submit reconcile failed: could not parse reviews list");
  }
  const candidates = reviews.filter((r) => r.commit_id === lease.commitId);
  for (const cand of candidates) {
    if ((cand.body ?? "") !== lease.body) continue;
    const inline = lease.comments.filter((c) => c.path !== undefined);
    if (inline.length === 0) return { id: cand.id, ...(cand.html_url ? { url: cand.html_url } : {}) };
    const cArgs = ["api", `repos/${repo.owner}/${repo.name}/pulls/${prNumber}/reviews/${cand.id}/comments`];
    const cRes = await runGh(runner, cArgs, { args: cArgs, cwd: repo.localPath });
    if (cRes.code !== 0) continue;
    let posted: GhReviewComment[];
    try {
      posted = JSON.parse(cRes.stdout) as GhReviewComment[];
    } catch {
      continue;
    }
    const have = new Map<string, number>();
    for (const p of posted) {
      const k = commentKey({ path: p.path, line: p.line ?? p.original_line ?? undefined, body: p.body ?? "" });
      have.set(k, (have.get(k) ?? 0) + 1);
    }
    let match = true;
    for (const c of inline) {
      const k = commentKey({ path: c.path, line: c.line, body: c.body });
      const n = have.get(k) ?? 0;
      if (n <= 0) {
        match = false;
        break;
      }
      have.set(k, n - 1);
    }
    if (match) return { id: cand.id, ...(cand.html_url ? { url: cand.html_url } : {}) };
  }
  return null;
}

/** Mark the leased threads posted locally (recovery path). */
export async function markLeasePosted(
  reviews: ReviewStore,
  reviewId: string,
  lease: SubmitLease,
  url: string | undefined,
  at: number,
): Promise<{ marked: number; stillPending: number }> {
  const snapshot = reviews.getSnapshot(reviewId);
  // Only threads whose current text still matches the leased text are
  // marked: drafts edited after the crash stay pending so the edit is not
  // silently dropped from the submit queue.
  const matchIds = new Set<string>();
  if (snapshot) {
    const leasedById = new Map(lease.comments.map((c) => [c.threadId, c.body]));
    for (const a of snapshot.annotations) {
      if (a.type !== "thread" || !a.post || a.postedAt) continue;
      const want = leasedById.get(a.id);
      if (want === undefined) continue;
      try {
        if (locateThreadWithText(snapshot, a).text === want) matchIds.add(a.id);
      } catch {
        // unlocatable thread: leave pending
      }
    }
  } else {
    for (const c of lease.comments) matchIds.add(c.threadId);
  }
  await reviews.mutate(reviewId, (draft) => {
    for (const a of draft.annotations) {
      if (a.type !== "thread" || !a.post || a.postedAt) continue;
      if (!matchIds.has(a.id)) continue;
      a.postedAt = at;
      if (url) a.postedUrl = url;
    }
  });
  const pending = lease.comments.length - matchIds.size;
  return { marked: matchIds.size, stillPending: pending < 0 ? 0 : pending };
}
