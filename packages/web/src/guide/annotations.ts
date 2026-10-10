/**
 * Thread hooks for guide blocks (web-guide owner).
 *
 * Threads themselves are a later milestone (comments agent). Until then:
 * - `blockThreads(annotations, cardId, blockId)` returns the thread
 *   annotations anchored on the block. Anchors store `cardId#blockId`
 *   (service form) or a bare block id (prototype form); both match.
 * - `onOpenBlockThread` is the seam the threads milestone plugs into.
 */
import { useMemo } from "react";
import type { Annotation } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { anchorMatchesBlock } from "./guideUtils.js";

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

/** All thread annotations anchored on a guide card + block. */
export function blockThreads(
  annotations: Annotation[],
  cardId: string,
  blockId: string,
): Annotation[] {
  return annotations.filter(
    (a) =>
      a.type === "thread" &&
      a.anchor.host.kind === "block" &&
      anchorMatchesBlock(a.anchor.host.blockId, cardId, blockId),
  );
}

/** Open (in-place) expansion annotations anchored on a card + block. */
export function blockExpansions(
  annotations: Annotation[],
  cardId: string,
  blockId: string,
): Annotation[] {
  return annotations.filter(
    (a) =>
      a.type === "expansion" &&
      a.open &&
      a.anchor.host.kind === "block" &&
      anchorMatchesBlock(a.anchor.host.blockId, cardId, blockId),
  );
}

export function useBlockThreads(cardId: string, blockId: string): Annotation[] {
  const annotations = useReview((s) => s.snapshot?.annotations);
  return useMemo(
    () => (annotations ? blockThreads(annotations, cardId, blockId) : []),
    [annotations, cardId, blockId],
  );
}

export function useBlockExpansions(cardId: string, blockId: string): Annotation[] {
  const annotations = useReview((s) => s.snapshot?.annotations);
  return useMemo(
    () => (annotations ? blockExpansions(annotations, cardId, blockId) : []),
    [annotations, cardId, blockId],
  );
}
