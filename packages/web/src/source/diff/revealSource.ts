/**
 * `revealSource(ref)` — the guide agent's hook for jumping from a citation
 * to the diff (PRD §4.5: click opens the source pane at that spot).
 *
 * Given a `diff:` ID (file key, optional new-side line range, e.g.
 * `diff:conn`, `diff:conn:82`, `diff:conn:99-118`), it:
 * 1. switches the source pane to the Diff tab,
 * 2. clears the file filters that hide the file (category chip, name
 *    filter, hide-reviewed),
 * 3. unfolds the file and unhides/unfolds the overlapping hunks,
 * 4. scrolls to the lines (or the file) and highlights them briefly —
 *    the same behaviour as the prototype's `showSource`.
 *
 * Wiring: `SourcePane` listens for the `unvibe:reveal-source` window event
 * and switches tabs; the mounted `DiffView` subscribes via
 * `onRevealSource` and performs steps 2–4. If the Diff tab isn't mounted
 * (e.g. the description tab is open), the ref waits in `takePendingReveal`
 * and the DiffView consumes it on mount. Returns `true` for a valid `diff:`
 * ref, `false` otherwise.
 */
import { parseDiffRef, type RevealTarget } from "./diffLogic.js";

export const REVEAL_EVENT = "unvibe:reveal-source";

export type { RevealTarget };
export { parseDiffRef };

type Listener = (ref: string, target: RevealTarget) => void;

const listeners = new Set<Listener>();
let pending: string | null = null;

/** Subscribe to reveal requests. Returns an unsubscribe function. */
export function onRevealSource(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Reveal a `diff:` location in the diff pane. See module docs. */
export function revealSource(ref: string): boolean {
  const target = parseDiffRef(ref);
  if (!target) return false;
  pending = ref;
  for (const fn of [...listeners]) fn(ref, target);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: { ref } }));
  }
  return true;
}

/** Take the reveal ref waiting for a freshly mounted DiffView, if any. */
export function takePendingReveal(): string | null {
  const ref = pending;
  pending = null;
  return ref;
}
