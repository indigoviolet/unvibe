/**
 * Review ingest (PRD §11.1, no-agent steps).
 *
 * `ingestReview` turns a PR or branch into version-1 review data:
 * resolve → fetch → merge-base → local diff → parse → IDs → classify →
 * worktree. Description, hunk hashes, file keys, and `hidden_reason`
 * pre-classification included. The caller persists the result (reviews +
 * versions rows via `writeReviewRows`, snapshot via `ReviewStore`).
 */
import { randomBytes } from "node:crypto";
import type {
  Review,
  ReviewCommit,
  ReviewDescription,
  ReviewFile,
  Version,
} from "@unvibe/shared";
import type { DatabaseSync } from "../store/index.js";
import type { CommandRunner } from "../exec/index.js";
import { buildReviewFiles, displayedReviewDecision } from "@unvibe/shared";
import { renderCommitMessages, renderMarkdownBlocks } from "./description.js";
import { parseUnifiedDiff } from "./diff.js";
import { buildReviewCommits, readCommitDiffs } from "./commits.js";
import { resolveSource, type IngestSource } from "./source.js";
import { splitRawBlocks } from "../submit/description.js";

export type { IngestSource };
export { parseUnifiedDiff } from "./diff.js";
export { hashHunkLines, hunkHashInput, normaliseHunkLine } from "./hash.js";
export { classifyFile, fileKeyForPath } from "./classify.js";
export { uninterestingReason } from "./uninteresting.js";
export { buildReviewFiles } from "@unvibe/shared";
export { renderCommitMessages, renderMarkdownBlocks, renderInline } from "./description.js";
export { baseRefCandidates, readCommitMessages, resolveHead, resolvePrMergeBase, resolveSource } from "./source.js";
export { buildReviewCommits, readCommitDiffs, MAX_COMMIT_DIFFS } from "./commits.js";

export interface IngestDeps {
  runner: CommandRunner;
  /** Service data dir (worktrees live in `<dataDir>/worktrees`). */
  dataDir: string;
}

/** #179: the diff is empty — there is nothing to review. Distinct from a
 * failed ingest so the UI can say "No changes to review" (with Retry /
 * Remove) instead of "Couldn't open". No pipeline runs for an empty diff. */
export class EmptyDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyDiffError";
  }
}

export function emptyDiffMessage(args: {
  prNumber?: number;
  prState?: string;
  branch: string;
  baseRef: string;
}): string {
  if (args.prNumber !== undefined) {
    if (args.prState === "MERGED") {
      return "No changes to review: this PR has been merged and its branch is now the same as its base, so the diff is empty.";
    }
    return "No changes to review: this PR's branch is the same as its base, so the diff is empty. Its changes may already be in the base branch.";
  }
  return `No changes to review: branch "${args.branch}" is the same as its base (${args.baseRef}), so the diff is empty. There are no changes to show yet.`;
}

/** #179: no hunks and no binary change — nothing for a reader or agent. */
export function isEmptyDiff(files: ReviewFile[]): boolean {
  return files.every((f) => f.hunks.length === 0 && !f.isBinary);
}

export interface IngestedReview {
  review: Review;
  version: Version;
  files: ReviewFile[];
  description: ReviewDescription;
  /** Issue #193: commits with per-commit files/hunks, landing order. */
  commits: ReviewCommit[];
  worktreePath: string;
  /** Display title: PR title or branch name (stored in reviews.data for the front-screen list). */
  title: string;
}

/** New review/version-1 ids. Format `rv_<12 hex>` (app-assigned, PRD §7.2). */
export function newReviewId(): string {
  return `rv_${randomBytes(6).toString("hex")}`;
}

/** Query `linguist-generated` for every path; empty set when git can't tell. */
async function linguistGenerated(
  runner: CommandRunner,
  repoPath: string,
  headSha: string,
  paths: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (paths.length === 0) return out;
  try {
    const res = await runner.run(
      "git",
      { args: ["check-attr", "linguist-generated", "--stdin"], cwd: repoPath, stdin: paths.join("\n") },
    );
    if (res.code !== 0) return out;
    for (const line of res.stdout.split("\n")) {
      const m = line.match(/^(.*): linguist-generated: (.*)$/);
      if (m && m[2].trim() === "set") out.add(m[1]);
    }
  } catch {
    // Best effort only.
  }
  void headSha;
  return out;
}

/**
 * Ingest a PR or branch into version-1 review data. Pure git/gh side
 * effects only (fetch, worktree); persistence is the caller's job.
 *
 * `refresh` (PR sources): the caller's repo-wide fetch, awaited alongside
 * `gh pr view` instead of before it (#123).
 */
