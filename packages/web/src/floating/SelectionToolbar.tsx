/**
 * Text-selection toolbar (comments owner; PRD §4.6).
 *
 * Ported from `prototype.html` (behaviour + `#selbar` styles, not code):
 * - works in the guide, the PR description and diff code;
 * - the selection snaps to whole words with leading/trailing spaces
 *   trimmed, and the highlight updates to match;
 * - offers Explain, Ask… and Note;
 * - appears only when the user finishes selecting text, never after
 *   clicking a control;
 * - dismisses on scroll, outside press, Escape, blur, resize and selection
 *   collapse — the same rules as the other floating UI.
 *
 * Explain calls the `explain` action (accepted by the service; the
 * expansion card itself renders in a later milestone — never a break).
 * Ask… / Note open a pending thread
 * composer at the anchor via the `unvibe:new-thread` event; the host
 * (guide block, description paragraph, diff line) renders it. Selection in
 * a pure-deletion diff row anchors to the nearest row with a new-side
 * line, as the prototype does.
 *
 * The host-resolution + line-id helpers are re-exported for the
 * interaction agent's Explain/expansion cards (`resolveSelectionHost`).
 */
import { useEffect, useRef, useState } from "react";
import type { ActionAnchor } from "@unvibe/shared";
import { apiErrorCode, friendlyError } from "../api/client.js";
import { isReadOnlyVersionNow, useIsReadOnlyVersion } from "../comments/readOnly.js";
import { parseLineElementId, snapWordOffsets, normalizeQuote, validSelectionQuote } from "../comments/selection.js";
import { performAction } from "../guide/actions.js";
import { NO_AGENT_COPY } from "../guide/expansions/expansionUtils.js";
import { toast } from "./Toast.js";
import { useReview } from "../state/store.js";

export const NEW_THREAD_EVENT = "unvibe:new-thread";

export interface NewThreadRequest {
  anchor: ActionAnchor;
  quote: string;
  /** True = Note (no agent reply); false = Ask. */
  note: boolean;
}

/** Ask a host to open a pending thread composer for this selection. */
export function requestNewThread(req: NewThreadRequest): void {
  window.dispatchEvent(new CustomEvent<NewThreadRequest>(NEW_THREAD_EVENT, { detail: req }));
}

export interface SelectionHost {
  anchor: ActionAnchor;
  /**
   * True when the selection sits in revealed context around a hunk
   * (issue #133): Explain and Ask are offered, anchored on the diff
   * line, but Note is not — a note there could never land on the diff's
   * own lines.
   */
  revealed: boolean;
}

function elementOf(node: Node | null): HTMLElement | null {
  if (!node) return null;
  if (node.nodeType === 1) return node as HTMLElement;
  return (node.parentElement as HTMLElement | null) ?? null;
}

/**
 * Resolve a selection anchor element to an `ActionAnchor`. Exported for
 * reuse (Explain cards resolve the same hosts).
 */
export function resolveSelectionHost(el: HTMLElement): SelectionHost | null {
  // Second-opinion reasoning is attached content, not a host (#116): its
  // blocks live on the result, not on any card or expansion, so the
  // service has no block to anchor to. No toolbar there.
  if (el.closest("[data-so]")) return null;
  const top = el.closest("#page [data-top], #right [data-top]");
  if (top) {
    const id = (top as HTMLElement).dataset.top ?? "";
    if (!id) return null;
    // Inside the description pane a `data-top` (or any `id`) addresses a
    // paragraph; in the guide it addresses a block.
    if (top.closest("#right .desc")) {
      const paragraphId = (top as HTMLElement).dataset.top ?? top.id ?? id;
      return { anchor: { where: "description", paragraphId }, revealed: false };
    }
    // Block ids repeat across cards (`b1`, `b2`, … in each): qualify with
    // the owning card, or expansion, so the anchor addresses one block.
    const owner = top.closest("section.card[id]")?.id ?? "";
    const cardId = /^[CB]-/.test(owner) ? owner.slice(2) : "";
    return { anchor: { where: "block", blockId: cardId && !id.includes("#") ? `${cardId}#${id}` : id }, revealed: false };
  }
  // Description paragraphs carry stable `id`s but no `data-top` in live
  // snapshots: fall back to the nearest id under `.desc`.
  const descNode = el.closest("#right .desc [id]");
  if (descNode && el.closest("#right .desc")) {
    return { anchor: { where: "description", paragraphId: (descNode as HTMLElement).id }, revealed: false };
  }
  const td = el.closest("#right table.diff td.c");
  if (!td) return null;
  // Revealed context rows (issue #133) carry `data-revealed` on the row:
  // the anchor stays a diff line, but Note is not offered there.
  const revealed = (td.closest("tr") as HTMLElement | null)?.dataset?.revealed === "1";
  // Rows without a new-side line number (pure deletions) anchor to the
  // nearest numbered row: forward first, then backward (prototype rule).
  const tr = td.closest("tr");
  let row: Element | null | undefined = tr;
  while (row && !(row.id?.startsWith("L-"))) row = row.nextElementSibling;
  if (!row) {
    row = tr;
    while (row && !(row.id?.startsWith("L-"))) row = row.previousElementSibling;
  }
  if (!row?.id) return null;
  const parsed = parseLineElementId(row.id);
  if (!parsed) return null;
  return { anchor: { where: "diff-line", fileKey: parsed.fileKey, line: parsed.line }, revealed };
}

