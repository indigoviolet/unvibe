/**
 * Interaction hook (PRD §9.3): how pipeline stages and UI actions feed the
 * append-only log.
 *
 * The interaction-actions agent owns `pipeline/actions/` and calls
 * `recordInteraction(event)` for things like new expansions, depth rewrites,
 * examples, diagrams, settled threads and deletions. It defines the same
 * interface with a no-op default in `packages/service/src/interaction/`; this
 * module is the shared-context side of that seam. Both export the same names
 * (`InteractionEvent`, `recordInteraction`, `setInteractionHandler`) so the
 * supervisor can join them: whichever handler is registered last wins, and
 * the default is a no-op until the service wires the real one in `app.ts`.
 *
 * Event kinds (PRD §9.3 taxonomy):
 * - logged card-local: `example-added`, `diagram-added`, `depth-rewrite`
 *   (only for conversations anchored on that card — `cardId` required);
 * - logged global: `thread-settled` (one line once a thread settles),
 *   `new-card` / `new-finding` (in full), `out-of-base-answer` (answers that
 *   cited something outside the base, in full), `item-deleted` (one line for
 *   a deleted item that had been shared);
 * - accepted but never logged (UI state): `read`, `collapse`,
 *   `depth-state`, `open`, `close`, `mark-for-pr`, `undo`, `bookmark`
 *   (page-saved flag).
 */
export type InteractionEventKind =
  | "example-added"
  | "diagram-added"
  | "depth-rewrite"
  | "thread-settled"
  | "new-card"
  | "new-finding"
  | "out-of-base-answer"
  | "item-deleted"
  | "read"
  | "collapse"
  | "depth-state"
  | "open"
  | "close"
  | "mark-for-pr"
  | "undo"
  | "bookmark";

export interface InteractionEvent {
  kind: InteractionEventKind;
  reviewId: string;
  /** Card the event belongs to (required for card-local kinds). */
  cardId?: string;
  /** Page the event belongs to (page-level UI state such as `bookmark`). */
  pageId?: string;
  /** Hunk content hash, for hunk-anchored events (e.g. settled threads). */
  hunkHash?: string;
  /** Thread the event came from, when there is one. */
  threadId?: string;
  /** Session that produced the content, when there is one. */
  sessionId?: string;
  /** One-line summary or full text, depending on the kind. */
  text: string;
  /** Citation targets, for `out-of-base-answer` and findings. */
  citations?: string[];
}

export type InteractionHandler = (event: InteractionEvent) => Promise<void>;

let handler: InteractionHandler = async () => {
  // No-op default: the service registers the real handler at startup.
};

/** Register the real handler (the service does this in `app.ts`). */
export function setInteractionHandler(next: InteractionHandler): void {
  handler = next;
}

/** The previous handler (tests use this to save/restore). */
export function getInteractionHandler(): InteractionHandler {
  return handler;
}

/**
 * Record one interaction event. UI-state kinds are accepted and dropped by
 * the real handler (they never enter the log); every other kind is mapped
 * to log entries by the taxonomy in `taxonomy.ts`.
 */
export async function recordInteraction(event: InteractionEvent): Promise<void> {
  await handler(event);
}
