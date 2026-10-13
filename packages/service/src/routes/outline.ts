/**
 * Enclosing units for a hunk range (issue #133, stage 2).
 *
 * - `GET /api/reviews/:id/outline?path=&commit=&start=&end=` — the chain
 *   of units enclosing the range (innermost first) for stepping one level
 *   out per click, with the unit name for the hunk header.
 *
 * Reads through the shared `git show` source (`readFileText`, same
 * family as the file-slice route) and parses with the service-side
 * tree-sitter grammars, falling back to the indentation heuristic.
 * Parsed trees cache by file content hash. Never throws on content: a
 * missing file answers 404 (`no-content` when the review has no file
 * content at all), binary/oversize/minified files answer an empty chain
 * with `how: "none"`, and only bad ranges are 400.
 */
import type { FastifyInstance } from "fastify";
import type { FileOutlineResponse } from "@unvibe/shared";
import { sendError } from "../errors.js";
import { McpRegistry } from "../mcp/registry.js";
import { readFileText } from "../mcp/read.js";
import { enclosingUnits } from "../outline/outline.js";
import { ingestRefusal } from "../reviews/index.js";
import type { ServiceContext } from "./context.js";
import { commitResolves, cwdForReview, isHexSha } from "./files.js";

export async function registerOutline(app: FastifyInstance, ctx: ServiceContext): Promise<void> {
  app.get("/api/reviews/:id/outline", async (req, reply) => {
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

    const cwd = cwdForReview(ctx, id, snapshot.review.repoId);
    if (!cwd) return reply.code(404).send({ error: "no checkout for this review" });
    try {
      McpRegistry.checkPathInRepo(cwd, relPath);
    } catch {
      return reply.code(400).send({ error: `path escapes repository: ${relPath}` });
    }

    const file = await readFileText(ctx.runner, cwd, commit, relPath);
    if ("error" in file) {
      if (file.error === "not-found") {
        if (!(await commitResolves(ctx, cwd, commit))) {
          return sendError(reply, 404, "this review has no file content to read", "no-content");
        }
        return reply.code(404).send({ error: `no ${relPath} at ${commit}` });
      }
      // Binary files have no units: degrade, don't refuse.
      const body: FileOutlineResponse = {
        path: relPath,
        commit,
        start,
        end,
        totalLines: 0,
        language: null,
        how: "none",
        chain: [],
      };
      return body;
    }
    if (end > file.totalLines) {
      return reply.code(400).send({ error: `lines ${start}-${end} are outside ${relPath} (${file.totalLines} lines)` });
    }
    const outline = await enclosingUnits(relPath, file.text, start, end);
    const body: FileOutlineResponse = {
      path: relPath,
      commit,
      start,
      end,
      totalLines: outline.totalLines,
      language: outline.language,
      how: outline.how,
      chain: outline.chain,
    };
    return body;
  });
}
