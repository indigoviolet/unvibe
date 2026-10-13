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

/**
 * Pinned rows + programmatic scroll (issue #132).
 *
 * Two rows stay pinned at the top of `#right` while the diff scrolls: the
 * tab strip (`.rstick`, owned by `SourcePane`) and the diff actions bar
 * (`.dtool`, owned by `DiffView`). Every place that scrolls a diff line or
 * a file header into view goes through the helpers below so the target
 * lands below the pinned rows — never under them. The one shared value is
 * measured live from the DOM (no copied constants): `diffPinnedHeight()`
 * for scroll offsets, `--diffbar-top` (same measurement, tab strip only)
 * for the bar's sticky `top`.
 */

/** Gap between the pinned bars and a revealed line, in px. */
export const DIFF_REVEAL_MARGIN = 8;

// Fallbacks when the pane isn't laid out yet (first paint, jsdom): the
// tab strip is one row of 13px tabs, the bar one row of pill buttons.
const RSTICK_FALLBACK = 40;
const DTOOL_FALLBACK = 37;

function measuredHeight(el: Element | null, fallback: number): number {
  if (!(el instanceof HTMLElement)) return 0;
  const h = el.offsetHeight;
  return h > 0 ? h : fallback;
}

function diffPane(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("right");
}

/** Height of the pinned tab strip alone: the actions bar's sticky `top`. */
export function diffTabStripHeight(): number {
  const pane = diffPane();
  if (!pane) return 0;
  return measuredHeight(pane.querySelector(".rstick"), RSTICK_FALLBACK);
}

/**
 * Total height of the rows pinned at the top of `#right`: tab strip plus
 * actions bar (0 when the pane isn't mounted, e.g. unit tests).
 */
export function diffPinnedHeight(): number {
  const pane = diffPane();
  if (!pane) return 0;
  return (
    measuredHeight(pane.querySelector(".rstick"), RSTICK_FALLBACK) +
    measuredHeight(pane.querySelector(".dtool"), DTOOL_FALLBACK)
  );
}

/**
 * Keep `--diffbar-top` on `#right` equal to the tab strip's live height, so
 * the sticky actions bar pins directly under it without hard-coding a
 * height if the strip ever wraps. A `ResizeObserver`, not a scroll
 * listener: sticky positioning does the pinning. Returns a disconnect
 * function; a no-op when the pane isn't mounted.
 */
export function observeDiffTabStrip(): () => void {
  const pane = diffPane();
  const stick = pane?.querySelector(".rstick");
  if (!pane || !(stick instanceof HTMLElement) || typeof ResizeObserver === "undefined") return () => {};
  const apply = (): void => {
    pane.style.setProperty("--diffbar-top", `${diffTabStripHeight()}px`);
  };
  apply();
  const ro = new ResizeObserver(apply);
  ro.observe(stick);
  return () => ro.disconnect();
}

/**
 * Scroll `#right` so `el`'s top lands below the pinned rows (plus margin).
 * Falls back to `scrollIntoView` when the pane isn't mounted (unit tests).
 */
export function revealDiffElement(el: HTMLElement): void {
  const pane = diffPane();
  if (!pane) {
    el.scrollIntoView?.({ block: "center" });
    return;
  }
  const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  pane.scrollTop = Math.max(0, top - diffPinnedHeight() - DIFF_REVEAL_MARGIN);
}

/**
 * Ensure `el` is visible in `#right` without hiding it behind the pinned
 * rows: scrolls only when the element is under the bars or out of view.
 */
export function ensureDiffVisible(el: HTMLElement): void {
  const pane = diffPane();
  if (!pane) {
    el.scrollIntoView?.({ block: "nearest" });
    return;
  }
  const pinned = diffPinnedHeight() + DIFF_REVEAL_MARGIN;
  const box = el.getBoundingClientRect();
  const view = pane.getBoundingClientRect();
  if (box.top < view.top + pinned) {
    pane.scrollTop = Math.max(0, pane.scrollTop + (box.top - view.top - pinned));
  } else if (box.bottom > view.bottom) {
    pane.scrollTop += box.bottom - view.bottom + DIFF_REVEAL_MARGIN;
  }
}

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
