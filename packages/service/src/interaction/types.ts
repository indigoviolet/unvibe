/**
 * Interaction event hook (M4).
 *
 * Every `POST /api/reviews/:id/actions` handler reports what it did
 * through a single `recordInteraction(event)` hook. The shared-context
 * agent owns the log, change lists and contributions: it implements this
 * interface and decides what enters the log (PRD §9.3). The default is a
 * no-op so interaction works without it.
 *
 * Events emitted (one per action; async completions emit a second event):
 * - `explain.requested` / `explain.completed` / `explain.failed`
 * - `ask.requested` / `ask.replied` / `ask.failed`
 * - `note.created` (no agent reply)
 * - `depth.requested` / `depth.completed` (instant when the level is cached)
 * - `examples.added` / `diagram.added`
 * - `undo.applied`
 * - `read.changed` / `collapse.changed` / `bookmark.changed` (UI state;
 *   never logged per PRD §9.3 — emitted so the hook can ignore them)
 * - `expansion.closed` / `thread.closed` / `annotation.deleted`
 * - `expansion.promoted` (open-as-page)
 * - `followup.answered` (follow-up suggestion clicked, answer added)
 * - `thread.reply` (follow-up message in an ask thread)
 * - `thread.retried` (retry after a visible error)
 * - `concept.requested` / `concept.completed`
 */
export type InteractionEvent =
  | { type: "explain.requested"; reviewId: string; annotationId: string; quote: string }
  | { type: "explain.completed"; reviewId: string; annotationId: string; unverified: number }
  | { type: "explain.failed"; reviewId: string; annotationId: string; error: string }
  | { type: "ask.requested"; reviewId: string; threadId: string }
  | { type: "ask.replied"; reviewId: string; threadId: string; unverified: number }
  | { type: "ask.failed"; reviewId: string; threadId: string; error: string }
  | { type: "note.created"; reviewId: string; threadId: string }
  | { type: "depth.requested"; reviewId: string; cardId: string; direction: "simpler" | "deeper" }
  | { type: "depth.completed"; reviewId: string; cardId: string; level: string; fromAgent: boolean }
  | { type: "examples.added"; reviewId: string; cardId: string; count: number }
  | { type: "diagram.added"; reviewId: string; cardId: string }
  | { type: "undo.applied"; reviewId: string; cardId: string }
  | { type: "read.changed"; reviewId: string; cardId: string; read: boolean }
  | { type: "collapse.changed"; reviewId: string; cardId: string; collapsed: boolean }
  | { type: "bookmark.changed"; reviewId: string; pageId: string; saved: boolean }
  | { type: "expansion.closed"; reviewId: string; annotationId: string }
  | { type: "thread.closed"; reviewId: string; threadId: string }
  | { type: "annotation.deleted"; reviewId: string; annotationId: string }
  | { type: "expansion.promoted"; reviewId: string; annotationId: string; pageId: string }
  | { type: "followup.answered"; reviewId: string; annotationId: string; cardId: string }
  | { type: "thread.reply"; reviewId: string; threadId: string }
  | { type: "thread.retried"; reviewId: string; threadId: string }
  | { type: "concept.requested"; reviewId: string; slug: string }
  | { type: "concept.completed"; reviewId: string; slug: string; pageId: string };

/** Single hook the shared-context agent implements; no-op by default. */
export interface InteractionRecorder {
  recordInteraction(event: InteractionEvent): void;
}

/** Default recorder: drops every event (log ownership lives elsewhere). */
export const noopRecorder: InteractionRecorder = {
  recordInteraction() {},
};

let current: InteractionRecorder = noopRecorder;

/** Override the process-wide recorder (tests + shared-context wiring). */
export function setInteractionRecorder(recorder: InteractionRecorder): void {
  current = recorder;
}

/** Emit one interaction event to the current recorder. Never throws. */
export function recordInteraction(event: InteractionEvent): void {
  try {
    current.recordInteraction(event);
  } catch {
    // Recording must never break the action itself.
  }
}
