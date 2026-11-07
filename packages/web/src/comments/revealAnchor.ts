/**
 * Reverse link (issue #364): from an answer back to the passage it
 * answers. Scrolls to the thread's highlight mark — or, when the quote
 * can't be placed, to the margin marker's line — and flashes it.
 *
 * Returns true when a mark or margin marker was found (and flashed);
 * false when it fell back to the thread element itself.
 */
export function revealThreadAnchor(threadId: string): boolean {
  let id = threadId;
  try {
    id = CSS.escape(threadId);
  } catch {
    // CSS.escape is total in practice; keep the raw id as a fallback.
  }
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scroll = (el: Element): void => {
    try {
      el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    } catch {
      el.scrollIntoView();
    }
  };
  const flash = (el: Element): void => {
    el.classList.add("flash");
    window.setTimeout(() => el.classList.remove("flash"), 2000);
  };
  const mark = document.querySelector(`mark.anc[data-thr="${id}"]`);
  if (mark) {
    scroll(mark);
    flash(mark);
    return true;
  }
  const margin = document.querySelector(`[data-thr-margin~="${id}"]`);
  if (margin) {
    scroll(margin);
    flash(margin);
    return true;
  }
  const thread = document.getElementById(threadId);
  if (thread) scroll(thread);
  return false;
}
