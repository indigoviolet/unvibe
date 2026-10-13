/**
 * Expand-by-lines state and rows (issue #133, stage 1).
 *
 * One hook per file (`useFileExpansion`) owns the revealed intervals,
 * their texts, the file total, and fetching through `api.fileSlice`.
 * Row components render the step controls, the gap "show all" row, and
 * the revealed context rows in both views. Revealed rows are context:
 * tinted differently from the diff's own lines (`expand.css`), with
 * Shiki token colours through the same path as hunk rows, and
 * collapsible back per region.
 *
 * Anchors: revealed lines keep the diff-line address (`fileKey` + line),
 * so Explain and Ask work through the existing selection toolbar; the
 * line-number cells offer no comment start (no `onLineClick`, no comment
 * icon). `data-revealed` marks the rows so the toolbar hides Note there.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Fragment } from "react";
import type { EnclosingUnit, FileSliceRangeError, Hunk, ReviewFile } from "@unvibe/shared";
import { api, friendlyError } from "../../api/client.js";
import { escapeHtml } from "../../components/escapeHtml.js";
import { slotKey, type LineSlots } from "./lineSlots.js";
import { codeLineHtml } from "./highlight/codeHtml.js";
import { cachedLines, highlightLines } from "./highlight/shiki.js";
import { waitForSelectionClear } from "./highlight/selectionGuard.js";
import type { LineTokens } from "./highlight/tokenize.js";
import {
  EXPAND_STEP,
  expandRegions,
  hiddenIn,
  isRegionFull,
  mapNewToOld,
  mergeRanges,
  planExpandAll,
  planExpandDown,
  planExpandUp,
  revealedIn,
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
  collapse: (region: ExpandRegion) => void;
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
      if (region) {
        const plan = planExpandDown(end, region, revealed);
        if (plan) void fetchRanges([plan]);
      } else if (last) {
        // Total unknown and no bottom region yet: probe blindly downward;
        // past-the-end answers carry the total, hiding this control.
        void fetchRanges([{ start: end + 1, end: end + EXPAND_STEP }]);
      }
    },
    [edgeOf, hunks.length, regions, revealed, fetchRanges],
  );

  const expandAll = useCallback(
    (region: ExpandRegion): void => {
      void fetchRanges(planExpandAll(region, revealed, SLICE_CAP));
    },
    [revealed, fetchRanges],
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

  const collapse = useCallback((region: ExpandRegion): void => {
    setTexts((prev) => {
      const next = new Map(prev);
      for (let n = region.start; n <= region.end; n++) next.delete(n);
      return next;
    });
    setRevealed((prev) => prev.flatMap((r) => (r.end < region.start || r.start > region.end ? [r] : [])));
    // A collapsed region takes any unit step overlapping it back to none.
    setUnits((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [hash, st] of next) {
        if (st.level < 0) continue;
        const span =
          st.level < st.chain.length
            ? { start: st.chain[st.level].start, end: st.chain[st.level].end }
            : { start: 1, end: st.totalLines };
        if (span.end >= region.start && span.start <= region.end) {
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
    collapse,
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

function StepButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}): ReactNode {
  return (
    <button className="tbtn xs" type="button" aria-label={label} disabled={disabled} onClick={onClick}>
      {disabled ? "Loading…" : label}
    </button>
  );
}

/** Step + hide controls above or below one hunk. */
export function ExpandEdge({
  hunk,
  index,
  side,
  expansion,
  file,
  cols,
  showHide,
}: {
  hunk: Hunk;
  index: number;
  side: "above" | "below";
  expansion: FileExpansion;
  file: Pick<ReviewFile, "isDeleted" | "hunks">;
  cols: number;
  /** Render the region Hide control here (top region + bottom region only). */
  showHide: boolean;
}): ReactNode {
  const deleted = file.isDeleted === true;
  const last = index >= file.hunks.length - 1;
  const edge = side === "above" ? (deleted ? hunk.oldStart : hunk.newStart) : deleted ? hunk.oldEnd : hunk.newEnd;
  const region = side === "above" ? expansion.regionAbove(index) : expansion.regionBelow(index, file.hunks);
  // Total unknown and no bottom region yet: offer one blind step downward;
  // past-the-end answers carry the total, hiding this control for good.
  const blind = side === "below" && last && !region;
  const plan = region
    ? side === "above"
      ? planExpandUp(edge, region, expansion.revealed)
      : planExpandDown(edge, region, expansion.revealed)
    : null;
  if (!region && !blind) return null;
  if (region && !plan && !(showHide && revealedIn(region, expansion.revealed).length > 0)) return null;
  const remaining = region
    ? (side === "above"
        ? hiddenIn(region, expansion.revealed).filter((r) => r.start < edge)
        : hiddenIn(region, expansion.revealed).filter((r) => r.end > edge)
      ).reduce((s, r) => s + r.end - r.start + 1, 0)
    : EXPAND_STEP;
  return (
    <tr className="pr">
      <td colSpan={cols}>
        <div className="pin xrow">
          {plan || blind ? (
            <StepButton
              label={`Show ${Math.min(EXPAND_STEP, remaining)} more lines`}
              onClick={() => (side === "above" ? expansion.expandUp(hunk, index) : expansion.expandDown(hunk, index))}
              disabled={expansion.pending}
            />
          ) : null}
          {showHide && region && revealedIn(region, expansion.revealed).length > 0 ? (
            <button className="tbtn xs ghost" type="button" aria-label="Hide shown lines" onClick={() => expansion.collapse(region)}>
              Hide
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/** Gap row between two hunks: show-all plus collapse; slim hide when full. */
export function ExpandGap({ region, expansion, cols }: { region: ExpandRegion; expansion: FileExpansion; cols: number }): ReactNode {
  const hidden = hiddenIn(region, expansion.revealed);
  const remaining = hidden.reduce((s, r) => s + r.end - r.start + 1, 0);
  const shown = revealedIn(region, expansion.revealed).reduce((s, r) => s + r.end - r.start + 1, 0);
  if (remaining === 0 && shown === 0) return null;
  const full = isRegionFull(region, expansion.revealed);
  return (
    <tr className="pr">
      <td colSpan={cols}>
        <div className="pin xrow">
          {remaining > 0 ? (
            <StepButton label={`Show all ${remaining} lines`} onClick={() => expansion.expandAll(region)} disabled={expansion.pending} />
          ) : null}
          {shown > 0 ? (
            <button
              className="tbtn xs ghost"
              type="button"
              aria-label={full ? "Hide shown lines" : `Hide ${shown} shown lines`}
              onClick={() => expansion.collapse(region)}
            >
              {full ? "Hide" : `Hide ${shown} lines`}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function RevealedCells({
  line,
  view,
  segs,
}: {
  line: RevealedLine;
  view: "unified" | "split";
  segs: LineTokens | null;
}): ReactNode {
  const html = escapeHtml(" ") + codeLineHtml(line.text, segs);
  if (view === "unified") {
    return (
      <>
        <td className="n">{line.oldLine ?? ""}</td>
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
        <td className="n">{line.oldLine}</td>
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

/** Revealed context rows just above or below one hunk. */
export function RevealedRows({
  fileKey,
  lines,
  view,
  tokens,
  slots,
  highlight,
}: {
  fileKey: string;
  lines: RevealedLine[];
  view: "unified" | "split";
  tokens: ReadonlyMap<number, LineTokens | null>;
  slots: LineSlots;
  highlight: LineRange | null;
}): ReactNode {
  const cols = view === "split" ? 4 : 3;
  return (
    <>
      {lines.map((l) => {
        const num = l.newLine ?? l.oldLine;
        const hl = num !== null && num !== undefined && highlight !== null && num >= highlight.start && num <= highlight.end;
        return (
          <Fragment key={`rev-${l.line}`}>
            <tr className={hl ? "hl" : undefined} data-revealed="1" id={num !== null && num !== undefined ? `L-${fileKey}-${num}` : undefined}>
              <RevealedCells line={l} view={view} segs={tokens.get(l.line) ?? null} />
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
      })}
    </>
  );
}
