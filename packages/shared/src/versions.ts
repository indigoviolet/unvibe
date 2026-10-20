/**
 * Versions milestone (PRD §8) — additive contract.
 *
 * Pure types for hunk-by-hunk comparison, anchor remapping, review-level
 * staleness, and the update pass. Nothing here changes existing types;
 * `entities.ts` / `api.ts` gain optional fields that reference these.
 */

/** Pointer to one hunk in one version's diff. */
export interface VersionHunkRef {
  fileKey: string;
  path: string;
  contentHash: string;
  newStart: number;
  newEnd: number;
  oldStart: number;
  oldEnd: number;
}

/** An unchanged hunk: same content hash, possibly shifted lines / renamed file. */
export interface UnchangedHunk {
  oldId: string;
  newId: string;
  oldHunk: VersionHunkRef;
  newHunk: VersionHunkRef;
  /** newStart - oldStart on the new side. */
  lineShift: number;
  /** True when the file was renamed between versions. */
  renamed: boolean;
}

/** A changed hunk: best old→new match by file + similarity. */
export interface ChangedHunkPair {
  oldId: string;
  newId: string;
  oldHunk: VersionHunkRef;
  newHunk: VersionHunkRef;
  /** 0..1 content similarity (line-set Jaccard over stripped text). */
  similarity: number;
  lineShift: number;
}

/** A hunk with no counterpart in the other version. */
export interface SoloHunk {
  id: string;
  hunk: VersionHunkRef;
}

export interface FileRename {
  oldPath: string;
  newPath: string;
  fileKey: string;
}

/**
 * Structured comparison of old diff (old merge-base..old head) vs new diff
 * (new merge-base..new head), hunk by hunk using content hashes.
 * A rebase without conflicts comes out as all `unchanged`.
 */
export interface VersionComparison {
  oldVersion: number;
  newVersion: number;
  oldHeadSha: string;
  newHeadSha: string;
  unchanged: UnchangedHunk[];
  changed: ChangedHunkPair[];
  removed: SoloHunk[];
  added: SoloHunk[];
  renames: FileRename[];
  /** Raw `git range-diff` output for display (may be empty when git fails). */
  rangeDiff: string;
}

export type VersionComparisonSummary = Pick<
  VersionComparison,
  "oldVersion" | "newVersion" | "oldHeadSha" | "newHeadSha" | "renames" | "rangeDiff"
> & {
  unchangedHunks: number;
  changedHunks: number;
  newHunks: number;
  removedHunks: number;
  /** `h:` IDs of changed hunks (old side) for stale marking. */
  changedOldIds: string[];
  /** `h:` IDs of changed hunks (new side). */
  changedNewIds: string[];
};

export function summarizeComparison(c: VersionComparison): VersionComparisonSummary {
  return {
    oldVersion: c.oldVersion,
    newVersion: c.newVersion,
    oldHeadSha: c.oldHeadSha,
    newHeadSha: c.newHeadSha,
    renames: c.renames,
    rangeDiff: c.rangeDiff,
    unchangedHunks: c.unchanged.length,
    changedHunks: c.changed.length,
    newHunks: c.added.length,
    removedHunks: c.removed.length,
    changedOldIds: c.changed.map((p) => p.oldId),
    changedNewIds: c.changed.map((p) => p.newId),
  };
}

/** Review-level staleness for the "New commits · Update" banner + start page. */
export interface VersionStatus {
  /** True when the current version has unprocessed changes (update not yet run). */
  stale: boolean;
  fromVersion: number;
  toVersion: number;
  unchangedHunks: number;
  changedHunks: number;
  newHunks: number;
  removedHunks: number;
  renamedFiles: FileRename[];
  /** Old-side `h:` IDs whose content changed (for card staleness). */
  changedOldIds: string[];
  /** New-side `h:` IDs (for the update-pass prompt). */
  changedNewIds: string[];
  /** `git range-diff` output for display. */
  rangeDiff: string;
  /** Epoch ms when the new version was fetched. */
  fetchedAt: number;
  /** #179: the new version's diff is empty (no hunks to review). */
  empty?: boolean;
}

/** Reader-pinned excerpt stored in the snapshot (PRD §8 "Pinned code"). */
export interface PinnedCode {
  path: string;
  start: number;
  end: number;
  sha: string;
  text: string;
  language?: string;
  /** Set when the excerpt could not be found again by content. */
  needsRepining?: boolean;
  /** Remapped location when found again (new sha + lines). */
  remappedSha?: string;
  remappedStart?: number;
  remappedEnd?: number;
}

/** Anchor remap outcome (PRD §8 "every anchor is tied to content"). */
export type AnchorRemap =
  | { status: "moved"; newLine: number; lineShift: number; newHunkHash?: string }
  | { status: "outdated"; reason: string };

/** Finding recheck verdict produced by the update pass. */
export type FindingVerdict = "still-applies" | "resolved" | "changed";

/** One revised card from the update pass (new revision, same IDs). */
export interface RevisedCard {
  cardId: string;
  /** Full replacement blocks (IDs preserved by the agent per the prompt). */
  blocks: import("./entities.js").Block[];
  revision: number;
}

/** One rechecked finding from the update pass. */
export interface RecheckedFinding {
  pageId: string;
  verdict: FindingVerdict;
  evidence?: string;
  newSummary?: string;
}

/** One new finding for new code from the update pass. */
export interface NewFinding {
  pageId: string;
  title: string;
  confidence: string;
  summary: string;
  cards: import("./entities.js").Card[];
}

/** Structured result of the update pass, applied to review state. */
export interface UpdatePassResult {
  revisedCards: RevisedCard[];
  recheckedFindings: RecheckedFinding[];
  newFindings: NewFinding[];
  /** contentHash → regenerated one-line summary for changed hunks. */
  hunkSummaries: Record<string, string>;
  /** Old pins that no longer apply (paths the agent dropped). */
  droppedPins?: string[];
}

/**
 * Narrow reply parser interface (PRD §10 trailing JSON block).
 *
 * When `packages/shared/src/content` exists in the tree it should be used;
 * otherwise the service depends on this interface and tests inject a fake.
 * The default implementation below parses the trailing fenced JSON block.
 */
export interface UpdateReplyParser {
  parseReply(text: string): UpdatePassResult;
}
