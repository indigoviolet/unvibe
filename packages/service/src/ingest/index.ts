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
  Hunk,
  Review,
  ReviewDescription,
  ReviewFile,
  Version,
} from "@unvibe/shared";
import type { DatabaseSync } from "../store/index.js";
import type { CommandRunner } from "../exec/index.js";
import { classifyFile } from "./classify.js";
import { renderCommitMessages, renderMarkdownBlocks } from "./description.js";
import { hashHunkLines } from "./hash.js";
import { fileKeyForPath } from "./classify.js";
import { parseUnifiedDiff } from "./diff.js";
import { resolveSource, type IngestSource } from "./source.js";
import { uninterestingReason } from "./uninteresting.js";
import { splitRawBlocks } from "../submit/description.js";

export type { IngestSource };
export { parseUnifiedDiff } from "./diff.js";
export { hashHunkLines, hunkHashInput, normaliseHunkLine } from "./hash.js";
export { classifyFile, fileKeyForPath } from "./classify.js";
export { uninterestingReason } from "./uninteresting.js";
export { renderCommitMessages, renderMarkdownBlocks, renderInline } from "./description.js";
export { resolveHead, resolveSource } from "./source.js";

export interface IngestDeps {
  runner: CommandRunner;
  /** Service data dir (worktrees live in `<dataDir>/worktrees`). */
  dataDir: string;
}

export interface IngestedReview {
  review: Review;
  version: Version;
  files: ReviewFile[];
  description: ReviewDescription;
  worktreePath: string;
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
 */
export async function ingestReview(
  deps: IngestDeps,
  source: IngestSource,
  reviewId: string = newReviewId(),
): Promise<IngestedReview> {
  const resolved = await resolveSource(deps.runner, source, deps.dataDir, reviewId);
  const parsed = parseUnifiedDiff(resolved.diffText);
  const gen = await linguistGenerated(
    deps.runner,
    source.repoPath,
    resolved.headSha,
    parsed.map((f) => f.path),
  );

  const files: ReviewFile[] = parsed.map((f) => {
    const category = classifyFile(f.path, { linguistGenerated: gen });
    const fileKey = fileKeyForPath(f.path);
    const hunks: Hunk[] = f.hunks.map((h) => {
      const contentHash = hashHunkLines(h.lines);
      return {
        contentHash,
        header: h.header,
        ...(h.context !== undefined ? { context: h.context } : {}),
        newStart: h.newStart,
        newEnd: h.newEnd,
        oldStart: h.oldStart,
        oldEnd: h.oldEnd,
        added: h.added,
        removed: h.removed,
        lines: h.lines.map((l) => ({ ...l })),
        ...(h.noNewline ? { noNewline: true as const } : {}),
        ...(() => {
          const reason = uninterestingReason(h, {
            category,
            generatedFlag: gen.has(f.path),
          });
          return reason !== undefined ? { hiddenReason: reason } : {};
        })(),
      };
    });
    return {
      fileKey,
      path: f.path,
      category,
      hunks,
      ...(f.oldPath !== undefined ? { oldPath: f.oldPath } : {}),
      ...(f.isNew ? { isNew: true as const } : {}),
      ...(f.isDeleted ? { isDeleted: true as const } : {}),
      ...(f.isRename ? { isRename: true as const } : {}),
      ...(f.isBinary ? { isBinary: true as const } : {}),
    };
  });

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

  return { review, version, files, description, worktreePath: resolved.worktreePath };
}

/** Persist the review + version-1 rows (snapshot goes via `ReviewStore`). */
export function writeReviewRows(
  db: DatabaseSync,
  repoId: string,
  ingested: IngestedReview,
): void {
  const { review, version } = ingested;
  db.prepare(
    "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    review.id,
    repoId,
    review.branch,
    review.prNumber ?? null,
    review.currentVersion,
    review.createdAt,
    JSON.stringify({ title: "" }),
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
