/**
 * Shared helpers for interaction actions (M4).
 *
 * Every action goes through `ReviewStore.mutate` so the UI gets patches;
 * every agent call runs at user-requested priority with a dedupe key of
 * (anchor, kind, depth, base version) and is validated (citations, one
 * repair turn) by the `runInFork` seam.
 */
import type { Job } from "@unvibe/shared";
import { JOB_PRIORITY, jobDedupeKeyString, type ActionAnchor, type JobDedupeKey, type ReviewSnapshot } from "@unvibe/shared";
import type { JobQueue } from "../../jobs/index.js";
import type { ReviewStore } from "../../state/store.js";
import type { Pipeline } from "../runner.js";
import type { SessionManager } from "../../sessions/manager.js";
import type { SettingsStore } from "../../settings/index.js";
import type { SharedContextService } from "../../sharedctx/service.js";
import { findBlock, recordInteraction } from "../../interaction/index.js";

function findBlockInSnapshot(snapshot: ReviewSnapshot, blockId: string): string | null {
  const found = findBlock(snapshot, blockId);
  return found ? found.block.id : null;
}

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
 * Tolerate `card:<card>#<block>` / `<card>#<block>` block ids in action
 * anchors: resolve to the real block id first so `buildAnchor` (which
 * matches plain block ids) keeps working when the web sends the
 * card-qualified form from link tokens.
 */
export function normalizeBlockAnchor(snapshot: ReviewSnapshot, anchor: ActionAnchor): ActionAnchor {
  if (anchor.where !== "block") return anchor;
  const raw = anchor.blockId;
  if (!raw.includes("#") && !raw.includes(":")) return anchor;
  const found = findBlockInSnapshot(snapshot, raw);
  if (found) return { where: "block", blockId: found };
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
