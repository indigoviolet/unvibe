/**
 * Reviews (M1 service + M5 versions + M3 pipeline + #92 async open):
 * - `POST /api/reviews` — creates the review row + a loading snapshot and
 *   answers at once (202) with the placeholder; fetch + ingest run after
 *   the response, then fill the snapshot through patch events (or mark it
 *   failed with a retry). The `demo` fixture stays synchronous (201).
 * - `POST /api/reviews/:id/retry` — re-run a failed ingest (#92).
 * - `GET /api/reviews/:id[?version=n]` — current snapshot (with live jobs
 *   merged in), or an older version's `version` + `files` swapped in.
 * - `POST /api/reviews/:id/refresh` — fetch and compare (no agent time).
 * - `POST /api/reviews/:id/update` — manual update pass (M5, via the
 *   pipeline's UpdateBaseRunner by default).
 * - `POST /api/reviews/:id/resume` — re-enqueue interrupted pipeline stages
 *   (M3 resilience; idempotent).
 * - `POST …/actions` — M3 dispatcher (`generate` implemented, rest 501).
 *
 * Loading reviews have no `version`/`files`/`description` yet; every route
 * below refuses loading/failed snapshots cleanly (409) except the reads
 * (`GET`, list) and `retry`/`DELETE`.
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
import { ingestStatusOf, isReadySnapshot, summarizeComparison } from "@unvibe/shared";
import { ingestRefusal } from "../reviews/index.js";
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

/** #92: dedupe key — repo + PR number, or repo + branch. Decided in the service so two tabs share one loading review. */
function dedupeKeyFor(repoId: string, pr: number | undefined, branch: string | undefined): string {
  return pr !== undefined ? `${repoId}|pr:${pr}` : `${repoId}|branch:${branch ?? ""}`;
}

/**
 * #92: find a loading or failed review for the same repo + PR/branch to
 * reuse (same PR opened twice while loading goes to the same review).
 * Ready reviews are left alone (opening again creates a new review, as today).
 */
function findReusableReview(
  ctx: ServiceContext,
  repoId: string,
  pr: number | undefined,
  branch: string | undefined,
): { id: string; snapshot: ReviewSnapshot } | null {
  let rows: { id: string }[];
  try {
    if (pr !== undefined) {
      rows = ctx.db
        .prepare("SELECT id FROM reviews WHERE repo_id = ? AND pr_number = ? ORDER BY created_at DESC")
        .all(repoId, pr) as { id: string }[];
    } else {
      rows = ctx.db
        .prepare("SELECT id FROM reviews WHERE repo_id = ? AND pr_number IS NULL AND branch = ? ORDER BY created_at DESC")
        .all(repoId, branch ?? "") as { id: string }[];
    }
  } catch {
    return null;
  }
  for (const row of rows) {
    const snap = ctx.reviews.getSnapshot(row.id);
    if (!snap) continue;
    const st = ingestStatusOf(snap);
    if (st === "loading" || st === "failed") return { id: row.id, snapshot: snap };
  }
  return null;
}

/**
 * #92: resume loading reviews left behind by a restart. Re-runs the ingest
 * (same path as retry); when the repo or source is gone, marks the review
 * failed instead of leaving it loading forever. Lease-style: the loading
 * snapshot is the durable marker (like `submit_leases`), reconciled here on
 * startup rather than via a new table.
 */
export async function resumeInterruptedIngests(
  ctx: ServiceContext,
  opts: { pipeline?: Pipeline; autoPipeline?: boolean } = {},
): Promise<{ resumed: number; failed: number }> {
  let rows: { review_id: string }[];
  try {
    rows = ctx.db.prepare("SELECT review_id FROM review_snapshots").all() as { review_id: string }[];
  } catch {
    return { resumed: 0, failed: 0 };
  }
  let resumed = 0;
  let failed = 0;
  for (const row of rows) {
    let snap: ReviewSnapshot | null = null;
    try {
      snap = ctx.reviews.getSnapshot(row.review_id);
    } catch {
      continue;
    }
    if (!snap || ingestStatusOf(snap) !== "loading") continue;
    const started = startIngestBackground(ctx, opts, snap.review.id);
    if (started) resumed += 1;
    else failed += 1;
  }
  return { resumed, failed };
}

/**
 * #92: (re)start the background ingest for a loading review. Reads the
 * source from the durable reviews row (repo + PR/branch). Returns false
 * when the review cannot be resumed (unknown review/repo) — the caller
 * marks it failed. Fire-and-forget: never throws.
 */
function startIngestBackground(
  ctx: ServiceContext,
  opts: { pipeline?: Pipeline; autoPipeline?: boolean },
  reviewId: string,
): boolean {
  let row: { repoId: string; branch: string; prNumber: number | null } | null = null;
  try {
    row = readReviewRow(ctx.db, reviewId);
  } catch {
    return false;
  }
  if (!row) return false;
  const repo = ctx.repos.get(row.repoId);
  if (!repo) {
    void ctx.reviews
      .mutate(reviewId, (draft) => {
        draft.ingest = { status: "failed", error: "unknown repo — remove and open again" };
      })
      .catch(() => {});
    return false;
  }
  void runIngestBackground(ctx, opts, {
    repoId: repo.id,
    repoPath: repo.localPath,
    reviewId,
    ...(row.prNumber !== null ? { pr: row.prNumber } : { branch: row.branch }),
  }).catch(() => {});
  return true;
}

