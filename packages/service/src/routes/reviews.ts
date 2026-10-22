/**
 * Reviews (M1 service + M5 versions + M3 pipeline + #92 async open):
 * - `POST /api/reviews` — creates the review row + a loading snapshot and
 *   answers at once (202) with the placeholder; fetch + ingest run after
 *   the response, then fill the snapshot through patch events (or mark it
 *   failed with a retry). The `demo` fixture stays synchronous (201).
 * - `POST /api/reviews/:id/retry` — re-run a failed ingest (#92).
 * - `POST /api/reviews/:id/redo` — re-do the guide: delete + create in
 *   one call, answering with the new review's loading snapshot (#115).
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
  CreateDocumentRequest,
  CreateReviewRequest,
  CreateReviewResponse,
  RefreshResponse,
  ResetDataResponse,
  ResumeReviewResponse,
  ReviewSnapshot,
  UpdateReviewResponse,
  Version,
} from "@unvibe/shared";
import { ingestStatusOf, isDocumentReview, isReadySnapshot, parseDocumentMarkdown, summarizeComparison } from "@unvibe/shared";
import { ingestRefusal } from "../reviews/index.js";
import {
  EmptyDiffError,
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
import { refreshManagedCheckout, resolveContextRepo } from "../repos/index.js";
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
import { fetchExistingComments } from "../submit/index.js";
import { readSubmitLease } from "../submit/lease.js";
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
 * #149: find any review for the same source to reuse (same PR opened twice
 * goes to the same review, whether it is still loading, failed, or ready).
 * A PR review and a branch review of the same branch are different sources
 * and may both exist: PR sources match by PR number, branch sources match
 * by branch with no PR number. When stored duplicates meet the lookup, the
 * most recently active review wins (deterministic).
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
        .prepare(
          `SELECT r.id AS id FROM reviews r LEFT JOIN review_snapshots rs ON rs.review_id = r.id
           WHERE r.repo_id = ? AND r.pr_number = ? ORDER BY COALESCE(rs.updated_at, r.created_at) DESC`,
        )
        .all(repoId, pr) as { id: string }[];
    } else {
      rows = ctx.db
        .prepare(
          `SELECT r.id AS id FROM reviews r LEFT JOIN review_snapshots rs ON rs.review_id = r.id
           WHERE r.repo_id = ? AND r.pr_number IS NULL AND r.branch = ?
           ORDER BY COALESCE(rs.updated_at, r.created_at) DESC`,
        )
        .all(repoId, branch ?? "") as { id: string }[];
    }
  } catch {
    return null;
  }
  for (const row of rows) {
    const snap = ctx.reviews.getSnapshot(row.id);
    if (!snap) continue;
    return { id: row.id, snapshot: snap };
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
        draft.ingest = { status: "failed", error: "this review's repo is gone — add the repo again, then open the review again" };
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
    // #123: the repo-wide fetch runs alongside `gh pr view` for PR sources
    // (independent: git vs API) instead of serially before it; the ingest
    // awaits it where the refs are needed. Branch sources keep the old order
    // (the fresh tip is needed before resolving).
    const refresh =
      repo?.managed === true && args.pr !== undefined ? refreshManagedCheckout(ctx.runner, repo) : null;
    if (repo?.managed === true && args.pr === undefined) {
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
      refresh,
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
      commits: ingested.commits,
      pages: [],
      annotations: [],
      hunkStates: [],
      fileStates: [],
      viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
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
      draft.commits = snapshot.commits ? snapshot.commits.map((c) => ({ ...c })) : undefined;
      draft.pages = [];
      draft.annotations = [];
      draft.hunkStates = [];
      draft.fileStates = [];
      draft.viewPrefs = { showExistingComments: true, existingCommentsCollapsed: false };
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
      // Never fail the ingest; fire-and-forget (startReview resolves live
      // model defaults first).
      void pipeline.startReview(reviewId).catch(() => {});
    }
    // Issue #168: existing GitHub comments load with the review (PRs
    // only), best effort — a gh failure leaves the field absent and the
    // comments menu fetches on open instead.
    if (args.pr !== undefined) {
      const repo = ctx.repos.get(repoId);
      if (repo) {
        try {
          const comments = await fetchExistingComments(ctx.runner, repoPath, repo.owner, repo.name, args.pr);
          await ctx.reviews
            .mutate(reviewId, (draft) => {
              draft.existingComments = comments.map((c) => ({ ...c }));
            })
            .catch(() => {});
        } catch {
          // Leave absent; the menu lazy-loads.
        }
      }
    }
  } catch (err) {
    try {
      await ctx.reviews.mutate(reviewId, (draft) => {
        // #179: empty diff is its own outcome, not a failure to open.
        draft.ingest =
          err instanceof EmptyDiffError
            ? { status: "empty", error: err.message.slice(0, 500) }
            : { status: "failed", error: (err as Error).message.slice(0, 500) };
      });
    } catch {
      // Deleted or unreadable: nothing to mark.
    }
  }
}

interface BeginCreateArgs {
  repoId: string;
  pr?: number;
  branch?: string;
  title?: string;
  author?: string;
}

type BeginCreateResult =
  | { ok: true; status: 200 | 202; snapshot: CreateReviewResponse }
  | { ok: false; status: number; error: string };

/**
 * #115: the shared create path behind `POST /api/reviews` and redo:
 * resolve the repo, reuse a review for the same source (#92 while loading
 * or failed, #149 once ready), or insert the row + loading snapshot and
 * start the background ingest. The demo fixture is not handled here
 * (callers branch before calling).
 */
