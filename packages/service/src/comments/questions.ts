/**
 * Agents' open questions as AI-suggested comments (issue #181).
 *
 * When a turn records an `open_questions` contribution, the question is
 * offered the same way the agent's other suggested comments are: an
 * AI-suggested comment anchored where the question came from, marked as
 * a question, drafted until the reviewer accepts it (Submit is still the
 * only thing that posts). Dismissing the suggestion marks its
 * contribution item dismissed (see `deleteInDraft` in `threads.ts`), so
 * agents do not raise it again.
 *
 * Anchor (the turn's source, never parsed prose):
 * - a conversation turn → its card's anchor (block / description /
 *   diff-line verbatim; a hunk maps to its first changed line, the same
 *   rule as #138 comments);
 * - a guide-card turn → the card's first block (empty quote: a marker
 *   comment, posted as a general review comment);
 * - anything else (reader, …) → the root page's first card's first
 *   block. Absent any card, the question stays contribution-only.
 *
 * Dedupe ("offer once"): same anchor host + same stored question text
 * (normalised, never prose parsing) skips creation — checked against the
 * draft's existing suggestions inside the same mutate that stores the
 * contribution, so concurrent turns cannot double-offer.
 */
import type {
  ActionAnchor,
  Annotation,
  ChatMessage,
  ReviewSnapshot,
} from "@unvibe/shared";
import type { WritableDraft } from "immer";
import { normalizeContributionText } from "../sharedctx/contributions.js";
import { buildAnchor, newAnnotationId } from "./threads.js";

export interface QuestionTurnContext {
  annotationId?: string;
  cardId?: string;
}

export interface KeptQuestion {
  text: string;
  contributionId: string;
  itemIndex: number;
}

/** First new-side line of a hunk, for hunk-sourced questions (#138 rule). */
function firstHunkLine(snapshot: ReviewSnapshot, fileKey: string, contentHash: string): number | null {
  const file = (snapshot.files ?? []).find((f) => f.fileKey === fileKey);
  const hunk = file?.hunks.find((h) => h.contentHash === contentHash);
  if (!hunk) return null;
  for (const row of hunk.lines ?? []) {
    if (row.newLine !== undefined) return row.newLine;
  }
  return null;
}

function firstBlockOf(snapshot: ReviewSnapshot, cardId: string): { cardId: string; blockId: string } | null {
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      if (card.id !== cardId) continue;
      const block = card.blocks[0];
      if (!block) return null;
      return { cardId: card.id, blockId: block.id };
    }
  }
  // Answers host nested questions the same way (issue #116).
  for (const a of snapshot.annotations ?? []) {
    for (const turn of a.turns ?? []) {
      if (turn.id !== cardId) continue;
      const block = turn.blocks[0];
      if (!block) return null;
      return { cardId: turn.id, blockId: block.id };
    }
  }
  return null;
}

function rootFirstBlock(snapshot: ReviewSnapshot): { cardId: string; blockId: string } | null {
  const root = (snapshot.pages ?? []).find((p) => p.kind === "root") ?? snapshot.pages[0];
  const card = root?.cards[0];
  const block = card?.blocks[0];
  if (!card || !block) return null;
  return { cardId: card.id, blockId: block.id };
}

/**
 * Where a turn's open questions belong. Null when nothing sensible
 * exists (the questions stay contribution-only, as today).
 */
export function resolveQuestionAnchor(
  snapshot: ReviewSnapshot,
  ctx: QuestionTurnContext,
): ActionAnchor | null {
  if (ctx.annotationId) {
    const ann = (snapshot.annotations ?? []).find((a) => a.id === ctx.annotationId);
    const host = ann?.anchor.host;
    if (!host) return null;
    if (host.kind === "block") return { where: "block", blockId: host.blockId };
    if (host.kind === "description") return { where: "description", paragraphId: host.paragraphId };
    if (host.kind === "diff-line") return { where: "diff-line", fileKey: host.fileKey, line: host.line };
    if (host.kind === "hunk") {
      const line = firstHunkLine(snapshot, host.fileKey, host.contentHash);
      return line === null ? null : { where: "diff-line", fileKey: host.fileKey, line };
    }
    return null;
  }
  const own = ctx.cardId ? firstBlockOf(snapshot, ctx.cardId) : null;
  const target = own ?? rootFirstBlock(snapshot);
  if (!target) return null;
  return { where: "block", blockId: `${target.cardId}#${target.blockId}` };
}

/** Anchor-host identity for suggestion dedupe (issue #181). */
export function questionHostKey(host: Annotation["anchor"]["host"]): string {
  if (host.kind === "block") return `block:${host.blockId}`;
  if (host.kind === "description") return `description:${host.paragraphId}`;
  if (host.kind === "diff-line") return `diff-line:${host.fileKey}:${host.line}`;
  if (host.kind === "comment") return `comment:${host.commentId}`;
  return `hunk:${host.fileKey}:${host.contentHash}`;
}

/** True when this annotation is already offered for this question. */
function alreadyOffered(annotations: Annotation[], hostKey: string, question: string): boolean {
  const want = normalizeContributionText(question);
  for (const a of annotations) {
    if (a.type !== "comment") continue;
    if (questionHostKey(a.anchor.host) !== hostKey) continue;
    for (const m of a.messages as ChatMessage[]) {
      if (m.who === "ai" && m.suggested && m.text && normalizeContributionText(m.text) === want) {
        return true;
      }
    }
  }
  return false;
}

export interface SuggestQuestionsParams {
  snapshot: ReviewSnapshot;
  ctx: QuestionTurnContext;
  questions: KeptQuestion[];
}

/**
 * Draft helper: offer kept open-question items as AI-suggested comments.
 * Runs inside the same mutate that stores the contributions, so the
 * offer-once check is atomic with them. Returns the created annotations.
 */
export function suggestOpenQuestionsInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  params: SuggestQuestionsParams,
): Annotation[] {
  const created: Annotation[] = [];
  if (params.questions.length === 0) return created;
  const anchor = resolveQuestionAnchor(params.snapshot, params.ctx);
  if (!anchor) return created;
  for (const q of params.questions) {
    const text = q.text?.trim() ?? "";
    if (!text) continue;
    const built = buildAnchor(params.snapshot, anchor, "");
    const hostKey = questionHostKey(built.host);
    if (alreadyOffered(draft.annotations as unknown as Annotation[], hostKey, text)) continue;
    if (alreadyOffered(created, hostKey, text)) continue;
    const thread: Annotation = {
      id: newAnnotationId(),
      type: "comment",
      anchor: built,
      // Guide questions start closed (marker); diff/description start open.
      open: built.host.kind === "block" ? false : true,
      pinned: false,
      messages: [{ who: "ai", text, suggested: true, question: true }],
      post: false,
      openQuestion: { contributionId: q.contributionId, itemIndex: q.itemIndex },
    };
    (draft.annotations as unknown as Annotation[]).push(thread as Annotation);
    created.push(thread);
  }
  return created;
}