export async function ingestReview(
  deps: IngestDeps,
  source: IngestSource,
  reviewId: string = newReviewId(),
  refresh?: Promise<unknown> | null,
): Promise<IngestedReview> {
  const resolved = await resolveSource(deps.runner, source, deps.dataDir, reviewId, refresh ?? null);
  const parsed = parseUnifiedDiff(resolved.diffText);
  const gen = await linguistGenerated(
    deps.runner,
    source.repoPath,
    resolved.headSha,
    parsed.map((f) => f.path),
  );

  // classify → key → hash → hidden_reason via the shared pure pipeline
  // (the web mock fixture builds its files through this same function).
  const files: ReviewFile[] = buildReviewFiles(parsed, { linguistGenerated: gen });
  if (isEmptyDiff(files)) {
    throw new EmptyDiffError(
      emptyDiffMessage({
        ...(resolved.prNumber !== undefined ? { prNumber: resolved.prNumber } : {}),
        ...(resolved.descriptionState !== undefined ? { prState: resolved.descriptionState } : {}),
        branch: resolved.branch,
        baseRef: resolved.baseRef,
      }),
    );
  }
  // Issue #193: per-commit files/hunks for the reader's plotline evidence.
  const commitDiffs = await readCommitDiffs(deps.runner, source.repoPath, resolved.commits);
  const commits = buildReviewCommits(resolved.commits, commitDiffs, files);

  const now = Date.now();
  const prNumber = resolved.prNumber;
  const review: Review = {
    id: reviewId,
    repoId: "",
    branch: resolved.branch,
    ...(prNumber !== undefined ? { prNumber } : {}),
    versions: [],
    currentVersion: 1,
    createdAt: now,
  };
  const version: Version = {
    n: 1,
    headSha: resolved.headSha,
    mergeBaseSha: resolved.mergeBaseSha,
    baseRef: resolved.baseRef,
    fetchedAt: now,
    idMapping: {},
  };
  review.versions = [version];

  let description: ReviewDescription;
  if (prNumber !== undefined) {
    const rendered = renderMarkdownBlocks(resolved.descriptionMarkdown);
    // M6: keep the verbatim body + per-paragraph sources so edited HTML
    // converts back with byte-for-byte round-trip outside edited paragraphs.
    const paragraphSources: Record<string, string> = {};
    for (const b of splitRawBlocks(resolved.descriptionMarkdown)) {
      if (b.id) paragraphSources[b.id] = b.raw;
    }
    description = {
      html: rendered.html,
      rev: "1",
      source: "pr",
      editable: resolved.descriptionEditable,
      ...(resolved.descriptionAuthor !== undefined ? { author: resolved.descriptionAuthor } : {}),
      ...(resolved.descriptionState !== undefined ? { state: resolved.descriptionState } : {}),
      ...(resolved.descriptionIsDraft !== undefined ? { isDraft: resolved.descriptionIsDraft } : {}),
      ...(displayedReviewDecision({
        reviewDecision: resolved.descriptionReviewDecision,
        reviewRequests: resolved.descriptionReviewRequests,
        latestReviews: resolved.descriptionLatestReviews,
      }) !== undefined
        ? {
            reviewDecision: displayedReviewDecision({
              reviewDecision: resolved.descriptionReviewDecision,
              reviewRequests: resolved.descriptionReviewRequests,
              latestReviews: resolved.descriptionLatestReviews,
            }),
          }
        : {}),
      baseMarkdown: resolved.descriptionMarkdown,
      paragraphSources,
    };
  } else {
    const rendered = renderCommitMessages(resolved.commits);
    description = {
      html: rendered.html,
      rev: "1",
      source: "commits",
      editable: false,
    };
  }

  return { review, version, files, description, commits, worktreePath: resolved.worktreePath, title: resolved.title };
}

/** Persist the review + version-1 rows (snapshot goes via `ReviewStore`). */
export function writeReviewRows(
  db: DatabaseSync,
  repoId: string,
  ingested: IngestedReview,
): void {
  const { review, version } = ingested;
  const title = ingested.title ?? "";
  db.prepare(
    "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    review.id,
    repoId,
    review.branch,
    review.prNumber ?? null,
    review.currentVersion,
    review.createdAt,
    JSON.stringify({ title }),
  );
  db.prepare(
    "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    review.id,
    version.n,
    version.headSha,
    version.mergeBaseSha,
    version.baseRef,
    version.fetchedAt,
    JSON.stringify(version.idMapping),
  );
}

/** Read a review row back (null when unknown). */
export function readReviewRow(
  db: DatabaseSync,
  reviewId: string,
): { id: string; repoId: string; branch: string; prNumber: number | null } | null {
  const row = db
    .prepare("SELECT id, repo_id AS repoId, branch, pr_number AS prNumber FROM reviews WHERE id = ?")
    .get(reviewId) as
    | { id: string; repoId: string; branch: string; prNumber: number | null }
    | undefined;
  return row ?? null;
}
