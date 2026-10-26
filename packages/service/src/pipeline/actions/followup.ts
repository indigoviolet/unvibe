/**
 * `followup` action (PRD §4.3): clicking a follow-up suggestion answers it.
 *
 * - On a page card the suggestion item is consumed (removed from the
 *   follow-up block, as in the prototype's `follow`) and its answer
 *   arrives as a new conversation card anchored on that block, quoting
 *   the suggestion label. The message sent is the item's pre-baked `ask`
 *   question when present, else the label.
 * - On a conversation card (issue #136) the suggestion is sent as the
 *   next turn in the same conversation, through the reply path — the item
 *   stays, like a question typed in the reply box.
 */
import type { WritableDraft } from "immer";
import type { Block, FollowUpBlock, ReviewSnapshot } from "@unvibe/shared";
import {
  baseVersionOf,
  findActiveJob,
  getSnapshotOrThrow,
  type ActionContext,
} from "./common.js";
import { pushConversationTurn, createConversationCard, runConversationTurn } from "./conversation.js";
import { probeConversationSessionFor } from "./ask-probe.js";

export async function followupAction(
  ctx: ActionContext,
  cardId: string,
  blockId: string,
  index: number,
): Promise<{ annotationId: string; replyId?: string; jobId?: string; deduplicated?: boolean }> {
  const { reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);

  // Locate the follow-up block + item (page cards and conversation answers).
  const located = findFollowUp(snapshot, cardId, blockId);
  if (!located) throw new Error(`unknown follow-up block ${blockId} on card ${cardId}`);
  if (!Number.isSafeInteger(index) || index < 0 || index >= located.block.items.length) {
    throw new Error(`unknown follow-up ${index} on block ${blockId}`);
  }
  const item = located.block.items[index];
  const message = item.ask ?? item.label;
  const quote = item.label;

  const key = {
    anchor: `followup:${cardId}:${blockId}:${index}`,
    requestKind: "followup",
    baseVersion: baseVersionOf(snapshot),
  };
  const active = findActiveJob(ctx.jobs, reviewId, key);
  if (active) {
    const existing = snapshot.annotations.find((a) => a.jobId === active.id);
    return { annotationId: existing?.id ?? "", jobId: active.id, deduplicated: true };
  }

  // Issue #136: a suggestion on a conversation card is the next turn in
  // the same conversation (the item stays, like reply-box text).
  if (located.holder.kind === "thread") {
    const annotationId = located.holder.annotationId;
    const current = getSnapshotOrThrow(reviews, reviewId);
    const card = current.annotations.find((a) => a.id === annotationId);
    if (!card || (card.type !== "thread" && card.type !== "link")) throw new Error(`unknown conversation ${annotationId}`);
    const replyId = await pushConversationTurn(ctx, annotationId, message, "Writing answer");
    const probe = await probeConversationSessionFor(ctx, card);
    const live = probe.continueSessionId !== undefined && !probe.rebuilt;
    const res = await runConversationTurn(ctx, annotationId, replyId, {
      anchor: card.anchor,
      template: live ? "ask_turn" : "ask",
      message,
      ...(probe.transcript !== undefined && !live ? { transcript: probe.transcript } : {}),
      ...(probe.continueSessionId ? { continueSessionId: probe.continueSessionId } : {}),
      dedupeKey: key,
      echoCandidates: [quote, message],
      replayKind: "ask",
      cardLabel: message,
      workingLabel: "Writing answer",
    });
    return { annotationId, replyId, ...res };
  }

  // Qualified like every other block anchor (#116): a bare block ID would
  // match the same-numbered block of every card at render time.
  const holder = located.holder;
  if (holder.kind !== "page-card") throw new Error(`unknown follow-up block ${blockId} on card ${cardId}`);
  const anchor = {
    host: { kind: "block" as const, blockId: `${holder.cardId}#${located.block.id}` },
    quotedText: quote,
    prefix: "",
    suffix: "",
    position: 0,
    version: snapshot.version.n,
  };

  // Consume the suggestion + create the answer card (working state).
  await reviews.mutate(reviewId, (draft) => {
    removeFollowUpItem(draft, holder.cardId, blockId, index);
  });
  const { annotationId, replyId } = await createConversationCard(ctx, anchor, message, "Writing answer");

  const live = getSnapshotOrThrow(reviews, reviewId);
  const ann = live.annotations.find((a) => a.id === annotationId)!;
  const res = await runConversationTurn(ctx, annotationId, replyId, {
    anchor: ann.anchor,
    template: "ask",
    message,
    dedupeKey: key,
    // Issue #50: the card header shows the suggestion label; the
    // question is the label (or its pre-baked ask text).
    echoCandidates: [quote, message],
    replayKind: "ask",
    cardLabel: message,
    workingLabel: "Writing answer",
  });
  return { annotationId, replyId, ...res };
}

type FollowUpHolder =
  | { kind: "page-card"; cardId: string }
  | { kind: "thread"; annotationId: string };

function findFollowUp(
  snapshot: ReviewSnapshot,
  cardId: string,
  blockId: string,
): { block: FollowUpBlock; holder: FollowUpHolder } | null {
  const fromBlocks = (blocks: Block[]): FollowUpBlock | null => {
    for (const b of blocks) {
      if (b.type === "follow-up" && (b.id === blockId || b.id === shortId(blockId))) {
        return b as FollowUpBlock;
      }
    }
    return null;
  };
  // The addressed card first: a page card, a conversation card, or one
  // answer's `ans_…` id (resolved to its card).
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.id !== cardId) continue;
      const hit = fromBlocks(card.blocks);
      if (hit) return { block: hit, holder: { kind: "page-card", cardId: card.id } };
    }
  }
  for (const ann of snapshot.annotations ?? []) {
    if (ann.type !== "thread" && ann.type !== "link") continue;
    for (const turn of ann.replies ?? []) {
      if (ann.id !== cardId && turn.id !== cardId) continue;
      const hit = fromBlocks(turn.blocks);
      if (hit) return { block: hit, holder: { kind: "thread", annotationId: ann.id } };
    }
  }
  // The block may live on a different card than addressed (anchor drift):
  // search everywhere as a fallback.
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      const hit = fromBlocks(card.blocks);
      if (hit) return { block: hit, holder: { kind: "page-card", cardId: card.id } };
    }
  }
  for (const ann of snapshot.annotations ?? []) {
    if (ann.type !== "thread" && ann.type !== "link") continue;
    for (const turn of ann.replies ?? []) {
      const hit = fromBlocks(turn.blocks);
      if (hit) return { block: hit, holder: { kind: "thread", annotationId: ann.id } };
    }
  }
  return null;
}

function shortId(raw: string): string {
  if (raw.includes("#")) return raw.split("#").pop()!;
  if (raw.includes(":")) return raw.split(":").pop()!;
  return raw;
}

function removeFollowUpItem(
  draft: WritableDraft<ReviewSnapshot>,
  cardId: string,
  blockId: string,
  index: number,
): void {
  const removeFrom = (blocks: Block[]): boolean => {
    for (const b of blocks) {
      if (b.type === "follow-up" && (b.id === blockId || shortId(b.id) === shortId(blockId))) {
        (b as FollowUpBlock).items.splice(index, 1);
        return true;
      }
    }
    return false;
  };
  for (const page of draft.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.id === cardId && removeFrom(card.blocks as Block[])) return;
    }
  }
}
