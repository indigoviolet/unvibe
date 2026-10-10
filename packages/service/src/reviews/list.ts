/**
 * Front-screen review list (PRD §4.2): every review opened before, across
 * ALL repos, most recent first.
 *
 * Summaries are derived from the durable rows (reviews + repos +
 * review_snapshots + versions count) plus the snapshot JSON for counts.
 * Snapshots can be large, so each row is parsed once and released; the
 * endpoint stays fast for dozens of sessions (no gh/git calls here).
 */
import type { Job, ReviewSummary, ReviewSnapshot } from "@unvibe/shared";
import type { DatabaseSync } from "../store/index.js";

export interface ListReviewsDeps {
  db: DatabaseSync;
  jobsByReview?: (reviewId: string) => Job[];
  pipelineDisabled?: boolean;
}

interface ReviewRow {
  id: string;
  repo_id: string;
  branch: string;
  pr_number: number | null;
  current_version: number;
  created_at: number;
  data: string;
  owner: string | null;
  name: string | null;
  snapshot: string | null;
  updated_at: number | null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function titleFor(dataTitle: string, snapshot: ReviewSnapshot | null, branch: string): string {
  if (dataTitle.trim() !== "") return dataTitle;
  const root = snapshot?.pages?.find((p) => p.id === "root")?.title;
  if (root && root.trim() !== "" && root !== "Guided review") return root;
  return branch;
}

type GuideStatus = ReviewSummary["guideStatus"];

function guideStatusFor(
  snapshot: ReviewSnapshot | null,
  liveJobs: Job[],
  pipelineDisabled: boolean,
): { status: GuideStatus; detail?: string } {
  const running = liveJobs.filter(
    (j) => j.state === "queued" || j.state === "running" || j.state === "backing-off",
  );
  const errored = liveJobs.filter((j) => j.state === "error");
  if (running.length > 0) {
    const kinds = [...new Set(running.map((j) => j.kind))].slice(0, 3).join(", ");
    return { status: "running", detail: `Running: ${kinds}` };
  }
  if (errored.length > 0) {
    return { status: "error", detail: errored[0].error ?? `${errored.length} job(s) failed` };
  }
  const stages = snapshot?.pipeline?.stages as
    | Record<string, "pending" | "running" | "done" | "error">
    | undefined;
  if (stages) {
    const values = Object.values(stages);
    if (values.length > 0 && values.every((v) => v === "done")) return { status: "ready" };
    if (values.some((v) => v === "error")) {
      const errs = snapshot?.pipeline?.errors;
      const first = errs ? Object.values(errs)[0] : undefined;
      return { status: "error", detail: typeof first === "string" ? first : "A pipeline stage failed" };
    }
    if (values.some((v) => v === "running")) return { status: "running", detail: "Pipeline running" };
  }
  const hasCards = (snapshot?.pages ?? []).some((p) => (p.cards ?? []).length > 0);
  if (hasCards) return { status: "ready" };
  if (pipelineDisabled) return { status: "disabled", detail: "Pipeline disabled (UNVIBE_AGENT=none)" };
  return { status: "idle", detail: "Guide not started yet" };
}

/** Touch a review's last-opened time (best effort; never throws). */
export function touchReviewOpened(db: DatabaseSync, reviewId: string): void {
  try {
    db.prepare("UPDATE review_snapshots SET updated_at = ? WHERE review_id = ?").run(Date.now(), reviewId);
  } catch {
    // Missing snapshot row (pre-M1 data): ignore.
  }
}

export function listReviewSummaries(deps: ListReviewsDeps): ReviewSummary[] {
  const { db } = deps;
  let rows: ReviewRow[];
  try {
    rows = db
      .prepare(
        `SELECT r.id, r.repo_id, r.branch, r.pr_number, r.current_version, r.created_at, r.data,
                repos.owner AS owner, repos.name AS name,
                rs.snapshot AS snapshot, rs.updated_at AS updated_at
         FROM reviews r
         LEFT JOIN repos ON repos.id = r.repo_id
         LEFT JOIN review_snapshots rs ON rs.review_id = r.id
         ORDER BY COALESCE(rs.updated_at, r.created_at) DESC`,
      )
      .all() as unknown as ReviewRow[];
  } catch {
    return [];
  }

  const versionCounts = new Map<string, number>();
  try {
    const vc = db
      .prepare("SELECT review_id AS reviewId, COUNT(*) AS n FROM versions GROUP BY review_id")
      .all() as unknown as { reviewId: string; n: number }[];
    for (const r of vc) versionCounts.set(r.reviewId, r.n);
  } catch {
    // versions table missing in a bare test DB: fall back per-row below.
  }

  const out: ReviewSummary[] = [];
  for (const row of rows) {
    const data = parseJson<{ title?: string }>(row.data, {});
    const snapshot = row.snapshot ? parseJson<ReviewSnapshot | null>(row.snapshot, null) : null;
    const liveJobs = deps.jobsByReview ? safeJobs(deps.jobsByReview, row.id) : [];
    const files = snapshot?.files ?? [];
    const totalHunks = files.reduce((n, f) => n + (f.hunks?.length ?? 0), 0);
    const reviewedHunks = (snapshot?.hunkStates ?? []).filter((s) => s.reviewed).length;
    const pendingComments = (snapshot?.annotations ?? []).filter(
      (a) => a.type === "thread" && (a as { post?: boolean }).post && !(a as { postedAt?: number }).postedAt,
    ).length;
    const stale = snapshot?.versionStatus?.stale ?? false;
    const guide = guideStatusFor(snapshot, liveJobs, deps.pipelineDisabled ?? false);
    const title = titleFor(data.title ?? "", snapshot, row.branch);
    out.push({
      id: row.id,
      repoId: row.repo_id,
      repoOwner: row.owner ?? "local",
      repoName: row.name ?? row.repo_id,
      title,
      branch: row.branch,
      ...(row.pr_number !== null ? { prNumber: row.pr_number } : {}),
      createdAt: row.created_at,
      lastOpened: row.updated_at ?? row.created_at,
      versionCount: versionCounts.get(row.id) ?? snapshot?.review?.versions?.length ?? row.current_version,
      currentVersion: row.current_version,
      stale,
      totalHunks,
      reviewedHunks,
      pendingComments,
      guideStatus: guide.status,
      ...(guide.detail ? { guideDetail: guide.detail } : {}),
    });
  }
  return out;
}

function safeJobs(fn: (id: string) => Job[], id: string): Job[] {
  try {
    return fn(id) ?? [];
  } catch {
    return [];
  }
}
