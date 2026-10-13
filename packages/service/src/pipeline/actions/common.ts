/**
 * Shared helpers for interaction actions (M4).
 *
 * Every action goes through `ReviewStore.mutate` so the UI gets patches;
 * every agent call runs at user-requested priority with a dedupe key of
 * (anchor, kind, depth, base version) and is validated (citations, one
 * repair turn) by the `runInFork` seam.
 */
import type { Job } from "@unvibe/shared";
import { JOB_PRIORITY, jobDedupeKeyString, type ActionAnchor, type Anchor, type Annotation, type JobDedupeKey, type ReviewSnapshot } from "@unvibe/shared";
import path from "node:path";
import type { JobQueue } from "../../jobs/index.js";
import { readCodeSlice } from "../../mcp/read.js";
import type { ReviewStore } from "../../state/store.js";
import type { Pipeline } from "../runner.js";
import type { SessionManager } from "../../sessions/manager.js";
import type { SettingsStore } from "../../settings/index.js";
import type { SharedContextService } from "../../sharedctx/service.js";
import { findBlock, l4Variables, recordInteraction } from "../../interaction/index.js";

export { JOB_PRIORITY };
export { recordInteraction };

export interface ActionContext {
  pipeline: Pipeline;
  jobs: JobQueue;
  reviews: ReviewStore;
  reviewId: string;
  sessions?: SessionManager;
  settings?: SettingsStore;
  /** M5 shared context (log, settle checks, turn ingest). Absent in tests. */
  sharedctx?: SharedContextService;
  fixturesDir?: string;
  promptsDir?: string;
}

/** Canonical anchor string for dedupe keys. */
export function anchorKey(anchor: ActionAnchor): string {
  switch (anchor.where) {
    case "block":
      return `block:${anchor.blockId}`;
    case "description":
      return `desc:${anchor.paragraphId}`;
    case "diff-line":
      return `diff:${anchor.fileKey}:${anchor.line}`;
  }
}

/** Base version string for dedupe keys (`v<n>`). */
export function baseVersionOf(snapshot: ReviewSnapshot): string {
  return `v${snapshot.version.n}`;
}

export function dedupeString(key: JobDedupeKey): string {
  return jobDedupeKeyString(key);
}

/** Active (non-terminal) job with this dedupe key, if any. */
export function findActiveJob(jobs: JobQueue, reviewId: string, key: JobDedupeKey): Job | null {
  const want = dedupeString(key);
  for (const j of jobs.listByReview(reviewId)) {
    if (j.dedupeKey === want && j.state !== "done" && j.state !== "error" && j.state !== "cancelled") {
      return j;
    }
  }
  return null;
}

export function getSnapshotOrThrow(reviews: ReviewStore, reviewId: string): ReviewSnapshot {
  const snapshot = reviews.getSnapshot(reviewId);
  if (!snapshot) throw new Error(`unknown review ${reviewId}`);
  return snapshot;
}

/**
 * Host line text for Explain/Ask on revealed context (issue #133).
 *
 * Revealed lines sit outside any hunk, where the snapshot has no row
 * text (`(line N not in diff)`). Read the line through the same
 * file-slice source instead, so the agent sees the selected code. Null
 * when hunk rows cover the line or the read fails — callers keep the
 * snapshot text then. Never throws.
 */
export async function revealedBlockText(ctx: ActionContext, anchor: Anchor): Promise<string | null> {
  const host = anchor.host;
  if (host.kind !== "diff-line") return null;
  const line = host.line;
  const fileKey = host.fileKey;
  let snapshot: ReviewSnapshot;
  try {
    snapshot = getSnapshotOrThrow(ctx.reviews, ctx.reviewId);
  } catch {
    return null;
  }
  const file = (snapshot.files ?? []).find((f) => f.fileKey === fileKey);
  if (!file) return null;
  for (const hunk of file.hunks ?? []) {
    for (const row of hunk.lines) {
      if ((row.newLine ?? row.oldLine) === line) return null;
    }
  }
  try {
    const deleted = file.isDeleted === true;
    const cwd = path.join(ctx.pipeline.dataDir, "worktrees", ctx.reviewId);
    const rev = deleted ? snapshot.version.mergeBaseSha : snapshot.version.headSha;
    const relPath = deleted ? (file.oldPath ?? file.path) : file.path;
    const slice = await readCodeSlice(ctx.pipeline.commands, cwd, rev, relPath, line, line);
    if ("text" in slice && slice.text.trim() !== "") return slice.text;
    return null;
  } catch {
    return null;
  }
}