/** Snap the live selection to whole words (single-range fast path). */
function snapLiveSelection(sel: Selection): void {
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = range;
  // Multi-node ranges: only adjust when an end sits in a text node.
  try {
    if (sc === ec && sc.nodeType === 3) {
      const text = (sc as Text).data;
      const [nso, neo] = snapWordOffsets(text, so, eo);
      if (nso === so && neo === eo) return;
      range.setStart(sc, nso);
      range.setEnd(ec, neo);
      if (range.collapsed) return;
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    const clone = range.cloneRange();
    if (sc.nodeType === 3) {
      const text = (sc as Text).data;
      const [nso] = snapWordOffsets(text, so, text.length);
      clone.setStart(sc, nso);
    }
    if (ec.nodeType === 3) {
      const text = (ec as Text).data;
      const [, neo] = snapWordOffsets(text, 0, eo);
      clone.setEnd(ec, neo);
    }
    if (clone.collapsed) return;
    sel.removeAllRanges();
    sel.addRange(clone);
  } catch {
    // A range that refuses to snap keeps its original highlight.
  }
}

interface Pending {
  quote: string;
  anchor: ActionAnchor;
  revealed: boolean;
}

export function SelectionToolbar() {
  const [pending, setPending] = useState<Pending | null>(null);
  const readOnly = useIsReadOnlyVersion();
  const barRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    const bar = (): HTMLElement | null => barRef.current;
    const hide = (): void => setPending(null);

    const onMouseUp = (e: MouseEvent): void => {
      if ((e.target as Element | null)?.closest?.("#selbar")) return;
      const scope = (e.target as Element | null)?.closest?.(
        "#page, #right .desc:not(.editing), #right table.diff",
      );
      if (
        !scope ||
        (e.target as Element | null)?.closest?.("button, a, input, textarea") ||
        isReadOnlyVersionNow()
      ) {
        hide();
        return;
      }
      window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          hide();
          return;
        }
        snapLiveSelection(sel);
        const quote = normalizeQuote(sel.toString());
        const anchorNode = sel.anchorNode;
        const host = resolveSelectionHost(elementOf(anchorNode) ?? document.body);
        if (!quote || !validSelectionQuote(quote) || !host) {
          hide();
          return;
        }
        setPending({ quote, anchor: host.anchor, revealed: host.revealed });
        // Position after render (needs the bar's size).
        window.setTimeout(() => {
          const b = bar();
          if (!b || sel.rangeCount === 0) return;
          const r = sel.getRangeAt(0).getBoundingClientRect();
          b.style.left = `${Math.max(8, Math.min(window.innerWidth - b.offsetWidth - 8, r.left + r.width / 2 - b.offsetWidth / 2))}px`;
          const preferBelow = r.top - b.offsetHeight - 8 < 56;
          const rawTop = preferBelow ? r.bottom + 8 : r.top - b.offsetHeight - 8;
          b.style.top = `${Math.max(8, Math.min(window.innerHeight - b.offsetHeight - 8, rawTop))}px`;
        }, 0);
      }, 0);
    };

    const onSelectionChange = (): void => {
      if (window.getSelection()?.isCollapsed) hide();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") hide();
    };
    const onScroll = (): void => hide();
    const onPointerDown = (e: PointerEvent): void => {
      if (!(e.target as Element | null)?.closest?.("#selbar")) hide();
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("wheel", onScroll, { capture: true, passive: true });
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("wheel", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);

  const dismiss = (): void => {
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const onExplain = (): void => {
    const current = pendingRef.current;
    if (!current) return;
    const reviewId = useReview.getState().snapshot?.review.id;
    dismiss();
    if (!reviewId) {
      toast("The review is still loading");
      return;
    }
    // The in-flight entry (keyed by anchor) is set synchronously, so a
    // placeholder shows where the explanation will land before the
    // request returns.
    performAction(
      reviewId,
      { kind: "explain", quote: current.quote, anchor: current.anchor },
      { toast: false },
    )
      .then((res) => {
        if (!res.accepted) toast("Not available with mock data");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (apiErrorCode(err) === "no-agent" || /no agent configured/i.test(msg)) {
          toast(NO_AGENT_COPY);
        } else {
          toast(`Couldn't explain: ${friendlyError(err)}`);
        }
      });
  };

  const onAskNote = (note: boolean): void => {
    const current = pendingRef.current;
    if (!current) return;
    dismiss();
    requestNewThread({ anchor: current.anchor, quote: current.quote, note });
  };

  return (
    <div id="selbar" ref={barRef} hidden={pending === null || readOnly}>
      <button type="button" data-act="explain" onClick={onExplain}>
        Explain
      </button>
      <span className="sep" />
      <button type="button" data-act="ask" onClick={() => onAskNote(false)}>
        Ask…
      </button>
      {pending?.revealed ? null : (
        <button type="button" data-act="note" onClick={() => onAskNote(true)}>
          Note
        </button>
      )}
    </div>
  );
}
