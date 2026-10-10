/**
 * Hunk-by-hunk version comparison (PRD §8).
 *
 * Compares the old diff (old merge-base..old head) with the new one using
 * content hashes, so a rebase without conflicts comes out as "no change".
 * Pure functions over `ReviewFile` snapshots — no git, no store.
 *
 * - Unchanged: same content hash (line shifts and renames allowed).
 * - Changed: best old→new match by file + similarity (Jaccard over
 *   normalised rows) above threshold.
 * - Removed / new: no counterpart.
 * - Renames: new file whose `oldPath` matches an old file's `path`.
 */
import type { ReviewFile } from "@unvibe/shared";
import type {
  ChangedHunkPair,
  FileRename,
  SoloHunk,
  UnchangedHunk,
  VersionComparison,
  VersionHunkRef,
} from "@unvibe/shared";

export const CHANGED_SIMILARITY_THRESHOLD = 0.35;
export const CROSS_FILE_SIMILARITY_THRESHOLD = 0.8;

export function hunkId(fileKey: string, contentHash: string): string {
  return `h:${fileKey}:${contentHash}`;
}

function toRef(file: ReviewFile, hunk: ReviewFile["hunks"][number]): VersionHunkRef {
  return {
    fileKey: file.fileKey,
    path: file.path,
    contentHash: hunk.contentHash,
    newStart: hunk.newStart,
    newEnd: hunk.newEnd,
    oldStart: hunk.oldStart,
    oldEnd: hunk.oldEnd,
  };
}

/** Normalised row key (mirrors `hash.ts`: kind + whitespace-stripped text). */
export function normalisedRow(kind: string, text: string): string {
  return `${kind}:${text.replace(/\s+/g, "")}`;
}

function rowKeys(hunk: ReviewFile["hunks"][number]): string[] {
  return hunk.lines.map((l) => normalisedRow(l.kind, l.text));
}

/**
 * Content similarity 0..1: multiset Jaccard over normalised rows.
 * 1 = identical, 0 = disjoint. Pure and deterministic.
 */
export function hunkSimilarity(
  a: ReviewFile["hunks"][number],
  b: ReviewFile["hunks"][number],
): number {
  const ka = rowKeys(a);
  const kb = rowKeys(b);
  if (ka.length === 0 && kb.length === 0) return 1;
  if (ka.length === 0 || kb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const k of ka) counts.set(k, (counts.get(k) ?? 0) + 1);
  let inter = 0;
  const bCounts = new Map<string, number>();
  for (const k of kb) bCounts.set(k, (bCounts.get(k) ?? 0) + 1);
  for (const [k, cb] of bCounts) {
    const ca = counts.get(k) ?? 0;
    inter += Math.min(ca, cb);
  }
  let union = 0;
  const all = new Set([...counts.keys(), ...bCounts.keys()]);
  for (const k of all) union += Math.max(counts.get(k) ?? 0, bCounts.get(k) ?? 0);
  return union === 0 ? 1 : inter / union;
}

export interface HunkEntry {
  file: ReviewFile;
  hunk: ReviewFile["hunks"][number];
  ref: VersionHunkRef;
  id: string;
}

function entries(files: ReviewFile[]): HunkEntry[] {
  const out: HunkEntry[] = [];
  for (const f of files) {
    for (const h of f.hunks) {
      out.push({ file: f, hunk: h, ref: toRef(f, h), id: hunkId(f.fileKey, h.contentHash) });
    }
  }
  return out;
}

/** Detect per-file renames: new file with `oldPath` matching an old path. */
export function detectRenames(oldFiles: ReviewFile[], newFiles: ReviewFile[]): FileRename[] {
  const oldByPath = new Map(oldFiles.map((f) => [f.path, f]));
  const out: FileRename[] = [];
  for (const nf of newFiles) {
    if (nf.oldPath && oldByPath.has(nf.oldPath) && nf.oldPath !== nf.path) {
      out.push({ oldPath: nf.oldPath, newPath: nf.path, fileKey: nf.fileKey });
    }
  }
  return out;
}

/** True when two files are the "same" across versions (same path or rename). */
function sameFile(oldFile: ReviewFile, newFile: ReviewFile, renames: FileRename[]): boolean {
  if (oldFile.path === newFile.path) return true;
  return renames.some((r) => r.oldPath === oldFile.path && r.newPath === newFile.path);
}

export interface HunkComparison {
  unchanged: UnchangedHunk[];
  changed: ChangedHunkPair[];
  removed: SoloHunk[];
  added: SoloHunk[];
  renames: FileRename[];
}

