/**
 * Diff expansions (M4 interaction; PRD §4.7).
 *
 * Additive bindings over the diff pane's line-slot registry (reusing the
 * slot APIs like `DiffComments`):
 * - open expansions render under their line (slot row, pinned width);
 * - from the diff, Open as page navigates to the new page (the pane
 *   listener navigates; the slot unmounts with the annotation type flip);
 * - closed expansions highlight their quote in the diff row as a dotted
 *   link; click re-expands;
 * - anchor-stale shows the collapsed card fallback in the slot.
 */
import { useEffect, useMemo, useReducer } from "react";
import type { Annotation, Page } from "@unvibe/shared";
import { api, friendlyError } from "../../api/client.js";
import { clearMarks, markTextInElement, withPreservedSelection } from "../../comments/anchor.js";
import { toast } from "../../floating/Toast.js";
import { slotKey, type LineSlots } from "../../source/diff/lineSlots.js";
import { subscribeHighlight } from "../../source/diff/highlight/shiki.js";
import { useReview } from "../../state/store.js";
import { ExpansionCard } from "./ExpansionCard.js";
import { isAnchorStale } from "./expansionUtils.js";

function makeExpMark(id: string, closed: boolean): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = closed ? "anc exl" : "anc ex";
  mark.dataset.jump = id;
  return mark;
}

export function useDiffExpansionBindings(
  reviewId: string,
  lookupPage: (pageId: string) => Page | undefined,
  onOpenPage: (pageId: string) => void,
  onFollowUp: (cardId: string, blockId: string, index: number) => void,
): { lineSlots: LineSlots; expandedLines: ReadonlySet<string> } {
  const annotations = useReview((s) => s.snapshot?.annotations);

  const byLine = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations ?? []) {
      if (a.type !== "conversation" && a.type !== "link") continue;
      if (a.anchor.host.kind !== "diff-line") continue;
      if (a.type === "link") continue; // promoted: navigates away, no slot
      const key = slotKey(a.anchor.host.fileKey, a.anchor.host.line);
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [annotations]);

  // Highlight quotes inside diff rows (open + closed); anchor-stale skips.
  // Idempotent (issue #15): each cell's own expansion marks are cleared
  // first (per-cell scoping never touches guide/description marks), then
  // re-marked inside one selection-preserving window. `markTextInElement`
  // itself also unwraps same-id marks, so re-renders that wipe DOM marks
  // and re-applied timers both converge on depth 1, and open <-> closed
  // class flips update instead of nesting.
  //
  // Highlighting (issue #23): token rows arrive after first paint and React
  // replaces the cell's text nodes with spans, wiping DOM marks — so this
  // also re-runs on highlight completions (`hlTick`). Quotes spanning
  // several token spans still resolve: `markTextInElement` joins text nodes
  // before locating the quote.
  const [hlTick, bumpHlTick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeHighlight(() => bumpHlTick()), []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const scope = document.body;
      withPreservedSelection(scope, () => {
        for (const [key, exps] of byLine) {
          const [fileKey, lineStr] = key.split(":");
          const row = document.getElementById(`L-${fileKey}-${lineStr}`);
          if (!row) continue;
          for (const cell of row.querySelectorAll("td.c")) {
            clearMarks(cell, "mark.anc.ex[data-jump], mark.anc.exl[data-jump]");
            for (const a of exps) {
              if (isAnchorStale(a) || !a.anchor.quotedText) continue;
              try {
                markTextInElement(cell, a.anchor.quotedText, () => makeExpMark(a.id, !a.open));
              } catch {
                // Ignore.
              }
            }
          }
        }
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [byLine, annotations, hlTick]);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const mark = (e.target as Element | null)?.closest?.("#right mark.anc[data-jump]");
      if (!mark) return;
      const id = (mark as HTMLElement).dataset.jump ?? "";
      const snap = useReview.getState().snapshot;
      const found = snap?.annotations.find((x) => x.id === id);
      if (!found || found.anchor.host.kind !== "diff-line") return;
      if (found.type === "conversation" && !found.open) {
        api.updateComment(reviewId, id, { open: true }).catch((err: unknown) => {
          toast(`Couldn't open the explanation: ${friendlyError(err)}`);
        });
      }
      window.setTimeout(() => {
        document.getElementById(`B-${id}`)?.scrollIntoView({ block: "nearest" });
      }, 120);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [reviewId]);

  const lineSlots = useMemo<LineSlots>(() => {
    const slots: LineSlots = {};
    for (const [key, exps] of byLine) {
      const open = exps.filter((a) => a.type === "conversation" && a.open);
      if (open.length === 0) continue;
      slots[key] = (
        <>
          {open.map((e) => (
            <ExpansionCard
              key={e.id}
              reviewId={reviewId}
              expansion={e}
              lookupPage={lookupPage}
              onOpenPage={onOpenPage}
              onFollowUp={onFollowUp}
            />
          ))}
        </>
      );
    }
    return slots;
  }, [byLine, reviewId, lookupPage, onOpenPage, onFollowUp]);

  const expandedLines = useMemo<ReadonlySet<string>>(() => new Set(byLine.keys()), [byLine]);

  return { lineSlots, expandedLines };
}
