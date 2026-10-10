/**
 * Reviews (M1 service):
 * - `POST /api/reviews` — ingest a PR or branch, persist review + version 1
 *   rows and the v1 snapshot, return the snapshot.
 * - `GET /api/reviews/:id` — the current snapshot.
 * - `POST /api/reviews/:id/refresh` — fetch and report whether the head SHA
 *   moved. M5 seam: creating versions + ID mapping is milestone M5's job;
 *   this route only detects movement.
 * - `POST …/update` (M5) and `POST …/actions` (M3) stay 501 stubs here.
 */
import type { FastifyInstance } from "fastify";
import type {
  CreateReviewRequest,
  RefreshResponse,
  ReviewSnapshot,
} from "@unvibe/shared";
import {
  ingestReview,
  newReviewId,
  readReviewRow,
  resolveHead,
  writeReviewRows,
} from "../ingest/index.js";
import { transaction } from "../store/index.js";
import type { ServiceContext } from "./context.js";

const TODO_UPDATE = { error: "not implemented: M5 update pass" };
const TODO_ACTIONS = { error: "not implemented: M3 actions" };

/**
 * POST /api/reviews · GET /api/reviews/:id ·
 * POST /api/reviews/:id/refresh · POST /api/reviews/:id/update ·
 * POST /api/reviews/:id/actions
 */
export async function registerReviews(app: FastifyInstance, ctx: ServiceContext): Promise<void> {
  app.post("/api/reviews", async (req, reply) => {
    const body = (req.body ?? {}) as CreateReviewRequest;
    if (!body.repoId) return reply.code(400).send({ error: "repoId is required" });
    if (body.pr === undefined && !body.branch) {
      return reply.code(400).send({ error: "either pr or branch is required" });
    }
    const repo = ctx.repos.get(body.repoId);
    if (!repo) return reply.code(404).send({ error: "unknown repo" });

    const reviewId = newReviewId();
    let ingested;
    try {
      ingested = await ingestReview(
        { runner: ctx.runner, dataDir: ctx.dataDir },
        { repoPath: repo.localPath, ...(body.pr !== undefined ? { pr: body.pr } : { branch: body.branch }) },
        reviewId,
      );
    } catch (err) {
      return reply.code(502).send({ error: `ingest failed: ${(err as Error).message}` });
    }

    const snapshot: ReviewSnapshot = {
      review: { ...ingested.review, repoId: repo.id },
      version: ingested.version,
      files: ingested.files,
      description: ingested.description,
      pages: [],
      annotations: [],
      hunkStates: [],
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
    };
    transaction(ctx.db, () => {
      writeReviewRows(ctx.db, repo.id, { ...ingested, review: snapshot.review });
      ctx.reviews.putSnapshot(reviewId, snapshot);
    });
    ctx.repos.touch(repo.id);
    return reply.code(201).send(snapshot);
  });

  app.get("/api/reviews/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    return snapshot;
  });

  app.post("/api/reviews/:id/refresh", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = readReviewRow(ctx.db, id);
    if (!row) return reply.code(404).send({ error: "unknown review" });
    const repo = ctx.repos.get(row.repoId);
    if (!repo) return reply.code(404).send({ error: "unknown repo" });
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });

    let head: { headSha: string; baseRef: string };
    try {
      head = await resolveHead(ctx.runner, repo.localPath, {
        ...(row.prNumber !== null ? { pr: row.prNumber } : { branch: row.branch }),
      });
    } catch (err) {
      return reply.code(502).send({ error: `refresh failed: ${(err as Error).message}` });
    }
    const moved = head.headSha !== "" && head.headSha !== snapshot.version.headSha;

    // M5 seam: when `moved`, M5 creates version n+1 with the old→new ID
    // mapping (§8), remaps anchors, and refreshes the snapshot. M1 only
    // reports; the stored snapshot is untouched.
    const response: RefreshResponse = { review: snapshot.review, newVersion: moved };
    return response;
  });

  app.post("/api/reviews/:id/update", async (_req, reply) => reply.code(501).send(TODO_UPDATE));
  app.post("/api/reviews/:id/actions", async (_req, reply) => reply.code(501).send(TODO_ACTIONS));
}