/**
 * #92: background ingest after the 202 response (or retry/resume). Updates
 * the loading snapshot's step through patches ("fetching" → "reading
 * diff"), then fills it to ready in one mutate (so the page fills through
 * the usual patch events) and starts the pipeline — or marks it failed
 * with the error and a retry. Never throws; a deleted review is skipped.
 */
async function runIngestBackground(
  ctx: ServiceContext,
  opts: { pipeline?: Pipeline; autoPipeline?: boolean },
  args: { repoId: string; repoPath: string; reviewId: string; pr?: number; branch?: string },
): Promise<void> {
  const { reviewId, repoPath, repoId } = args;
  const pipeline = opts.pipeline;
  const autoPipeline = opts.autoPipeline ?? true;
  try {
    const repo = ctx.repos.get(repoId);
    if (repo?.managed === true) {
      await refreshManagedCheckout(ctx.runner, repo);
    }
    await ctx.reviews
      .mutate(reviewId, (draft) => {
        if (draft.ingest?.status === "loading") draft.ingest.step = "reading diff";
      })
      .catch(() => {});
    const ingested = await ingestReview(
      { runner: ctx.runner, dataDir: ctx.dataDir },
      { repoPath, ...(args.pr !== undefined ? { pr: args.pr } : { branch: args.branch }) },
      reviewId,
    );
    // Deleted while loading: skip the write (best-effort worktree cleanup).
    if (!ctx.reviews.getSnapshot(reviewId)) {
      try {
        const { default: fs } = await import("node:fs");
        const { default: path } = await import("node:path");
        fs.rmSync(path.join(ctx.dataDir, "worktrees", reviewId), { recursive: true, force: true });
      } catch {
        // Ignore.
      }
      return;
    }
    const snapshot: ReviewSnapshot = {
      review: { ...ingested.review, repoId },
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
      ingest: { status: "ready" },
    };
    transaction(ctx.db, () => {
      ctx.db.prepare("UPDATE reviews SET branch = ?, pr_number = ?, current_version = ?, data = ? WHERE id = ?").run(
        snapshot.review.branch,
        snapshot.review.prNumber ?? null,
        snapshot.review.currentVersion,
        JSON.stringify({ title: ingested.title }),
        reviewId,
      );
      ctx.db
        .prepare(
          "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING",
        )
        .run(
          reviewId,
          snapshot.version!.n,
          snapshot.version!.headSha,
          snapshot.version!.mergeBaseSha,
          snapshot.version!.baseRef,
          snapshot.version!.fetchedAt,
          JSON.stringify(snapshot.version!.idMapping),
        );
      saveVersionFiles(ctx.db, reviewId, snapshot.version!.n, snapshot.files!);
    });
    // One mutate so the UI gets one patch (ready through the usual events).
    await ctx.reviews.mutate(reviewId, (draft) => {
      draft.review = { ...snapshot.review };
      draft.version = { ...snapshot.version! };
      draft.files = snapshot.files as ReviewSnapshot["files"];
      draft.description = snapshot.description ? { ...snapshot.description } : undefined;
      draft.pages = [];
      draft.annotations = [];
      draft.hunkStates = [];
      draft.jobs = [];
      draft.contributions = [];
      draft.logTail = [];
      draft.ingest = { status: "ready" };
    });
    try {
      ctx.repos.touch(repoId);
    } catch {
      // Ignore.
    }
    if (pipeline && autoPipeline) {
      try {
        pipeline.startReview(reviewId);
      } catch {
        // never fail the ingest
      }
    }
  } catch (err) {
    try {
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.ingest = { status: "failed", error: (err as Error).message.slice(0, 500) };
      });
    } catch {
      // Deleted or unreadable: nothing to mark.
    }
  }
}

