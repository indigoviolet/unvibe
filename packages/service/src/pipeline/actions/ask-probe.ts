/**
 * Conversation session probe, issue #136 (shared by reply, retry and
 * follow-up suggestions on conversation cards).
 *
 * Probe a conversation card's session: continue on it when live, else
 * fork fresh with the stored turns as the transcript. A rebuild lands
 * under a new id with no history, so the new id is stored and the full
 * prompt goes out; when even the rebuild fails the id is dropped and the
 * fork carries the transcript instead.
 */
import type { Annotation } from "@unvibe/shared";
import { turnsTextFor } from "../../interaction/index.js";
import { getSnapshotOrThrow, type ActionContext } from "./common.js";

export async function probeConversationSessionFor(
  ctx: ActionContext,
  card: Annotation,
): Promise<{ continueSessionId?: string; transcript?: string }> {
  const { reviews, reviewId, sessions } = ctx;
  // Re-read: the card passed in may predate a just-pushed turn; only the
  // session id and the stored turns matter here.
  const live = getSnapshotOrThrow(reviews, reviewId);
  const current = live.annotations.find((a) => a.id === card.id) ?? card;
  const sessionId = current.sessionId;
  const transcript = turnsTextFor(current);
  if (!sessionId || !sessions) return { transcript };
  try {
    const ensured = await sessions.ensureConversation(sessionId);
    if (ensured.rebuilt) {
      await reviews.mutate(reviewId, (draft) => {
        const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === card.id);
        if (target) target.sessionId = ensured.session.id;
      });
      return { transcript };
    }
    return { continueSessionId: sessionId };
  } catch {
    await reviews.mutate(reviewId, (draft) => {
      const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === card.id);
      if (target) delete target.sessionId;
    });
    return { transcript };
  }
}
