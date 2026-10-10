/**
 * Reviews (M1 service + M5 versions):
 * - `POST /api/reviews` — ingest a PR or branch, persist review + version 1
 *   rows, the v1 per-version files (M5, migration 003), and the v1 snapshot.
 * - `GET /api/reviews/:id[?version=n]` — the current snapshot, or the
 *   snapshot with an older version's `version` + `files` swapped in (M5:
 *   older versions stay viewable).
 * - `POST /api/reviews/:id/refresh` — fetch and compare (no agent time,
 *   PRD §8.1). A moved head creates version n+1 with the old→new ID mapping
 *   and applies the §8 table in one `ReviewStore.mutate`.
 * - `POST /api/reviews/:id/update` — manual only: enqueues the update-pass
 *   job (M5). 501 until a `JobQueue` + `UpdateBaseRunner` are wired.
 * - `POST …/actions` (M3) stays a 501 stub here.
 */
import type { FastifyInstance } from "fastify";
import type {
  CreateReviewRequest,
  RefreshResponse,
  ReviewSnapshot,
  UpdateReviewResponse,
  Version,
} from "@unvibe/shared";
import { summarizeComparison } from "@unvibe/shared";
import {
  ingestReview,
  newReviewId,
  readReviewRow,
  writeReviewRows,
} from "../ingest/index.js";
import { transaction } from "../store/index.js";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";
import { loadVersionFiles, saveVersionFiles } from "../versions/files.js";
import { refreshReview } from "../versions/refresh.js";
import {
  enqueueUpdatePass,
  JsonBlockReplyParser,
  type UpdateBaseRunner,
  type UpdateReplyParser,
} from "../versions/update.js";

const TODO_ACTIONS = { error: "not implemented: M3 actions" };

/**
 * Extra M5 dependencies for the reviews routes. The supervisor wires the
 * real base pipeline; tests inject a fake `baseRunner`. Absent `jobs` or
 * `baseRunner`, `POST …/update` stays 501 like the other unwired stubs.
 */
export interface ReviewsRouteDeps {
  baseRunner?: UpdateBaseRunner;
  parser?: UpdateReplyParser;
  promptsDir?: string;
}

export type RegisterReviewsDeps = RouteDeps & ReviewsRouteDeps;

/**
 * POST /api/reviews · GET /api/reviews/:id ·
 * POST /api/reviews/:id/refresh · POST /api/reviews/:id/update ·
 * POST /api/reviews/:id/actions
 */
export async function registerReviews(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RegisterReviewsDeps = {},
): Promise<void> {
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
      saveVersionFiles(ctx.db, reviewId, ingested.version.n, ingested.files);
      ctx.reviews.putSnapshot(reviewId, snapshot);
    });
    ctx.repos.touch(repo.id);
    return reply.code(201).send(snapshot);
  });

  app.get("/api/reviews/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { version?: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    if (query.version === undefined) return snapshot;

    const n = Number(query.version);
    if (!Number.isSafeInteger(n) || n < 1) {
      return reply.code(400).send({ error: `bad ?version=${query.version}` });
    }
    if (n === snapshot.version.n) return snapshot;
    const vrow = ctx.db
      .prepare(
        "SELECT n, head_sha AS headSha, merge_base_sha AS mergeBaseSha, base_ref AS baseRef, fetched_at AS fetchedAt, id_mapping AS idMapping FROM versions WHERE review_id = ? AND n = ?",
      )
      .get(id, n) as
      | { n: number; headSha: string; mergeBaseSha: string; baseRef: string; fetchedAt: number; idMapping: string }
      | undefined;
    if (!vrow) return reply.code(404).send({ error: `unknown version ${n}` });
    const files = loadVersionFiles(ctx.db, id, n);
    if (!files) return reply.code(404).send({ error: `no files stored for version ${n}` });
    const version: Version = {
      n: vrow.n,
      headSha: vrow.headSha,
      mergeBaseSha: vrow.mergeBaseSha,
      baseRef: vrow.baseRef,
      fetchedAt: vrow.fetchedAt,
      idMapping: JSON.parse(vrow.idMapping) as Record<string, string>,
    };
    return { ...snapshot, version, files };
  });

  app.post("/api/reviews/:id/refresh", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = readReviewRow(ctx.db, id);
    if (!row) return reply.code(404).send({ error: "unknown review" });
    const repo = ctx.repos.get(row.repoId);
    if (!repo) return reply.code(404).send({ error: "unknown repo" });
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });

    let result;
    try {
      result = await refreshReview(
        { runner: ctx.runner, db: ctx.db, reviews: ctx.reviews },
        repo.localPath,
        id,
        row,
        snapshot,
      );
    } catch (err) {
      return reply.code(502).send({ error: `refresh failed: ${(err as Error).message}` });
    }
    if (!result.moved) {
      const response: RefreshResponse = { review: snapshot.review, newVersion: false };
      return response;
    }
    const after = ctx.reviews.getSnapshot(id);
    const response: RefreshResponse = {
      review: after?.review ?? snapshot.review,
      newVersion: true,
      comparison: summarizeComparison(result.comparison),
      version: result.version,
    };
    return response;
  });

  app.post("/api/reviews/:id/update", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    if (!deps.jobs || !deps.baseRunner) {
      return reply.code(501).send({ error: "not implemented: update pass not wired (no job queue / base runner)" });
    }
    const parser = deps.parser ?? new JsonBlockReplyParser();
    let provider = "main";
    let model = "main-model";
    try {
      const s = deps.settings?.get();
      if (s) {
        provider = s.main.provider;
        model = s.main.model;
      }
    } catch {
      // Keep defaults.
    }
    void req;
    try {
      const job = enqueueUpdatePass(
        {
          jobs: deps.jobs,
          reviews: ctx.reviews,
          baseRunner: deps.baseRunner,
          parser,
          ...(deps.promptsDir !== undefined ? { promptsDir: deps.promptsDir } : {}),
          provider,
          model,
        },
        { reviewId: id, toVersion: snapshot.review.currentVersion },
      );
      const response: UpdateReviewResponse = { jobId: job.id, toVersion: snapshot.review.currentVersion };
      return reply.code(202).send(response);
    } catch (err) {
      const msg = (err as Error).message;
      if (/up to date/.test(msg)) return reply.code(409).send({ error: msg });
      if (/no prompts dir/.test(msg)) return reply.code(500).send({ error: msg });
      return reply.code(500).send({ error: msg });
    }
  });

  app.post("/api/reviews/:id/actions", async (_req, reply) => reply.code(501).send(TODO_ACTIONS));
}
