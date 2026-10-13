/**
 * Guide threads (comments owner; PRD §4.8).
 *
 * Additive hooks over the guide column (kept small by design so the
 * interaction agent can reuse them for Explain/expansion cards):
 *
 * - `GuideThreadHooks`: mounted once (in `ReviewRoute`, no guide edits).
 *   Highlights every block-anchored thread quote inside `#page`
 *   (`mark.anc[data-thr]`, reusable anchor-highlighting), toggles
 *   threads from mark clicks, outlines anchors while hovering open threads,
 *   and reveals footnote chips (`[data-tfallback]`, issue #72) for quoted
 *   threads whose highlight landed nowhere (the bare bubble marker now
 *   holds only threads that never had a quote, so highlighted ids never
 *   need pruning out of it — and pruning would mean removing
 *   React-rendered nodes behind React's back, issue #101).
 * - `GuideBlockThreads`: rendered per block (one additive line in
 *   `CardView`). Shows open threads under their block plus the pending
 *   composer the selection toolbar requests. Guide threads start closed;
 *   newly created ones are opened so the author sees the working state.
 */
import { useEffect, useState } from "react";
import type { Annotation } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { WorkingPlaceholder } from "../components/WorkingPlaceholder.js";
import { toast } from "../floating/Toast.js";
import { anchorMatchesBlock } from "../guide/guideUtils.js";
import { onOpenBlockThread } from "../guide/annotations.js";
import { inflightForBlock, inflightLabel } from "../guide/inflight.js";
import { useReview } from "../state/store.js";
import { anchorScope, clearMarks, highlightAnchorInRoot, withPreservedSelection } from "./anchor.js";
import { NEW_THREAD_EVENT, type NewThreadRequest } from "../floating/SelectionToolbar.js";
import { NewThreadComposer } from "./NewThreadComposer.js";
import { isReadOnlyVersionNow, useIsReadOnlyVersion } from "./readOnly.js";
import { ThreadView } from "./ThreadView.js";

function makeMark(threadId: string): HTMLElement {
  const mark = document.createElement("mark");
  mark.className = "anc";
  mark.dataset.thr = threadId;
  return mark;
}

