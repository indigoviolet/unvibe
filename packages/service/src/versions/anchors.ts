/**
 * Anchor remapping by content (PRD §8).
 *
 * Every anchor keeps its position at creation, the quoted text with a few
 * lines before/after (prefix/suffix), and its hunk's content hash. On a new
 * version we re-find it:
 *
 * 1. Exact hash hit → move with the line shift (unchanged hunk, possibly
 *    renamed file).
 * 2. Otherwise search for the quote with its context in the new version of
 *    the file, with a confidence threshold; ambiguous or weak matches are
 *    outdated.
 * 3. Anchors whose hunk changed or was removed are marked outdated even
 *    when the quote is found (PRD §8 table: changed → outdated, keeping the
 *    original snippet and a link to the new code).
 *
 * Pure functions: callers supply the hunk comparison and the new file
 * contents (`git show <newHead>:<path>` split into lines). No git here.
 */
import type { Anchor } from "@unvibe/shared";
import type { AnchorRemap } from "@unvibe/shared";
import type { HunkComparison } from "./compare.js";

export const ANCHOR_CONFIDENCE_THRESHOLD = 0.6;

function oldHunkId(fileKey: string, hunkHash: string): string {
  return `h:${fileKey}:${hunkHash}`;
}

/**
 * New fileKey for an old fileKey, via the comparison (handles renames).
 * Majority vote over unchanged + changed pairs; undefined when the file
 * has no surviving hunks (deleted or fully rewritten).
 */
