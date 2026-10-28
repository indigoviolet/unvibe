/**
 * Expand-by-lines state and rows (issue #133).
 *
 * One hook per file (`useFileExpansion`) owns the revealed intervals,
 * their texts, the file total, and fetching through `api.fileSlice`.
 * Controls are quiet gutter icons in thin separator rows: a single
 * caret steps 20 lines, a double caret shows a whole run; direction
 * follows where lines appear. Each gap holds one hidden run with one
 * remaining count shared from both ends: step-down + show-all ride the
 * upper hunk's table, step-up + show-all-to-previous ride the lower
 * hunk's. Revealed lines land in the section whose control revealed
 * them (issue #265): up-steps (and show-all up) atop the clicked hunk,
 * down-steps below it; a fully revealed gap shows once, never in both
 * sections. Continuous boundaries
 * (fully revealed gaps, adjacent hunks, file edges) show no expand
 * controls. Unified E2 (issue #308) rides expand-more on the outermost
 * visible row of each direction and the `fold` collapse chevron on the
 * next row in — both move outward with every expansion, and collapse
 * returns the side to the hunk's edge (reopening a closed gap). Split
 * view keeps its separator controls; revealed blocks there collapse
 * back through a hover gutter icon on their first row.
 *
 * Anchors: revealed lines keep the diff-line address (`fileKey` + line),
 * so Explain, Ask and GitHub work through the existing selection
 * toolbar; the line-number cells offer no comment start (no
 * `onLineClick`, no comment icon). `data-revealed` marks the rows so
 * the toolbar hides Comment there.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Fragment } from "react";
import type { EnclosingUnit, FileSliceRangeError, Hunk, ReviewFile } from "@unvibe/shared";
import { api, friendlyError } from "../../api/client.js";
import { escapeHtml } from "../../components/escapeHtml.js";
import { Icon, type IconName } from "../../components/Icon.js";
import { slotKey, type LineSlots } from "./lineSlots.js";
import { codeLineHtml } from "./highlight/codeHtml.js";
import { cachedLines, highlightLines } from "./highlight/shiki.js";
import { waitForSelectionClear } from "./highlight/selectionGuard.js";
import type { LineTokens } from "./highlight/tokenize.js";
import {
  EXPAND_STEP,
  collapseRangeAbove,
  collapseRangeBelow,
  expandRegions,
  mapNewToOld,
  mergeRanges,
  optimisticBottomRegion,
  planExpandAll,
  planExpandDown,
  planExpandUp,
  type ExpandRegion,
  type RevealedRange,
} from "./expandLines.js";
import type { LineRange } from "./FileSection.js";
import "./expand.css";

/** Route cap (mirrors the service `MAX_SLICE_LINES`). */
const SLICE_CAP = 200;