/** Core hunk matching (no SHAs / range-diff; see `compareVersions`). */
export function compareHunks(oldFiles: ReviewFile[], newFiles: ReviewFile[]): HunkComparison {
  const renames = detectRenames(oldFiles, newFiles);
  const oldEntries = entries(oldFiles);
  const newEntries = entries(newFiles);

  const matchedOld = new Set<number>();
  const matchedNew = new Set<number>();
  const unchanged: UnchangedHunk[] = [];
  const changed: ChangedHunkPair[] = [];

  // Phase 1: exact content-hash matches. Prefer same-file pairs so duplicate
  // hashes (identical hunks in several files) map to the right file.
  const oldByHash = new Map<string, number[]>();
  oldEntries.forEach((e, i) => {
    const l = oldByHash.get(e.hunk.contentHash) ?? [];
    l.push(i);
    oldByHash.set(e.hunk.contentHash, l);
  });
  const newByHash = new Map<string, number[]>();
  newEntries.forEach((e, i) => {
    const l = newByHash.get(e.hunk.contentHash) ?? [];
    l.push(i);
    newByHash.set(e.hunk.contentHash, l);
  });
  for (const [hash, olds] of oldByHash) {
    const news = newByHash.get(hash);
    if (!news) continue;
    const freeOlds = olds.filter((i) => !matchedOld.has(i));
    const freeNews = news.filter((i) => !matchedNew.has(i));
    if (freeOlds.length === 0 || freeNews.length === 0) continue;
    // Greedy: same-file first, then renamed-file, then any.
    const pairs: Array<[number, number, number]> = [];
    for (const oi of freeOlds) {
      for (const ni of freeNews) {
        const o = oldEntries[oi];
        const n = newEntries[ni];
        let score = 0;
        if (o.file.path === n.file.path) score = 2;
        else if (sameFile(o.file, n.file, renames)) score = 1;
        pairs.push([score, oi, ni]);
      }
    }
    pairs.sort((a, b) => b[0] - a[0]);
    const usedO = new Set<number>();
    const usedN = new Set<number>();
    for (const [, oi, ni] of pairs) {
      if (usedO.has(oi) || usedN.has(ni)) continue;
      // Only take as many pairs as the overlap allows.
      usedO.add(oi);
      usedN.add(ni);
      matchedOld.add(oi);
      matchedNew.add(ni);
      const o = oldEntries[oi];
      const n = newEntries[ni];
      const renamed = o.file.path !== n.file.path;
      unchanged.push({
        oldId: o.id,
        newId: n.id,
        oldHunk: o.ref,
        newHunk: n.ref,
        lineShift: n.ref.newStart - o.ref.newStart,
        renamed,
      });
      if (usedO.size >= Math.min(freeOlds.length, freeNews.length)) break;
    }
  }

  // Phase 2: changed-hunk matching by file + similarity. All candidate
  // pairs scored, greedy highest-first.
  const freeOldIdx = oldEntries.map((_, i) => i).filter((i) => !matchedOld.has(i));
  const freeNewIdx = newEntries.map((_, i) => i).filter((i) => !matchedNew.has(i));
  interface Candidate {
    sim: number;
    oi: number;
    ni: number;
    crossFile: boolean;
  }
  const candidates: Candidate[] = [];
  for (const oi of freeOldIdx) {
    for (const ni of freeNewIdx) {
      const o = oldEntries[oi];
      const n = newEntries[ni];
      const same = sameFile(o.file, n.file, renames);
      const sim = hunkSimilarity(o.hunk, n.hunk);
      const threshold = same ? CHANGED_SIMILARITY_THRESHOLD : CROSS_FILE_SIMILARITY_THRESHOLD;
      if (sim >= threshold) {
        candidates.push({ sim, oi, ni, crossFile: !same });
      }
    }
  }
  // Same-file pairs win over cross-file at equal similarity.
  candidates.sort((a, b) => {
    if (a.crossFile !== b.crossFile) return a.crossFile ? 1 : -1;
    return b.sim - a.sim;
  });
  for (const c of candidates) {
    if (matchedOld.has(c.oi) || matchedNew.has(c.ni)) continue;
    matchedOld.add(c.oi);
    matchedNew.add(c.ni);
    const o = oldEntries[c.oi];
    const n = newEntries[c.ni];
    changed.push({
      oldId: o.id,
      newId: n.id,
      oldHunk: o.ref,
      newHunk: n.ref,
      similarity: c.sim,
      lineShift: n.ref.newStart - o.ref.newStart,
    });
  }

  const removed: SoloHunk[] = [];
  const added: SoloHunk[] = [];
  oldEntries.forEach((e, i) => {
    if (!matchedOld.has(i)) removed.push({ id: e.id, hunk: e.ref });
  });
  newEntries.forEach((e, i) => {
    if (!matchedNew.has(i)) added.push({ id: e.id, hunk: e.ref });
  });

  // Stable output order for deterministic prompts / tests.
  const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  unchanged.sort((a, b) => (a.oldId < b.oldId ? -1 : a.oldId > b.oldId ? 1 : 0));
  changed.sort((a, b) => (a.oldId < b.oldId ? -1 : a.oldId > b.oldId ? 1 : 0));
  removed.sort(byId);
  added.sort(byId);

  return { unchanged, changed, removed, added, renames };
}

/**
 * Full comparison wrapper that attaches version/SHA metadata and the
 * display-only `git range-diff` text.
 */
export function compareVersions(opts: {
  oldFiles: ReviewFile[];
  newFiles: ReviewFile[];
  oldVersion: number;
  newVersion: number;
  oldHeadSha: string;
  newHeadSha: string;
  rangeDiff?: string;
}): VersionComparison {
  const c = compareHunks(opts.oldFiles, opts.newFiles);
  return {
    oldVersion: opts.oldVersion,
    newVersion: opts.newVersion,
    oldHeadSha: opts.oldHeadSha,
    newHeadSha: opts.newHeadSha,
    unchanged: c.unchanged,
    changed: c.changed,
    removed: c.removed,
    added: c.added,
    renames: c.renames,
    rangeDiff: opts.rangeDiff ?? "",
  };
}
