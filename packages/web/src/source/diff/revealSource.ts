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
 * Pinned rows + programmatic scroll (issues #132, #140).
 *
 * Four rows stay pinned at the top of `#right` while the diff scrolls: the
 * tab strip (`.rstick`, owned by `SourcePane`), the diff actions bar
 * (`.dtool`, owned by `DiffView`), the current file header (`.dfile-h`) and
 * the current hunk header (`.dhunk-h`, owned by `FileSection`). Every place
 * that scrolls a diff line or a file header into view goes through the
 * helpers below so the target lands below the pinned rows — never under
 * them. The one shared mechanism is live measurement from the DOM (no
 * copied constants): `diffPinnedHeight()` for scroll offsets, `--diffbar-top`
 * / `--dfile-top` / `--dhunk-top` (same measurements) for the sticky `top`s.
 */

/** Gap between the pinned bars and a revealed line, in px. */
export const DIFF_REVEAL_MARGIN = 8;

/** Reveal scope: a diff line pins file + hunk headers above it, a file jump does not. */
export type RevealScope = "line" | "file";

// Fallbacks when the pane isn't laid out yet (first paint, jsdom): the
// tab strip is one row of 13px tabs, the bar one row of pill buttons, and
// both headers one row each.
const RSTICK_FALLBACK = 40;
const DTOOL_FALLBACK = 43;
const DFILE_FALLBACK = 34;
const DHUNK_FALLBACK = 31;

function measuredHeight(el: Element | null, fallback: number): number {
  if (!(el instanceof HTMLElement)) return 0;
  const h = el.offsetHeight;
  return h > 0 ? h : fallback;
}

function diffPane(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("right");
}

/**
 * Total height of the rows pinned at the top of `#right` that sit above a
 * reveal target (0 when the pane isn't mounted, e.g. unit tests). A `"line"`
 * target lands below all four rows (a file header and a hunk header pin
 * above it); a `"file"` target is the file header itself, so it lands below
 * the tab strip plus actions bar only. Every header kind is a uniform single
 * row, so sampling the first mounted one stands in for the pinned one.
 */
export function diffPinnedHeight(scope: RevealScope = "line"): number {
  const pane = diffPane();
  if (!pane) return 0;
  const top =
    measuredHeight(pane.querySelector(".rstick"), RSTICK_FALLBACK) +
    measuredHeight(pane.querySelector(".dtool"), DTOOL_FALLBACK);
  if (scope === "file") return top;
  return (
    top +
    measuredHeight(pane.querySelector(".dfile-h"), DFILE_FALLBACK) +
    measuredHeight(pane.querySelector(".dhunk-h"), DHUNK_FALLBACK)
  );
}

/**
 * Write the pinned rows' live heights onto `#right` as CSS variables, so
 * each sticky `top` tracks the rows above it without hard-coding a height:
 * `--diffbar-top` (tab strip), `--dfile-top` (strip + bar), `--dhunk-top`
 * (strip + bar + file header). No-op when the pane isn't mounted.
 */
export function refreshDiffPinned(): void {
  const pane = diffPane();
  if (!pane) return;
  const strip = measuredHeight(pane.querySelector(".rstick"), RSTICK_FALLBACK);
  const bar = measuredHeight(pane.querySelector(".dtool"), DTOOL_FALLBACK);
  const file = measuredHeight(pane.querySelector(".dfile-h"), DFILE_FALLBACK);
  pane.style.setProperty("--diffbar-top", `${strip}px`);
  pane.style.setProperty("--dfile-top", `${strip + bar}px`);
  pane.style.setProperty("--dhunk-top", `${strip + bar + file}px`);
}

/**
 * Keep the pinned-offset variables equal to the rows' live heights (a
 * `ResizeObserver`, never a scroll listener: sticky positioning does the
 * pinning). The observer watches the pane plus the two top rows; header
 * heights are re-sampled on every fire, and `refreshDiffPinned` covers DOM
 * insertions (snapshot load, view switch) that don't resize the pane.
 * Returns a disconnect function; a no-op when the pane isn't mounted.
 */
export function observeDiffPinned(): () => void {
  const pane = diffPane();
  if (!pane || typeof ResizeObserver === "undefined") return () => {};
  refreshDiffPinned();
  // Stuck marking (owner's floating-card rule): a file/hunk header may
  // paint above a floating card only while it is actually stuck in its
  // pinned slot; in place, later sections stay below the card. CSS
  // cannot select "stuck", so mark it from the same live measurements
  // as the sticky offsets: a header is stuck when its top sits at its
  // sticky offset (±1px). Recomputed on scroll (rAF-throttled) and on
  // every resize refresh.
  const updateStuck = (): void => {
    const paneTop = pane.getBoundingClientRect().top;
    const strip = measuredHeight(pane.querySelector(".rstick"), RSTICK_FALLBACK);
    const bar = measuredHeight(pane.querySelector(".dtool"), DTOOL_FALLBACK);
    const file = measuredHeight(pane.querySelector(".dfile-h"), DFILE_FALLBACK);
    pane.querySelectorAll(".dfile-h").forEach((h) => {
      h.classList.toggle("stuck", Math.abs(h.getBoundingClientRect().top - (paneTop + strip + bar)) <= 1);
    });
    pane.querySelectorAll(".dhunk-h").forEach((h) => {
      h.classList.toggle("stuck", Math.abs(h.getBoundingClientRect().top - (paneTop + strip + bar + file)) <= 1);
    });
  };
  let raf = 0;
  const onScroll = (): void => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      updateStuck();
    });
  };
  pane.addEventListener("scroll", onScroll, { passive: true });
  updateStuck();
  const ro = new ResizeObserver(() => {
    refreshDiffPinned();
    updateStuck();
  });
  ro.observe(pane);
  const stick = pane.querySelector(".rstick");
  const bar = pane.querySelector(".dtool");
  if (stick instanceof HTMLElement) ro.observe(stick);
  if (bar instanceof HTMLElement) ro.observe(bar);
  if (typeof document !== "undefined" && document.fonts) {
    document.fonts.ready.then(refreshDiffPinned).catch(() => {});
  }
  return () => {
    pane.removeEventListener("scroll", onScroll);
    if (raf) cancelAnimationFrame(raf);
    ro.disconnect();
  };
}

/**
 * Scroll `#right` so `el`'s top lands below the pinned rows (plus margin).
 * `"line"` clears all four rows; `"file"` clears the strip plus bar (the
 * target is the file header itself). Falls back to `scrollIntoView` when
 * the pane isn't mounted (unit tests).
 */
export function revealDiffElement(el: HTMLElement, scope: RevealScope = "line"): void {
  const pane = diffPane();
  if (!pane) {
    el.scrollIntoView?.({ block: "center" });
    return;
  }
  const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  pane.scrollTop = Math.max(0, top - diffPinnedHeight(scope) - DIFF_REVEAL_MARGIN);
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