/**
 * `l4Variables` with the revealed-line host fix above: the agent prompt
 * carries the actual line text for Explain/Ask on expanded context.
 */
export async function l4VariablesWithRevealed(
  ctx: ActionContext,
  snapshot: ReviewSnapshot,
  anchor: Anchor,
  opts: { thread?: Annotation; message: string; excludeId?: string },
): Promise<Record<string, unknown>> {
  const variables = l4Variables(snapshot, anchor, opts);
  const text = await revealedBlockText(ctx, anchor);
  if (text !== null) (variables.anchor as { block: string }).block = text;
  return variables;
}

/**
 * The `jobId` of the `runInFork`/`runSmall` job backing an action. The
 * seam enqueues after the base lookup, so the id arrives via the `onJob`
 * callback shortly after the call; this waits for it (bounded) so the
 * HTTP response can carry the `jobId` the UI streams on.
 *
 * When the fill settles without ever enqueuing (fail-fast agent, e.g.
 * `UNVIBE_AGENT=none`), callers invoke `settled()` in their completion
 * handlers so `wait()` resolves at once instead of hitting the timeout.
 * Promise resolution is first-wins, so a later `onJob`/`settled` is a
 * no-op once the other has fired.
 */
export function captureJobId(): {
  onJob: (job: Job) => void;
  settled: () => void;
  wait: () => Promise<Job | null>;
} {
  let resolve: (j: Job | null) => void = () => {};
  const done = new Promise<Job | null>((res) => {
    resolve = res;
  });
  const timer = setTimeout(() => resolve(null), 10000);
  return {
    onJob: (job: Job) => {
      clearTimeout(timer);
      resolve(job);
    },
    settled: () => {
      clearTimeout(timer);
      resolve(null);
    },
    wait: () => done,
  };
}

/** Cancel the job backing an annotation, if it is still active. */
export function cancelAnnotationJob(jobs: JobQueue, reviewId: string, jobId: string | null | undefined): void {
  if (!jobId) return;
  try {
    const job = jobs.get(jobId);
    if (job && job.reviewId === reviewId && job.state !== "done" && job.state !== "error" && job.state !== "cancelled") {
      jobs.cancel(jobId);
    }
  } catch {
    // Unknown job (restart) or already settled: nothing to cancel.
  }
}

/**
 * Store block anchors as `<card>#<block>`. Block ids restart at `b1` in
 * every card, so a bare id addresses the same-numbered block of every
 * card: an Explain on one card showed under the others (#78). Accepts the
 * qualified form, `card:<card>#<block>` from link tokens, and bare ids
 * (first card with that block). Unknown blocks pass through for
 * `buildAnchor` to reject.
 */
export function normalizeBlockAnchor(snapshot: ReviewSnapshot, anchor: ActionAnchor): ActionAnchor {
  if (anchor.where !== "block") return anchor;
  const found = findBlock(snapshot, anchor.blockId);
  if (found) return { where: "block", blockId: `${found.cardId}#${found.block.id}` };
  return anchor;
}

/**
 * True when a fill failure must NOT leave a visible error: the annotation
 * was closed or deleted while its job ran (cancel-on-close, PRD §12), or
 * its job was cancelled. Clears the working state and returns true.
 */
export async function suppressFillError(ctx: ActionContext, annotationId: string): Promise<boolean> {
  const { jobs, reviews, reviewId } = ctx;
  const snapshot = reviews.getSnapshot(reviewId);
  const found = snapshot?.annotations.find((a) => a.id === annotationId);
  if (!found || !found.open) {
    // Deleted or closed while filling: clear any working flag, no error.
    try {
      await reviews.mutate(reviewId, (draft) => {
        const ann = (draft.annotations as unknown as { id: string; working?: string | null }[]).find(
          (a) => a.id === annotationId,
        );
        if (ann) ann.working = null;
      });
    } catch {
      // Already deleted: nothing to clear.
    }
    return true;
  }
  const jobId = found.jobId;
  if (jobId) {
    try {
      if (jobs.get(jobId)?.state === "cancelled") {
        await reviews.mutate(reviewId, (draft) => {
          const ann = (draft.annotations as unknown as { id: string; working?: string | null; error?: string | null }[]).find(
            (a) => a.id === annotationId,
          );
          if (ann) {
            ann.working = null;
            ann.error = null;
          }
        });
        return true;
      }
    } catch {
      // Unknown job: fall through to the visible error.
    }
  }
  return false;
}

export function notFound(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, message: string): unknown {
  return reply.code(404).send({ error: message });
}

export function badRequest(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, message: string): unknown {
  return reply.code(400).send({ error: message });
}
