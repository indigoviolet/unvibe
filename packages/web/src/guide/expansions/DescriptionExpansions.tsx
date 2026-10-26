/**
 * Description expansions (M4 interaction; PRD §4.7).
 *
 * - Open expansions render under their paragraph (in `.dann`, like threads).
 * - Closed expansions highlight their quote as a dotted link
 *   (`mark.anc.exl[data-jump]`); click re-expands via the comments PATCH
 *   path (service M4 fix allows `open` on expansions).
 * - Anchor-stale expansions skip highlighting (collapsed card fallback).
 * - Promoted links highlight as page links (`a.cx.pg`).
 */
import { useEffect, useState } from "react";
import type { Annotation } from "@unvibe/shared";
import { api, friendlyError } from "../../api/client.js";
import { clearMarks, placeAnchorSpot, retryUntilSettled, spotFromAnchor, withPreservedSelection, type AnchorSpot } from "../../comments/anchor.js";
import { toast } from "../../floating/Toast.js";
import { useReview } from "../../state/store.js";
import { ExpansionCard } from "./ExpansionCard.js";
import { isAnchorStale } from "./expansionUtils.js";
import { hostLabel, recordUnplacedAnchors } from "../unplacedAnchors.js";
import type { Page } from "@unvibe/shared";

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

interface Props {
  reviewId: string;
  paragraphId: string;
  lookupPage: (pageId: string) => Page | undefined;
  onOpenPage: (pageId: string) => void;
  onFollowUp: (cardId: string, blockId: string, index: number) => void;
}

export function DescriptionExpansions({ reviewId, paragraphId, lookupPage, onOpenPage, onFollowUp }: Props) {
  const annotations = useReview((s) => s.snapshot?.annotations);
  const [, setTick] = useState(0);

  const exps = (annotations ?? []).filter((a) => {
    if (a.type !== "thread" && a.type !== "link") return false;
    if (a.anchor.host.kind === "description") return a.anchor.host.paragraphId === paragraphId;
    // Issue #214: a card on a comment renders under that comment's paragraph.
    if (a.anchor.host.kind === "comment") {
      const commentId = a.anchor.host.commentId;
      const comment = (annotations ?? []).find((x) => x.id === commentId && x.replies.some((r) => r.kind === "comment"));
      return comment?.anchor.host.kind === "description" && comment.anchor.host.paragraphId === paragraphId;
    }
    return false;
  });
  const open = exps.filter((a) => a.type === "thread" && a.open && !a.promotedToPage);

  useEffect(() => {
    const root = document.querySelector("#right .desc");
    if (!root || exps.length === 0) return;
    // Issue #166: retry boundedly when the paragraph body isn't there yet.
    let pending = new Set<string>(exps.map((a) => a.id));
    const retry = retryUntilSettled({ isSettled: () => pending.size === 0, repass: () => runPass(), attempts: 3, delayMs: 250, onGiveUp: () => recordGaveUp() });
    function recordGaveUp(): void {
      let body: Element | null = null;
      try {
        body = root!.querySelector(`[data-top="${CSS.escape(paragraphId)}"] .dseg-body`);
      } catch {
        body = null;
      }
      recordUnplacedAnchors(
        "Description expansions",
        exps
          .filter((a) => pending.has(a.id))
          .map((a) => ({ id: a.id, kind: a.type, host: hostLabel(a.anchor), reason: body ? ("quote-not-found" as const) : ("host-missing" as const) })),
      );
    }
    const runPass = (): void => {
      pending = new Set<string>(exps.map((a) => a.id));
      // Idempotent re-mark (issue #15): clear our own stale marks first,
      // then re-mark inside one selection-preserving window. Thread marks
      // (`mark[data-thr]`, owned by DescriptionView) are never touched.
      withPreservedSelection(root, () => {
        clearMarks(root, "mark.anc.ex[data-jump], mark.anc.exl[data-jump], a.cx.pg[data-node]");
        let changed = false;
        // Marks land only in the paragraph body (issue #101): it renders
        // through `dangerouslySetInnerHTML`, so its text nodes are
        // anonymous. The segment div around it also holds React-rendered
        // threads, markers and cards, which marks must never touch.
        let body: Element | null = null;
        try {
          body = root.querySelector(`[data-top="${CSS.escape(paragraphId)}"] .dseg-body`);
        } catch {
          body = null;
        }
        if (!body) return;
        const bodyEl: Element = body;
        const markInBody = (spot: AnchorSpot, make: () => Element): boolean =>
          placeAnchorSpot(bodyEl, spot, make) > 0;
        for (const a of exps) {
          if (isAnchorStale(a) || !a.anchor.quotedText) continue;
          if (a.type === "link" || a.promotedToPage) {
            const target = a.promotedToPage ?? "";
            if (target && markInBody(spotFromAnchor(a.anchor), () => makePageLink(target))) {
              changed = true;
              pending.delete(a.id);
            }
            continue;
          }
          const closed = !a.open;
          if (a.anchor.host.kind === "comment") {
            // Issue #214: mark inside the comment, not the paragraph body.
            const msgs = root.querySelectorAll(`[data-comment="${CSS.escape(a.anchor.host.commentId)}"]`);
            for (const msg of msgs) {
              if (placeAnchorSpot(msg, spotFromAnchor(a.anchor), () => makeExpMark(a.id, closed)) > 0) {
                changed = true;
                pending.delete(a.id);
                break;
              }
            }
            continue;
          }
          if (markInBody(spotFromAnchor(a.anchor), () => makeExpMark(a.id, closed))) {
            changed = true;
            pending.delete(a.id);
          }
        }
        if (changed) setTick((t) => t + 1);
      });
      if (pending.size === 0) recordUnplacedAnchors("Description expansions", []);
      else retry.schedule();
    };
    const timer = window.setTimeout(runPass, 0);
    return () => {
      window.clearTimeout(timer);
      retry.cancel();
    };
  }, [annotations, paragraphId, exps]);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const mark = (e.target as Element | null)?.closest?.("#right mark.anc[data-jump]");
      if (!mark) return;
      const id = (mark as HTMLElement).dataset.jump ?? "";
      const snap = useReview.getState().snapshot;
      const found = snap?.annotations.find((x) => x.id === id);
      if (!found) return;
      if (found.type === "thread" && !found.open) {
        api.updateComment(reviewId, id, { open: true, pinned: true }).catch((err: unknown) => {
          toast(`Couldn't open the explanation: ${friendlyError(err)}`);
        });
        window.setTimeout(() => {
          document.getElementById(`B-${id}`)?.scrollIntoView({ block: "nearest" });
        }, 120);
      } else {
        document.getElementById(`B-${id}`)?.scrollIntoView({ block: "nearest" });
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [reviewId]);

  if (open.length === 0) return null;
  return (
    <>
      {open.map((e) => (
        <div className="dann" key={e.id}>
          <ExpansionCard
            reviewId={reviewId}
            expansion={e as Annotation}
            lookupPage={lookupPage}
            onOpenPage={onOpenPage}
            onFollowUp={onFollowUp}
          />
        </div>
      ))}
    </>
  );
}
