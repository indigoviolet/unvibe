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
 * - promoted links keep a page-link mark on the quote (click opens the
 *   page), including while the moved answer is still filling;
 * - anchor-stale shows the collapsed card fallback in the slot.
 */
import { useEffect, useMemo, useReducer } from "react";
import type { Annotation, Page, ReviewFile } from "@unvibe/shared";
import { api, friendlyError } from "../../api/client.js";
import { clearMarks, placeAnchorSpot, repassUntilSettled, spotFromAnchor, withPreservedSelection } from "../../comments/anchor.js";
import { toast } from "../../floating/Toast.js";
import { slotKey, type LineSlots } from "../../source/diff/lineSlots.js";
import { subscribeHighlight } from "../../source/diff/highlight/shiki.js";
import { useReview } from "../../state/store.js";
import { ExpansionCard } from "./ExpansionCard.js";
import { shouldFloatConversation } from "./cardFloat.js";
import { isAnchorStale } from "./expansionUtils.js";

function makeExpMark(id: string, closed: boolean): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = closed ? "anc exl" : "anc ex";
  mark.dataset.jump = id;
  return mark;
}

/**
 * Index of the hunk containing a new-side `line` (issue #167: floating
 * diff cards render at their hunk, outside the hunk's sideways scroller).
 * Falls back to the old-side range (pure deletions anchor forward), then
 * to the first hunk. Null when the file has no hunks.
 */
export function hunkIndexForLine(file: ReviewFile, line: number): number | null {
  if (file.hunks.length === 0) return null;
  for (let i = 0; i < file.hunks.length; i++) {
    const h = file.hunks[i];
    if (line >= h.newStart && line <= h.newEnd) return i;
  }
  for (let i = 0; i < file.hunks.length; i++) {
    const h = file.hunks[i];
    if (line >= h.oldStart && line <= h.oldEnd) return i;
  }
  return 0;
}

/** Key for a hunk-level floating card list (issue #167). */
export function floatingHunkKey(fileKey: string, hunkIndex: number): string {
  return `${fileKey}:${hunkIndex}`;
}

function makePageLink(pageId: string): HTMLElement {
  const a = document.createElement("a");
  a.className = "cx pg";
  a.dataset.node = pageId;
  (a as HTMLAnchorElement).title = "Opened as its own page";
  return a;
}

export function useDiffExpansionBindings(
  reviewId: string,
  lookupPage: (pageId: string) => Page | undefined,
  onOpenPage: (pageId: string) => void,
  onFollowUp: (cardId: string, blockId: string, index: number) => void,
): {
  lineSlots: LineSlots;
  expandedLines: ReadonlySet<string>;
  /**
   * Issue #167: open floating cards by hunk (`floatingHunkKey`), rendered
   * at the hunk level outside the hunk's sideways scroller (an overlay
   * inside the table would be clipped by `.dwrap`). Pinned cards stay in
   * `lineSlots`, exactly today's inline position under their line.
   */
  floatingByHunk: ReadonlyMap<string, Annotation[]>;
} {
  const annotations = useReview((s) => s.snapshot?.annotations);
  const files = useReview((s) => s.snapshot?.files);
  const pinnedCards = useReview((s) => s.pinnedCards);

  const byLine = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations ?? []) {
      if (a.type !== "conversation" && a.type !== "link") continue;
      if (a.anchor.host.kind !== "diff-line") continue;
      // Promoted links join the map so the anchor keeps its page-link
      // mark (issue #152); they render no slot (the card moved away).
      if (a.type === "link" && !a.promotedToPage) continue;
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
  //
  // Promoted links (issue #152) mark the anchor as a page link at once,
  // including while the moved answer is still filling: the quote keeps
  // its link styling from the promote patch on.
  const [hlTick, bumpHlTick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeHighlight(() => bumpHlTick()), []);
  useEffect(() => {
    // Issue #166: retry boundedly when a row isn't there yet (lazy hunk
    // bodies, highlight upgrades replacing cells).
    const allIds = [...byLine.values()].flat().map((a) => a.id);
    let pending = new Set<string>(allIds);
    let retryCleanup: (() => void) | null = null;
    const runPass = (): void => {
      pending = new Set<string>([...byLine.values()].flat().map((a) => a.id));
      const scope = document.body;
      withPreservedSelection(scope, () => {
        for (const [key, exps] of byLine) {
          const [fileKey, lineStr] = key.split(":");
          const row = document.getElementById(`L-${fileKey}-${lineStr}`);
          if (!row) continue;
          for (const cell of row.querySelectorAll("td.c")) {
            clearMarks(cell, "mark.anc.ex[data-jump], mark.anc.exl[data-jump], a.cx.pg[data-node]");
            for (const a of exps) {
              if (isAnchorStale(a) || !a.anchor.quotedText) continue;
              try {
                // Issue #166: the spot carries the recorded selection
                // offsets, so a repeated phrase places exactly; without
                // offsets the first occurrence wins, as today.
                const spot = spotFromAnchor(a.anchor);
                if (a.type === "link" || a.promotedToPage) {
                  const target = a.promotedToPage ?? "";
                  if (target && placeAnchorSpot(cell, spot, () => makePageLink(target)) > 0) {
                    pending.delete(a.id);
                  }
                  continue;
                }
                if (placeAnchorSpot(cell, spot, () => makeExpMark(a.id, !a.open)) > 0) {
                  pending.delete(a.id);
                }
              } catch {
                // Ignore.
              }
            }
          }
        }
      });
      retryCleanup?.();
      retryCleanup = null;
      if (pending.size > 0) {
        retryCleanup = repassUntilSettled(() => pending.size === 0, runPass);
      }
    };
    const timer = window.setTimeout(runPass, 0);
    return () => {
      window.clearTimeout(timer);
      retryCleanup?.();
    };
  }, [byLine, annotations, hlTick]);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      // Promoted page links inside diff rows navigate to the page.
      const pg = (e.target as Element | null)?.closest?.("#right a.cx.pg[data-node]");
      if (pg) {
        const target = (pg as HTMLElement).dataset.node ?? "";
        if (target) onOpenPage(target);
        return;
      }
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
  }, [reviewId, onOpenPage]);

  const lineSlots = useMemo<LineSlots>(() => {
    const slots: LineSlots = {};
    for (const [key, exps] of byLine) {
      // Issue #167: floating cards leave the slot row for the hunk-level
      // overlay (`floatingByHunk` below); pinned cards stay here, exactly
      // today's inline position under their line.
      const open = exps.filter(
        (a) => a.type === "conversation" && a.open && !shouldFloatConversation(a, pinnedCards[a.id] === true),
      );
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
  }, [byLine, pinnedCards, reviewId, lookupPage, onOpenPage, onFollowUp]);

  const floatingByHunk = useMemo<ReadonlyMap<string, Annotation[]>>(() => {
    const map = new Map<string, Annotation[]>();
    for (const a of annotations ?? []) {
      if (a.type !== "conversation" || !a.open || a.promotedToPage) continue;
      if (a.anchor.host.kind !== "diff-line") continue;
      if (!shouldFloatConversation(a, pinnedCards[a.id] === true)) continue;
      const host = a.anchor.host;
      const file = (files ?? []).find((f) => f.fileKey === host.fileKey);
      if (!file) continue;
      const index = hunkIndexForLine(file, host.line);
      if (index === null) continue;
      const key = floatingHunkKey(file.fileKey, index);
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [annotations, files, pinnedCards]);

  const expandedLines = useMemo<ReadonlySet<string>>(() => new Set(byLine.keys()), [byLine]);

  return { lineSlots, expandedLines, floatingByHunk };
}
