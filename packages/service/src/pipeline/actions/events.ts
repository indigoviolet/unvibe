/**
 * Interaction → log event mapping (M4 actions emit the canonical
 * `sharedctx/hooks.ts` kinds; the taxonomy there decides what enters the
 * append-only log and with what scope).
 *
 * - explain / follow-up answers (new conversation turns) → `new-card`;
 * - agent depth rewrites → `depth-rewrite` (card scope); instant cached
 *   switches → `depth-state` (UI state, never logged);
 * - examples / diagrams → `example-added` / `diagram-added` (card scope);
 * - ask replies citing fetched `code:` (outside the diff/descriptions in
 *   L1) → `out-of-base-answer` in full; threads themselves settle later
 *   via `maybeSettleThread` (one line on close/idle);
 * - deleted items that had shared agent content → `item-deleted`;
 * - collapse / undo / close → UI-state kinds (accepted,
 *   never logged).
 */
import { parseId, renderMarkdown, type Annotation, type Block, type ReviewSnapshot } from "@unvibe/shared";
import type { InteractionEvent } from "../../interaction/index.js";
import { findBlock } from "../../interaction/index.js";

/** Whitespace-folded onto one line (log one-liners). Never cut short. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Rendered turn content in full (for `new-card` entries, PRD §9.3). */
export function turnText(blocks: Block[], quote: string, question: string | null): string {
  const head = question === null ? `Explain "${oneLine(quote)}"` : `Q: ${oneLine(question)}`;
  return `${head}:\n\n${renderMarkdown(blocks).trim()}`;
}

/** Page-card id hosting a block anchor, when there is one. */
export function hostCardId(snapshot: ReviewSnapshot, anchor: Annotation["anchor"]): string | undefined {
  if (anchor.host.kind !== "block") return undefined;
  const found = findBlock(snapshot, anchor.host.blockId);
  if (!found || !found.pageId) return undefined;
  return found.cardId;
}

/** Card title for human-readable log lines. Never an internal id. */
export function cardTitle(snapshot: ReviewSnapshot, cardId: string): string {
  for (const page of snapshot.pages ?? []) {
    const card = page.cards.find((c) => c.id === cardId);
    if (card?.title) return card.title;
    if (card) return "untitled card";
  }
  const ann = snapshot.annotations.find((a) => a.id === cardId);
  if (ann?.type === "conversation") {
    return ann.anchor.quotedText.trim() !== "" ? ann.anchor.quotedText : "explanation";
  }
  for (const a of snapshot.annotations ?? []) {
    const turn = (a.turns ?? []).find((t) => t.id === cardId);
    if (turn) return turn.question ?? (a.anchor.quotedText.trim() !== "" ? a.anchor.quotedText : "explanation");
  }
  return "untitled card";
}

/**
 * Issue #50: the stored page-card title, if any, for echo-strip
 * candidates. Unlike `cardTitle` this never falls back to ids or quotes
 * (those must not become strip candidates).
 */
export function storedCardTitle(snapshot: ReviewSnapshot, cardId: string): string | undefined {
  for (const page of snapshot.pages ?? []) {
    const card = page.cards.find((c) => c.id === cardId);
    if (card?.title) return card.title;
  }
  return undefined;
}

/**
 * Issue #50 / #136: echo-strip candidate for a conversation answer — its
 * question, else the card's quoted text (shown in the card header, so a
 * rewrite must not open by repeating it).
 */
export function answerEchoTitle(snapshot: ReviewSnapshot, cardId: string): string | undefined {
  for (const a of snapshot.annotations ?? []) {
    const turn = (a.turns ?? []).find((t) => t.id === cardId);
    if (turn) return turn.question ?? (a.anchor.quotedText || undefined);
  }
  return undefined;
}

/**
 * True when any validated citation points at fetched code (`code:`).
 * The base pack inlines the diff, descriptions, pins and guide (L1/L1b/L2);
 * `code:` excerpts come from `get_code` fetches beyond it, so an answer
 * citing them is shared in full (PRD §9.3).
 */
export function hasOutOfBaseCitations(tokens: { target: string; status: string }[]): boolean {
  return tokens.some((t) => {
    if (t.status === "unverified") return false;
    return parseId(t.target)?.kind === "code";
  });
}

/** `new-card` for a filled conversation turn. */
export function newCardForTurn(
  reviewId: string,
  snapshot: ReviewSnapshot,
  annotation: Annotation,
  turnId: string,
  sessionId?: string,
): InteractionEvent | null {
  // Promoted links still holding turns log like conversations (issue
  // #152): a turn that fills after the move is new shared knowledge.
  if (annotation.type !== "conversation" && !(annotation.type === "link" && (annotation.turns?.length ?? 0) > 0)) {
    return null;
  }
  const turn = (annotation.turns ?? []).find((t) => t.id === turnId);
  if (!turn) return null;
  const event: InteractionEvent = {
    kind: "new-card",
    reviewId,
    text: turnText(turn.blocks, annotation.anchor.quotedText, turn.question),
    annotationId: annotation.id,
  };
  const cardId = hostCardId(snapshot, annotation.anchor);
  if (cardId) event.cardId = cardId;
  if (sessionId) event.sessionId = sessionId;
  return event;
}

/** True when an annotation holds shared agent content (deletion-worthy). */
export function wasShared(annotation: Annotation): boolean {
  if (annotation.type === "conversation") return (annotation.turns ?? []).some((t) => t.blocks.length > 0);
  if (annotation.type === "link") return (annotation.turns ?? []).some((t) => t.blocks.length > 0);
  if (annotation.type === "comment") return annotation.messages.some((m) => m.who === "ai");
  return false;
}

/** `item-deleted` one-liner for a deleted shared item. */
export function deletionFor(reviewId: string, annotation: Annotation): InteractionEvent {
  const what = annotation.type === "conversation" ? "explanation" : annotation.type === "comment" ? "comment" : "annotation";
  return {
    kind: "item-deleted",
    reviewId,
    text: `Deleted ${what} "${oneLine(annotation.anchor.quotedText)}"`,
    annotationId: annotation.id,
  };
}