export async function registerReviews(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RegisterReviewsDeps = {},
): Promise<void> {
  const pipeline = (deps as { pipeline?: Pipeline }).pipeline;
  const autoPipeline = (deps as { autoPipeline?: boolean }).autoPipeline ?? true;
  // #92: in-flight ingests by dedupe key (two tabs opening the same PR at
  // once share one review). Entries are best-effort; the DB check above is
  // the authority across restarts.
  const pendingIngests = new Map<string, string>();

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
        return reply.code(500).send({ error: `demo ingest failed: ${(err as Error).message}` });
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
        try {
          pipeline.startReview(reviewId);
        } catch (err) {
          // Pipeline trigger never fails creation; the stage records the error.
          void err;
        }
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

    // #92: same PR/branch opened twice while loading reuses the review —
    // decided here in the service so two tabs share one row.
    const key = dedupeKeyFor(repo.id, body.pr, body.branch);
    const pendingId = pendingIngests.get(key);
    if (pendingId) {
      const pendingSnap = ctx.reviews.getSnapshot(pendingId);
      if (pendingSnap && ingestStatusOf(pendingSnap) !== "ready") {
        return reply.code(200).send(pendingSnap);
      }
      pendingIngests.delete(key);
    }
    const reusable = findReusableReview(ctx, repo.id, body.pr, body.branch);
    if (reusable) {
      pendingIngests.set(key, reusable.id);
      return reply.code(200).send(reusable.snapshot);
    }

    // #92: create the row + loading snapshot and answer at once (202),
    // before the fetch and ingest. The web navigates immediately; the
    // ingest fills the snapshot through patch events.
    const reviewId = newReviewId();
    const branchPlaceholder = body.branch ?? (body.pr !== undefined ? `pr-${body.pr}` : "");
    const titleHint =
      body.title?.trim() || (body.pr !== undefined ? `PR #${body.pr}` : (body.branch ?? "review"));
    const now = Date.now();
    const placeholder: ReviewSnapshot = {
      review: {
        id: reviewId,
        repoId: repo.id,
        branch: branchPlaceholder,
        ...(body.pr !== undefined ? { prNumber: body.pr } : {}),
        versions: [],
        currentVersion: 0,
        createdAt: now,
      },
      // #92: placeholder (n: 0) — no real version/files/description yet.
      version: { n: 0, headSha: "", mergeBaseSha: "", baseRef: "", fetchedAt: now, idMapping: {} },
      files: [],
      pages: [],
      annotations: [],
      hunkStates: [],
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
      ingest: { status: "loading", step: "fetching" },
    };
    transaction(ctx.db, () => {
      ctx.db
        .prepare(
          "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          reviewId,
          repo.id,
          branchPlaceholder,
          body.pr ?? null,
          0,
          now,
          JSON.stringify({ title: titleHint, ...(body.author ? { author: body.author } : {}) }),
        );
      ctx.reviews.putSnapshot(reviewId, placeholder);
    });
    try {
      ctx.repos.touch(repo.id);
    } catch {
      // Ignore.
    }
    pendingIngests.set(key, reviewId);
    void runIngestBackground(
      ctx,
      { ...(pipeline ? { pipeline } : {}), autoPipeline },
      {
        repoId: repo.id,
        repoPath: repo.localPath,
        reviewId,
        ...(body.pr !== undefined ? { pr: body.pr } : { branch: body.branch }),
      },
    )
      .catch(() => {})
      .finally(() => {
        if (pendingIngests.get(key) === reviewId) pendingIngests.delete(key);
      });
    return reply.code(202).send(placeholder);
  });

  // #92: retry a failed ingest. Loading reviews return the current snapshot
  // (already running); ready reviews refuse; demo reviews never retry.
  app.post("/api/reviews/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snap = ctx.reviews.getSnapshot(id);
    if (!snap) return reply.code(404).send({ error: "unknown review" });
    const st = ingestStatusOf(snap);
    if (st === "ready") return reply.code(409).send({ error: "review is ready" });
    if (st === "loading") return reply.code(200).send(snap);
    if (snap.review.repoId === "demo") {
      return reply.code(409).send({ error: "demo reviews do not retry" });
    }
    await ctx.reviews.mutate(id, (draft) => {
      draft.ingest = { status: "loading", step: "fetching" };
    }).catch(() => {});
    const after = ctx.reviews.getSnapshot(id);
    const started = startIngestBackground(ctx, { ...(pipeline ? { pipeline } : {}), autoPipeline }, id);
    if (!started) {
      return reply.code(502).send({ error: "could not restart the ingest — remove and open again" });
    }
    return reply.code(202).send(after ?? snap);
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

    // #92: loading/failed reviews have no versions yet — serve the status.
    if (!isReadySnapshot(snapshot)) return withJobs;

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
    const refused = ingestRefusal(first);
    if (refused) return reply.code(409).send({ error: refused });
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
      return reply.code(501).send({ error: "not implemented: update pass not wired (no job queue / base runner)" });
    }
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const refusedUpdate = ingestRefusal(snapshot);
    if (refusedUpdate) return reply.code(409).send({ error: refusedUpdate });
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
    if (!pipeline) return reply.code(501).send({ error: "not implemented: pipeline not wired" });
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const refusedResume = ingestRefusal(snapshot);
    if (refusedResume) return reply.code(409).send({ error: refusedResume });
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
    if (snapshot) {
      const refusedAction = ingestRefusal(snapshot);
      if (refusedAction) return reply.code(409).send({ error: refusedAction });
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

  // #92: restart recovery — resume loading ingests left behind (or mark
  // failed). Fire-and-forget so startup never blocks on gh/git.
  void resumeInterruptedIngests(ctx, { ...(pipeline ? { pipeline } : {}), autoPipeline }).catch(() => {});
}