async function beginReviewFromSource(
  ctx: ServiceContext,
  opts: { pipeline?: Pipeline; autoPipeline?: boolean },
  pendingIngests: Map<string, string>,
  inFlightCreates: Map<string, Promise<BeginCreateResult>>,
  args: BeginCreateArgs,
): Promise<BeginCreateResult> {
  let repo = ctx.repos.get(args.repoId);
  if (!repo) {
    // Detected checkouts are addressable too: the first review remembers
    // the checkout under the same id, so the start page's selection holds.
    const found = (await listAllRepos(ctx)).find((r) => r.id === args.repoId);
    if (found) {
      ctx.repos.upsert(found);
      repo = ctx.repos.get(found.id);
    }
  }
  if (!repo) return { ok: false, status: 404, error: "unknown repo" };

  // #92/#149: same source opened twice reuses the review — decided here in
  // the service so two tabs share one row. A ready review is reused too
  // (#149): opening it again opens it (with its refresh when the source
  // moved), never a second review.
  const key = dedupeKeyFor(repo.id, args.pr, args.branch);
  // #149: a concurrent create for the same source is already inserting —
  // await it and share its review instead of inserting a second row. (The
  // #92 `pendingIngests` entry below covers creates whose ingest is still
  // running; this covers creates that have not inserted yet.)
  const concurrent = inFlightCreates.get(key);
  if (concurrent) {
    const settled = await concurrent;
    if (settled.ok) return { ok: true, status: 200, snapshot: { ...settled.snapshot, reused: true } };
    const retry = findReusableReview(ctx, repo.id, args.pr, args.branch);
    if (retry) {
      if (ingestStatusOf(retry.snapshot) === "ready") touchReviewOpened(ctx.db, retry.id);
      return { ok: true, status: 200, snapshot: { ...retry.snapshot, reused: true } };
    }
  }
  const pendingId = pendingIngests.get(key);
  if (pendingId) {
    const pendingSnap = ctx.reviews.getSnapshot(pendingId);
    if (pendingSnap && ingestStatusOf(pendingSnap) !== "ready") {
      return { ok: true, status: 200, snapshot: { ...pendingSnap, reused: true } };
    }
    pendingIngests.delete(key);
  }
  const reusable = findReusableReview(ctx, repo.id, args.pr, args.branch);
  if (reusable) {
    pendingIngests.set(key, reusable.id);
    // Opening a finished review counts as opening it (front-screen order).
    if (ingestStatusOf(reusable.snapshot) === "ready") touchReviewOpened(ctx.db, reusable.id);
    return { ok: true, status: 200, snapshot: { ...reusable.snapshot, reused: true } };
  }

  // #149: claim the creation slot before inserting, so a concurrent
  // create for the same source (already past its own repo lookup) awaits
  // this insert instead of adding a second row. Everything below runs
  // synchronously until the row exists; the background ingest stays
  // fire-and-forget after the 202 response.
  let resolveCreate!: (r: BeginCreateResult) => void;
  const creating = new Promise<BeginCreateResult>((resolve) => {
    resolveCreate = resolve;
  });
  inFlightCreates.set(key, creating);
  const done = (r: BeginCreateResult): BeginCreateResult => {
    resolveCreate(r);
    if (inFlightCreates.get(key) === creating) inFlightCreates.delete(key);
    return r;
  };
  try {
    // A waiter may have inserted while this call awaited the repo lookup:
    // re-check the DB under the slot before inserting.
    const late = findReusableReview(ctx, repo.id, args.pr, args.branch);
    if (late) {
      pendingIngests.set(key, late.id);
      if (ingestStatusOf(late.snapshot) === "ready") touchReviewOpened(ctx.db, late.id);
      return done({ ok: true, status: 200, snapshot: { ...late.snapshot, reused: true } });
    }
    // #92: create the row + loading snapshot and answer at once (202),
    // before the fetch and ingest. The web navigates immediately; the
    // ingest fills the snapshot through patch events.
    const reviewId = newReviewId();
  const branchPlaceholder = args.branch ?? (args.pr !== undefined ? `pr-${args.pr}` : "");
  const titleHint =
    args.title?.trim() || (args.pr !== undefined ? `PR #${args.pr}` : (args.branch ?? "review"));
  const now = Date.now();
  const placeholder: ReviewSnapshot = {
    review: {
      id: reviewId,
      repoId: repo.id,
      branch: branchPlaceholder,
      ...(args.pr !== undefined ? { prNumber: args.pr } : {}),
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
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
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
        args.pr ?? null,
        0,
        now,
        JSON.stringify({ title: titleHint, ...(args.author ? { author: args.author } : {}) }),
      );
    ctx.reviews.putSnapshot(reviewId, placeholder);
  });
  try {
    ctx.repos.touch(repo.id);
  } catch {
    // Ignore.
  }
  const pipeline = opts.pipeline;
  const autoPipeline = opts.autoPipeline ?? true;
  pendingIngests.set(key, reviewId);
  void runIngestBackground(
    ctx,
    { ...(pipeline ? { pipeline } : {}), autoPipeline },
    {
      repoId: repo.id,
      repoPath: repo.localPath,
      reviewId,
      ...(args.pr !== undefined ? { pr: args.pr } : { branch: args.branch }),
    },
  )
      .catch(() => {})
      .finally(() => {
        if (pendingIngests.get(key) === reviewId) pendingIngests.delete(key);
      });
    return done({ ok: true, status: 202, snapshot: placeholder });
  } catch (err) {
    return done({ ok: false, status: 500, error: (err as Error).message });
  }
}

