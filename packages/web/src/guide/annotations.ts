/**
 * Thread hooks for guide blocks (M2, web-guide owner).
 *
 * Threads themselves are a later milestone (comments agent). Until then:
 * - `useBlockThreads(blockId)` returns the snapshot annotations anchored on
 *   the block, so `BlockView` can render the speech-bubble comment marker
 *   (PRD §4.5) with a count.
 * - `onOpenBlockThread` is the seam the threads milestone plugs into:
 *   the default implementation previews the thread in the hover popover
 *   (the marker carries `data-threads`, which `HoverPopover` resolves).
 */
import { useMemo } from "react";
import type { Annotation } from "@unvibe/shared";
import { useReview } from "../state/store.js";

export type OpenThreadHandler = (threadId: string, blockId: string) => void;

let openHandler: OpenThreadHandler | null = null;

/** Threads milestone: register the real open-thread behaviour here. */
export function onOpenBlockThread(fn: OpenThreadHandler): () => void {
  openHandler = fn;
  return () => {
    if (openHandler === fn) openHandler = null;
  };
}

/** Default: no full thread UI yet — hovering the marker previews it. */
export function openBlockThread(threadId: string, blockId: string): void {
  openHandler?.(threadId, blockId);
}

/** All thread annotations anchored on a guide block. */
export function blockThreads(
  annotations: Annotation[],
  blockId: string,
): Annotation[] {
  return annotations.filter(
    (a) => a.type === "thread" && a.anchor.host.kind === "block" && a.anchor.host.blockId === blockId,
  );
}

export function useBlockThreads(blockId: string): Annotation[] {
  const annotations = useReview((s) => s.snapshot?.annotations);
  return useMemo(
    () => (annotations ? blockThreads(annotations, blockId) : []),
    [annotations, blockId],
  );
}
