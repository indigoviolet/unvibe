/**
 * Context-builder inputs (PRD §9).
 *
 * Pure functions over these inputs: no store, no git, no agents. The
 * ingest + review-state agents own diff parsing and persistence; they hand
 * the builder this narrow snapshot. Where the shared `ReviewSnapshot`
 * (§14.1) lacks rendered text (hunk line content, description markdown,
 * guide prose), it travels here instead, so the supervisor can wire the
 * two together without the builder importing state modules.
 */
import type { Contribution, FileCategory, LogEntry } from "@unvibe/shared";
import type { DescriptionParagraph } from "../ingest/description.js";

/** One diff line's content, without its `+`/`-`/` ` prefix. */
export interface ContextDiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

/** A hunk with the line content the builder renders inline. */
export interface ContextHunk {
  contentHash: string;
  fileKey: string;
  /** Raw `@@ … @@` header line. */
  header: string;
  /** Trailing context, e.g. the enclosing function name. */
  context?: string;
  newStart: number;
  oldStart: number;
  lines: ContextDiffLine[];
  /** Why "Hide uninteresting" hid this hunk, if it did. */
  hiddenReason?: string;
  /** Hunk-pass one-liner, when known. */
  summary?: string;
  /** True when the guide cites this hunk (never hidden, always inlined). */
  citedByGuide?: boolean;
}

export interface ContextFile {
  fileKey: string;
  path: string;
  category: FileCategory;
  hunks: ContextHunk[];
}

/** A reader-pinned excerpt, rendered in L1b with a `code:` ID. */
export interface PinnedExcerpt {
  path: string;
  start: number;
  end: number;
  sha: string;
  language?: string;
  text: string;
}

/** One existing GitHub review comment, as the agents see it (issue #168). */
export interface ExistingCommentInput {
  id: number;
  path?: string;
  line?: number;
  author?: string;
  /** Plain-text body (the rendered HTML stays in the UI). */
  body: string;
}

/** One guide card's standard-depth prose, already rendered to Markdown. */
export interface GuideCardInput {
  id: string;
  title: string | null;
  level: string;
  revision: number;
  markdown: string;
}

/** One agent finding page, already rendered to Markdown. */
export interface FindingInput {
  pageId: string;
  title: string;
  confidence: string;
  summary: string;
  markdown: string;
}

export interface ConceptIndexEntry {
  slug: string;
  title: string;
  oneLine: string;
}

/**
 * Everything the context builder needs for one review. `version` and
 * `guideRevision` plus the target `model` key the base pack (§9.2).
 */
export interface PromptReviewSnapshot {
  reviewId: string;
  title: string;
  /** `owner/name`. */
  repo: string;
  branch: string;
  prNumber?: number;
  version: number;
  headSha: string;
  baseRef: string;
  /** Opaque revision of the generated guide; bumped on regeneration. */
  guideRevision: string;
  /** Model this base is built for (caches are per model, §9.1). */
  model: string;
  sourceKind: "pr" | "branch";
  /** PR description Markdown (branch reviews: undefined). */
  description?: string;
  /**
   * PR description paragraphs with the stable citation IDs ingest assigned
   * (issue #110), parsed from the stored HTML with `parseDescriptionParagraphs`
   * (issue #96) by `toPromptSnapshot` — the same function the MCP tools, the
   * citation validator and second-opinion excerpts read, so the IDs in the
   * base are exactly the ones those resolve. Absent when there is no
   * ID-carrying description (branch reviews, pre-ID stored HTML): the source
   * blurb then falls back to `description`.
   */
  descriptionParagraphs?: DescriptionParagraph[];
  /** Branch-only reviews: commit messages, read-only. */
  commitLog?: string;
  files: ContextFile[];
  pinnedCode: PinnedExcerpt[];
  cards: GuideCardInput[];
  findings: FindingInput[];
  concepts: ConceptIndexEntry[];
  /** Existing GitHub review comments, oldest first (issue #168). */
  existingComments: ExistingCommentInput[];
  /** Append-only log, ascending seq (PRD §9.3). */
  log: LogEntry[];
  /**
   * Current contributions: the consolidate input, rendered with the same
   * formatter the real call uses (issue #80). Absent on snapshots built
   * before contributions were projected here.
   */
  contributions?: Contribution[];
}

/** Per-session cursor into the log (PRD §9.3). */
export interface SessionCursor {
  sessionId: string;
  /** Last log seq this session has seen. */
  lastSeenSeq: number;
  /** Card this session is anchored on, if any. */
  cardId?: string;
  /** Hunk content hash this session is anchored on, if any. */
  hunkHash?: string;
}