export interface RevealedLine {
  /** Expanded-side number (new side, or old side for deleted files). */
  line: number;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

interface ExpansionSource {
  path: string;
  commit: string;
  deleted: boolean;
}

function sourceFor(file: { path: string; oldPath?: string; isDeleted?: boolean }, head: string, base: string): ExpansionSource {
  return file.isDeleted === true
    ? { path: file.oldPath ?? file.path, commit: base, deleted: true }
    : { path: file.path, commit: head, deleted: false };
}

export interface FileExpansion {
  regions: ExpandRegion[];
  revealed: RevealedRange[];
  /** Revealed lines in ascending order. */
  lines: RevealedLine[];
  totalLines: number | null;
  pending: boolean;
  error: string | null;
  retry: () => void;
  expandUp: (hunk: Hunk, index: number) => void;
  expandDown: (hunk: Hunk, index: number) => void;
  expandAll: (region: ExpandRegion, dir: "up" | "down") => void;
  /** Hide one contiguous revealed block (hover gutter icon, split view). */
  collapseInterval: (start: number, end: number) => void;
  /**
   * Hide everything the above side of one hunk revealed, back to the
   * hunk's original edge (issue #308): gap sides stop at the partition
   * split so the other side's expansion survives; a closed gap reopens.
   */
  collapseAbove: (hunk: Hunk, index: number) => void;
  /** Mirror of `collapseAbove` below the hunk. */
  collapseBelow: (hunk: Hunk, index: number) => void;
  regionAbove: (index: number) => ExpandRegion | null;
  regionBelow: (index: number, hunks: Hunk[]) => ExpandRegion | null;
  /**
   * Gap partition for rendering (issue #265): lines of `region` below
   * the split read under the earlier hunk, lines at/above it atop the
   * later hunk. Top/bottom regions and untouched gaps default past the
   * end (everything reads under the earlier hunk, as before).
   */
  splitFor: (region: ExpandRegion) => number;
  /** Unit step for one hunk (issue #133, stage 2). */
  expandUnit: (hunk: Hunk) => void;
  unitFor: (hunk: Hunk) => HunkUnit;
}

/** Display state of one hunk's unit step. */
export interface HunkUnit {
  /** Name shown in the hunk header (`· in <name>`), if any level expanded. */
  name: string | null;
  /** True when the shown unit came from the heuristic fallback. */
  approx: boolean;
  /** Next-step button, null when stepping is done or unavailable. */
  next: { label: string; tip: string } | null;
  pending: boolean;
}

interface UnitState {
  chain: EnclosingUnit[];
  how: "parser" | "heuristic" | "none";
  totalLines: number;
  /** -1 none, 0..chain.length-1 unit, chain.length whole file. */
  level: number;
  /** True when no unit exists (empty chain or how none): no control. */
  hidden: boolean;
  pending: boolean;
}

/** Short display word for a unit kind. */
export function unitWord(kind: string): string {
  if (/method|constructor/.test(kind)) return "method";
  if (/function/.test(kind)) return "function";
  if (/callback|bound-function/.test(kind)) return "function";
  if (/class|module|interface|struct|enum|trait|record|namespace/.test(kind)) return "class";
  return "unit";
}

function rangeKey(r: RevealedRange): string {
  return `${r.start}-${r.end}`;
}

export function useFileExpansion(
  file: Pick<ReviewFile, "path" | "oldPath" | "isDeleted" | "isBinary" | "isNew" | "hunks">,
  opts: { reviewId: string; headCommit: string; baseCommit: string; disabled?: boolean },
): FileExpansion {
  const [revealed, setRevealed] = useState<RevealedRange[]>([]);
  const [splits, setSplits] = useState<ReadonlyMap<string, number>>(new Map());
  const [texts, setTexts] = useState<ReadonlyMap<number, string>>(new Map());
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<RevealedRange[]>([]);
  const [units, setUnits] = useState<ReadonlyMap<string, UnitState>>(new Map());
  const [failedUnit, setFailedUnit] = useState<Hunk | null>(null);
  const src = sourceFor(file, opts.headCommit, opts.baseCommit);
  const hunks = file.hunks;

  const regions = useMemo(() => expandRegions(file, totalLines), [file, totalLines]);

  const regionAbove = useCallback(
    (index: number): ExpandRegion | null => {
      if (index <= 0) return regions.find((r) => r.key === "top") ?? null;
      return regions.find((r) => r.key === `gap-${index - 1}`) ?? null;
    },
    [regions],
  );

  const splitFor = useCallback(
    (region: ExpandRegion): number => splits.get(region.key) ?? region.end + 1,
    [splits],
  );

  const claimSplit = useCallback((region: ExpandRegion, split: number): void => {
    // Top/bottom regions read from one side only; only gaps partition.
    if (!region.key.startsWith("gap-")) return;
    setSplits((prev) => {
      if (prev.get(region.key) === split) return prev;
      const next = new Map(prev);
      next.set(region.key, split);
      return next;
    });
  }, []);
  const regionBelow = useCallback(
    (index: number, all: Hunk[]): ExpandRegion | null => {
      if (index < all.length - 1) return regions.find((r) => r.key === `gap-${index}`) ?? null;
      const known = regions.find((r) => r.key === "bottom") ?? null;
      if (known) return known;
      // Issue #288: optimistic bottom while the total is unknown — one
      // assumed step below the last hunk. The click fetches it; EOF
      // teaches the total and the control disappears.
      if (totalLines !== null || all.length === 0) return null;
      return optimisticBottomRegion({ hunks: all, isDeleted: file.isDeleted });
    },
    [regions, totalLines, file],
  );

  const totalFromError = useCallback((err: unknown): number | null => {
    if (err instanceof Error) {
      const m = err.message.match(/: 400 ([\s\S]*)$/);
      if (m) {
        try {
          const body = JSON.parse(m[1]) as Partial<FileSliceRangeError>;
          if (typeof body.totalLines === "number") return body.totalLines;
        } catch {
          // Not JSON: nothing to learn.
        }
      }
    }
    return null;
  }, []);

  const learnTotal = useCallback(
    (err: unknown): void => {
      const total = totalFromError(err);
      if (total !== null) setTotalLines(total);
    },
    [totalFromError],
  );

  const fetchRanges = useCallback(
    async (ranges: RevealedRange[]): Promise<void> => {
      if (ranges.length === 0 || opts.disabled) return;
      const keys = ranges.map(rangeKey);
      setPendingKeys((prev) => new Set([...prev, ...keys]));
      setError(null);
      try {
        for (const r of ranges) {
          const res = await api.fileSlice(opts.reviewId, { path: src.path, commit: src.commit, start: r.start, end: r.end });
          if (res.totalLines !== undefined) setTotalLines(res.totalLines);
          setTexts((prev) => {
            const next = new Map(prev);
            res.lines.forEach((text, i) => next.set(r.start + i, text));
            return next;
          });
          setRevealed((prev) => mergeRanges([...prev, { start: r.start, end: r.end }]));
        }
        setFailed([]);
      } catch (err) {
        learnTotal(err);
        setError(friendlyError(err));
        setFailed(ranges);
      } finally {
        setPendingKeys((prev) => {
          const next = new Set(prev);
          for (const k of keys) next.delete(k);
          return next;
        });
      }
    },
    [opts.reviewId, opts.disabled, src.path, src.commit, learnTotal],
  );

  const edgeOf = useCallback(
    (hunk: Hunk): { start: number; end: number } => {
      const start = src.deleted ? hunk.oldStart : hunk.newStart;
      const end = src.deleted ? hunk.oldEnd : hunk.newEnd;
      return { start, end };
    },
    [src.deleted],
  );

  const expandUp = useCallback(
    (hunk: Hunk, index: number): void => {
      const { start } = edgeOf(hunk);
      const region = index <= 0 ? regions.find((r) => r.key === "top") : regions.find((r) => r.key === `gap-${index - 1}`);
      if (!region) return;
      const plan = planExpandUp(start, region, revealed);
      if (!plan) return;
      // The tail just revealed reads atop the clicked hunk (issue #265).
      claimSplit(region, plan.start);
      void fetchRanges([plan]);
    },
    [edgeOf, regions, revealed, fetchRanges, claimSplit],
  );

  /**
   * Optimistic bottom step (issue #288): fetch `[end+1, end+step]`
   * without a known total. Success reveals and teaches the total;
   * past-the-end (400 with `totalLines`) teaches the total silently —
   * EOF adds nothing and the control disappears, a short tail clamps
   * to `[start, total]` and reveals. Other failures show as today.
   */
  const fetchOptimisticBottom = useCallback(
    async (start: number, end: number): Promise<void> => {
      if (opts.disabled) return;
      const key = `${start}-${end}`;
      setPendingKeys((prev) => new Set([...prev, key]));
      setError(null);
      try {
        const res = await api.fileSlice(opts.reviewId, { path: src.path, commit: src.commit, start, end });
        if (res.totalLines !== undefined) setTotalLines(res.totalLines);
        setTexts((prev) => {
          const next = new Map(prev);
          res.lines.forEach((text, i) => next.set(start + i, text));
          return next;
        });
        setRevealed((prev) => mergeRanges([...prev, { start, end }]));
        setFailed([]);
      } catch (err) {
        const total = totalFromError(err);
        if (total !== null) {
          setTotalLines(total);
          if (start > total) {
            // Hunk ended at EOF: nothing to add, no error.
            setFailed([]);
            return;
          }
          // Short tail: the guess overshot; clamp and reveal.
          const clamped: RevealedRange = { start, end: Math.min(end, total) };
          try {
            const res = await api.fileSlice(opts.reviewId, {
              path: src.path,
              commit: src.commit,
              start: clamped.start,
              end: clamped.end,
            });
            if (res.totalLines !== undefined) setTotalLines(res.totalLines);
            setTexts((prev) => {
              const next = new Map(prev);
              res.lines.forEach((text, i) => next.set(clamped.start + i, text));
              return next;
            });
            setRevealed((prev) => mergeRanges([...prev, clamped]));
            setFailed([]);
            return;
          } catch (retryErr) {
            learnTotal(retryErr);
            setError(friendlyError(retryErr));
            setFailed([clamped]);
            return;
          }
        }
        learnTotal(err);
        setError(friendlyError(err));
        setFailed([{ start, end }]);
      } finally {
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [opts.reviewId, opts.disabled, src.path, src.commit, totalFromError, learnTotal],
  );

  const expandDown = useCallback(
    (hunk: Hunk, index: number): void => {
      const { end } = edgeOf(hunk);
      const last = index >= hunks.length - 1;
      if (last && totalLines === null) {
        // Optimistic: no known total, no region yet — assume one step.
        const hidden = revealed.filter((r) => r.end > end);
        const start = Math.max(end + 1, hidden.length > 0 ? Math.min(...hidden.map((r) => r.start)) : end + 1);
        void fetchOptimisticBottom(start, start + EXPAND_STEP - 1);
        return;
      }
      const region = last ? regions.find((r) => r.key === "bottom") : regions.find((r) => r.key === `gap-${index}`);
      if (!region) return;
      const plan = planExpandDown(end, region, revealed);
      if (!plan) return;
      // The head just revealed reads under the clicked hunk (issue #265).
      claimSplit(region, plan.end + 1);
      void fetchRanges([plan]);
    },
    [edgeOf, hunks.length, regions, revealed, fetchRanges, fetchOptimisticBottom, claimSplit, totalLines],
  );

  const expandAll = useCallback(
    (region: ExpandRegion, dir: "up" | "down"): void => {
      // Show-all lands in the section whose control was clicked: up
      // (to the top or the previous hunk) reads atop the later hunk,
      // down below the earlier one (issue #265).
      claimSplit(region, dir === "up" ? region.start : region.end + 1);
      void fetchRanges(planExpandAll(region, revealed, SLICE_CAP));
    },
    [revealed, fetchRanges, claimSplit],
  );

  const chunkRange = useCallback(
    (start: number, end: number): void => {
      const out: RevealedRange[] = [];
      for (let s = start; s <= end; s += SLICE_CAP) out.push({ start: s, end: Math.min(s + SLICE_CAP - 1, end) });
      void fetchRanges(out);
    },
    [fetchRanges],
  );

  /**
   * One unit level per click (issue #133, stage 2): fetch the hunk's
   * chain on first click, then reveal each level's span around the hunk
   * (unit spans merge into the same revealed lines as steps). Past the
   * last unit, one more click reveals the whole file. Empty chains and
   * `how: "none"` hide the control (degrade to expand-by-lines).
   */
  const expandUnit = useCallback(
    (hunk: Hunk): void => {
      if (opts.disabled) return;
      const { start: hs, end: he } = edgeOf(hunk);
      const st = units.get(hunk.contentHash);
      if (st?.pending) return;
      const step = (chain: EnclosingUnit[], total: number, level: number): void => {
        if (level < chain.length) {
          const u = chain[level];
          if (u.start < hs) chunkRange(u.start, hs - 1);
          if (u.end > he) chunkRange(he + 1, u.end);
        } else if (level === chain.length) {
          if (1 < hs) chunkRange(1, hs - 1);
          if (he < total) chunkRange(he + 1, total);
          setTotalLines(total);
        } else {
          return;
        }
        setUnits((prev) => {
          const cur = prev.get(hunk.contentHash);
          if (!cur) return prev;
          const next = new Map(prev);
          next.set(hunk.contentHash, { ...cur, level });
          return next;
        });
      };
      if (st && !st.hidden) {
        step(st.chain, st.totalLines, st.level + 1);
        return;
      }
      if (st) return;
      setUnits((prev) => {
        const next = new Map(prev);
        next.set(hunk.contentHash, { chain: [], how: "parser", totalLines: 0, level: -1, hidden: false, pending: true });
        return next;
      });
      setError(null);
      void (async () => {
        try {
          const res = await api.outline(opts.reviewId, { path: src.path, commit: src.commit, start: hs, end: he });
          if (res.totalLines !== undefined) setTotalLines(res.totalLines);
          if (res.chain.length === 0 || res.how === "none") {
            setUnits((prev) => {
              const next = new Map(prev);
              next.set(hunk.contentHash, {
                chain: [],
                how: res.how,
                totalLines: res.totalLines,
                level: -1,
                hidden: true,
                pending: false,
              });
              return next;
            });
            return;
          }
          setUnits((prev) => {
            const next = new Map(prev);
            next.set(hunk.contentHash, {
              chain: res.chain,
              how: res.how,
              totalLines: res.totalLines,
              level: -1,
              hidden: false,
              pending: false,
            });
            return next;
          });
          step(res.chain, res.totalLines, 0);
        } catch (err) {
          learnTotal(err);
          setError(friendlyError(err));
          setFailedUnit(hunk);
          setUnits((prev) => {
            const next = new Map(prev);
            next.delete(hunk.contentHash);
            return next;
          });
        }
      })();
    },
    [opts.disabled, opts.reviewId, edgeOf, units, chunkRange, src.path, src.commit, learnTotal],
  );

  const unitFor = useCallback(
    (hunk: Hunk): HunkUnit => {
      const st = units.get(hunk.contentHash);
      if (!st || st.hidden) {
        if (st?.hidden) return { name: null, approx: false, next: null, pending: false };
        return {
          name: null,
          approx: false,
          next: { label: "Show unit", tip: "Show the enclosing function or class" },
          pending: false,
        };
      }
      if (st.pending) {
        return { name: null, approx: false, next: { label: "Show unit", tip: "Show the enclosing function or class" }, pending: true };
      }
      const shown = st.level >= 0 ? st.chain[Math.min(st.level, st.chain.length - 1)] : null;
      const nextLevel = st.level + 1;
      const next =
        nextLevel < st.chain.length
          ? {
              label: `Show ${unitWord(st.chain[nextLevel].kind)}`,
              tip: `Show enclosing ${unitWord(st.chain[nextLevel].kind)} ${st.chain[nextLevel].name}`,
            }
          : nextLevel === st.chain.length
            ? { label: "Show file", tip: "Show the whole file" }
            : null;
      return { name: shown?.name ?? null, approx: st.how === "heuristic", next, pending: false };
    },
    [units],
  );

  const removeRevealed = useCallback((start: number, end: number): void => {
    setTexts((prev) => {
      const next = new Map(prev);
      for (let n = start; n <= end; n++) next.delete(n);
      return next;
    });
    setRevealed((prev) => {
      const out: RevealedRange[] = [];
      for (const r of prev) {
        if (r.end < start || r.start > end) {
          out.push(r);
          continue;
        }
        if (r.start < start) out.push({ start: r.start, end: start - 1 });
        if (r.end > end) out.push({ start: end + 1, end: r.end });
      }
      return mergeRanges(out);
    });
    // A hidden block takes any unit step overlapping it back to none.
    setUnits((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [hash, st] of next) {
        if (st.level < 0) continue;
        const span =
          st.level < st.chain.length
            ? { start: st.chain[st.level].start, end: st.chain[st.level].end }
            : { start: 1, end: st.totalLines };
        if (span.end >= start && span.start <= end) {
          next.set(hash, { ...st, level: -1 });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setError(null);
    setFailed([]);
    setFailedUnit(null);
  }, []);

  const collapseInterval = useCallback(
    (start: number, end: number): void => {
      removeRevealed(start, end);
    },
    [removeRevealed],
  );

  /**
   * Hide everything one hunk-side revealed (issue #308): the window
   * runs back to the hunk's original edge, stopping at the gap
   * partition split so the neighbouring hunk's expansion survives. If
   * the gap had closed, removing the revealed lines reopens it (the
   * expand controls return to the hunk's edge rows).
   */
  const collapseAbove = useCallback(
    (hunk: Hunk, index: number): void => {
      const region = regionAbove(index);
      if (!region) return;
      const { start } = edgeOf(hunk);
      const window = collapseRangeAbove(region, start, splitFor(region));
      if (window) removeRevealed(window.start, window.end);
    },
    [regionAbove, edgeOf, splitFor, removeRevealed],
  );

  const collapseBelow = useCallback(
    (hunk: Hunk, index: number): void => {
      const region = regionBelow(index, hunks);
      if (!region) return;
      const { end } = edgeOf(hunk);
      const window = collapseRangeBelow(region, end, splitFor(region));
      if (window) removeRevealed(window.start, window.end);
    },
    [regionBelow, hunks, edgeOf, splitFor, removeRevealed],
  );

  const retry = useCallback((): void => {
    if (failed.length > 0) void fetchRanges(failed);
    else if (failedUnit) expandUnit(failedUnit);
  }, [failed, failedUnit, fetchRanges, expandUnit]);

  const lines = useMemo<RevealedLine[]>(() => {
    const out: RevealedLine[] = [];
    for (const r of mergeRanges(revealed)) {
      for (let n = r.start; n <= r.end; n++) {
        const text = texts.get(n);
        if (text === undefined) continue;
        if (src.deleted) {
          out.push({ line: n, oldLine: n, newLine: null, text });
        } else {
          out.push({ line: n, oldLine: mapNewToOld(file, n), newLine: n, text });
        }
      }
    }
    return out;
  }, [revealed, texts, src.deleted, file]);

  return {
    regions,
    revealed,
    lines,
    totalLines,
    pending: pendingKeys.size > 0,
    error,
    retry,
    expandUp,
    expandDown,
    expandAll,
    collapseInterval,
    collapseAbove,
    collapseBelow,
    regionAbove,
    regionBelow,
    splitFor,
    expandUnit,
    unitFor,
  };
}

/** Token rows for revealed lines, through the same Shiki path as hunks. */
export function useRevealedTokens(
  path: string,
  lines: RevealedLine[],
  active: boolean,
): ReadonlyMap<number, LineTokens | null> {
  const [segs, setSegs] = useState<ReadonlyMap<number, LineTokens | null>>(() => new Map());
  useEffect(() => {
    if (!active || lines.length === 0) return;
    let cancelled = false;
    const texts = lines.map((l) => l.text);
    const cached = cachedLines(path, texts);
    if (cached) {
      const next = new Map<number, LineTokens | null>();
      lines.forEach((l, i) => next.set(l.line, cached[i] ?? null));
      setSegs(next);
      return;
    }
    void (async () => {
      const out = await highlightLines(path, texts);
      if (cancelled) return;
      await waitForSelectionClear(undefined, () => cancelled);
      if (cancelled || !out) return;
      const next = new Map<number, LineTokens | null>();
      lines.forEach((l, i) => next.set(l.line, out[i] ?? null));
      setSegs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [path, lines, active]);
  return segs;
}

/** One gutter icon in a separator row or an in-row number cell. */
export interface GutterControl {
  /**
   * Single caret (one step), double caret (the whole run), or the
   * collapse chevron (issue #308: hides what this side revealed).
   */
  kind: "step" | "all" | "collapse";
  /** Where revealed lines appear from this control (collapse: which side it hides). */
  dir: "up" | "down";
  /** Words + count for the tooltip and accessible name. */
  label: string;
  onClick: () => void;
}

/**
 * Row classes for in-row gutter controls (issue #308): expand pairs
 * ride `has-xup`/`has-xdown` (hover reveals the carets, numbers yield),
 * collapse chevrons `has-xhide-up`/`has-xhide-down`. A row can carry
 * both (a single-row hunk serving both directions).
 */
export function gutterRowClass(cs: GutterControl[] | null | undefined): string {
  if (!cs || cs.length === 0) return "";
  let s = "";
  if (cs.some((c) => c.dir === "up" && c.kind !== "collapse")) s += " has-xup";
  if (cs.some((c) => c.dir === "down" && c.kind !== "collapse")) s += " has-xdown";
  if (cs.some((c) => c.dir === "up" && c.kind === "collapse")) s += " has-xhide-up";
  if (cs.some((c) => c.dir === "down" && c.kind === "collapse")) s += " has-xhide-down";
  return s;
}

/** Gutter icon for an in-row or separator control (issue #308: collapse reuses `fold`). */
export function gutterIcon(c: GutterControl): IconName {
  if (c.kind === "collapse") return "fold";
  if (c.kind === "step") return c.dir === "up" ? "hide" : "down";
  return c.dir === "up" ? "upUp" : "downDown";
}

/**
 * Quiet gutter buttons for in-row number cells (issues #285, #308):
 * transparent at rest so number clicks pass through, revealed on row
 * hover/focus via the row's `has-x*` classes.
 */
export function GutterButtons({ cs, pending }: { cs: GutterControl[]; pending: boolean }): ReactNode {
  if (cs.length === 0) return null;
  return (
    <span className="xbtns">
      {cs.map((c) => (
        <button
          key={`${c.kind}-${c.dir}`}
          className="ib xbtn"
          type="button"
          data-tip={pending ? "Loading…" : c.label}
          aria-label={pending ? "Loading…" : c.label}
          disabled={pending}
          // The buttons sit inside the comment-start cell: expanding
          // or collapsing must not also start a comment.
          onClick={(e) => {
            e.stopPropagation();
            c.onClick();
          }}
        >
          <Icon name={gutterIcon(c)} />
        </button>
      ))}
    </span>
  );
}

/**
 * Thin separator row carrying gutter icons (issue #133): the icons sit
 * in the number gutter cell, frozen left like `.pin` rows so sideways
 * scrolling never hides them; the rest of the row stays empty so it
 * never reads as content. Muted at rest, clearer on hover/focus; real
 * buttons with a 20px hit area.
 */
export function ControlSeparator({
  controls,
  cols,
  pending,
  hideOld,
  hideNew,
}: {
  controls: GutterControl[];
  cols: number;
  pending: boolean;
  /** Issue #261: collapse the empty number column (unified only). */
  hideOld?: boolean;
  hideNew?: boolean;
}): ReactNode {
  if (controls.length === 0) return null;
  const icon = (c: GutterControl): IconName => gutterIcon(c);
  // Unified with a hidden number column: the icon cell + code only (2
  // cols). The icons spill via `.xicons` (width 0, visible overflow),
  // so the narrow gutter still shows them without reserving number width.
  const unifiedHidden = cols !== 4 && (hideOld === true || hideNew === true);
  return (
    <tr className="xsep">
      <td className="n xgutter">
        <span className="xicons">
          {controls.map((c) => (
            <button
              key={`${c.kind}-${c.dir}`}
              className="ib xbtn"
              type="button"
              data-tip={pending ? "Loading…" : c.label}
              aria-label={pending ? "Loading…" : c.label}
              disabled={pending}
              onClick={c.onClick}
            >
              <Icon name={icon(c)} />
            </button>
          ))}
        </span>
      </td>
      {cols === 4 ? (
        <>
          <td className="c" />
          <td className="n" />
          <td className="c" />
        </>
      ) : unifiedHidden ? (
        <td className="c" />
      ) : (
        <>
          <td className="n" />
          <td className="c" />
        </>
      )}
    </tr>
  );
}

function RevealedCells({
  line,
  view,
  segs,
  hide,
  controls,
  pending,
  hideOld,
  hideNew,
}: {
  line: RevealedLine;
  view: "unified" | "split";
  segs: LineTokens | null;
  /** Hide control for the block's first row, overlaid on its gutter number (split view only). */
  hide: ReactNode;
  /**
   * In-row gutter controls for this row (unified E2, issue #308): the
   * first rides the old cell, the rest the new cell — the same split
   * hunk rows use. Plain numbers, no comment affordance (revealed
   * lines offer no comment start).
   */
  controls?: GutterControl[] | null;
  pending?: boolean;
  /** Issue #261: collapse the empty number column (unified only). */
  hideOld?: boolean;
  hideNew?: boolean;
}): ReactNode {
  const html = escapeHtml(" ") + codeLineHtml(line.text, segs);
  if (view === "unified") {
    // Issue #308: in-row controls ride the number cells (the first in
    // the old cell, the rest in the new one — the same split hunk
    // rows use); at rest the numbers show, on row hover the controls.
    const cs = controls ?? [];
    const pendingBtns = pending ?? false;
    const oldCs = hideOld === true ? [] : hideNew === true ? [...cs] : cs.slice(0, 1);
    const newCs = hideNew === true ? [] : hideOld === true ? [...cs] : cs.slice(1);
    const oldNum = line.oldLine ?? "";
    const newNum = line.newLine ?? "";
    if (hideOld === true) {
      return (
        <>
          <td className="n">
            <span className="nnum">{newNum}</span>
            <GutterButtons cs={newCs} pending={pendingBtns} />
          </td>
          <td className="c">
            <span dangerouslySetInnerHTML={{ __html: html }} />
          </td>
        </>
      );
    }
    if (hideNew === true) {
      return (
        <>
          <td className="n">
            <span className="nnum">{oldNum}</span>
            <GutterButtons cs={oldCs} pending={pendingBtns} />
          </td>
          <td className="c">
            <span dangerouslySetInnerHTML={{ __html: html }} />
          </td>
        </>
      );
    }
    return (
      <>
        <td className="n">
          <span className="nnum">{oldNum}</span>
          <GutterButtons cs={oldCs} pending={pendingBtns} />
        </td>
        <td className="n">
          <span className="nnum">{newNum}</span>
          <GutterButtons cs={newCs} pending={pendingBtns} />
        </td>
        <td className="c">
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </td>
      </>
    );
  }
  const left =
    line.oldLine !== null && line.oldLine !== undefined ? (
      <>
        <td className="n xhide-cell">
          {line.oldLine}
          {hide}
        </td>
        <td className="c">
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </td>
      </>
    ) : (
      <>
        <td className="n empty xhide-cell">{hide}</td>
        <td className="c empty" />
      </>
    );
  const right =
    line.newLine !== null && line.newLine !== undefined ? (
      <>
        <td className="n">{line.newLine}</td>
        <td className="c">
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </td>
      </>
    ) : (
      <>
        <td className="n empty" />
        <td className="c empty" />
      </>
    );
  return (
    <>
      {left}
      {right}
    </>
  );
}

/**
 * Revealed context rows. Lines render in order.
 *
 * Split view keeps its separator controls plus one quiet Hide icon on
 * each contiguous block's first row (collapse needs no control row
 * between continuous code lines).
 *
 * Unified E2 (issue #308) carries the controls in-row: expand-more
 * (`^`/`^^`, `v`/`vv`) rides the outermost visible row in that
 * direction, collapse (the `fold` chevron, "Hide expanded lines
 * above/below") the next row in. Both move outward with every
 * expansion until the gap closes or the file's start or end; the
 * collapse returns the side to the hunk's original edge (reopening a
 * closed gap). Expand-more is never replaced by collapse.
 */
export function RevealedRows({
  fileKey,
  lines,
  view,
  tokens,
  slots,
  highlight,
  onHideBlock,
  hideOld,
  hideNew,
  controlsPending,
  leadControls,
  secondControls,
  trailControls,
  secondLastControls,
}: {
  fileKey: string;
  lines: RevealedLine[];
  view: "unified" | "split";
  tokens: ReadonlyMap<number, LineTokens | null>;
  slots: LineSlots;
  highlight: LineRange | null;
  /** Split view only: hide one contiguous block (unified uses collapse controls instead). */
  onHideBlock?: (start: number, end: number) => void;
  /** Issue #261: collapse the empty number column (unified only). */
  hideOld?: boolean;
  hideNew?: boolean;
  /** Unified only: disable the in-row controls while a fetch is pending. */
  controlsPending?: boolean;
  /** Unified only: expand-more on the first row (outermost above). */
  leadControls?: GutterControl[] | null;
  /** Unified only: collapse on the second row (next row in above). */
  secondControls?: GutterControl[] | null;
  /** Unified only: expand-more on the last row (outermost below). */
  trailControls?: GutterControl[] | null;
  /** Unified only: collapse on the second-to-last row (next row in below). */
  secondLastControls?: GutterControl[] | null;
}): ReactNode {
  const hidden = view !== "split" && (hideOld === true || hideNew === true);
  const cols = view === "split" ? 4 : hidden ? 2 : 3;
  const pending = controlsPending ?? false;
  const blocks: RevealedLine[][] = [];
  for (const l of lines) {
    const last = blocks[blocks.length - 1];
    if (last && l.line === last[last.length - 1].line + 1) last.push(l);
    else blocks.push([l]);
  }
  // Global row positions across blocks (blocks are contiguous in
  // practice; positions decide which rows carry controls).
  let ordinal = -1;
  return (
    <>
      {blocks.flatMap((block) =>
        block.map((l, bi) => {
          ordinal += 1;
          const gi = ordinal;
          const num = l.newLine ?? l.oldLine;
          const hl = num !== null && num !== undefined && highlight !== null && num >= highlight.start && num <= highlight.end;
          // Ids address new-side lines (issue #134 reads them for the
          // GitHub link). Deleted files have no new side: their revealed
          // rows stay id-less old-side lines, read from the number cell.
          const rowId =
            l.newLine !== null && l.newLine !== undefined ? `L-${fileKey}-${l.newLine}` : undefined;
          // Split view: the quiet Hide icon rides the block's first
          // row, as before (unified collapses through its second row).
          const hide =
            view === "split" && bi === 0 && onHideBlock ? (
              <button
                className="ib xhide"
                type="button"
                data-tip={`Hide ${block.length} lines`}
                aria-label={`Hide ${block.length} lines`}
                onClick={() => onHideBlock(block[0].line, block[block.length - 1].line)}
              >
                <Icon name="fold" />
              </button>
            ) : null;
          // Unified: expand-more outermost, collapse next row in.
          // Single-line sides carry expand-more here while collapse
          // sits on the hunk's edge row (passed via the hunk controls).
          let controls: GutterControl[] | null = null;
          if (view !== "split") {
            const add = (cs?: GutterControl[] | null): void => {
              if (cs && cs.length > 0) controls = [...(controls ?? []), ...cs];
            };
            if (gi === 0) add(leadControls);
            if (gi === 1 && lines.length > 1) add(secondControls);
            if (gi === lines.length - 1) add(trailControls);
            if (gi === lines.length - 2 && lines.length > 1) add(secondLastControls);
          }
          return (
            <Fragment key={`rev-${l.line}`}>
              <tr className={`${hl ? "hl" : ""}${gutterRowClass(controls)}` || undefined} data-revealed="1" id={rowId}>
                <RevealedCells line={l} view={view} segs={tokens.get(l.line) ?? null} hide={hide} controls={controls} pending={pending} hideOld={hideOld} hideNew={hideNew} />
              </tr>
              {num !== null && num !== undefined && slots[slotKey(fileKey, num)] != null ? (
                <tr className="pr">
                  <td colSpan={cols}>
                    <div className="pin" style={{ padding: "6px 10px 6px 34px", background: "var(--bg)" }}>
                      {slots[slotKey(fileKey, num)]}
                    </div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        }),
      )}
    </>
  );
}
