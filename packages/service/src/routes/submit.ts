/**
 * Submit review (M6, PRD 4.12, 15) — the ONLY path that posts to GitHub.
 *
 * - `POST /api/reviews/:id/submit` with `{ dryRun: true }` returns the
 *   preview without posting (Submit panel).
 * - `GET /api/reviews/:id/submit/preview` is the same preview for panels
 *   that prefer GET.
 * - `GET /api/reviews/:id/pr-comments` fetches existing PR comments
 *   read-only (`gh api …/pulls/{n}/comments`) and caches them in the
 *   snapshot (`existingComments`).
 */
import type { FastifyInstance } from "fastify";
import type { SubmitReviewRequest } from "@unvibe/shared";
import { readReviewRow } from "../ingest/index.js";
import { buildPreview, fetchExistingComments, runSubmit } from "../submit/index.js";
import type { ServiceContext } from "./context.js";
import { ingestRefusal } from "../reviews/index.js";

/** POST /api/reviews/:id/submit — the ONLY path that posts to GitHub. */
export async function registerSubmit(app: FastifyInstance, ctx?: ServiceContext): Promise<void> {
  if (!ctx) {
    app.post("/api/reviews/:id/submit", async (_req, reply) =>
      reply.code(501).send({ error: "not available in this build" }),
    );
    return;
  }

  app.post("/api/reviews/:id/submit", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as SubmitReviewRequest;
    if (body.expectedCount !== undefined && !Number.isSafeInteger(body.expectedCount)) {
      return reply.code(400).send({ error: "expectedCount must be an integer" });
    }
    const out = await runSubmit(
      { runner: ctx.runner, db: ctx.db, repos: ctx.repos, reviews: ctx.reviews },
      id,
      {
        ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
        ...(body.expectedCount !== undefined ? { expectedCount: body.expectedCount } : {}),
      },
    );
    return reply.code(out.status).send(out.body);
  });

  app.get("/api/reviews/:id/submit/preview", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: `unknown review ${id}` });
    const refused = ingestRefusal(snapshot);
    if (refused) return reply.code(409).send({ error: refused });
    const row = readReviewRow(ctx.db, id);
    const prNumber = row?.prNumber ?? snapshot.review.prNumber;
    if (prNumber === null || prNumber === undefined) {
      const preview = buildPreview(snapshot);
      const reason = "This branch has no PR, so there is nothing to submit to.";
      return { preview: { ...preview, disabledReason: reason }, reason };
    }
    return { preview: buildPreview(snapshot) };
  });

  app.get("/api/reviews/:id/pr-comments", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: `unknown review ${id}` });
    const refusedComments = ingestRefusal(snapshot);
    if (refusedComments) return reply.code(409).send({ error: refusedComments });
    // Demo reviews have no git source: no GitHub comments exist.
    if (snapshot.review.repoId === "demo") return { comments: [] };
    const row = readReviewRow(ctx.db, id);
    const prNumber = row?.prNumber ?? snapshot.review.prNumber;
    if (prNumber === null || prNumber === undefined) {
      return reply.code(400).send({ error: "branch has no PR" });
    }
    const repo = row ? ctx.repos.get(row.repoId) : null;
    if (!repo) return reply.code(404).send({ error: "unknown repo" });
    try {
      const comments = await fetchExistingComments(
        ctx.runner,
        repo.localPath,
        repo.owner,
        repo.name,
        prNumber,
      );
      await ctx.reviews.mutate(id, (draft) => {
        draft.existingComments = comments.map((c) => ({ ...c }));
      });
      return { comments };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