export function GuideThreadHooks() {
  const annotations = useReview((s) => s.snapshot?.annotations);
  const pages = useReview((s) => s.snapshot?.pages);

  // Open-thread registration for the guide's comment markers.
  useEffect(
    () =>
      onOpenBlockThread((threadId) => {
        const reviewId = useReview.getState().snapshot?.review.id;
        if (!reviewId) return;
        if (isReadOnlyVersionNow()) {
          toast("Viewing an older version · read-only");
          return;
        }
        api.updateComment(reviewId, threadId, { open: true }).catch((err: unknown) => {
          toast(`Couldn't open the comment: ${friendlyError(err)}`);
        });
        window.setTimeout(() => {
          document.getElementById(threadId)?.scrollIntoView({ block: "nearest" });
        }, 60);
      }),
    [],
  );

  // Anchor highlights. Re-runs when threads or guide content change
  // (depth rewrites re-render blocks and drop DOM marks).
  // Idempotent (issue #15): our own thread marks are cleared first so N
  // store patches leave depth 1, inside one selection-preserving window.
  // Expansion marks (`mark.anc.ex/exl`, `a.cx.pg`) belong to
  // ExpansionHighlights and are never touched (narrow selector).
  // Markers are never pruned here: the bubble lists only unquoted threads
  // (see `BlockMarkers`), so highlighted ids cannot occur in it — and
  // removing React-rendered marker nodes imperatively is exactly the
  // `removeChild` crash of issue #101.
  useEffect(() => {
    const page = document.getElementById("page");
    if (!page) return;
    const threads = (annotations ?? []).filter(
      (a): a is Annotation => a.type === "thread" && a.anchor.host.kind === "block" && !!a.anchor.quotedText,
    );
    const highlighted = new Set<string>();
    // One frame: let the guide's own render commit first.
    const timer = window.setTimeout(() => {
      withPreservedSelection(page, () => {
        // Footnote chips (issue #72) are marks too but live in `.lo`;
        // keep them (toggled via [data-tfallback] below).
        clearMarks(page, "mark.anc[data-thr]:not(.fnote)");
        for (const thread of threads) {
          const host = thread.anchor.host;
          if (host.kind !== "block") continue;
          // Anchor ids may be `card#block` (service) or bare (prototype).
          const hash = host.blockId.indexOf("#");
          const bare = hash >= 0 ? host.blockId.slice(hash + 1) : host.blockId;
          const candidates = [host.blockId, bare];
          let done = false;
          for (const top of candidates) {
            if (highlightAnchorInRoot(anchorScope(page, host.blockId), top, thread.anchor.quotedText, () => makeMark(thread.id))) {
              done = true;
              break;
            }
          }
          if (done) highlighted.add(thread.id);
        }
        // Footnote chips (issue #72): quoted threads whose highlight landed
        // nowhere show their chip; highlighted ones hide it again (level
        // switch / undo). Mirrors ExpansionHighlights' [data-fallback]
        // toggle, on a separate attribute so the two passes never clash.
        for (const el of page.querySelectorAll("[data-tfallback]")) {
          const id = (el as HTMLElement).dataset.tfallback ?? "";
          if (!id) continue;
          if (highlighted.has(id)) (el as HTMLElement).hidden = true;
          else (el as HTMLElement).hidden = false;
        }
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [annotations, pages]);

  // Mark clicks toggle; hovering outlines anchors <-> threads.
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const mark = (e.target as Element | null)?.closest?.("mark.anc[data-thr]");
      if (!mark) {
        // Suggested-comment links jump to the thread and open it.
        const jump = (e.target as Element | null)?.closest?.("[data-cjump]");
        if (jump) {
          const id = (jump as HTMLElement).dataset.cjump ?? "";
          const snap = useReview.getState().snapshot;
          const reviewId = snap?.review.id;
          const thread = snap?.annotations.find((a) => a.id === id);
          if (!reviewId || !thread || thread.type !== "thread" || isReadOnlyVersionNow()) return;
          if (!thread.open) {
            api.updateComment(reviewId, id, { open: true }).catch(() => {});
          }
        }
        return;
      }
      const id = (mark as HTMLElement).dataset.thr ?? "";
      const snap = useReview.getState().snapshot;
      const reviewId = snap?.review.id;
      const thread = snap?.annotations.find((a) => a.id === id);
      if (!reviewId || !thread || thread.type !== "thread") return;
      if (isReadOnlyVersionNow()) {
        toast("Viewing an older version · read-only");
        return;
      }
      api.updateComment(reviewId, id, { open: !thread.open }).catch((err: unknown) => {
        toast(`Couldn't open the comment: ${friendlyError(err)}`);
      });
      if (!thread.open) {
        window.setTimeout(() => {
          document.getElementById(id)?.scrollIntoView({ block: "nearest" });
        }, 120);
      }
    };
    const onMouseOver = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      // Clear only the outlines this handler adds (marks + open threads).
      // A bare `#page .on` would also strip the depth stepper pips
      // (`.pips i.on`, issue #111), which React owns.
      document.querySelectorAll("#page mark.on, #page .ithread.on").forEach((x) => x.classList.remove("on"));
      const mark = target.closest("mark[data-thr]");
      if (mark) {
        const id = (mark as HTMLElement).dataset.thr ?? "";
        mark.classList.add("on");
        document.getElementById(id)?.classList.add("on");
        return;
      }
      const open = target.closest("#page .ithread");
      if (open?.id) {
        open.classList.add("on");
        document.querySelectorAll(`mark[data-thr="${CSS.escape(open.id)}"]`).forEach((x) => x.classList.add("on"));
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

interface BlockProps {
  reviewId: string;
  cardId: string;
  blockId: string;
}

export function GuideBlockThreads({ reviewId, cardId, blockId }: BlockProps) {
  const annotations = useReview((s) => s.snapshot?.annotations);
  const inflight = useReview((s) => s.inflight);
  const readOnly = useIsReadOnlyVersion();
  const [pending, setPending] = useState<NewThreadRequest | null>(null);

  useEffect(() => {
    const onRequest = (e: Event): void => {
      const req = (e as CustomEvent<NewThreadRequest>).detail;
      if (req.anchor.where !== "block") return;
      if (!anchorMatchesBlock(req.anchor.blockId, cardId, blockId)) return;
      if (isReadOnlyVersionNow()) return;
      setPending(req);
    };
    window.addEventListener(NEW_THREAD_EVENT, onRequest);
    return () => window.removeEventListener(NEW_THREAD_EVENT, onRequest);
  }, [cardId, blockId]);

  const threads = (annotations ?? []).filter(
    (a): a is Annotation =>
      a.type === "thread" &&
      a.anchor.host.kind === "block" &&
      anchorMatchesBlock(a.anchor.host.blockId, cardId, blockId) &&
      a.open,
  );

  // An explain started from a selection on this block shows a
  // placeholder where the expansion will land (issue #46). Ask turns keep
  // their composer as the placeholder, so they are skipped here.
  const incoming = !readOnly ? inflightForBlock(inflight, cardId, blockId) : undefined;
  const placeholder = incoming?.kind === "explain" ? incoming : undefined;

  if (!pending && threads.length === 0 && !placeholder) return null;
  return (
    <>
      {threads.map((t) => (
        <ThreadView key={t.id} reviewId={reviewId} thread={t} readOnly={readOnly} />
      ))}
      {placeholder ? <WorkingPlaceholder label={inflightLabel(placeholder.kind)} /> : null}
      {pending && !readOnly ? (
        <NewThreadComposer
              key="pending"
          reviewId={reviewId}
          anchor={pending.anchor}
          quote={pending.quote}
          note={pending.note}
          onDiscard={() => setPending(null)}
          onCreated={(id) => {
            setPending(null);
            // New guide threads start closed on the service; open the one
            // just created so the author sees the working state.
            api.updateComment(reviewId, id, { open: true }).catch(() => {});
            window.setTimeout(() => {
              document.getElementById(id)?.scrollIntoView({ block: "nearest" });
            }, 120);
          }}
        />
      ) : null}
    </>
  );
}
