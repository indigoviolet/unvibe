/**
 * Diff threads (comments owner; PRD §4.8).
 *
 * Additive bindings over the diff pane's line-slot registry (kept small so
 * the interaction agent can reuse the slot APIs for Explain cards):
 *
 * - `useDiffCommentBindings(reviewId)`: `{ lineSlots, commentedLines,
 *   onLineClick }` for `DiffView`. Threads sit under their line and start
 *   open; closing leaves a comment icon on the line number (the slot set
 *   keeps closed threads, so `FileSection` renders the icon); clicking the
 *   number reopens; clicking any line number without a thread starts a
 *   comment. Selection-created threads anchor to the selection's line.
 * - `slotKeyFor` re-exports the registry key helper.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Annotation } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { slotKey, type LineSlots } from "../source/diff/lineSlots.js";
import { useReview } from "../state/store.js";
import { NEW_THREAD_EVENT, type NewThreadRequest } from "../floating/SelectionToolbar.js";
import { NewThreadComposer } from "./NewThreadComposer.js";
import { isReadOnlyVersionNow, useIsReadOnlyVersion } from "./readOnly.js";
import { ThreadView } from "./ThreadView.js";

export { slotKey };

interface Pending {
  fileKey: string;
  line: number;
  quote: string;
  note: boolean;
}

export function useDiffCommentBindings(reviewId: string): {
  lineSlots: LineSlots;
  commentedLines: ReadonlySet<string>;
  onLineClick: (fileKey: string, line: number) => void;
} {
  const annotations = useReview((s) => s.snapshot?.annotations);
  const readOnly = useIsReadOnlyVersion();
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const onRequest = (e: Event): void => {
      const req = (e as CustomEvent<NewThreadRequest>).detail;
      if (req.anchor.where !== "diff-line") return;
      if (isReadOnlyVersionNow()) return;
      setPending({ fileKey: req.anchor.fileKey, line: req.anchor.line, quote: req.quote, note: req.note });
    };
    window.addEventListener(NEW_THREAD_EVENT, onRequest);
    return () => window.removeEventListener(NEW_THREAD_EVENT, onRequest);
  }, []);

  const byLine = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const annotation of annotations ?? []) {
      if (annotation.type !== "thread") continue;
      const thread = annotation as Annotation;
      const host = thread.anchor.host;
      if (host.kind !== "diff-line") continue;
      const key = slotKey(host.fileKey, host.line);
      const list = map.get(key) ?? [];
      list.push(thread);
      map.set(key, list);
    }
    return map;
  }, [annotations]);

  const onLineClick = useCallback(
    (fileKey: string, line: number) => {
      if (isReadOnlyVersionNow()) {
        toast("Viewing an older version · read-only");
        return;
      }
      const key = slotKey(fileKey, line);
      const existing = byLine.get(key) ?? [];
      const snap = useReview.getState().snapshot;
      const review = snap?.review.id ?? reviewId;
      if (existing.length > 0) {
        // Clicking the number reopens closed threads; open ones scroll.
        const closed = existing.filter((t) => !t.open);
        if (closed.length > 0) {
          for (const thread of closed) {
            api.updateComment(review, thread.id, { open: true }).catch((err: unknown) => {
              toast(`Couldn't open the comment: ${friendlyError(err)}`);
            });
          }
        }
        window.setTimeout(() => {
          document.getElementById(existing[0].id)?.scrollIntoView({ block: "nearest" });
        }, 60);
        return;
      }
      setPending({ fileKey, line, quote: "", note: false });
    },
    [byLine, reviewId],
  );

  const lineSlots = useMemo<LineSlots>(() => {
    const slots: LineSlots = {};
    for (const [key, threads] of byLine) {
      const open = threads.filter((t) => t.open);
      if (open.length === 0) continue;
      slots[key] = (
        <>
          {open.map((t) => (
            <ThreadView key={t.id} reviewId={reviewId} thread={t} readOnly={readOnly} />
          ))}
          {pending && !readOnly && slotKey(pending.fileKey, pending.line) === key ? (
            <NewThreadComposer
              key="pending"
              reviewId={reviewId}
              anchor={{ where: "diff-line", fileKey: pending.fileKey, line: pending.line }}
              quote={pending.quote}
              note={pending.note}
              onDiscard={() => setPending(null)}
              onCreated={() => setPending(null)}
            />
          ) : null}
        </>
      );
    }
    if (pending && !readOnly && !slots[slotKey(pending.fileKey, pending.line)]) {
      slots[slotKey(pending.fileKey, pending.line)] = (
        <NewThreadComposer
              key="pending"
          reviewId={reviewId}
          anchor={{ where: "diff-line", fileKey: pending.fileKey, line: pending.line }}
          quote={pending.quote}
          note={pending.note}
          onDiscard={() => setPending(null)}
          onCreated={() => setPending(null)}
        />
      );
    }
    return slots;
  }, [byLine, pending, reviewId, readOnly]);

  const commentedLines = useMemo<ReadonlySet<string>>(() => new Set(byLine.keys()), [byLine]);

  return { lineSlots, commentedLines, onLineClick };
}
