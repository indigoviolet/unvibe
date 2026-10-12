/**
 * Interaction → log event mapping (M4 actions emit the canonical
 * `sharedctx/hooks.ts` kinds; the taxonomy there decides what enters the
 * append-only log and with what scope).
 *
 * - explain / follow-up answers (new expansion content) → `new-card`;
 * - agent depth rewrites → `depth-rewrite` (card scope); instant cached
 *   switches → `depth-state` (UI state, never logged);
 * - examples / diagrams → `example-added` / `diagram-added` (card scope);
 * - ask replies citing fetched `code:` (outside the diff/descriptions in
 *   L1) → `out-of-base-answer` in full; threads themselves settle later
 *   via `maybeSettleThread` (one line on close/idle);
 * - deleted items that had shared agent content → `item-deleted`;
 * - read / collapse / bookmark / undo / close → UI-state kinds (accepted,
 *   never logged).
 */
import { parseId, renderMarkdown, type Annotation, type Block, type ReviewSnapshot } from "@unvibe/shared";
import type { InteractionEvent } from "../../interaction/index.js";
import { findBlock } from "../../interaction/index.js";

/** Whitespace-folded onto one line (log one-liners). Never cut short. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Rendered expansion content in full (for `new-card` entries, PRD §9.3). */
export function expansionText(blocks: Block[], quote: string): string {
  return `Explain "${oneLine(quote)}":\n\n${renderMarkdown(blocks).trim()}`;
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
  if (ann?.type === "expansion") {
    return ann.anchor.quotedText.trim() !== "" ? ann.anchor.quotedText : "explanation";
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

/** `new-card` for a filled explanation/follow-up expansion. */
export function newCardForExpansion(
  reviewId: string,
  snapshot: ReviewSnapshot,
  annotation: Annotation,
  sessionId?: string,
): InteractionEvent | null {
  if (annotation.type !== "expansion" || !annotation.expansion) return null;
  const event: InteractionEvent = {
    kind: "new-card",
    reviewId,
    text: expansionText(annotation.expansion.blocks, annotation.anchor.quotedText),
    threadId: annotation.id,
  };
  const cardId = hostCardId(snapshot, annotation.anchor);
  if (cardId) event.cardId = cardId;
  if (sessionId) event.sessionId = sessionId;
  return event;
}

/** True when an annotation holds shared agent content (deletion-worthy). */
export function wasShared(annotation: Annotation): boolean {
  if (annotation.type === "expansion") return (annotation.expansion?.blocks.length ?? 0) > 0;
  if (annotation.type === "thread") return annotation.messages.some((m) => m.who === "ai");
  return false;
}

/** `item-deleted` one-liner for a deleted shared item. */
export function deletionFor(reviewId: string, annotation: Annotation): InteractionEvent {
  const what = annotation.type === "expansion" ? "explanation" : annotation.type === "thread" ? "thread" : "annotation";
  return {
    kind: "item-deleted",
    reviewId,
    text: `Deleted ${what} "${oneLine(annotation.anchor.quotedText)}"`,
    threadId: annotation.id,
  };
}
