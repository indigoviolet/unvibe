/**
 * File slices (issue #133: expand a diff beyond its hunks).
 *
 * - `GET /api/reviews/:id/file?path=&commit=&start=&end=` — raw lines
 *   of `path` at `commit` through the single content-at-revision source
 *   (`readCodeSlice` in `mcp/read.ts`, the same `git show` the `get_code`
 *   tool serves). General on purpose: the diff expander reads hunk
 *   surroundings through it today; later uses read any range the same way.
 *
 * Never throws: unknown review → 404, bad range → 400, missing or binary
 * file → 404/400 with a human message. At most `MAX_SLICE_LINES` lines
 * per request; wider ranges page through repeated calls.
 */
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import type { FileSliceResponse } from "@unvibe/shared";
import { isDocumentReview } from "@unvibe/shared";
import { repoContainingSha } from "../document/resolve.js";
import { sendError } from "../errors.js";
import { McpRegistry } from "../mcp/registry.js";
import { readCodeSlice } from "../mcp/read.js";
import { ingestRefusal } from "../reviews/index.js";
import type { ServiceContext } from "./context.js";

/** Lines per file-slice request (a full gap pages through repeats). */
export const MAX_SLICE_LINES = 200;

export function isHexSha(v: string): boolean {
  return /^[0-9a-fA-F]{4,64}$/.test(v);
}

/** Where `git show <rev>:<path>` runs: the review's worktree, else the repo checkout. */
export function cwdForReview(ctx: ServiceContext, reviewId: string, repoId: string): string | null {
  const wt = path.join(ctx.dataDir, "worktrees", reviewId);
  try {
    if (fs.existsSync(wt)) return wt;
  } catch {
    // Fall through to the repo checkout.
  }
  try {
    const repo = ctx.repos.get(repoId);
    if (repo && fs.existsSync(repo.localPath)) return repo.localPath;
  } catch {
    // No readable cwd.
  }
  return null;
}

/**
 * True when `commit` resolves in `cwd` (the review carries file content
 * there). Reviews with no resolvable commit and no on-disk files fail
 * this — callers answer `no-content` so the UI hides expansion instead of
 * showing load errors. (The demo's files are materialized on disk, #176,
 * so its slices resolve before this is consulted.)
 */
export async function commitResolves(ctx: ServiceContext, cwd: string, commit: string): Promise<boolean> {
  try {
    const res = await ctx.runner.run("git", { args: ["cat-file", "-e", commit], cwd });
    return res.code === 0;
  } catch {
    return false;
  }
}

export async function registerFileSlices(app: FastifyInstance, ctx: ServiceContext): Promise<void> {
  app.get("/api/reviews/:id/file", async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { path?: string; commit?: string; start?: string; end?: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const refused = ingestRefusal(snapshot);
    if (refused) return reply.code(409).send({ error: refused });

    const relPath = query.path ?? "";
    const commit = query.commit ?? "";
    const start = Number(query.start);
    const end = Number(query.end);
    if (!relPath) return reply.code(400).send({ error: "path is required" });
    if (!isHexSha(commit)) return reply.code(400).send({ error: "commit must be a hex sha" });
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
      return reply.code(400).send({ error: "start and end must be line numbers with end after start" });
    }
    if (end - start + 1 > MAX_SLICE_LINES) {
      return reply.code(400).send({ error: `at most ${MAX_SLICE_LINES} lines per request` });
    }

    // Issue #222: on a document review, the repo is resolved from the
    // cited commit — the first context repo containing it. A commit in
    // neither repo falls through to the plain checkout, which cannot
    // serve it (the citation stays unverified and unopened).
    let cwd = cwdForReview(ctx, id, snapshot.review.repoId);
    if (isDocumentReview(snapshot)) {
      const ref = await repoContainingSha(ctx.runner, snapshot.contextRepos, commit);
      if (ref) cwd = ref.repoPath;
    }
    if (!cwd) return reply.code(404).send({ error: "no checkout for this review" });
    try {
      McpRegistry.checkPathInRepo(cwd, relPath);
    } catch {
      return reply.code(400).send({ error: `path escapes repository: ${relPath}` });
    }

    const slice = await readCodeSlice(ctx.runner, cwd, commit, relPath, start, end);
    if ("error" in slice) {
      if (slice.error === "not-found") {
        // Decided by a service-known fact, not by "is demo": when the
        // commit itself resolves nowhere, the review has no file content
        // to read. The UI hides expansion on
        // `no-content` instead of showing load errors.
        if (!(await commitResolves(ctx, cwd, commit))) {
          return sendError(reply, 404, "this review has no file content to read", "no-content");
        }
        return reply.code(404).send({ error: `no ${relPath} at ${commit}` });
      }
      if (slice.error === "binary") {
        return reply.code(400).send({ error: `${relPath} is a binary file and is not shown` });
      }
      const total = slice.totalLines ?? 0;
      return reply
        .code(400)
        // `totalLines` rides along so the caller learns the file end
        // without a second read (the diff expander hides its edge
        // controls once the range proves past the end).
        .send({ error: `lines ${start}-${end} are outside ${relPath} (${total} lines)`, totalLines: total });
    }
    const body: FileSliceResponse = {
      path: relPath,
      commit,
      start,
      end,
      totalLines: slice.totalLines,
      lines: slice.text.split("\n"),
    };
    return body;
  });
}
