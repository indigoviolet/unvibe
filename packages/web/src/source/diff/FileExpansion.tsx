/**
 * Expand-by-lines state and rows (issue #133).
 *
 * One hook per file (`useFileExpansion`) owns the revealed intervals,
 * their texts, the file total, and fetching through `api.fileSlice`.
 * Controls are quiet gutter icons in thin separator rows: a single
 * caret steps 20 lines, a double caret shows a whole run; direction
 * follows where lines appear. Each gap holds one hidden run with one
 * set of controls sharing its remaining count; continuous boundaries
 * (fully revealed gaps, adjacent hunks, file edges) show no controls.
 * Revealed blocks collapse back through a hover gutter icon on their
 * first row — never a control row between continuous lines.
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
  expandRegions,
  mapNewToOld,
  mergeRanges,
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
  expandAll: (region: ExpandRegion) => void;
  /** Hide one contiguous revealed block (hover gutter icon). */
  collapseInterval: (start: number, end: number) => void;
  /** Learn the file total without revealing anything (single-hunk files). */
  probeTotal: () => void;
  regionAbove: (index: number) => ExpandRegion | null;
  regionBelow: (index: number, hunks: Hunk[]) => ExpandRegion | null;
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

  const regionBelow = useCallback(
    (index: number, all: Hunk[]): ExpandRegion | null => {
      if (index >= all.length - 1) return regions.find((r) => r.key === "bottom") ?? null;
      return regions.find((r) => r.key === `gap-${index}`) ?? null;
    },
    [regions],
  );

  const learnTotal = useCallback((err: unknown): void => {
    if (err instanceof Error) {
      const m = err.message.match(/: 400 ([\s\S]*)$/);
      if (m) {
        try {
          const body = JSON.parse(m[1]) as Partial<FileSliceRangeError>;
          if (typeof body.totalLines === "number") setTotalLines(body.totalLines);
        } catch {
          // Not JSON: nothing to learn.
        }
      }
    }
  }, []);

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
      if (plan) void fetchRanges([plan]);
    },
    [edgeOf, regions, revealed, fetchRanges],
  );

  const expandDown = useCallback(
    (hunk: Hunk, index: number): void => {
      const { end } = edgeOf(hunk);
      const last = index >= hunks.length - 1;
      const region = last ? regions.find((r) => r.key === "bottom") : regions.find((r) => r.key === `gap-${index}`);
      // No blind probing: the bottom control renders only once the total
      // is known (learned from any slice/outline response, or the probe
      // below for single-hunk files starting at line 1).
      if (!region) return;
      const plan = planExpandDown(end, region, revealed);
      if (plan) void fetchRanges([plan]);
    },
    [edgeOf, hunks.length, regions, revealed, fetchRanges],
  );

  const expandAll = useCallback(
    (region: ExpandRegion): void => {
      void fetchRanges(planExpandAll(region, revealed, SLICE_CAP));
    },
    [revealed, fetchRanges],
  );

  /**
   * Learn the file total without revealing anything. Only needed for
   * single-hunk files starting at line 1: every other shape reaches a
   * slice or outline response (which carries the total) through its top
   * or gap controls first. Silent: failures just leave the bottom
   * control hidden.
   */
  const probeTotal = useCallback(async (): Promise<void> => {
    if (opts.disabled || totalLines !== null) return;
    try {
      const res = await api.fileSlice(opts.reviewId, { path: src.path, commit: src.commit, start: 1, end: 1 });
      setTotalLines(res.totalLines);
    } catch (err) {
      learnTotal(err);
    }
  }, [opts.disabled, opts.reviewId, totalLines, src.path, src.commit, learnTotal]);

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

  const collapseInterval = useCallback((start: number, end: number): void => {
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
    probeTotal,
    regionAbove,
    regionBelow,
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

/** One gutter icon in a separator row. */
export interface GutterControl {
  /** Single caret (one step) or double caret (the whole run). */
  kind: "step" | "all";
  /** Where revealed lines appear from this control. */
  dir: "up" | "down";
  /** Words + count for the tooltip and accessible name. */
  label: string;
  onClick: () => void;
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
}: {
  controls: GutterControl[];
  cols: number;
  pending: boolean;
}): ReactNode {
  if (controls.length === 0) return null;
  const icon = (c: GutterControl): IconName => {
    if (c.kind === "step") return c.dir === "up" ? "hide" : "down";
    return c.dir === "up" ? "upUp" : "downDown";
  };
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
}: {
  line: RevealedLine;
  view: "unified" | "split";
  segs: LineTokens | null;
  /** Hide control for the block's first row, overlaid on its gutter number. */
  hide: ReactNode;
}): ReactNode {
  const html = escapeHtml(" ") + codeLineHtml(line.text, segs);
  if (view === "unified") {
    return (
      <>
        <td className="n xhide-cell">
          {line.oldLine ?? ""}
          {hide}
        </td>
        <td className="n">{line.newLine ?? ""}</td>
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
 * Revealed context rows. Lines render in order; each contiguous block
 * gets a quiet Hide icon over its first row's gutter number (visible on
 * row hover or keyboard focus), so collapsing never needs a control row
 * between continuous code lines.
 */
export function RevealedRows({
  fileKey,
  lines,
  view,
  tokens,
  slots,
  highlight,
  onHideBlock,
}: {
  fileKey: string;
  lines: RevealedLine[];
  view: "unified" | "split";
  tokens: ReadonlyMap<number, LineTokens | null>;
  slots: LineSlots;
  highlight: LineRange | null;
  onHideBlock: (start: number, end: number) => void;
}): ReactNode {
  const cols = view === "split" ? 4 : 3;
  const blocks: RevealedLine[][] = [];
  for (const l of lines) {
    const last = blocks[blocks.length - 1];
    if (last && l.line === last[last.length - 1].line + 1) last.push(l);
    else blocks.push([l]);
  }
  return (
    <>
      {blocks.flatMap((block) =>
        block.map((l, bi) => {
          const num = l.newLine ?? l.oldLine;
          const hl = num !== null && num !== undefined && highlight !== null && num >= highlight.start && num <= highlight.end;
          // Ids address new-side lines (issue #134 reads them for the
          // GitHub link). Deleted files have no new side: their revealed
          // rows stay id-less old-side lines, read from the number cell.
          const rowId =
            l.newLine !== null && l.newLine !== undefined ? `L-${fileKey}-${l.newLine}` : undefined;
          const hide =
            bi === 0 ? (
              <button
                className="ib xhide"
                type="button"
                data-tip="Hide shown lines"
                aria-label="Hide shown lines"
                onClick={() => onHideBlock(block[0].line, block[block.length - 1].line)}
              >
                <Icon name="x" />
              </button>
            ) : null;
          return (
            <Fragment key={`rev-${l.line}`}>
              <tr className={hl ? "hl" : undefined} data-revealed="1" id={rowId}>
                <RevealedCells line={l} view={view} segs={tokens.get(l.line) ?? null} hide={hide} />
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
