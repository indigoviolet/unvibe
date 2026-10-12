/**
 * Expansion anchor highlights (M4 interaction; PRD §4.7, issue #72).
 *
 * Mirrors `GuideThreads` anchor-highlighting for expansions:
 * - open expansions highlight their quote (`mark.anc.ex[data-jump]`);
 * - closed expansions become dotted links (`mark.anc.exl[data-jump]`);
 * - promoted links become page links (`a.cx.pg[data-node]`);
 * - anchor-stale expansions skip highlighting (their footnote chip shows);
 * - clicking a mark scrolls to the card (closed ones expand first);
 * - hovering outlines anchors <-> cards.
 *
 * Closed expansions / links whose quote is gone fall back to a footnote
 * chip (`[data-fallback]`, hidden) on the paragraph's citations line;
 * the pass reveals it when the highlight lands nowhere and hides it again
 * when the phrase returns. Thread chips (`[data-tfallback]`) belong to
 * `GuideThreads` and are never touched here.
 */
import { useEffect } from "react";
import { api, friendlyError } from "../../api/client.js";
import { toast } from "../../floating/Toast.js";
import { anchorMatchesBlock } from "../guideUtils.js";
import { useReview } from "../../state/store.js";
import { highlightAnchorInRoot, withPreservedSelection, clearMarks } from "../../comments/anchor.js";
import { isAnchorStale } from "./expansionUtils.js";

function makeExpMark(id: string, closed: boolean): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = closed ? "anc exl" : "anc ex";
  mark.dataset.jump = id;
  return mark;
}

function makePageLink(pageId: string): HTMLElement {
  const a = document.createElement("a");
  a.className = "cx pg";
  a.dataset.node = pageId;
  (a as HTMLAnchorElement).title = "Opened as its own page";
  return a;
}

export function ExpansionHighlights() {
  const annotations = useReview((s) => s.snapshot?.annotations);
  const pages = useReview((s) => s.snapshot?.pages);

  useEffect(() => {
    const root = document.getElementById("page");
    if (!root) return;
    const timer = window.setTimeout(() => {
      // Idempotent re-mark (issue #15): drop our own stale marks first
      // (deleted / anchor-stale / quote-gone annotations are skipped below
      // and would otherwise leave ghosts), then re-mark everything inside
      // one selection-preserving window. Thread marks (`mark[data-thr]`)
      // belong to GuideThreads and are never touched (narrow selectors).
      withPreservedSelection(root, () => {
        // Footnote chips (issue #72) share the same marks/links shapes but
        // live in `.lo` and must survive: exclude `.fnote` here (highlights
        // only; chips are toggled via [data-fallback] below).
        clearMarks(
          root,
          "mark.anc.ex[data-jump]:not(.fnote), mark.anc.exl[data-jump]:not(.fnote), a.cx.pg[data-node]:not(.fnote)",
        );
        const highlighted = new Set<string>();
        for (const a of annotations ?? []) {
          if (a.type !== "expansion" && a.type !== "link") continue;
          if (isAnchorStale(a)) continue;
          if (!a.anchor.quotedText) continue;
          if (a.anchor.host.kind !== "block") continue;
          const pageId = a.promotedToPage ?? (a.type === "link" ? a.promotedToPage : undefined);
          if (a.type === "link" || pageId) {
            const target = pageId ?? "";
            if (!target) continue;
            const { cardId, block } = splitBlock(a.anchor.host.blockId);
            const tops = cardId ? [`${cardId}#${block}`, block, a.anchor.host.blockId] : [block, a.anchor.host.blockId];
            for (const top of tops) {
              if (highlightAnchorInRoot(root, top, a.anchor.quotedText, () => makePageLink(target))) {
                highlighted.add(a.id);
                break;
              }
            }
            continue;
          }
          const closed = !a.open;
          const { cardId, block } = splitBlock(a.anchor.host.blockId);
          // Match the same block-matching rule as the card list so marks land
          // on the host the card renders under.
          void cardId;
          const tops = [a.anchor.host.blockId, block];
          for (const top of tops) {
            if (highlightAnchorInRoot(root, top, a.anchor.quotedText, () => makeExpMark(a.id, closed))) {
              highlighted.add(a.id);
              break;
            }
          }
        }
        // Closed expansions whose quote is gone: reveal the fallback stub.
        for (const el of root.querySelectorAll("[data-fallback]")) {
          const id = (el as HTMLElement).dataset.fallback ?? "";
          if (id && !highlighted.has(id)) (el as HTMLElement).hidden = false;
          else if (id && highlighted.has(id)) (el as HTMLElement).hidden = true;
        }
        // Open expansions always have their card in place; their fallback
        // stays hidden.
        void pages;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [annotations, pages]);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const mark = (e.target as Element | null)?.closest?.("mark.anc[data-jump]");
      if (!mark) return;
      const id = (mark as HTMLElement).dataset.jump ?? "";
      const snap = useReview.getState().snapshot;
      const reviewId = snap?.review.id;
      const found = snap?.annotations.find((x) => x.id === id);
      if (!reviewId || !found) return;
      if (found.type === "expansion" && !found.open) {
        api.updateComment(reviewId, id, { open: true }).catch((err: unknown) => {
          toast(`Couldn't expand: ${friendlyError(err)}`);
        });
      }
      window.setTimeout(() => {
        document.getElementById(`B-${id}`)?.scrollIntoView({ block: "nearest" });
      }, 120);
    };
    const onMouseOver = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      const mark = target.closest("mark[data-jump]");
      document.querySelectorAll("#page .on").forEach((x) => x.classList.remove("on"));
      if (mark) {
        const id = (mark as HTMLElement).dataset.jump ?? "";
        mark.classList.add("on");
        document.getElementById(`B-${id}`)?.classList.add("on");
        return;
      }
      const card = target.closest("#page .card.child");
      if (card?.id) {
        card.classList.add("on");
        const id = card.id.replace(/^B-/, "");
        document.querySelectorAll(`mark[data-jump="${CSS.escape(id)}"]`).forEach((x) => x.classList.add("on"));
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("mouseover", onMouseOver);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("mouseover", onMouseOver);
    };
  }, []);

  return null;
}

function splitBlock(blockId: string): { cardId: string | null; block: string } {
  const hash = blockId.indexOf("#");
  if (hash < 0) return { cardId: null, block: blockId };
  return { cardId: blockId.slice(0, hash), block: blockId.slice(hash + 1) };
}

/** Expansions anchored on a card + block (open ones render in place). */
export function expansionsForBlock(
  annotations: import("@unvibe/shared").Annotation[] | undefined,
  cardId: string,
  blockId: string,
): import("@unvibe/shared").Annotation[] {
  if (!annotations) return [];
  return annotations.filter(
    (a) =>
      (a.type === "expansion" || a.type === "link") &&
      a.anchor.host.kind === "block" &&
      anchorMatchesBlock(a.anchor.host.blockId, cardId, blockId),
  );
}
