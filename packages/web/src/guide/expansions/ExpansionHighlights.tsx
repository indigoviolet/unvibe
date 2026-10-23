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
 *
 * The pass re-runs on the route as well as the snapshot (issue #152):
 * the guide page remounts with clean DOM on navigation while this
 * component stays mounted, so without the route trigger a mark drawn
 * before leaving would never come back.
 */
import { useEffect, useReducer } from "react";
import { useLocation } from "react-router";
import { subscribeHighlight } from "../../source/diff/highlight/shiki.js";
import { api, friendlyError } from "../../api/client.js";
import { toast } from "../../floating/Toast.js";
import { anchorMatchesBlock } from "../guideUtils.js";
import { useReview } from "../../state/store.js";
import { anchorHostExists, anchorScope, highlightAnchorInRoot, placeAnchorSpot, probeAnchorInRoot, retryUntilSettled, withPreservedSelection, clearMarks, spotFromAnchor } from "../../comments/anchor.js";
import { hostLabel, recordUnplacedAnchors } from "../unplacedAnchors.js";
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
  const pathname = useLocation().pathname;

  // Code-block highlighting (issue #255) swaps text nodes post-paint, as
  // diff rows do — re-run the pass when it lands.
  const [hlTick, bumpHlTick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeHighlight(() => bumpHlTick()), []);

  useEffect(() => {
    const root = document.getElementById("page");
    if (!root) return;
    // Issue #166: anchors whose host text isn't there yet are retried —
    // bounded overall per effect run (#206), never re-armed per pass.
    const placeable = (annotations ?? []).filter(
      (a) =>
        (a.type === "conversation" || a.type === "link") &&
        !isAnchorStale(a) &&
        !!a.anchor.quotedText &&
        a.anchor.host.kind === "block",
    );
    let pending = new Set<string>(placeable.map((a) => a.id));

    // Where each anchor would land, probed without touching the DOM
    // (#206): a pass whose result is already on the page leaves the DOM
    // alone, so placed marks never blink.
    const desiredOf = (a: (typeof placeable)[number]): { placed: boolean; sig: string | null; hostMissing: boolean } => {
      if (a.anchor.host.kind !== "block") return { placed: false, sig: null, hostMissing: true };
      const scope = anchorScope(root, a.anchor.host.blockId);
      const spot = spotFromAnchor(a.anchor);
      const pageId = a.promotedToPage ?? (a.type === "link" ? a.promotedToPage : undefined);
      const { cardId, block } = splitBlock(a.anchor.host.blockId);
      const tops =
        a.type === "link" || pageId
          ? cardId
            ? [`${cardId}#${block}`, block, a.anchor.host.blockId]
            : [block, a.anchor.host.blockId]
          : [a.anchor.host.blockId, block];
      const hostMissing = !tops.some((top) => anchorHostExists(scope, top));
      const placed = tops.some((top) => probeAnchorInRoot(scope, top, spot));
      if (a.type === "link" || pageId) return { placed, sig: placed ? `pg:${pageId ?? ""}` : null, hostMissing };
      return { placed, sig: placed ? (!a.open ? "exl" : "ex") : null, hostMissing };
    };

    const recordGaveUp = (): void => {
      recordUnplacedAnchors(
        "Guide expansions",
        placeable
          .filter((a) => pending.has(a.id))
          .map((a) => ({
            id: a.id,
            kind: a.type,
            host: hostLabel(a.anchor),
            reason: desiredOf(a).hostMissing ? ("host-missing" as const) : ("quote-not-found" as const),
          })),
      );
    };
    const retry = retryUntilSettled({
      isSettled: () => pending.size === 0,
      repass: () => runPass(),
      attempts: 3,
      delayMs: 250,
      onGiveUp: recordGaveUp,
    });

    const runPass = (): void => {
      pending = new Set<string>(placeable.map((a) => a.id));
      // #206: skip the DOM surgery entirely when the marks and chips
      // already match what this pass would produce.
      const desired = new Map(placeable.map((a) => [a.id, desiredOf(a)]));
      const current = new Map<string, string>();
      for (const el of root.querySelectorAll(
        "mark.anc.ex[data-jump]:not(.fnote), mark.anc.exl[data-jump]:not(.fnote)",
      )) {
        const id = (el as HTMLElement).dataset.jump ?? "";
        if (id) current.set(id, el.classList.contains("exl") ? "exl" : "ex");
      }
      for (const el of root.querySelectorAll("a.cx.pg[data-node]:not(.fnote)")) {
        const node = (el as HTMLElement).dataset.node ?? "";
        if (node) current.set(`pg:${node}`, `pg:${node}`);
      }
      // Normalised desired marks: annotation id -> mark kind, or
      // `pg:<page>` -> itself for promoted page links.
      const desiredMarks = new Map<string, string>();
      for (const a of placeable) {
        const d = desired.get(a.id)!;
        if (!d.placed || d.sig === null) continue;
        if (a.type === "link" || a.promotedToPage) desiredMarks.set(d.sig, d.sig);
        else desiredMarks.set(a.id, d.sig);
        pending.delete(a.id);
      }
      // Issue #214: comment-hosted cards mark inside their comment.
      for (const a of annotations ?? []) {
        if (a.type !== "conversation" && a.type !== "link") continue;
        if (a.anchor.host.kind !== "comment" || isAnchorStale(a) || !a.anchor.quotedText) continue;
        const msgs = root.querySelectorAll(`[data-comment="${CSS.escape(a.anchor.host.commentId)}"]`);
        let placed = false;
        for (const msg of msgs) {
          // Probe without DOM writes (probeAnchorSpot is imported for this).
          const nodes: string[] = [];
          const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push((n as Text).data);
          if (nodes.join("").includes(a.anchor.quotedText)) placed = true;
          if (placed) break;
        }
        if (!placed) continue;
        if (a.type === "link" || a.promotedToPage) {
          if (a.promotedToPage) desiredMarks.set(`pg:${a.promotedToPage}`, `pg:${a.promotedToPage}`);
        } else {
          desiredMarks.set(a.id, a.open ? "ex" : "exl");
        }
      }
      let same =
        desiredMarks.size === current.size &&
        [...desiredMarks].every(([k, v]) => current.get(k) === v);
      if (same) {
        for (const el of root.querySelectorAll("[data-fallback]")) {
          const id = (el as HTMLElement).dataset.fallback ?? "";
          if (!id) continue;
          // A chip shows exactly when its anchor did not land.
          const wantHidden = desired.has(id) ? desired.get(id)!.placed : false;
          if ((el as HTMLElement).hidden !== wantHidden) {
            same = false;
            break;
          }
        }
      }
      if (same) {
        if (pending.size === 0) recordUnplacedAnchors("Guide expansions", []);
        else retry.schedule();
        return;
      }
      pending = new Set<string>(placeable.map((a) => a.id));
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
        for (const a of placeable) {
          if (a.anchor.host.kind !== "block") continue;
          const pageId = a.promotedToPage ?? (a.type === "link" ? a.promotedToPage : undefined);
          if (a.type === "link" || pageId) {
            const target = pageId ?? "";
            if (!target) continue;
            const { cardId, block } = splitBlock(a.anchor.host.blockId);
            const tops = cardId ? [`${cardId}#${block}`, block, a.anchor.host.blockId] : [block, a.anchor.host.blockId];
            for (const top of tops) {
              if (highlightAnchorInRoot(anchorScope(root, a.anchor.host.blockId), top, spotFromAnchor(a.anchor), () => makePageLink(target))) {
                highlighted.add(a.id);
                pending.delete(a.id);
                break;
              }
            }
            continue;
          }
          const closed = !a.open;
          const { block } = splitBlock(a.anchor.host.blockId);
          const tops = [a.anchor.host.blockId, block];
          for (const top of tops) {
            if (highlightAnchorInRoot(anchorScope(root, a.anchor.host.blockId), top, spotFromAnchor(a.anchor), () => makeExpMark(a.id, closed))) {
              highlighted.add(a.id);
              pending.delete(a.id);
              break;
            }
          }
        }
        // Issue #214: cards on a comment mark their quote inside the
        // comment itself (their cards render under the comment's block).
        for (const a of annotations ?? []) {
          if (a.type !== "conversation" && a.type !== "link") continue;
          if (a.anchor.host.kind !== "comment" || isAnchorStale(a) || !a.anchor.quotedText) continue;
          const msgs = root.querySelectorAll(`[data-comment="${CSS.escape(a.anchor.host.commentId)}"]`);
          for (const msg of msgs) {
            const placed =
              a.type === "link" || a.promotedToPage
                ? a.promotedToPage
                  ? placeAnchorSpot(msg, spotFromAnchor(a.anchor), () => makePageLink(a.promotedToPage!)) > 0
                  : false
                : placeAnchorSpot(msg, spotFromAnchor(a.anchor), () => makeExpMark(a.id, !a.open)) > 0;
            if (placed) break;
          }
        }
        // Closed expansions whose quote is gone: reveal the fallback stub.
        for (const el of root.querySelectorAll("[data-fallback]")) {
          const id = (el as HTMLElement).dataset.fallback ?? "";
          if (id && !highlighted.has(id)) (el as HTMLElement).hidden = false;
          else if (id && highlighted.has(id)) (el as HTMLElement).hidden = true;
        }
        void pages;
      });
      if (pending.size === 0) recordUnplacedAnchors("Guide expansions", []);
      else retry.schedule();
    };
    const timer = window.setTimeout(runPass, 0);
    return () => {
      window.clearTimeout(timer);
      retry.cancel();
    };
  }, [annotations, pages, pathname, hlTick]);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const mark = (e.target as Element | null)?.closest?.("mark.anc[data-jump]");
      if (!mark) return;
      const id = (mark as HTMLElement).dataset.jump ?? "";
      const snap = useReview.getState().snapshot;
      const reviewId = snap?.review.id;
      const found = snap?.annotations.find((x) => x.id === id);
      if (!reviewId || !found) return;
      if (found.type === "conversation" && !found.open) {
        api.updateComment(reviewId, id, { open: true, pinned: true }).catch((err: unknown) => {
          toast(`Couldn't open the explanation: ${friendlyError(err)}`);
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
      // Clear only the outlines this handler adds (marks + expansion
      // cards). A bare `#page .on` would also strip the depth stepper
      // pips (`.pips i.on`, issue #111), which React owns.
      document.querySelectorAll("#page mark.on, #page .ui-card.child.on").forEach((x) => x.classList.remove("on"));
      if (mark) {
        const id = (mark as HTMLElement).dataset.jump ?? "";
        mark.classList.add("on");
        document.getElementById(`B-${id}`)?.classList.add("on");
        return;
      }
      const card = target.closest("#page .ui-card.child");
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

/** Conversation cards anchored on a card + block (open ones render in place). */
export function expansionsForBlock(
  annotations: import("@unvibe/shared").Annotation[] | undefined,
  cardId: string,
  blockId: string,
): import("@unvibe/shared").Annotation[] {
  if (!annotations) return [];
  return annotations.filter((a) => {
    if (a.type !== "conversation" && a.type !== "link") return false;
    if (a.anchor.host.kind === "block") return anchorMatchesBlock(a.anchor.host.blockId, cardId, blockId);
    // Issue #214: a card on a comment renders under that comment's block.
    if (a.anchor.host.kind === "comment") {
      const commentId = a.anchor.host.commentId;
      const comment = annotations.find((x) => x.id === commentId && x.type === "comment");
      return (
        comment?.anchor.host.kind === "block" && anchorMatchesBlock(comment.anchor.host.blockId, cardId, blockId)
      );
    }
    return false;
  });
}
