/**
 * Unplaced guide anchors (issue #206): when a highlight pass gives up
 * retrying, it records which anchors it could not place and why, keyed
 * by the pass that tried ("guide expansions", "guide threads", …). The
 * per-review Debug page shows the current list. IDs and reason only —
 * no quote text beyond what the app already stores.
 *
 * The record lives in module state, not the review store: it is a
 * client-side placement diagnostic, and it must survive navigating
 * from the review to its Debug page.
 */
import { useSyncExternalStore } from "react";

export type UnplacedReason = "host-missing" | "quote-not-found";

export interface UnplacedAnchor {
  /** Annotation id (`ann_…`). */
  id: string;
  /** Annotation type (`conversation`, `comment`, `link`). */
  kind: string;
  /** Host id only: a `card#block`, a description paragraph, or `file:line`. */
  host: string;
  reason: UnplacedReason;
  /** Which highlight pass gave up on it. */
  source: string;
}

const bySource = new Map<string, UnplacedAnchor[]>();
const listeners = new Set<() => void>();
let snapshotCache: UnplacedAnchor[] = [];

function refresh(): void {
  snapshotCache = [...bySource.values()].flat();
  for (const fn of listeners) fn();
}

/** Replace one pass's unplaced list (empty clears that pass's entries). */
export function recordUnplacedAnchors(source: string, list: Omit<UnplacedAnchor, "source">[]): void {
  const next = list.map((u) => ({ ...u, source }));
  const prev = bySource.get(source) ?? [];
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  if (next.length === 0) bySource.delete(source);
  else bySource.set(source, next);
  refresh();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): UnplacedAnchor[] {
  return snapshotCache;
}

/** Current unplaced anchors across every pass, for the Debug page. */
export function useUnplacedAnchors(): UnplacedAnchor[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Host id for the record: IDs only, never quote text. */
export function hostLabel(anchor: { host: { kind: string; blockId?: string; paragraphId?: string; fileKey?: string; line?: number } }): string {
  const h = anchor.host;
  if (h.kind === "block") return h.blockId ?? "block";
  if (h.kind === "description") return h.paragraphId ?? "description";
  if (h.kind === "diff-line") return `${h.fileKey ?? "file"}:${h.line ?? "?"}`;
  if (h.kind === "hunk") return `${h.fileKey ?? "file"}:hunk`;
  return h.kind;
}
