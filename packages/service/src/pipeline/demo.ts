/**
 * Demo ingest (M3): repo-less review from `fixtures/urllib3-5020/`.
 *
 * With the replay runner, creating a review from the special "demo" source
 * ingests the fixture diff + description and runs the *same pipeline code
 * path* against the recordings. No git/gh, no tokens.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Review, ReviewCommit, ReviewDescription, ReviewFile, Version } from "@unvibe/shared";
import { buildReviewFiles, parseUnifiedDiff } from "@unvibe/shared";
import { renderMarkdownBlocks } from "../ingest/index.js";
import { newReviewId } from "../ingest/index.js";

export interface DemoIngested {
  review: Review;
  version: Version;
  files: ReviewFile[];
  description: ReviewDescription;
  /** Fixture carries no commit list; the reader prompt omits the section. */
  commits: ReviewCommit[];
  worktreePath: string;
  title: string;
}

export function fixturesDirDefault(explicit?: string): string {
  if (explicit) return explicit;
  // Module-relative first (bundle + global install outside the repo),
  // then the repo cwd (dev/tests). Bundle: dist/index.js → ../../../fixtures.
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const c of [
    path.resolve(here, "..", "..", "..", "..", "fixtures", "urllib3-5020"),
    path.resolve(here, "..", "..", "..", "fixtures", "urllib3-5020"),
    path.resolve(process.cwd(), "fixtures", "urllib3-5020"),
  ]) {
    try {
      if (fs.existsSync(path.join(c, "manifest.json"))) return c;
    } catch {
      // try next
    }
  }
  return path.resolve(process.cwd(), "fixtures", "urllib3-5020");
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
  // Shared diff pipeline (moved to `packages/shared/src/diff.ts`):
  // service `ingest/*` are re-export shims over the same functions.
  const files: ReviewFile[] = buildReviewFiles(parseUnifiedDiff(diffText));
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
  return { review, version, files, description, commits: [], worktreePath, title: meta.title };
}
