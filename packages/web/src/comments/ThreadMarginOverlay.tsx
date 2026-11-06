/**
 * Guaranteed margin marker (issue #364): every thread anchored in prose
 * shows a comment icon in the margin — on its highlight's first line, or
 * on the paragraph's first line when the exact words can't be placed.
 * Clicking it opens the thread and scrolls to it.
 *
 * React owns the buttons (they never disappear on re-render — unlike the
 * DOM-surgery highlight marks, which come and go with re-anchoring); a
 * layout effect only nudges each button's vertical offset to the
 * highlight's first line when one is placed. The overlay is
 * pointer-transparent except on the buttons themselves, so text
 * selection underneath keeps working. Re-positioned whenever the
 * snapshot changes, on resize, and once more after paint (marks land a
 * frame after React commits).
 */
import { useEffect, useRef, useState } from "react";
import type { Thread } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";

interface Props {
  /** Threads to mark (one icon each). */
  threads: Thread[];
  readOnly?: boolean;
}

function esc(id: string): string {
  try {
    return CSS.escape(id);
  } catch {
    return id;
  }
}

/** Host top for a thread's anchor inside `scope` (fallback line). */
function fallbackTop(scope: Element, thread: Thread): number | null {
  const host = thread.anchor.host;
  let top: string | null = null;
  if (host.kind === "block") {
    const hash = host.blockId.indexOf("#");
    const bare = hash >= 0 ? host.blockId.slice(hash + 1) : host.blockId;
    top = host.blockId;
    try {
      const el =
        scope.querySelector(`[data-top="${esc(top)}"]`) ?? scope.querySelector(`[data-top="${esc(bare)}"]`);
      if (el) return el.getBoundingClientRect().top;
    } catch {
      return null;
    }
    return null;
  }
  if (host.kind === "description") {
    try {
      const el = scope.querySelector(`[data-top="${esc(host.paragraphId)}"] .dseg-body`);
      if (el) return el.getBoundingClientRect().top;
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

export function ThreadMarginOverlay({ threads, readOnly }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [tops, setTops] = useState<Record<string, number>>({});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // The overlay sits inside the positioned card/desc container; the
    // scope is that container (marks live in the blocks above).
    const scope = host.parentElement;
    if (!scope) return;
    let cancelled = false;
    const place = (): void => {
      if (cancelled) return;
      const base = scope.getBoundingClientRect().top;
      const next: Record<string, number> = {};
      for (const thread of threads) {
        let top: number | null = null;
        try {
          const mark = scope.querySelector(`mark.anc[data-thr="${esc(thread.id)}"]`);
          if (mark) top = mark.getBoundingClientRect().top;
        } catch {
          top = null;
        }
        top ??= fallbackTop(scope, thread);
        // No host at all (a collapsed card's hidden body): the icon sits
        // at the container's top line rather than vanishing.
        next[thread.id] = Math.max(0, (top ?? base) - base);
      }
      setTops((prev) => {
        const keys = Object.keys(next);
        if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])) return prev;
        return next;
      });
    };
    place();
    const late = window.setTimeout(place, 350);
    window.addEventListener("resize", place);
    return () => {
      cancelled = true;
      window.clearTimeout(late);
      window.removeEventListener("resize", place);
    };
  }, [threads]);

  const onOpen = (id: string): void => {
    const reviewId = useReview.getState().snapshot?.review.id;
    if (!reviewId || readOnly) return;
    const thread = useReview.getState().snapshot?.annotations.find((a) => a.id === id);
    if (thread && !thread.open) {
      api.updateComment(reviewId, id, { open: true }).catch((err: unknown) => {
        toast(`Couldn't open the thread: ${friendlyError(err)}`);
      });
    }
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "nearest" });
    }, thread?.open ? 0 : 120);
  };

  if (threads.length === 0) return null;
  // Buttons appear only once measured, so they never stack at the
  // container's top for a frame before positioning settles.
  const placed = threads.filter((t) => tops[t.id] !== undefined);
  return (
    <div className="tmargin" ref={hostRef} aria-hidden={false}>
      {placed.map((t) => (
        <button
          key={t.id}
          type="button"
          className="tmargin-btn"
          data-thr-margin={t.id}
          data-tip={t.open ? "Scroll to thread" : "Open thread"}
          aria-label={t.open ? `Scroll to thread: ${t.anchor.quotedText || "comment"}` : `Open thread: ${t.anchor.quotedText || "comment"}`}
          style={tops[t.id] !== undefined ? { top: tops[t.id] } : undefined}
          onClick={() => onOpen(t.id)}
        >
          <Icon name="comment" />
        </button>
      ))}
    </div>
  );
}
