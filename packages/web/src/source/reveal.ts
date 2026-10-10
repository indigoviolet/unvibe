/**
 * `revealSource(ref)` — jump from a guide citation to the source pane.
 *
 * Owner: guide agent (this interface). The diff agent joins the diff side.
 *
 * Contract:
 * - Guide code calls only `revealSource(target)` with a citation target
 *   (`diff:<fileKey>:<lines>[@sha]`, `desc:<para>[@rev]`, `h:…`, `code:…`).
 * - `revealSource` first dispatches `unvibe:reveal-source` (a `CustomEvent`
 *   with `{ ref }` in `detail`). `AppShell` listens and switches the source
 *   pane to the right tab + opens it. The diff pane (diff agent) should
 *   listen for the same event (or register via `onRevealSource`) to
 *   unhide/unfold, clear file filters, scroll and highlight — until then the
 *   DOM fallback below does scroll + highlight on its own.
 * - `onRevealSource` registers an override handler. Handlers run before the
 *   fallback; the first handler returning `true` wins. E2E tests use the
 *   `CustomEvent` to observe calls.
 */

export const REVEAL_EVENT = "unvibe:reveal-source";

export type RevealHandler = (ref: string) => boolean;

const handlers = new Set<RevealHandler>();

/** Register a reveal handler. Returns an unregister function. */
export function onRevealSource(fn: RevealHandler): () => void {
  handlers.add(fn);
  return () => {
    handlers.delete(fn);
  };
}

export function revealSource(ref: string): void {
  window.dispatchEvent(
    new CustomEvent(REVEAL_EVENT, { detail: { ref } }),
  );
  for (const fn of handlers) {
    try {
      if (fn(ref)) return;
    } catch {
      // A failing handler must not break the fallback.
    }
  }
  fallbackReveal(ref);
}

/** Parse the line range half of a `diff:` / `code:` target. */
function parseRange(target: string): { key: string; lines: number[] } | null {
  const m = target.match(/^(?:diff|code):([^:@]+):(\d+(?:-\d+)?)/);
  if (!m) return null;
  const [, key, range] = m;
  const [s, e] = range.split("-").map(Number);
  const lines: number[] = [];
  for (let i = s; i <= (e ?? s); i++) lines.push(i);
  return { key, lines };
}

/**
 * Best-effort fallback: find the already-rendered source element, scroll it
 * into view and flash it. The diff agent's handler replaces this for the
 * diff (unfold/unhide/filter handling); this stays as the last resort.
 */
function fallbackReveal(ref: string): void {
  // Let the tab switch (AppShell's event listener) render first.
  window.setTimeout(() => {
    let els: HTMLElement[] = [];
    if (ref.startsWith("desc:")) {
      const para = ref.slice("desc:".length).split("@")[0];
      const el = document.getElementById(para);
      if (el) els = [el];
    } else {
      const parsed = parseRange(ref);
      if (parsed) {
        els = parsed.lines
          .map((n) => document.getElementById(`L-${parsed.key}-${n}`))
          .filter((el): el is HTMLElement => el !== null);
        if (!els.length) {
          const file = document.getElementById(`F-${parsed.key}`);
          if (file) els = [file];
        }
      }
    }
    if (!els.length) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    els.forEach((el) => el.classList.add("hl"));
    els[0].scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    window.setTimeout(() => els.forEach((el) => el.classList.remove("hl")), 2600);
  }, 60);
}