export function newFileKeyForOld(oldFileKey: string, comparison: HunkComparison): string | undefined {
  const votes = new Map<string, number>();
  for (const u of comparison.unchanged) {
    if (u.oldHunk.fileKey === oldFileKey) votes.set(u.newHunk.fileKey, (votes.get(u.newHunk.fileKey) ?? 0) + 1);
  }
  for (const c of comparison.changed) {
    if (c.oldHunk.fileKey === oldFileKey) votes.set(c.newHunk.fileKey, (votes.get(c.newHunk.fileKey) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [k, n] of votes) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

/** Old hunk status for an anchor (via its hunk hash when present). */
export type OldHunkStatus = "unchanged" | "changed" | "removed" | "unknown";

export function oldHunkStatus(
  fileKey: string,
  hunkHash: string | undefined,
  comparison: HunkComparison,
): OldHunkStatus {
  if (!hunkHash) return "unknown";
  const id = oldHunkId(fileKey, hunkHash);
  if (comparison.unchanged.some((u) => u.oldId === id)) return "unchanged";
  if (comparison.changed.some((c) => c.oldId === id)) return "changed";
  if (comparison.removed.some((r) => r.id === id)) return "removed";
  return "unknown";
}

function splitLines(s: string): string[] {
  if (s === "") return [];
  return s.split("\n");
}

function linesEqual(a: string, b: string): boolean {
  if (a === b) return true;
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

export interface QuoteHit {
  /** 1-based start line of the quote in the new file. */
  startLine: number;
  /** Confidence 0..1 (quote + prefix/suffix context). */
  confidence: number;
}

/**
 * Search a quote with prefix/suffix context in new file lines.
 * Returns the best hit, or null when nothing passes the threshold.
 * Ambiguous ties (two positions, same confidence, same distance to the
 * expected line) return null so the caller marks the anchor outdated.
 */
export function searchQuote(
  quote: string,
  prefix: string,
  suffix: string,
  newLines: string[],
  expectedLine?: number,
): QuoteHit | null {
  const q = splitLines(quote);
  if (q.length === 0 || newLines.length === 0) return null;
  const pre = splitLines(prefix).slice(-3);
  const suf = splitLines(suffix).slice(0, 3);
  const total = q.length + pre.length + suf.length;

  let best: QuoteHit | null = null;
  let bestDist = Infinity;
  let tied = false;
  for (let start = 1; start + q.length - 1 <= newLines.length; start++) {
    let ok = true;
    for (let i = 0; i < q.length; i++) {
      if (!linesEqual(newLines[start - 1 + i] ?? "", q[i] ?? "")) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let matched = q.length;
    for (let i = 0; i < pre.length; i++) {
      const lineNo = start - pre.length + i;
      const actual = lineNo >= 1 && lineNo <= newLines.length ? newLines[lineNo - 1] : undefined;
      if (actual !== undefined && linesEqual(actual, pre[i] ?? "")) matched += 1;
    }
    for (let i = 0; i < suf.length; i++) {
      const lineNo = start + q.length + i;
      const actual = lineNo >= 1 && lineNo <= newLines.length ? newLines[lineNo - 1] : undefined;
      if (actual !== undefined && linesEqual(actual, suf[i] ?? "")) matched += 1;
    }
    const confidence = total === 0 ? 1 : matched / total;
    if (confidence < ANCHOR_CONFIDENCE_THRESHOLD) continue;
    const dist = expectedLine !== undefined ? Math.abs(start - expectedLine) : 0;
    if (best === null || confidence > best.confidence || (confidence === best.confidence && dist < bestDist)) {
      best = { startLine: start, confidence };
      bestDist = dist;
      tied = false;
    } else if (confidence === best.confidence && dist === bestDist) {
      tied = true;
    }
  }
  if (best && tied) return null;
  return best;
}

export interface RemapInput {
  comparison: HunkComparison;
  /** New file contents keyed by NEW fileKey (1-indexed lines arrays). */
  newContents: Map<string, string[]> | Record<string, string[]>;
  /** Version number to stamp on moved anchors. */
  newVersion: number;
  /**
   * #81: new file lines for `code:` anchors, keyed by repo-relative path
   * (the anchor's own path, rename-resolved by the caller). Absent key =
   * no content to decide by.
   */
  codeContents?: Map<string, string[] | null>;
  /** #81: head SHA `code:` anchors move to when re-found. */
  newHeadSha?: string;
}

function getLines(input: RemapInput, fileKey: string): string[] | undefined {
  if (input.newContents instanceof Map) return input.newContents.get(fileKey);
  return (input.newContents as Record<string, string[]>)[fileKey];
}

export interface RemapOutcome {
  remap: AnchorRemap;
  /** Replacement anchor when moved (host line updated, version bumped). */
  newAnchor?: Anchor;
  /** Best-guess location when outdated but the quote was found. */
  successor?: Anchor;
}

/**
 * Remap one anchor to the new version. Non-diff anchors (guide blocks,
 * description paragraphs) have no line position in the diff and are
 * returned as moved unchanged.
 */
export function remapAnchor(anchor: Anchor, input: RemapInput): RemapOutcome {
  if (anchor.host.kind === "code") {
    // #81 (PRD §8): find the quoted text again in the file at the new
    // commit; move the anchor when found, mark it outdated with the
    // original snippet when not — the same rule as diff code.
    const host = anchor.host;
    const lines = input.codeContents?.get(host.path);
    if (!lines) {
      return { remap: { status: "outdated", reason: "file removed" } };
    }
    const hit = searchQuote(anchor.quotedText, anchor.prefix, anchor.suffix, lines, host.line);
    if (!hit) {
      return { remap: { status: "outdated", reason: "quote not found" } };
    }
    const quoteLines = Math.max(1, anchor.quotedText.split("\n").length);
    const newAnchor: Anchor = {
      ...anchor,
      host: {
        kind: "code",
        path: host.path,
        commit: input.newHeadSha ?? host.commit,
        line: hit.startLine,
        ...(host.endLine !== undefined ? { endLine: hit.startLine + quoteLines - 1 } : {}),
      },
      position: hit.startLine,
      version: input.newVersion,
    };
    return {
      remap: { status: "moved", newLine: hit.startLine, lineShift: hit.startLine - host.line },
      newAnchor,
    };
  }
  if (anchor.host.kind !== "diff-line") {
    return { remap: { status: "moved", newLine: anchor.position, lineShift: 0 } };
  }
  const oldFileKey = anchor.host.fileKey;
  const oldLine = anchor.host.line;
  const status = oldHunkStatus(oldFileKey, anchor.hunkHash, input.comparison);

  // Fast path: exact hash hit on an unchanged hunk → shift with the hunk.
  if (status === "unchanged" && anchor.hunkHash) {
    const id = oldHunkId(oldFileKey, anchor.hunkHash);
    const hit = input.comparison.unchanged.find((u) => u.oldId === id);
    if (hit) {
      const newLine = oldLine + hit.lineShift;
      const newAnchor: Anchor = {
        ...anchor,
        host: { kind: "diff-line", fileKey: hit.newHunk.fileKey, line: newLine },
        position: newLine,
        version: input.newVersion,
        ...(hit.newHunk.contentHash ? { hunkHash: hit.newHunk.contentHash } : {}),
      };
      return { remap: { status: "moved", newLine, lineShift: hit.lineShift, newHunkHash: hit.newHunk.contentHash }, newAnchor };
    }
  }

  // Resolve the new file (rename-aware) and search the quote there.
  const mappedKey = newFileKeyForOld(oldFileKey, input.comparison);
  // When the file has no surviving hunks it may still exist (all hunks
  // rewritten) — fall back to the old key so quote search still tries the
  // same path's new content when the caller keyed it that way.
  const candidateKeys = mappedKey ? [mappedKey] : [oldFileKey];
  // Estimate the expected line from unchanged hunks in the same file so
  // duplicate text resolves to the nearest occurrence.
  let expected: number | undefined;
  const shifts = input.comparison.unchanged
    .filter((u) => u.oldHunk.fileKey === oldFileKey)
    .map((u) => u.lineShift);
  if (shifts.length > 0) {
    const sorted = [...shifts].sort((a, b) => a - b);
    expected = oldLine + sorted[Math.floor(sorted.length / 2)];
  }

  for (const key of candidateKeys) {
    const lines = getLines(input, key);
    if (!lines) continue;
    const hit = searchQuote(anchor.quotedText, anchor.prefix, anchor.suffix, lines, expected);
    if (!hit) continue;
    const newHunkHash = hunkHashAtLine(key, hit.startLine, input.comparison);
    if (status === "changed" || status === "removed") {
      // PRD §8 table: changed → outdated, keeping the snippet + a link.
      const successor: Anchor = {
        ...anchor,
        host: { kind: "diff-line", fileKey: key, line: hit.startLine },
        position: hit.startLine,
        version: input.newVersion,
        ...(newHunkHash ? { hunkHash: newHunkHash } : {}),
      };
      return {
        remap: { status: "outdated", reason: status === "changed" ? "code changed since" : "hunk removed" },
        successor,
      };
    }
    const shift = hit.startLine - oldLine;
    const newAnchor: Anchor = {
      ...anchor,
      host: { kind: "diff-line", fileKey: key, line: hit.startLine },
      position: hit.startLine,
      version: input.newVersion,
      ...(newHunkHash ? { hunkHash: newHunkHash } : {}),
    };
    return { remap: { status: "moved", newLine: hit.startLine, lineShift: shift, ...(newHunkHash ? { newHunkHash } : {}) }, newAnchor };
  }

  // No confident hit (or no new content): outdated, or moved for unknown
  // non-diff cases already handled above.
  if (status === "unchanged" && anchor.hunkHash) {
    // Hash said unchanged but the file content is missing — keep the old
    // line rather than flapping to outdated.
    return { remap: { status: "moved", newLine: oldLine, lineShift: 0 } };
  }
  const reason =
    status === "removed"
      ? "hunk removed"
      : mappedKey === undefined
        ? "file removed"
        : "quote not found";
  return { remap: { status: "outdated", reason } };
}

/** New-side hunk hash containing a line, via the comparison's new refs. */
function hunkHashAtLine(newFileKey: string, line: number, comparison: HunkComparison): string | undefined {
  const all = [
    ...comparison.unchanged.map((u) => u.newHunk),
    ...comparison.changed.map((c) => c.newHunk),
    ...comparison.added.map((a) => a.hunk),
  ];
  for (const h of all) {
    if (h.fileKey === newFileKey && line >= h.newStart && line <= h.newEnd) return h.contentHash;
  }
  return undefined;
}
