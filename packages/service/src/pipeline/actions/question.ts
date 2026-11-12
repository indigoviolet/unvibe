/**
 * `question-rewrite` action (issue #388, ? mode): rewrite every guide
 * card in place with the picked terms as reader context ("the reader
 * doesn't understand these").
 *
 * The fan-out is one ordinary #387 `slower` press per card (same prompt
 * plus the terms block, same dedupe key shape, same undo push), so
 * per-card Undo works and nothing new is stored beyond #387's shape.
 * One agent call per card; the calls run through the job queue, so the
 * existing session/concurrency limits cap the parallelism — no extra
 * cap here. Guide version only: persona variants are never targeted.
 */
import { questionRewriteTargetIds } from "@unvibe/shared";
import { guidePromptText } from "../../interaction/index.js";
import { getSnapshotOrThrow, type ActionContext } from "./common.js";
import { slowerAction } from "./slower.js";

export interface QuestionRewriteResult {
  cardIds: string[];
  cardJobs: { cardId: string; jobId?: string; deduplicated?: boolean }[];
}

export async function questionRewriteAction(
  ctx: ActionContext,
  terms: string[],
): Promise<QuestionRewriteResult> {
  const clean = terms.map((t) => t.trim()).filter((t) => t.length > 0);
  if (clean.length === 0) throw new Error("terms are required");
  const snapshot = getSnapshotOrThrow(ctx.reviews, ctx.reviewId);
  const cardIds = questionRewriteTargetIds(snapshot);
  if (cardIds.length === 0) throw new Error("the guide has no written cards to rewrite");
  const guideText = guidePromptText(snapshot);
  // Sequential enqueue: each press returns once its job is queued (not
  // when the agent finishes), so the loop fans out fast and the queue
  // caps how many agent sessions actually run at once.
  const cardJobs: QuestionRewriteResult["cardJobs"] = [];
  for (const cardId of cardIds) {
    const res = await slowerAction(ctx, cardId, { terms: clean, guideText });
    cardJobs.push({
      cardId,
      ...(res.jobId ? { jobId: res.jobId } : {}),
      ...(res.deduplicated ? { deduplicated: true } : {}),
    });
  }
  return { cardIds, cardJobs };
}
