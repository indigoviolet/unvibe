/**
 * Conversation session probe, issue #136 (shared by reply, retry and
 * follow-up suggestions on conversation cards).
 *
 * Probe a conversation card's session: continue on it when live, else
 * fork fresh with the stored turns as the transcript. A rebuild lands
 * under a new id with no history, so the new id is stored and the full
 * prompt goes out; when even the rebuild fails the id is dropped and the
 * fork carries the transcript instead.
 *
 * Issue #160: a follow-up continues the stored session only when its
 * access mode matches the current setting. On a mismatch (the setting
 * flipped since the session started, either direction — or a session
 * stored before posture tracking), the old session is closed, its id
 * dropped, and the follow-up forks fresh in the current mode with the
 * transcript. The completion applier stores the fresh fork's id, so the
 * next follow-up continues it.
 */
import type { Annotation } from "@unvibe/shared";
import { accessModeOf } from "@unvibe/shared";
import { turnsTextFor } from "../../interaction/index.js";
import { getSnapshotOrThrow, type ActionContext } from "./common.js";

async function dropSessionId(ctx: ActionContext, cardId: string): Promise<void> {
  await ctx.reviews.mutate(ctx.reviewId, (draft) => {
    const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === cardId);
    if (target) delete target.sessionId;
  });
}

export async function probeConversationSessionFor(
  ctx: ActionContext,
  card: Annotation,
): Promise<{ continueSessionId?: string; transcript?: string; rebuilt?: boolean }> {
  const { reviews, reviewId, sessions } = ctx;
  // Re-read: the card passed in may predate a just-pushed turn; only the
  // session id and the stored turns matter here.
  const live = getSnapshotOrThrow(reviews, reviewId);
  const current = live.annotations.find((a) => a.id === card.id) ?? card;
  const sessionId = current.sessionId;
  const transcript = turnsTextFor(current);
  if (!sessionId || !sessions) return { transcript };
  // Issue #160: never continue a session started under the other access
  // mode. Unknown stored posture (pre-tracking rows) counts as a
  // mismatch: fork fresh once, then re-anchored by the applier.
  const expected = ctx.settings ? accessModeOf(ctx.settings.get()) !== "full" : undefined;
  const stored = sessions.conversationAccess(sessionId);
  if (expected !== undefined && stored !== expected) {
    try {
      await sessions.closeConversation(sessionId);
    } catch {
      // best-effort
    }
    await dropSessionId(ctx, card.id);
    return { transcript };
  }
  try {
    const ensured = await sessions.ensureConversation(sessionId);
    if (ensured.rebuilt) {
      await reviews.mutate(reviewId, (draft) => {
        const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === card.id);
        if (target) target.sessionId = ensured.session.id;
      });
      // Issue #143: the rebuilt session is reused for this turn (the
      // caller sends the full prompt with the transcript on it), so the
      // context is rebuilt exactly once and later turns continue short
      // — never a second fork, never the whole thread again.
      return { continueSessionId: ensured.session.id, transcript, rebuilt: true };
    }
    return { continueSessionId: sessionId };
  } catch {
    await dropSessionId(ctx, card.id);
    return { transcript };
  }
}
