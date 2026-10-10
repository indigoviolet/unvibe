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
import { highlightAnchorInRoot } from "../../comments/anchor.js";
import { toast } from "../../floating/Toast.js";
import { useReview } from "../../state/store.js";
import { ExpansionCard } from "./ExpansionCard.js";
import { isAnchorStale } from "./expansionUtils.js";
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

  const exps = (annotations ?? []).filter(
    (a) =>
      (a.type === "expansion" || a.type === "link") &&
      a.anchor.host.kind === "description" &&
      a.anchor.host.paragraphId === paragraphId,
  );
  const open = exps.filter((a) => a.type === "expansion" && a.open && !a.promotedToPage);

  useEffect(() => {
    const root = document.querySelector("#right .desc");
    if (!root || exps.length === 0) return;
    const timer = window.setTimeout(() => {
      let changed = false;
      for (const a of exps) {
        if (isAnchorStale(a) || !a.anchor.quotedText) continue;
        if (a.type === "link" || a.promotedToPage) {
          const target = a.promotedToPage ?? "";
          if (target && highlightAnchorInRoot(root, paragraphId, a.anchor.quotedText, () => makePageLink(target))) {
            changed = true;
          }
          continue;
        }
        const closed = !a.open;
        if (highlightAnchorInRoot(root, paragraphId, a.anchor.quotedText, () => makeExpMark(a.id, closed))) {
          changed = true;
        }
      }
      if (changed) setTick((t) => t + 1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [annotations, paragraphId, exps]);

  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const mark = (e.target as Element | null)?.closest?.("#right mark.anc[data-jump]");
      if (!mark) return;
      const id = (mark as HTMLElement).dataset.jump ?? "";
      const snap = useReview.getState().snapshot;
      const found = snap?.annotations.find((x) => x.id === id);
      if (!found) return;
      if (found.type === "expansion" && !found.open) {
        api.updateComment(reviewId, id, { open: true }).catch((err: unknown) => {
          toast(`Couldn't expand: ${friendlyError(err)}`);
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
