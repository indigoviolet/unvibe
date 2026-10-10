/**
 * Demo ingest (M3): repo-less review from `fixtures/urllib3-5020/`.
 *
 * With the replay runner, creating a review from the special "demo" source
 * ingests the fixture diff + description and runs the *same pipeline code
 * path* against the recordings. No git/gh, no tokens.
 */
import fs from "node:fs";
import path from "node:path";
import type { Review, ReviewDescription, ReviewFile, Version } from "@unvibe/shared";
import { classifyFile, fileKeyForPath, hashHunkLines, parseUnifiedDiff, renderMarkdownBlocks, uninterestingReason } from "../ingest/index.js";
import { newReviewId } from "../ingest/index.js";

export interface DemoIngested {
  review: Review;
  version: Version;
  files: ReviewFile[];
  description: ReviewDescription;
  worktreePath: string;
  title: string;
}

export function fixturesDirDefault(explicit?: string): string {
  if (explicit) return explicit;
  const fromCwd = path.resolve(process.cwd(), "fixtures", "urllib3-5020");
  if (fs.existsSync(fromCwd)) return fromCwd;
  // packages/service/dist/pipeline/demo.js → repo fixtures
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..", "..", "..", "..", "fixtures", "urllib3-5020");
}

export function isDemoRequest(body: { repoId?: string; demo?: boolean | string }): boolean {
  if (body.demo) return true;
  return body.repoId === "demo";
}

export function demoFixtureName(body: { demo?: boolean | string }): string {
  if (typeof body.demo === "string" && body.demo) return body.demo;
  return "urllib3-5020";
}

/** Ingest the fixture diff + description (no git/gh). */
export function ingestDemo(fixturesDir: string, reviewId: string = newReviewId(), dataDir?: string): DemoIngested {
  const read = (p: string): string => fs.readFileSync(path.join(fixturesDir, p), "utf8");
  const meta = JSON.parse(read("meta.json")) as {
    repo: string;
    pr: number;
    title: string;
    headSha: string;
    mergeBaseSha: string;
    baseRef: string;
  };
  const diffEntries = JSON.parse(read("diff.json")) as { diff: string }[];
  const diffText = diffEntries.map((e) => e.diff).join("\n");
  const parsed = parseUnifiedDiff(diffText);
  const files: ReviewFile[] = parsed.map((f) => {
    const category = classifyFile(f.path);
    return {
      fileKey: fileKeyForPath(f.path),
      path: f.path,
      category,
      hunks: f.hunks.map((h) => {
        const contentHash = hashHunkLines(h.lines);
        const reason = uninterestingReason(h, { category });
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
          ...(reason !== undefined ? { hiddenReason: reason } : {}),
        };
      }),
      ...(f.oldPath !== undefined ? { oldPath: f.oldPath } : {}),
      ...(f.isNew ? { isNew: true as const } : {}),
      ...(f.isDeleted ? { isDeleted: true as const } : {}),
      ...(f.isRename ? { isRename: true as const } : {}),
      ...(f.isBinary ? { isBinary: true as const } : {}),
    };
  });
  const now = Date.now();
  const review: Review = {
    id: reviewId,
    repoId: "demo",
    branch: meta.baseRef,
    prNumber: meta.pr,
    versions: [],
    currentVersion: 1,
    createdAt: now,
  };
  const version: Version = {
    n: 1,
    headSha: meta.headSha,
    mergeBaseSha: meta.mergeBaseSha,
    baseRef: meta.baseRef,
    fetchedAt: now,
    idMapping: {},
  };
  review.versions = [version];
  const rendered = renderMarkdownBlocks(read("description.md"));
  const description: ReviewDescription = { html: rendered.html, rev: "1", source: "pr", editable: false };
  const worktreePath = dataDir ? path.join(dataDir, "worktrees", reviewId) : path.join(fixturesDir);
  try {
    if (dataDir) fs.mkdirSync(worktreePath, { recursive: true });
  } catch {
    // ignore
  }
  return { review, version, files, description, worktreePath, title: meta.title };
}
