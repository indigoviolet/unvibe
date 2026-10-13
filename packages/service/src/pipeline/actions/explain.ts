/**
 * `explain` action (PRD §4.7, issue #136).
 *
 * Creates a conversation card anchored on the selected text (guide
 * block, description paragraph or diff line; quote + prefix/suffix),
 * immediately visible in a working state, then fills its first turn by a
 * job through `runConversationTurn` with the `explain` template and L4
 * context. The first turn's question is null (the default question);
 * later turns arrive through `reply` on the card's session. Content
 * streams into the turn as blocks; each answer is a unit in its own
 * right (depth level, revision, undo stack, second opinions).
 *
 * `runExplainFill` fills an existing turn (used by `retry` on the same
 * annotation id); `explainAction` creates the card first.
 */
import type { ActionAnchor, Anchor, Annotation } from "@unvibe/shared";
import { buildAnchor } from "../../comments/threads.js";
import {
  anchorKey,
  baseVersionOf,
  findActiveJob,
  getSnapshotOrThrow,
  normalizeBlockAnchor,
  type ActionContext,
} from "./common.js";
import { cancelConversationJob, createConversationCard, runConversationTurn } from "./conversation.js";
import { anchorSameHost } from "./explain-host.js";

export interface ExplainRequest {
  quote: string;
  anchor: ActionAnchor;
}

export async function explainAction(
  ctx: ActionContext,
  req: ExplainRequest,
): Promise<{ annotationId: string; turnId: string; jobId?: string; deduplicated?: boolean; reused?: boolean }> {
  const { reviews, reviewId } = ctx;
  // Empty quotes are legal (see ask.ts): the anchor still scopes the turn.
  if (typeof req.quote !== "string") throw new Error("quote is required");
  const before = getSnapshotOrThrow(reviews, reviewId);
  const normalized = normalizeBlockAnchor(before, req.anchor);
  // Validate the host exists (buildAnchor throws on unknown hosts).
  const anchor = buildAnchor(before, normalized, req.quote);
  const key = {
    anchor: `${anchorKey(normalized)}:${req.quote.slice(0, 80)}`,
    requestKind: "explain",
    baseVersion: baseVersionOf(before),
  };

  // Dedupe: identical active request, or an already-stored identical card.
  const active = findActiveJob(ctx.jobs, reviewId, key);
  if (active) {
    const existing = before.annotations.find(
      (a) => a.type === "conversation" && a.anchor.quotedText === req.quote && a.jobId === active.id,
    );
    return {
      annotationId: existing?.id ?? "",
      turnId: existing?.turns?.[0]?.id ?? "",
      jobId: active.id,
      deduplicated: true,
    };
  }
  // PRD §12 reuse (#10): the same anchor+quote on the same base version
  // reopens the stored card instead of generating a second one. Closed
  // cards reopen (dotted-link → expand in place); deleted cards
  // are gone so a repeat is legitimately a new request. A new base version
  // (new commits) invalidates: anchor.version must match current version.
  const storedDup = before.annotations.find(
    (a) =>
      a.type === "conversation" &&
      a.anchor.quotedText === req.quote &&
      anchorSameHost(a.anchor, anchor) &&
      a.anchor.version === before.version.n &&
      !a.error &&
      !(a.turns ?? []).some((t) => t.error) &&
      (a.turns ?? []).some((t) => t.blocks.length > 0),
  );
  if (storedDup) {
    if (!storedDup.open) {
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((x) => x.id === storedDup.id);
        if (found) found.open = true;
      });
    }
    return { annotationId: storedDup.id, turnId: storedDup.turns?.[0]?.id ?? "", reused: true };
  }

  // Immediately visible working state.
  const { annotationId, turnId } = await createConversationCard(ctx, anchor, null, "Thinking…");

  const res = await runExplainFill(ctx, annotationId, turnId, anchor, req.quote, { dedupeKey: key });
  return { annotationId, turnId, ...res };
}

/**
 * Fill an existing conversation turn via `runConversationTurn`. The turn
 * keeps its id (retry fills in place). Returns the job id when the job
 * started in time.
 */
export async function runExplainFill(
  ctx: ActionContext,
  annotationId: string,
  turnId: string,
  anchor: Anchor,
  quote: string,
  opts: { dedupeKey?: { anchor: string; requestKind: string; depth?: string; baseVersion: string }; skipDedupe?: boolean } = {},
): Promise<{ jobId?: string; deduplicated?: boolean }> {
  return runConversationTurn(ctx, annotationId, turnId, {
    anchor,
    template: "explain",
    message: `Explain: ${quote}`,
    dedupeKey: opts.dedupeKey,
    skipDedupe: opts.skipDedupe,
    echoCandidates: [quote],
    cardLabel: `Explain: ${quote}`,
    workingLabel: "Thinking…",
  });
}

/** Cancel the explain job (used by close/delete). */
export function cancelExplainJob(ctx: ActionContext, snapshot: { annotations: Annotation[] }, annotationId: string): void {
  cancelConversationJob(ctx, snapshot, annotationId);
}
