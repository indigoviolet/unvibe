/**
 * Reviews (M1 service + M5 versions + M3 pipeline):
 * - `POST /api/reviews` — ingest a PR or branch (or the `demo` fixture),
 *   persist review + version 1 rows, the v1 per-version files (M5), and the
 *   v1 snapshot. Triggers the M3 pipeline (`reader → base → critic/concepts
 *   → hunk pass`) in the background when wired.
 * - `GET /api/reviews/:id[?version=n]` — current snapshot (with live jobs
 *   merged in), or an older version's `version` + `files` swapped in.
 * - `POST /api/reviews/:id/refresh` — fetch and compare (no agent time).
 * - `POST /api/reviews/:id/update` — manual update pass (M5, via the
 *   pipeline's UpdateBaseRunner by default).
 * - `POST /api/reviews/:id/resume` — re-enqueue interrupted pipeline stages
 *   (M3 resilience; idempotent).
 * - `POST …/actions` — M3 dispatcher (`generate` implemented, rest 501).
 */
import type { FastifyInstance } from "fastify";
import type {
  CreateReviewRequest,
  RefreshResponse,
  ResetDataResponse,
  ResumeReviewResponse,
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
import { listAllRepos } from "./repos.js";
import { loadVersionFiles, saveVersionFiles } from "../versions/files.js";
import { refreshReview } from "../versions/refresh.js";
import {
  enqueueUpdatePass,
  JsonBlockReplyParser,
  type UpdateBaseRunner,
  type UpdateReplyParser,
} from "../versions/update.js";
import { demoFixtureName, fixturesDirDefault, ingestDemo, isDemoRequest } from "../pipeline/demo.js";
import { refreshManagedCheckout } from "../repos/index.js";
import { dispatchAction } from "../pipeline/actions/dispatcher.js";
import type { Pipeline } from "../pipeline/index.js";
import {
  deleteAllReviewRows,
  deleteReviewLocal,
  listReviewIds,
  listReviewSummaries,
  touchReviewOpened,
} from "../reviews/index.js";
import { hasAnySubmitLease } from "../update/index.js";
import { isNoneRunner } from "../agent/factory.js";

export interface ReviewsRouteDeps {
  baseRunner?: UpdateBaseRunner;
  parser?: UpdateReplyParser;
  promptsDir?: string;
  pipeline?: Pipeline;
  fixturesDir?: string;
  /**
   * When false, `POST /api/reviews` does not auto-trigger the pipeline.
   * Tests that assert exact revs / empty snapshots use this to preserve
   * pre-pipeline behaviour; production and pipeline tests use the default
   * (true). Demo reviews always trigger (they exist to exercise the pipe).
   */
  autoPipeline?: boolean;
}

export type RegisterReviewsDeps = RouteDeps & ReviewsRouteDeps;

export async function registerReviews(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RegisterReviewsDeps = {},
): Promise<void> {
  const pipeline = (deps as { pipeline?: Pipeline }).pipeline;
  const autoPipeline = (deps as { autoPipeline?: boolean }).autoPipeline ?? true;

  // Front screen: every review opened before, across ALL repos, most
  // recent first (PRD §4.2). No gh/git calls; summaries come from durable
  // rows + snapshots so the page stays fast with many sessions.
  app.get("/api/reviews", async () => {
    const agents = (deps as RouteDeps).agents;
    const pipelineDisabled = !pipeline || (agents ? isNoneRunner(agents) : false);
    const jobs = (deps as RouteDeps).jobs;
    const reviews = listReviewSummaries({
      db: ctx.db,
      ...(jobs ? { jobsByReview: (id: string) => jobs.listByReview(id) } : {}),
      pipelineDisabled,
    });
    return { reviews };
  });

  // Front screen "Remove": archive/delete the review's local data only.
  // Never touches GitHub or the user's checkout; removes the managed
  // worktree. Confirm in the UI before calling.
  const removeReview = async (id: string): Promise<boolean> => {
    const jobs = (deps as { jobs?: { listByReview: (id: string) => { id: string; state: string }[]; cancel: (id: string) => void } }).jobs;
    const result = await deleteReviewLocal({
      db: ctx.db,
      runner: ctx.runner,
      dataDir: ctx.dataDir,
      ...(jobs
        ? {
            cancelJobs: (reviewId: string) => {
              try {
                for (const j of jobs.listByReview(reviewId)) {
                  if (j.state !== "done" && j.state !== "error" && j.state !== "cancelled") {
                    try {
                      jobs.cancel(j.id);
                    } catch {
                      // Best effort.
                    }
                  }
                }
              } catch {
                // Ignore.
              }
            },
          }
        : {}),
    }, id);
    if (!result.deleted) return false;
    // Close the review's agent sessions (base + conversations) so a review
    // added again for the same change starts from new ones.
    try {
      await (deps as RouteDeps).sessions?.closeReview(id);
    } catch {
      // Best effort: the sessions also close on idle.
    }
    // The review's agent sessions are gone: its MCP secrets die with it, so
    // a stale agent URL can never reach another review's data.
    try {
      (deps as RouteDeps).mcp?.revokeForReview(id);
    } catch {
      // Best effort: secrets are process-local and die on restart anyway.
    }
    return true;
  };

  app.delete("/api/reviews/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await removeReview(id))) return reply.code(404).send({ error: "unknown review" });
    return { ok: true };
  });

  // Settings → Data "Reset data": Remove for every review, then empty the
  // review tables. Settings and repos stay. Refused while a Submit is in
  // flight, so a half-posted review is never forgotten.
  app.post("/api/reset", async (_req, reply) => {
    if (hasAnySubmitLease(ctx.db)) {
      return reply.code(409).send({ error: "A review is being submitted. Try again when it has finished." });
    }
    let reviewsRemoved = 0;
    for (const id of listReviewIds(ctx.db)) {
      if (await removeReview(id)) reviewsRemoved += 1;
    }
    deleteAllReviewRows(ctx.db);
    const body: ResetDataResponse = { ok: true, reviewsRemoved };
    return body;
  });

  app.post("/api/reviews", async (req, reply) => {
    const body = (req.body ?? {}) as CreateReviewRequest;
    if (!body.repoId) return reply.code(400).send({ error: "repoId is required" });

    // Demo mode: repo-less fixture review running the same pipeline path.
    if (isDemoRequest(body)) {
      const reviewId = newReviewId();
      const fixturesDir = (deps as { fixturesDir?: string }).fixturesDir ?? fixturesDirDefault();
      void demoFixtureName(body);
      let ingested;
      try {
        ingested = ingestDemo(fixturesDir, reviewId, ctx.dataDir);
      } catch (err) {
        return reply.code(500).send({ error: `couldn't load the demo: ${(err as Error).message}` });
      }
      const snapshot: ReviewSnapshot = {
        review: ingested.review,
        version: ingested.version,
        files: ingested.files,
        description: ingested.description,
        pages: [
          {
            id: "root",
            kind: "root",
            title: ingested.title,
            saved: false,
            cards: [],
          },
        ],
        annotations: [],
        hunkStates: [],
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
      };
      transaction(ctx.db, () => {
        // Demo repo row (synthetic, so jobs FK + refresh joins work).
        ctx.db
          .prepare(
            "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
          )
          .run("demo", "demo", "urllib3-5020", fixturesDir, Date.now());
        writeReviewRows(ctx.db, "demo", { ...ingested, review: snapshot.review });
        saveVersionFiles(ctx.db, reviewId, ingested.version.n, ingested.files);
        ctx.reviews.putSnapshot(reviewId, snapshot);
      });
      if (pipeline) {
        // Pipeline trigger never fails creation; the stage records the error.
        // Fire-and-forget: startReview resolves live model defaults first.
        void pipeline.startReview(reviewId).catch(() => {});
      }
      return reply.code(201).send(snapshot);
    }

    if (body.pr === undefined && !body.branch) {
      return reply.code(400).send({ error: "either pr or branch is required" });
    }
    let repo = ctx.repos.get(body.repoId);
    if (!repo) {
      // Detected checkouts are addressable too: the first review remembers
      // the checkout under the same id, so the start page's selection holds.
      const found = (await listAllRepos(ctx)).find((r) => r.id === body.repoId);
      if (found) {
        ctx.repos.upsert(found);
        repo = ctx.repos.get(found.id);
      }
    }
    if (!repo) return reply.code(404).send({ error: "unknown repo" });

    // #27: managed clones stay fresh — fetch before ingest so PR heads and
    // base branches are current. Best effort (ingest proceeds on stale data
    // when offline); user checkouts are never fetched implicitly.
    await refreshManagedCheckout(ctx.runner, repo);

    const reviewId = newReviewId();
    let ingested;
    try {
      ingested = await ingestReview(
        { runner: ctx.runner, dataDir: ctx.dataDir },
        { repoPath: repo.localPath, ...(body.pr !== undefined ? { pr: body.pr } : { branch: body.branch }) },
        reviewId,
      );
    } catch (err) {
      return reply.code(502).send({ error: `couldn't load the PR or branch: ${(err as Error).message}` });
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
    if (pipeline && autoPipeline) {
      // Never fail creation; fire-and-forget (startReview resolves live
      // model defaults first).
      void pipeline.startReview(reviewId).catch(() => {});
    }
    return reply.code(201).send(snapshot);
  });

  app.get("/api/reviews/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { version?: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    // Opening a review marks it recently opened for the front-screen list
    // (most recent first). Version views don't reorder the list.
    if (query.version === undefined) touchReviewOpened(ctx.db, id);
    // Merge live jobs so the Jobs view + usage totals stay current without
    // waiting for a patch event.
    const jobs = (deps as RouteDeps).jobs;
    const withJobs: ReviewSnapshot = jobs ? { ...snapshot, jobs: jobs.listByReview(id) } : snapshot;
    if (query.version === undefined) return withJobs;

    const n = Number(query.version);
    if (!Number.isSafeInteger(n) || n < 1) {
      return reply.code(400).send({ error: `bad ?version=${query.version}` });
    }
    if (n === snapshot.version.n) return withJobs;
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
    return { ...withJobs, version, files };
  });

  app.post("/api/reviews/:id/refresh", async (req, reply) => {
    const { id } = req.params as { id: string };
    // Demo reviews have no remote to fetch: refresh is a no-op (checked
    // first — demo rows exist in the DB for jobs/refresh joins, so the
    // row lookup below would otherwise fall through to a failing git fetch
    // and a spurious 502 on every review open).
    const first = ctx.reviews.getSnapshot(id);
    if (!first) return reply.code(404).send({ error: "unknown review" });
    if (first.review.repoId === "demo") {
      const response: RefreshResponse = { review: first.review, newVersion: false };
      return response;
    }
    const row = readReviewRow(ctx.db, id);
    if (!row) return reply.code(404).send({ error: "unknown review" });
    const repo = ctx.repos.get(row.repoId);
    if (!repo) return reply.code(404).send({ error: "unknown repo" });
    // #27: fetch managed clones before refresh (best effort, stale on
    // failure); never fetch a user's own checkout implicitly.
    await refreshManagedCheckout(ctx.runner, repo);
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
    if (!deps.jobs || !deps.baseRunner) {
      return reply.code(501).send({ error: "not available in this build" });
    }
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const parser = deps.parser ?? new JsonBlockReplyParser();
    let provider = "main";
    let model = "main-model";
    try {
      const s = (deps as RouteDeps).settings?.get();
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

  app.post("/api/reviews/:id/resume", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!pipeline) return reply.code(501).send({ error: "not available in this build" });
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    void req;
    try {
      const { jobIds, pendingStages } = await pipeline.resumeReview(id);
      const response: ResumeReviewResponse = { resumed: jobIds.length > 0, jobIds, pendingStages: pendingStages as ResumeReviewResponse["pendingStages"] };
      return response;
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.post("/api/reviews/:id/actions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { kind?: string };
    if (!body.kind) return reply.code(400).send({ error: "action kind is required" });
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot && body.kind !== "generate") {
      // Generate validates the review itself; everything else 404s early.
      return reply.code(404).send({ error: "unknown review" });
    }
    const routeDeps = deps as RouteDeps & { fixturesDir?: string; promptsDir?: string };
    return dispatchAction(
      body as Parameters<typeof dispatchAction>[0],
      {
        pipeline,
        jobs: (deps as RouteDeps).jobs,
        reviews: ctx.reviews,
        reviewId: id,
        ...(routeDeps.sessions ? { sessions: routeDeps.sessions } : {}),
        ...(routeDeps.settings ? { settings: routeDeps.settings } : {}),
        ...(routeDeps.sharedctx ? { sharedctx: routeDeps.sharedctx } : {}),
        ...(routeDeps.fixturesDir ? { fixturesDir: routeDeps.fixturesDir } : {}),
        ...(routeDeps.promptsDir ? { promptsDir: routeDeps.promptsDir } : {}),
      },
      reply,
    );
  });
}
