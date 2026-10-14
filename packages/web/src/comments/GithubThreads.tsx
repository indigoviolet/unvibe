/**
 * Existing GitHub comments in the diff (issue #168).
 *
 * Pure grouping + outdated detection below; `useGithubThreads` binds them
 * to the snapshot for the diff pane:
 * - current threads render collapsed under their line (through the diff's
 *   line-slot registry, merged with user threads);
 * - outdated threads (path known, line gone from the current diff) render
 *   in a group at their file's top;
 * - threads on unknown paths render in the diff's end section, never
 *   dropped — and always in the comments menu.
 * - hidden in the view through the review's `viewPrefs`; hiding never
 *   removes them from the agents' context.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ExistingReviewComment, ReviewFile } from "@unvibe/shared";
import { ensureDiffVisible } from "../source/diff/revealSource.js";
import { slotKey, type LineSlots } from "../source/diff/lineSlots.js";
import { useReview } from "../state/store.js";
import { GithubThreadView } from "./GithubThreadView.js";

export interface GithubThread {
  root: ExistingReviewComment;
  replies: ExistingReviewComment[];
  /** Canonical file key when the root's path matches a review file. */
  fileKey?: string;
  /** Root's line, for placement. */
  line?: number;
  /** Path known but the line no longer in the current diff. */
  outdated: boolean;
}

/** Group flat comments into threads: roots keep fetch order, replies nest under their ultimate root. */
export function groupGithubComments(comments: ExistingReviewComment[]): GithubThread[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: ExistingReviewComment): ExistingReviewComment => {
    let cur = c;
    const seen = new Set<number>([cur.id]);
    while (cur.replyTo !== undefined && byId.has(cur.replyTo) && !seen.has(cur.replyTo)) {
      cur = byId.get(cur.replyTo)!;
      seen.add(cur.id);
    }
    return cur;
  };
  const order: GithubThread[] = [];
  const at = new Map<number, GithubThread>();
  for (const c of comments) {
    const root = rootOf(c);
    let thread = at.get(root.id);
    if (!thread) {
      thread = { root, replies: [], outdated: false };
      at.set(root.id, thread);
      order.push(thread);
    }
    if (c.id !== root.id) thread.replies.push(c);
  }
  return order;
}

/** True when the comment's line no longer exists in the current diff. */
export function isOutdatedComment(files: ReviewFile[], comment: ExistingReviewComment): boolean {
  if (comment.path === undefined) return false;
  const file = files.find((f) => f.path === comment.path);
  if (!file) return true;
  if (comment.line === undefined) return false;
  const left = (comment.side ?? "RIGHT").toUpperCase() === "LEFT";
  for (const hunk of file.hunks) {
    for (const row of hunk.lines) {
      if ((left ? row.oldLine : row.newLine) === comment.line) return false;
    }
  }
  return true;
}

/** Attach file keys and outdated flags to grouped threads. */
export function resolveGithubThreads(files: ReviewFile[], comments: ExistingReviewComment[]): GithubThread[] {
  return groupGithubComments(comments).map((t) => {
    const file = t.root.path !== undefined ? files.find((f) => f.path === t.root.path) : undefined;
    return {
      ...t,
      ...(file ? { fileKey: file.fileKey } : {}),
      ...(t.root.line !== undefined ? { line: t.root.line } : {}),
      outdated: isOutdatedComment(files, t.root),
    };
  });
}

/** Ask the diff pane to expand (and scroll to) one GitHub thread. */
export const GH_EXPAND_EVENT = "unvibe:gh-expand";

export function requestGithubThread(rootId: number): void {
  window.dispatchEvent(new CustomEvent<number>(GH_EXPAND_EVENT, { detail: rootId }));
}

export interface GithubSlots {
  /** Threads under their line, keyed like every other line slot. */
  lineSlots: LineSlots;
  /** Outdated threads grouped at their file's top, keyed by file key. */
  fileTops: Record<string, ReactNode>;
  /** Threads on unknown paths, for the diff's end section. */
  orphans: ReactNode | null;
}

export function useGithubThreads(): GithubSlots {
  const snapshot = useReview((s) => s.snapshot);
  // Collapsed by default (absent = collapsed); the comments menu expands
  // through GH_EXPAND_EVENT.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    const onExpand = (e: Event): void => {
      const rootId = (e as CustomEvent<number>).detail;
      setExpanded((prev) => new Set(prev).add(rootId));
      window.setTimeout(() => {
        const el = document.getElementById(`gh-thread-${rootId}`);
        if (el) ensureDiffVisible(el);
      }, 120);
    };
    window.addEventListener(GH_EXPAND_EVENT, onExpand);
    return () => window.removeEventListener(GH_EXPAND_EVENT, onExpand);
  }, []);

  return useMemo(() => {
    const empty: GithubSlots = { lineSlots: {}, fileTops: {}, orphans: null };
    if (!snapshot || !snapshot.viewPrefs.showExistingComments) return empty;
    const threads = resolveGithubThreads(snapshot.files, snapshot.existingComments ?? []);
    const lineSlots: LineSlots = {};
    const fileTops: Record<string, ReactNode> = {};
    const orphans: ReactNode[] = [];
    const node = (t: GithubThread): ReactNode => (
      <GithubThreadView
        key={t.root.id}
        thread={t}
        collapsed={!expanded.has(t.root.id)}
        onToggle={() =>
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(t.root.id)) next.delete(t.root.id);
            else next.add(t.root.id);
            return next;
          })
        }
      />
    );
    for (const t of threads) {
      if (t.fileKey === undefined) {
        orphans.push(node(t));
        continue;
      }
      if (t.outdated || t.line === undefined) {
        const prev = fileTops[t.fileKey];
        fileTops[t.fileKey] = prev ? (
          <Fragment key={t.fileKey}>
            {prev}
            {node(t)}
          </Fragment>
        ) : (
          node(t)
        );
        continue;
      }
      const key = slotKey(t.fileKey, t.line);
      const prev = lineSlots[key];
      lineSlots[key] = prev ? (
        <Fragment key={key}>
          {prev}
          {node(t)}
        </Fragment>
      ) : (
        node(t)
      );
    }
    return {
      lineSlots,
      fileTops,
      orphans: orphans.length > 0 ? <>{orphans}</> : null,
    };
  }, [snapshot, expanded]);
}
