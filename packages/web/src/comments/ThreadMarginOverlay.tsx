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
  /** Threads to mark (one icon per vertical bucket — see below). */
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

/**
 * Issue #364 follow-up (found by the 218 tour): threads anchored on the
 * same line would stack their icons pixel-on-pixel, and no stacked icon
 * is clickable. Buttons less than one icon apart share a bucket: one
 * button with a count badge, opening every thread in the bucket. Like
 * the end-of-block bubble, the count reads the bucket, never the thread.
 */
const BUCKET_PX = 20;

interface Bucket {
  top: number;
  threads: Thread[];
}

export function bucketsFor(threads: Thread[], tops: Record<string, number>): Bucket[] {
  const placed = threads
    .filter((t) => tops[t.id] !== undefined)
    .sort((a, b) => (tops[a.id] as number) - (tops[b.id] as number));
  const out: Bucket[] = [];
  for (const t of placed) {
    const last = out[out.length - 1];
    if (last && (tops[t.id] as number) - last.top < BUCKET_PX) last.threads.push(t);
    else out.push({ top: tops[t.id] as number, threads: [t] });
  }
  return out;
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

  const onOpenBucket = (bucket: Bucket): void => {
    const reviewId = useReview.getState().snapshot?.review.id;
    if (!reviewId || readOnly) return;
    const snap = useReview.getState().snapshot;
    const closed = bucket.threads.filter((t) => {
      const live = snap?.annotations.find((a) => a.id === t.id);
      return live && !live.open;
    });
    for (const t of closed) {
      api.updateComment(reviewId, t.id, { open: true }).catch((err: unknown) => {
        toast(`Couldn't open the thread: ${friendlyError(err)}`);
      });
    }
    const first = bucket.threads[0];
    if (!first) return;
    const anyClosed = closed.length > 0;
    window.setTimeout(
      () => {
        document.getElementById(first.id)?.scrollIntoView({ block: "nearest" });
      },
      anyClosed ? 120 : 0,
    );
  };

  if (threads.length === 0) return null;
  // Buttons appear only once measured, so they never stack at the
  // container's top for a frame before positioning settles.
  const buckets = bucketsFor(threads, tops);
  return (
    <div className="tmargin" ref={hostRef} aria-hidden={false}>
      {buckets.map((b) => {
        const first = b.threads[0] as Thread;
        const n = b.threads.length;
        const ids = b.threads.map((t) => t.id).join(" ");
        return (
          <button
            key={first.id}
            type="button"
            className="tmargin-btn"
            data-thr-margin={ids}
            data-tip={n > 1 ? `Open ${n} threads` : first.open ? "Scroll to thread" : "Open thread"}
            data-tip-place="right"
            aria-label={
              n > 1
                ? `Open ${n} threads, starting with: ${first.anchor.quotedText || "comment"}`
                : first.open
                  ? `Scroll to thread: ${first.anchor.quotedText || "comment"}`
                  : `Open thread: ${first.anchor.quotedText || "comment"}`
            }
            style={{ top: b.top }}
            onClick={() => onOpenBucket(b)}
          >
            <Icon name="comment" />
            {n > 1 ? <span className="tmargin-n" data-n={n} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
