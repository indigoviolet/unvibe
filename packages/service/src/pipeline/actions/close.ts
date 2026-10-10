/**
 * `close` / `delete` actions (PRD §4.7, §4.8).
 *
 * - `close` on an expansion closes it (the anchor becomes a dotted link;
 *   hover previews, click expands in place). On a thread it closes the
 *   thread (guide: back to its marker; diff: comment icon on the line).
 * - `delete` removes the annotation entirely.
 * - Both cancel the annotation's job when one is still running (PRD §12).
 */
import type { Annotation } from "@unvibe/shared";
import { recordInteraction } from "../../interaction/index.js";
import { cancelAnnotationJob, getSnapshotOrThrow, type ActionContext } from "./common.js";

export async function closeAction(
  ctx: ActionContext,
  annotationId: string,
): Promise<{ annotationId: string }> {
  const { jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const found = snapshot.annotations.find((a) => a.id === annotationId);
  if (!found) throw new Error(`unknown annotation ${annotationId}`);
  cancelAnnotationJob(jobs, reviewId, found.jobId ?? (found.type === "expansion" ? found.expansion?.jobId : undefined));

  await reviews.mutate(reviewId, (draft) => {
    const ann = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    if (!ann) throw new Error(`unknown annotation ${annotationId}`);
    ann.open = false;
    ann.working = null;
    if (ann.type === "expansion" && ann.expansion) ann.expansion.working = null;
    // Closing keeps content for the dotted-link preview; a working job
    // that finishes later still fills the (closed) expansion.
  });
  if (found.type === "expansion") {
    recordInteraction({ type: "expansion.closed", reviewId, annotationId });
  } else {
    recordInteraction({ type: "thread.closed", reviewId, threadId: annotationId });
  }
  return { annotationId };
}

export async function deleteAction(
  ctx: ActionContext,
  targetId: string,
): Promise<{ targetId: string }> {
  const { jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const found = snapshot.annotations.find((a) => a.id === targetId);
  if (!found) throw new Error(`unknown annotation ${targetId}`);
  cancelAnnotationJob(jobs, reviewId, found.jobId ?? (found.type === "expansion" ? found.expansion?.jobId : undefined));

  await reviews.mutate(reviewId, (draft) => {
    const idx = (draft.annotations as unknown as Annotation[]).findIndex((a) => a.id === targetId);
    if (idx < 0) throw new Error(`unknown annotation ${targetId}`);
    (draft.annotations as unknown as Annotation[]).splice(idx, 1);
  });
  recordInteraction({ type: "annotation.deleted", reviewId, annotationId: targetId });
  return { targetId };
}
