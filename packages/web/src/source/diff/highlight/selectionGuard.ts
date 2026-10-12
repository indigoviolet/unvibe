/**
 * Selection guard for highlight upgrades (issue #23, hardening item 5).
 *
 * Token rows arrive after first paint and React swaps the cell's text nodes
 * for spans. A text selection anchored inside those nodes collapses when
 * the swap lands. Selections are transient UI (select → toolbar → act or
 * dismiss), so upgrades wait for a live diff selection to clear — bounded
 * by SELECTION_WAIT_MS, after which the upgrade lands anyway. The wait only
 * ever triggers once per hunk, and only while the user is actively
 * selecting diff code.
 */

export const SELECTION_WAIT_MS = 1500;
const POLL_MS = 120;

/** Minimal document surface the guard needs (injectable for tests). */
export interface SelectionScope {
  getSelection?: () => Selection | null;
  querySelector?: (selectors: string) => Element | null;
}

/** True when a non-collapsed selection is anchored inside diff code. */
export function isDiffSelectionActive(scope?: SelectionScope): boolean {
  try {
    const doc: SelectionScope =
      scope ?? (typeof document !== "undefined" ? document : ({} as SelectionScope));
    const sel = doc.getSelection?.() ?? null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
    const anchor = sel.anchorNode;
    if (!anchor) return false;
    const el = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
    return !!el?.closest?.("#right table.diff td.c");
  } catch {
    return false;
  }
}

/**
 * Resolve once no diff selection is active, the wait times out, or
 * `isCancelled()` turns true. Never rejects: highlighting must never break
 * for a guard.
 */
export function waitForSelectionClear(
  scope?: SelectionScope,
  isCancelled?: () => boolean,
  waitMs: number = SELECTION_WAIT_MS,
): Promise<void> {
  if (!isDiffSelectionActive(scope)) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      if (isCancelled?.() === true || !isDiffSelectionActive(scope) || Date.now() - started >= waitMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, POLL_MS);
    };
    window.setTimeout(tick, POLL_MS);
  });
}
