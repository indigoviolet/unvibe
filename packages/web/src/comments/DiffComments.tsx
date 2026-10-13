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
import { WorkingPlaceholder } from "../components/WorkingPlaceholder.js";
import { toast } from "../floating/Toast.js";
import { diffAnchorForExplainKey, inflightLabel } from "../guide/inflight.js";
import { slotKey, type LineSlots } from "../source/diff/lineSlots.js";
import { useReview } from "../state/store.js";
import { NEW_THREAD_EVENT, type NewThreadRequest } from "../floating/SelectionToolbar.js";
import { hunkCommentAnchor } from "../source/diff/hunkAnchor.js";
import { NewThreadComposer } from "./NewThreadComposer.js";
import { isReadOnlyVersionNow, useIsReadOnlyVersion } from "./readOnly.js";
import { ThreadView } from "./ThreadView.js";

export { slotKey };

interface Pending {
  fileKey: string;
  line: number;
  quote: string;
  kind: "comment" | "ask";
  initialText?: string;
  /**
   * Issue #138: an Ask on a hunk summary keeps its hunk anchor for the
   * send (the service activates the summary, then nests the question),
   * while the composer sits on the hunk's first changed line. A Comment
   * on a summary arrives already mapped to a diff-line anchor.
   */
  hunkAnchor?: { where: "hunk"; fileKey: string; contentHash: string };
}

export function useDiffCommentBindings(reviewId: string): {
  lineSlots: LineSlots;
  commentedLines: ReadonlySet<string>;
  onLineClick: (fileKey: string, line: number) => void;
} {
  const annotations = useReview((s) => s.snapshot?.annotations);
  const inflight = useReview((s) => s.inflight);
  const readOnly = useIsReadOnlyVersion();
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const onRequest = (e: Event): void => {
      const req = (e as CustomEvent<NewThreadRequest>).detail;
      if (req.anchor.where === "hunk") {
        // Issue #138: Ask on a hunk summary. The composer sits on the
        // hunk's first changed line; the send keeps the hunk anchor.
        if (req.kind !== "ask" || isReadOnlyVersionNow()) return;
        const mapped = hunkCommentAnchor(useReview.getState().snapshot, {
          fileKey: req.anchor.fileKey,
          contentHash: req.anchor.contentHash,
        });
        if (!mapped || mapped.where !== "diff-line") return;
        setPending({
          fileKey: mapped.fileKey,
          line: mapped.line,
          quote: req.quote,
          kind: req.kind,
          ...(req.initialText !== undefined ? { initialText: req.initialText } : {}),
          hunkAnchor: req.anchor,
        });
        return;
      }
      if (req.anchor.where !== "diff-line") return;
      if (isReadOnlyVersionNow()) return;
      setPending({
        fileKey: req.anchor.fileKey,
        line: req.anchor.line,
        quote: req.quote,
        kind: req.kind,
        ...(req.initialText !== undefined ? { initialText: req.initialText } : {}),
      });
    };
    window.addEventListener(NEW_THREAD_EVENT, onRequest);
    return () => window.removeEventListener(NEW_THREAD_EVENT, onRequest);
  }, []);

  const byLine = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const annotation of annotations ?? []) {
      if (annotation.type !== "comment") continue;
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
      setPending({ fileKey, line, quote: "", kind: "comment" });
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
              anchor={pending.hunkAnchor ?? { where: "diff-line", fileKey: pending.fileKey, line: pending.line }}
              quote={pending.quote}
              kind={pending.kind}
              initialText={pending.initialText}
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
          anchor={pending.hunkAnchor ?? { where: "diff-line", fileKey: pending.fileKey, line: pending.line }}
          quote={pending.quote}
          kind={pending.kind}
          initialText={pending.initialText}
          onDiscard={() => setPending(null)}
          onCreated={() => setPending(null)}
        />
      );
    }
    // Explains started from a diff selection show a placeholder under the
    // line until the card lands (issue #46). An Ask keeps its composer
    // until the card arrives; retargeted entries vanish from the anchor
    // key, so an arrived card never doubles with its placeholder — and a
    // card that lands before the response hides it too (issue #97).
    if (!readOnly) {
      const arrived = new Set<string>();
      for (const a of annotations ?? []) {
        if (a.type !== "conversation" || !a.open) continue;
        if (a.anchor.host.kind !== "diff-line") continue;
        arrived.add(slotKey(a.anchor.host.fileKey, a.anchor.host.line));
      }
      for (const [key, entry] of Object.entries(inflight)) {
        const anchor = diffAnchorForExplainKey(key);
        if (!anchor) continue;
        const slot = slotKey(anchor.fileKey, anchor.line);
        if (slots[slot] || arrived.has(slot)) continue;
        slots[slot] = <WorkingPlaceholder key={`inflight-${key}`} label={inflightLabel(entry.kind)} />;
      }
    }
    return slots;
  }, [annotations, byLine, pending, reviewId, readOnly, inflight]);

  const commentedLines = useMemo<ReadonlySet<string>>(() => new Set(byLine.keys()), [byLine]);

  return { lineSlots, commentedLines, onLineClick };
}
