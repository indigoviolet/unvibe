/**
 * `revealSource(target)` — jump from a guide citation to the source pane
 * (web-guide owner; thin adapter over the diff pane's implementation).
 *
 * - `diff:` / `h:` / `code:` targets (canonical file keys, stored that
 *   way by the pipeline) go to `source/diff/revealSource.ts`, which
 *   switches tabs, clears filters, unfolds, scrolls and highlights.
 * - `desc:` targets dispatch the same window event (the source pane opens
 *   the description tab) and then scroll to the paragraph in this module,
 *   since the diff pane only handles diff locations.
 * - Anything else toasts instead of failing silently.
 */
import { toast } from "../floating/Toast.js";
import { canonicalRevealTarget } from "../guide/citations.js";
import { useReview } from "../state/store.js";
import { REVEAL_EVENT, revealSource as diffReveal } from "./diff/revealSource.js";

export { REVEAL_EVENT };

function flashParagraph(paragraphId: string): void {
  // Let the tab switch render first.
  window.setTimeout(() => {
    const el = document.getElementById(paragraphId);
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    el.classList.add("hl");
    window.setTimeout(() => el.classList.remove("hl"), 2600);
  }, 60);
}

export function revealSource(target: string): void {
  const snapshot = useReview.getState().snapshot;
  const canonical = snapshot ? canonicalRevealTarget(snapshot, target) : target;
  if (target.startsWith("desc:")) {
    window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: { ref: target } }));
    flashParagraph(target.slice("desc:".length).split("@")[0]);
    return;
  }
  if (target.startsWith("diff:") || target.startsWith("h:") || target.startsWith("code:")) {
    if (!snapshot) {
      toast("The review is still loading");
      return;
    }
    if (diffReveal(canonical)) return;
    toast("Couldn't find the cited code in this version");
    return;
  }
  toast("Couldn't open that link");
}
