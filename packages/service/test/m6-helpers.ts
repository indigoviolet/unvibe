/**
 * M6 test helpers: build PR/branch review snapshots + DB rows without
 * ingest (no git/gh needed). Unit tests drive routes + `runSubmit` with
 * `FakeCommandRunner` asserting exact `gh` invocations.
 */
import os from "node:os";
import type {
  Annotation,
  Review,
  ReviewFile,
  ReviewSnapshot,
  Version,
} from "@unvibe/shared";
import { FakeCommandRunner } from "../src/exec/index.js";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { StaticModelCatalog } from "../src/settings/index.js";
import { writeReviewRows } from "../src/ingest/index.js";
import { renderMarkdownBlocks } from "../src/ingest/description.js";
import { buildParagraphSources } from "../src/submit/description.js";
import { createApp, type AppContext } from "../src/server.js";

export const OWNER = "octo";
export const REPO_NAME = "hello";
export const PR_NUMBER = 7;
export const HEAD_SHA = "a".repeat(40);
export const BASE_SHA = "b".repeat(40);

export function repoRow() {
  return { id: "rp_m6", owner: OWNER, name: REPO_NAME, localPath: os.tmpdir(), lastOpened: 0 };
}

export function versionRow(): Version {
  return { n: 1, headSha: HEAD_SHA, mergeBaseSha: BASE_SHA, baseRef: "main", fetchedAt: 1, idMapping: {} };
}

/** One source file with a small hunk (add + context). */
export function sourceFile(overrides: Partial<ReviewFile> = {}): ReviewFile {
  return {
    fileKey: "a-py",
    path: "a.py",
    category: "source",
    hunks: [
      {
        contentHash: "h1",
        header: "@@ -1,3 +1,4 @@",
        newStart: 1,
        newEnd: 4,
        oldStart: 1,
        oldEnd: 3,
        added: 1,
        removed: 0,
        lines: [
          { kind: "ctx", oldLine: 1, newLine: 1, text: "x = 1" },
          { kind: "add", newLine: 2, text: "y = 2" },
          { kind: "ctx", oldLine: 2, newLine: 3, text: "z = 3" },
          { kind: "ctx", oldLine: 3, newLine: 4, text: "w = 4" },
        ],
      },
    ],
    ...overrides,
  };
}

/** File with a deleted row (old-side) for LEFT-side tests. */
export function deletedFile(): ReviewFile {
  return {
    fileKey: "d-py",
    path: "d.py",
    category: "source",
    hunks: [
      {
        contentHash: "hd",
        header: "@@ -1,4 +1,2 @@",
        newStart: 1,
        newEnd: 2,
        oldStart: 1,
        oldEnd: 4,
        added: 0,
        removed: 2,
        lines: [
          { kind: "ctx", oldLine: 1, newLine: 1, text: "keep" },
          { kind: "del", oldLine: 2, text: "gone one" },
          { kind: "del", oldLine: 3, text: "gone two" },
          { kind: "ctx", oldLine: 4, newLine: 2, text: "tail" },
        ],
      },
    ],
  };
}

export function renamedFile(): ReviewFile {
  const f = sourceFile({ fileKey: "new-py", path: "new.py", oldPath: "old.py", isRename: true });
  return f;
}

export function descriptionFor(baseMarkdown: string) {
  const rendered = renderMarkdownBlocks(baseMarkdown);
  const built = buildParagraphSources(baseMarkdown);
  return {
    html: rendered.html,
    rev: "1",
    source: "pr" as const,
    editable: true,
    baseMarkdown,
    paragraphSources: built.paragraphSources,
  };
}

export interface SetupOpts {
  files?: ReviewFile[];
  baseMarkdown?: string;
  annotations?: Annotation[];
  pages?: ReviewSnapshot["pages"];
  prNumber?: number | null;
  reviewId?: string;
  /** Agent runner override (default: a fresh FakeAgentRunner). */
  agents?: FakeAgentRunner;
}

/** Create an app + repo + review rows + snapshot. */
export async function setupReview(
  runner: FakeCommandRunner,
  opts: SetupOpts = {},
): Promise<AppContext & { reviewId: string }> {
  // Fake agents + static model catalog (issue #119): the shared-context
  // route resolves effective settings, which must never start the real
  // adapters. The static main pick (claude/claude-opus-5-5) is the base key.
  const { app, ctx, ...rest } = await createApp("tok", {
    runner,
    agents: opts.agents ?? new FakeAgentRunner(),
    models: new StaticModelCatalog(),
  });
  const repo = repoRow();
  ctx.repos.upsert(repo);
  const reviewId = opts.reviewId ?? "rv_m6";
  const version = versionRow();
  const prNumber = opts.prNumber === undefined ? PR_NUMBER : opts.prNumber;
  const review: Review = {
    id: reviewId,
    repoId: repo.id,
    branch: "feature",
    ...(prNumber !== null ? { prNumber } : {}),
    versions: [version],
    currentVersion: 1,
    createdAt: 1,
  };
  const files = opts.files ?? [sourceFile()];
  const baseMarkdown = opts.baseMarkdown ?? "First para.\n\nSecond para.\n";
  const description = descriptionFor(baseMarkdown);
  writeReviewRows(ctx.db, repo.id, {
    review,
    version,
    files,
    description,
    commits: [],
    title: review.branch,
    worktreePath: os.tmpdir(),
  });
  const snapshot: ReviewSnapshot = {
    review,
    version,
    files,
    description,
    ingest: { status: "ready" },
    pages: opts.pages ?? [],
    annotations: opts.annotations ?? [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  };
  ctx.reviews.putSnapshot(reviewId, snapshot);
  return { app, ctx, reviewId, ...rest };
}

let threadSeq = 0;
export function threadOnDiffLine(
  fileKey: string,
  line: number,
  text: string,
  extra: Partial<Annotation> = {},
): Annotation {
  threadSeq += 1;
  return {
    id: `ann_test${threadSeq}`,
    type: "comment",
    anchor: { host: { kind: "diff-line", fileKey, line }, quotedText: "q", prefix: "", suffix: "", position: line, version: 1 },
    open: true,
    messages: [{ who: "you", text }],
    post: true,
    ...extra,
    // `extra` is a Partial, so its `pinned` may be absent; Annotation requires it.
    pinned: extra.pinned ?? false,
  };
}
