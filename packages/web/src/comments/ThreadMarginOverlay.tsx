/**
 * Guaranteed margin marker (issue #364): every thread anchored in prose
 * shows a comment icon in the margin — on its highlight's first line, or
 * on the paragraph's first line when the exact words can't be placed.
 * Clicking it opens the thread and scrolls to it.
 *
 * Issue #374: the icon is one compact pill (glyph + count, never
 * overlapping) sitting inside the card's reserved gutter
 * (`.has-threads`), so it is never clipped by the card or pane edge.
 * It is the single entry point for the paragraph's threads — the
 * end-of-block bubble is gone (see `BlockMarkers`).
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
  /** Threads to mark (one pill per block — see below). */
  threads: Thread[];
  readOnly?: boolean;
  /**
   * Issue #374 follow-up: floor for measured tops. A collapsed card's
   * hidden body measures at the container's top line (0), which would
   * straddle the card's top border — the collapsed card passes its
   * title line here so the pill sits inside, aligned with the title.
   */
  minTop?: number;
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
 * Issue #374 follow-up: one pill per block. Threads anchored in the same
 * block share one pill — the single entry point for the block's threads —
 * aligned to the block's first highlighted line (or its first line when
 * nothing placed). The count reads every thread anchored in the block.
 * (Issue #364 bucketed by vertical proximity; the owner asked for one
 * marker per paragraph instead.)
 */
interface Bucket {
  top: number;
  threads: Thread[];
}

/** Grouping key: the block (or description paragraph) a thread anchors in. */
export function bucketKeyFor(thread: Thread): string {
  const host = thread.anchor.host;
  if (host.kind === "block") {
    const hash = host.blockId.indexOf("#");
    return `block:${hash >= 0 ? host.blockId.slice(hash + 1) : host.blockId}`;
  }
  if (host.kind === "description") return `desc:${host.paragraphId}`;
  return `thread:${thread.id}`;
}

export function bucketsFor(threads: Thread[], tops: Record<string, number>): Bucket[] {
  const groups = new Map<string, Thread[]>();
  for (const t of threads) {
    if (tops[t.id] === undefined) continue;
    const list = groups.get(bucketKeyFor(t)) ?? [];
    list.push(t);
    groups.set(bucketKeyFor(t), list);
  }
  return [...groups.values()].map((group) => ({
    top: Math.min(...group.map((t) => tops[t.id] as number)),
    threads: group.sort((a, b) => (tops[a.id] as number) - (tops[b.id] as number)),
  }));
}

/**
 * Issue #374: the single computed thread count — the number the margin
 * pill shows and the tooltip names. One pure function, so the icon and
 * every assert read the same count.
 */
export function marginLabel(n: number): string {
  return n === 1 ? "1 thread" : `${n} threads`;
}

export function ThreadMarginOverlay({ threads, readOnly, minTop = 0 }: Props) {
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
        // No host at all (a collapsed card's hidden body): the pill sits
        // at the container's top line rather than vanishing.
        next[thread.id] = Math.max(minTop, (top ?? base) - base);
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
  }, [threads, minTop]);

  // Issue #374: the pill is the single entry point, so it keeps the old
  // end-of-block toggle (#262): all open closes them all (no scroll — the
  // pill stays where it is), otherwise closed ones open and the first
  // scrolls into view. The tooltip names the count ("3 threads").
  const onToggleBucket = (bucket: Bucket): void => {
    const reviewId = useReview.getState().snapshot?.review.id;
    if (!reviewId || readOnly) return;
    const snap = useReview.getState().snapshot;
    const liveOf = (id: string): Thread | undefined => snap?.annotations.find((a) => a.id === id) as Thread | undefined;
    const allOpen = bucket.threads.length > 0 && bucket.threads.every((t) => liveOf(t.id)?.open ?? t.open);
    for (const t of bucket.threads) {
      const live = liveOf(t.id);
      if (!live) continue;
      if (allOpen && live.open) {
        api.updateComment(reviewId, t.id, { open: false }).catch((err: unknown) => {
          toast(`Couldn't close the thread: ${friendlyError(err)}`);
        });
      } else if (!allOpen && !live.open) {
        api.updateComment(reviewId, t.id, { open: true }).catch((err: unknown) => {
          toast(`Couldn't open the thread: ${friendlyError(err)}`);
        });
      }
    }
    const first = bucket.threads[0];
    if (!first || allOpen) return;
    window.setTimeout(
      () => {
        document.getElementById(first.id)?.scrollIntoView({ block: "nearest" });
      },
      120,
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
            data-tip={marginLabel(n)}
            data-tip-place="right"
            aria-label={
              n > 1
                ? `Toggle ${n} threads, starting with: ${first.anchor.quotedText || "comment"}`
                : first.open
                  ? `Scroll to thread: ${first.anchor.quotedText || "comment"}`
                  : `Open thread: ${first.anchor.quotedText || "comment"}`
            }
            style={{ top: b.top }}
            onClick={() => onToggleBucket(b)}
          >
            <Icon name="comment" />
            <span className="tmargin-n">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
