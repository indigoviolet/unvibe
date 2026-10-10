/**
 * `promote` action ("Open as page", PRD §4.7).
 *
 * Moves an expansion's content to a new page titled with the quoted
 * text, parented to the current page for the trail; the anchor becomes a
 * link to that page. An active fill job is cancelled first and whatever
 * content exists so far is what moves.
 */
import { randomBytes } from "node:crypto";
import type { Annotation, Block, Card } from "@unvibe/shared";
import { findBlock, recordInteraction } from "../../interaction/index.js";
import { cancelAnnotationJob, getSnapshotOrThrow, type ActionContext } from "./common.js";

export async function promoteAction(
  ctx: ActionContext,
  annotationId: string,
): Promise<{ annotationId: string; pageId: string }> {
  const { jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const found = snapshot.annotations.find((a) => a.id === annotationId);
  if (!found) throw new Error(`unknown annotation ${annotationId}`);
  if (found.type !== "expansion" || !found.expansion) {
    throw new Error(`annotation ${annotationId} is not an expansion`);
  }
  cancelAnnotationJob(jobs, reviewId, found.jobId ?? found.expansion.jobId);

  // Parent for the trail: the page hosting the anchor block, else root.
  let parent = "root";
  if (found.anchor.host.kind === "block") {
    const located = findBlock(snapshot, found.anchor.host.blockId);
    if (located?.pageId) parent = located.pageId;
  }
  const quote = found.anchor.quotedText;
  const title = quote.length > 60 ? `${quote.slice(0, 58)}…` : quote || "(untitled)";
  const pageId = `p-${randomBytes(4).toString("hex")}`;
  const cardId = `c-${randomBytes(4).toString("hex")}`;
  const blocks = JSON.parse(JSON.stringify(found.expansion.blocks)) as Block[];
  const level = found.expansion.level;

  await reviews.mutate(reviewId, (draft) => {
    const ann = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    if (!ann || ann.type !== "expansion" || !ann.expansion) throw new Error(`unknown expansion ${annotationId}`);
    const card: Card = {
      id: cardId,
      pageId,
      title: null,
      level,
      read: false,
      collapsed: false,
      revision: 1,
      blocks,
      undoStack: [],
    };
    draft.pages.push({ id: pageId, kind: "opened-expansion", title, saved: false, parent, cards: [card] });
    // The anchor becomes a link to the new page (prototype `link` block).
    ann.type = "link";
    ann.open = false;
    ann.working = null;
    ann.error = null;
    ann.jobId = undefined;
    ann.promotedToPage = pageId;
    delete ann.expansion;
  });
  recordInteraction({ type: "expansion.promoted", reviewId, annotationId, pageId });
  return { annotationId, pageId };
}
