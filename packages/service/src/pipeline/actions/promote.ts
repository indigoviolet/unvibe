/**
 * `promote` action ("Open as page", PRD §4.7).
 *
 * Moves a conversation's content to a new page — one card per answer
 * (issue #136: an answer and a page card share the content body, so each
 * answer becomes an independently controllable card). The first card is
 * titled with the quoted text, later ones with their questions. The new
 * page is parented to the current page for the trail; the anchor becomes
 * a link to that page. An active fill job is cancelled first and whatever
 * content exists so far is what moves.
 */
import { randomBytes } from "node:crypto";
import type { Annotation, Block, Card } from "@unvibe/shared";
import { findBlock } from "../../interaction/index.js";
import { getSnapshotOrThrow, type ActionContext } from "./common.js";
import { cancelConversationJob } from "./conversation.js";

export async function promoteAction(
  ctx: ActionContext,
  annotationId: string,
): Promise<{ annotationId: string; pageId: string }> {
  const { reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const found = snapshot.annotations.find((a) => a.id === annotationId);
  if (!found) throw new Error(`unknown annotation ${annotationId}`);
  if (found.type !== "conversation" || !found.turns) {
    throw new Error(`annotation ${annotationId} is not a conversation`);
  }
  cancelConversationJob(ctx, snapshot, annotationId);

  // Parent for the trail: the page hosting the anchor block, else root.
  let parent = "root";
  if (found.anchor.host.kind === "block") {
    const located = findBlock(snapshot, found.anchor.host.blockId);
    if (located?.pageId) parent = located.pageId;
  }
  const quote = found.anchor.quotedText;
  const title = quote.length > 60 ? `${quote.slice(0, 58)}…` : quote || "(untitled)";
  const pageId = `p-${randomBytes(4).toString("hex")}`;

  await reviews.mutate(reviewId, (draft) => {
    const ann = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    if (!ann || ann.type !== "conversation" || !ann.turns) throw new Error(`unknown conversation ${annotationId}`);
    const cards: Card[] = ann.turns.map((turn, i) => ({
      id: `c-${randomBytes(4).toString("hex")}`,
      pageId,
      // First card carries the quoted text, later ones their questions.
      title: i === 0 ? ann.anchor.quotedText || null : (turn.question ?? null),
      level: turn.level,
      collapsed: false,
      revision: turn.revision,
      blocks: JSON.parse(JSON.stringify(turn.blocks)) as Block[],
      undoStack: JSON.parse(JSON.stringify(turn.undoStack)) as Card["undoStack"],
    }));
    draft.pages.push({ id: pageId, kind: "opened-expansion", title, saved: false, parent, cards });
    // The anchor becomes a link to the new page (prototype `link` block).
    ann.type = "link";
    ann.open = false;
    ann.working = null;
    ann.error = null;
    ann.jobId = undefined;
    ann.promotedToPage = pageId;
    delete ann.turns;
  });
  // The content entered the log when each turn filled (`new-card`);
  // moving it to a page adds no new shared knowledge.
  return { annotationId, pageId };
}
