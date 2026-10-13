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
import { McpRegistry } from "../mcp/registry.js";
import { readCodeSlice } from "../mcp/read.js";
import { ingestRefusal } from "../reviews/index.js";
import type { ServiceContext } from "./context.js";

/** Lines per file-slice request (a full gap pages through repeats). */
export const MAX_SLICE_LINES = 200;

function isHexSha(v: string): boolean {
  return /^[0-9a-fA-F]{4,64}$/.test(v);
}

/** Where `git show <rev>:<path>` runs: the review's worktree, else the repo checkout. */
function cwdForReview(ctx: ServiceContext, reviewId: string, repoId: string): string | null {
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

    const cwd = cwdForReview(ctx, id, snapshot.review.repoId);
    if (!cwd) return reply.code(404).send({ error: "no checkout for this review" });
    try {
      McpRegistry.checkPathInRepo(cwd, relPath);
    } catch {
      return reply.code(400).send({ error: `path escapes repository: ${relPath}` });
    }

    const slice = await readCodeSlice(ctx.runner, cwd, commit, relPath, start, end);
    if ("error" in slice) {
      if (slice.error === "not-found") {
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