/** #115: the stored title hint for a review's loading page (best effort). */
function storedTitle(db: ServiceContext["db"], reviewId: string): string | undefined {
  try {
    const row = db.prepare("SELECT data FROM reviews WHERE id = ?").get(reviewId) as
      | { data: string }
      | undefined;
    if (!row) return undefined;
    const data = JSON.parse(row.data) as { title?: unknown };
    return typeof data.title === "string" && data.title.trim() !== "" ? data.title : undefined;
  } catch {
    return undefined;
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
  // #149: creations currently inserting a row, by dedupe key. A concurrent
  // create for the same source awaits the in-flight insert instead of
  // adding a second row; entries live only for the synchronous insert.
  const inFlightCreates = new Map<string, Promise<BeginCreateResult>>();

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
    const jobs = (deps as { jobs?: { listByReview: (id: string) => { id: string; state: string }[]; cancel: (id: string) => void; dropReview: (id: string) => void } }).jobs;
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
    // #115: finished jobs outlive the delete (their rows are gone but the
    // queue still lists them), so drop the review's entries too — a review
    // added again for the same change starts with no jobs.
    try {
      jobs?.dropReview(id);
    } catch {
      // Best effort: the rows are already gone.
    }
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
    const raw = (req.body ?? {}) as CreateReviewRequest & Partial<CreateDocumentRequest>;
    // Issue #222: document reviews are created synchronously from the
    // pasted Markdown (no ingest, no pipeline — nothing generated up front).
    if ((raw as { kind?: string }).kind === "document") {
      const docBody = raw as CreateDocumentRequest;
      const markdown = typeof docBody.markdown === "string" ? docBody.markdown : "";
      if (markdown.trim() === "") return reply.code(400).send({ error: "paste the document's Markdown first" });
      if (markdown.length > 200_000) return reply.code(400).send({ error: "that document is too large (200,000 characters at most)" });
      const picks = Array.isArray(docBody.contextRepos) ? docBody.contextRepos : [];
      if (picks.length < 1) {
        return reply.code(400).send({ error: "pick at least one context repo" });
      }
      const document = parseDocumentMarkdown(markdown);
      if (document.blocks.length === 0) return reply.code(400).send({ error: "that document has no readable content" });
      if (typeof docBody.title === "string" && docBody.title.trim() !== "") document.title = docBody.title.trim().slice(0, 200);
      const contextRepos: import("@unvibe/shared").ContextRepoRef[] = [];
      for (const pick of picks) {
        if (!pick || typeof pick.repoId !== "string") return reply.code(400).send({ error: "each context repo needs a repo" });
        if (pick.source !== "worktree" && pick.source !== "origin-main" && pick.source !== "local") {
          return reply.code(400).send({ error: "each context repo needs a reading location: a worktree, origin/main, or the local copy" });
        }
        let repo = ctx.repos.get(pick.repoId);
        if (!repo) {
          const found = (await listAllRepos(ctx)).find((r) => r.id === pick.repoId);
          if (found) {
            ctx.repos.upsert(found);
            repo = ctx.repos.get(found.id);
          }
        }
        if (!repo) return reply.code(404).send({ error: "unknown repo" });
        try {
          contextRepos.push(await resolveContextRepo(ctx.runner, repo, pick.source, pick.worktreePath));
        } catch (err) {
          return reply.code(400).send({ error: (err as Error).message });
        }
      }
      const { createHash } = await import("node:crypto");
      const reviewId = newReviewId();
      const now = Date.now();
      const docSha = createHash("sha256").update(markdown, "utf8").digest("hex");
      const version: Version = { n: 1, headSha: docSha, mergeBaseSha: docSha, baseRef: "document", fetchedAt: now, idMapping: {} };
      const snapshot: ReviewSnapshot = {
        review: {
          id: reviewId,
          repoId: contextRepos[0].repoId,
          branch: "document",
          versions: [version],
          currentVersion: 1,
          createdAt: now,
        },
        document,
        contextRepos,
        version,
        files: [],
        pages: [],
        annotations: [],
        hunkStates: [],
        fileStates: [],
        viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
        ingest: { status: "ready" },
      };
      transaction(ctx.db, () => {
        ctx.db
          .prepare("INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(reviewId, contextRepos[0].repoId, "document", null, 1, now, JSON.stringify({ title: document.title }));
        ctx.db
          .prepare("INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING")
          .run(reviewId, 1, docSha, docSha, "document", now, "{}");
        ctx.reviews.putSnapshot(reviewId, snapshot);
      });
      try {
        ctx.repos.touch(contextRepos[0].repoId);
      } catch {
        // Ignore.
      }
      return reply.code(201).send(snapshot);
    }
    const body = raw as CreateReviewRequest;
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
        ingest: { status: "ready" },
        pages: [
          {
            id: "root",
            kind: "root",
            title: ingested.title,
            cards: [],
          },
        ],
        annotations: [],
        hunkStates: [],
        fileStates: [],
        viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
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
    const created = await beginReviewFromSource(
      ctx,
      { ...(pipeline ? { pipeline } : {}), autoPipeline },
      pendingIngests,
      inFlightCreates,
      {
        repoId: body.repoId,
        ...(body.pr !== undefined ? { pr: body.pr } : { branch: body.branch }),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.author !== undefined ? { author: body.author } : {}),
      },
    );
    if (!created.ok) return reply.code(created.status).send({ error: created.error });
    return reply.code(created.status).send(created.snapshot);
  });

  // #92: retry a failed ingest. Loading reviews return the current snapshot
  // (already running); ready reviews refuse; demo reviews never retry.
  app.post("/api/reviews/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snap = ctx.reviews.getSnapshot(id);
    if (!snap) return reply.code(404).send({ error: "unknown review" });
    const st = ingestStatusOf(snap);
    if (st === "ready") return reply.code(409).send({ error: "the review already opened" });
    if (st === "loading") return reply.code(200).send(snap);
    if (snap.review.repoId === "demo") {
      return reply.code(409).send({ error: "the demo can't be retried" });
    }
    await ctx.reviews.mutate(id, (draft) => {
      draft.ingest = { status: "loading", step: "fetching" };
    }).catch(() => {});
    const after = ctx.reviews.getSnapshot(id);
    const started = startIngestBackground(ctx, { ...(pipeline ? { pipeline } : {}), autoPipeline }, id);
    if (!started) {
      return reply.code(502).send({ error: "this review's repo is gone — add the repo again, then open the review again" });
    }
    return reply.code(202).send(after ?? snap);
  });

  // #115: re-do a review's guide — delete + create in one call, reusing
  // both paths so "same as delete + recreate" stays true by construction.
  // Running jobs are cancelled first (like delete); the review gets a new
  // id, so the web navigates to the new loading page (same as a fresh
  // open). Refused for the demo, while loading/failed (like
  // refresh/update/resume), while a submit is in flight for the review
  // (delete does not check — redo must never lose a submission), and when
  // the repo is gone (nothing is deleted then).
  app.post("/api/reviews/:id/redo", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snap = ctx.reviews.getSnapshot(id);
    if (!snap) return reply.code(404).send({ error: "unknown review" });
    if (snap.review.repoId === "demo") {
      return reply.code(409).send({ error: "the demo guide can't be re-done" });
    }
    if (isDocumentReview(snap)) {
      return reply.code(409).send({ error: "a document review can't be re-done — paste a new document to start another" });
    }
    const refusedRedo = ingestRefusal(snap);
    if (refusedRedo) return reply.code(409).send({ error: refusedRedo });
    if (readSubmitLease(ctx.db, id)) {
      return reply.code(409).send({ error: "A review is being submitted. Try again when it has finished." });
    }
    const row = readReviewRow(ctx.db, id);
    if (!row) return reply.code(404).send({ error: "unknown review" });
    if (row.prNumber === null && row.branch === "") {
      return reply.code(409).send({ error: "this review has no PR or branch to open again" });
    }
    const repoKnown =
      ctx.repos.get(row.repoId) ?? (await listAllRepos(ctx)).find((r) => r.id === row.repoId);
    if (!repoKnown) {
      return reply
        .code(409)
        .send({ error: "this review's repo is gone — add the repo again, then open the review again" });
    }
    const title = storedTitle(ctx.db, id);
    if (!(await removeReview(id))) return reply.code(404).send({ error: "unknown review" });
    const created = await beginReviewFromSource(
      ctx,
      { ...(pipeline ? { pipeline } : {}), autoPipeline },
      pendingIngests,
      inFlightCreates,
      {
        repoId: row.repoId,
        ...(row.prNumber !== null ? { pr: row.prNumber } : { branch: row.branch }),
        ...(title !== undefined ? { title } : {}),
      },
    );
    if (!created.ok) return reply.code(created.status).send({ error: created.error });
    return reply.code(created.status).send(created.snapshot);
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
    // Issue #222: document reviews have a single version — refresh is a
    // no-op (the web checks for new commits on every review open).
    if (isDocumentReview(first)) {
      const response: RefreshResponse = { review: first.review, newVersion: false };
      return response;
    }
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
    // Issue #168: existing GitHub comments reload with the review (PRs
    // only), whether or not new commits arrived — best effort, so a gh
    // failure keeps the previous list.
    if (row.prNumber !== null && row.prNumber !== undefined) {
      try {
        const comments = await fetchExistingComments(ctx.runner, repo.localPath, repo.owner, repo.name, row.prNumber);
        await ctx.reviews
          .mutate(id, (draft) => {
            draft.existingComments = comments.map((c) => ({ ...c }));
          })
          .catch(() => {});
      } catch {
        // Keep the previous list.
      }
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
    const refusedUpdate = ingestRefusal(snapshot);
    if (refusedUpdate) return reply.code(409).send({ error: refusedUpdate });
    // #179: never spend agent time on an empty diff (e.g. after a refresh
    // emptied it).
    if ((snapshot.files ?? []).every((f) => f.hunks.length === 0 && !f.isBinary)) {
      return reply.code(409).send({ error: "No changes to review: the diff is empty, so there is nothing to update." });
    }
    if (!deps.jobs || !deps.baseRunner) {
      return reply.code(501).send({ error: "not available in this build" });
    }
    const parser = deps.parser ?? new JsonBlockReplyParser();
    let provider = "main";
    let model = "main-model";
    let effort = "";
    try {
      const s = (deps as RouteDeps).settings?.get();
      if (s) {
        provider = s.main.provider;
        model = s.main.model;
        effort = s.main.effort;
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
          effort,
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
    const refusedResume = ingestRefusal(snapshot);
    if (refusedResume) return reply.code(409).send({ error: refusedResume });
    if (isDocumentReview(snapshot)) {
      return reply.code(409).send({ error: "document reviews generate nothing up front — there is nothing to resume" });
    }
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
