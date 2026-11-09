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

/**
 * Issue #367: the one shared update-availability predicate. The service
 * (`enqueueUpdatePass`) refuses an update when this is false, so the web
 * UI must not offer one either — card banners and the diff banner both
 * read this, never a local `stale` flag alone. An update pass clears
 * review-level staleness (option A also clears every card), so after a
 * pass this is false until the next refresh marks new changes.
 */
export function isUpdateAvailable(status: VersionStatus | undefined | null): boolean {
  return status?.stale === true;
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
/**
 * Issue #351: one feedback item the delta answers, as the agent writes
 * it — a pointer. The service resolves it against the snapshot
 * (existing comments, threads, PR conversation, commits) into a
 * `SinceFeedbackLink` and drops unknown ids.
 */
export interface SinceFeedbackRef {
  kind: "comment" | "thread" | "conversation" | "commit";
  /** ExistingComment id, Thread id, PrConversationRemark id, or commit sha. */
  id: string;
}

/**
 * Issue #351: a resolved feedback link rendered under a Since-B card or
 * addendum ("Answers: <excerpt> ↗"). Remote remarks link to GitHub via
 * their stored URL; local threads link to the thread on the page;
 * commits render as text (no stable URL).
 */
export interface SinceFeedbackLink {
  kind: SinceFeedbackRef["kind"];
  /** `@user on path:line`, `Thread t-1`, `PR conversation`, `abc1234 subject`. */
  label: string;
  excerpt: string;
  url?: string;
}

export interface UpdatePassResult {
  revisedCards: RevisedCard[];
  recheckedFindings: RecheckedFinding[];
  newFindings: NewFinding[];
  /** contentHash → regenerated one-line summary for changed hunks. */
  hunkSummaries: Record<string, string>;
  /** Old pins that no longer apply (paths the agent dropped). */
  droppedPins?: string[];
  /**
   * Issue #351 step 1: the baseline this pass explained. Defaults to the
   * version last opened; step 2 adds a commit kind alongside `version`.
   */
  baseline?: SinceBaseline;
  /**
   * Issue #351 step 1: new-side `h:` IDs changed or added since the
   * baseline, by hunk-content comparison (rebase-proof, PRD §8). Drives
   * the Since-B diff filter and the plotline `+N since B` markers.
   */
  sinceHunks?: SinceHunks;
  /**
   * Issue #351 step 1: new guide cards for the dated Since-B section.
   * Fresh card IDs; the service appends the section, never rewrites it.
   */
  sinceSection?: { cards: import("./entities.js").Card[] };
  /**
   * Issue #351 step 1: dated blocks appended to existing cards, leaving
   * the old text unchanged. The service stamps id/version/baseline/at.
   */
  addenda?: CardAddendumDraft[];
  /**
   * Issue #367 option A: stale card IDs the pass judged unaffected —
   * checked, but needing neither revision, recheck nor addendum. In the
   * same single reply, no extra agent call. A stale card in none of
   * revised/rechecked/addenda/unaffected was missed by the pass: it is
   * still cleared (the pass saw the whole delta) and logged, hunks keep
   * their own marks.
   */
  unaffectedCards?: string[];
  /**
   * Issue #351 step 1: new-side contentHash → plotline id for hunks
   * since the baseline. Genuinely new threads arrive as `newPlotlines`.
   */
  plotlineAssignments?: Record<string, string>;
  /**
   * Issue #351 step 1: genuinely new threads of work. The service marks
   * each `newSinceBaseline` so the row reads "new since B".
   */
  newPlotlines?: import("./scores.js").Plotline[];
}

/**
 * Issue #351: baseline B of "focus since B". Either an earlier stored
 * version (the version last opened, or any earlier version picked by
 * hand) or any commit sha (a PR commit from ingest, or the `commit_id`
 * of the reviewer's own latest GitHub review — the no-review-yet path).
 * "Since" is always hunk-content comparison against the head diff, never
 * git ancestry, so a rebased or force-pushed B works the same.
 */
export type SinceBaseline =
  | {
      kind: "version";
      version: number;
    }
  | {
      kind: "commit";
      sha: string;
    };

/** Full-length hex commit sha (40 chars) or an unambiguous short form. Pure. */
export function isCommitSha(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{4,64}$/i.test(v);
}

/** True when the value is a stored since-baseline. Pure. */
export function isSinceBaseline(v: unknown): v is SinceBaseline {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o["kind"] === "version") {
    return Number.isSafeInteger(o["version"]) && (o["version"] as number) >= 1;
  }
  if (o["kind"] === "commit") {
    return isCommitSha(o["sha"]);
  }
  return false;
}

/** Short display sha for a commit baseline (8 hex chars, like version labels). Pure. */
export function shortBaselineSha(sha: string): string {
  return sha.slice(0, 8);
}

/**
 * Issue #351 step 2: the baseline's display label — the real version
 * (`v1`) or the real short sha (`abc12345`). Never the letter "B".
 * Pure.
 */
export function sinceBaselineLabel(b: SinceBaseline): string {
  return b.kind === "version" ? `v${b.version}` : shortBaselineSha(b.sha);
}

/**
 * Issue #351: new-side `h:<fileKey>:<hash>` IDs changed or added since
 * the baseline, computed by hunk-content comparison between the stored
 * version diffs (never git ancestry, so rebases work).
 */
export interface SinceHunks {
  added: string[];
  changed: string[];
}

/** Empty since-hunks (no delta). Pure. */
export function emptySinceHunks(): SinceHunks {
  return { added: [], changed: [] };
}

/** Both sides as one lookup set. Pure. */
export function sinceHunkSet(s: SinceHunks | undefined): Set<string> {
  if (!s) return new Set();
  return new Set([...s.added, ...s.changed]);
}

/** True when a new-side `h:` ID changed or was added since B. Pure. */
export function hunkChangedSinceB(hunkId: string, s: SinceHunks | undefined): boolean {
  if (!s) return false;
  return s.added.includes(hunkId) || s.changed.includes(hunkId);
}

/**
 * Issue #351: the dated, collapsible Since-B section at the top of the
 * guide. Written once per update pass (replaced on the next pass) —
 * never revised in place.
 */
export interface SinceSection {
  /** Baseline B this section explains (version or commit). */
  baseline: SinceBaseline;
  /** Head version at the time of the pass that wrote it. */
  headVersion: number;
  /** Epoch ms the pass wrote it. */
  at: number;
  /** Cards explaining what changed, why, and what feedback caused it. */
  cards: import("./entities.js").Card[];
}

/**
 * Issue #351: one appended addendum as the agent writes it — the target
 * card plus the new blocks. The service stamps id/version/baseline/at.
 */
export interface CardAddendumDraft {
  cardId: string;
  blocks: import("./entities.js").Block[];
  /** Feedback pointers (resolved by the service, unknown ids dropped). */
  answers?: SinceFeedbackRef[];
}

/**
 * Issue #351: a dated addendum block appended to an existing card when a
 * change since B affects it. The card's old blocks stay unchanged.
 */
export interface CardAddendum {
  /** Stable id: `add-v<toVersion>-<index>` within the card. */
  id: string;
  /** Head version whose update pass wrote this addendum. */
  version: number;
  /** Baseline B it is relative to (version or commit). */
  baseline: SinceBaseline;
  /** Epoch ms the update pass wrote it. */
  at: number;
  blocks: import("./entities.js").Block[];
  /** Resolved feedback links (unknown ids dropped at apply time). */
  answers?: SinceFeedbackLink[];
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
