/**
 * Pane-visibility events for the review shell (issue #83).
 *
 * `SHOW_GUIDE_EVENT` ("unvibe:show-guide"): fired when something navigates
 * to guide content while the guide pane may be hidden — `AppShell` turns
 * the guide back on without touching the source pane. Mirrors the
 * `REVEAL_EVENT` (guide → source) direction.
 */
export const SHOW_GUIDE_EVENT = "unvibe:show-guide";

export function showGuidePane(): void {
  window.dispatchEvent(new CustomEvent(SHOW_GUIDE_EVENT));
}
