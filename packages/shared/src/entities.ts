/**
 * Unvibe data model (PRD §7.1).
 *
 * Pure TypeScript: no Node or DOM APIs. Service persists these (SQLite +
 * per-review folders); web renders them. Nested shapes are stored as JSON
 * columns where noted in the service's migration 001.
 */

/** A local checkout / GitHub repo the user can open reviews from. */
export interface Repo {
  id: string;
  owner: string;
  name: string;
  /** Absolute local path of the checkout. */
  localPath: string;
  /** Epoch ms of last open. */
  lastOpened: number;
}

/** One review of a branch or PR. */
export interface Review {
  id: string;
  repoId: string;
  branch: string;
  /** PR number, absent for branch-only reviews. */
  prNumber?: number;
  versions: Version[];
  currentVersion: number;
  createdAt: number;
}

/** One fetched state of the branch. */
export interface Version {
  n: number;
  headSha: string;
  mergeBaseSha: string;
  baseRef: string;
  fetchedAt: number;
  /**
   * Mapping of old IDs → new IDs carried from the previous version
   * (anchors remapped by content match, PRD §8).
   */
  idMapping: Record<string, string>;
}

export type FileCategory = "source" | "tests" | "docs" | "config" | "generated";

/** A changed file in a version's diff. */
export interface ReviewFile {
  /** Stable key within the review (e.g. short path slug). */
  fileKey: string;
  path: string;
  category: FileCategory;
  hunks: Hunk[];
}

/** One hunk: git's own run of changed lines + ≤3 context lines (PRD §4.13). */
export interface Hunk {
  /** Stable content hash: ignores line numbers and whitespace (PRD §8). */
  contentHash: string;
  /** Raw `@@ … @@` header line. */
  header: string;
  /** Trailing context, e.g. function name. */
  context?: string;
  newStart: number;
  newEnd: number;
  oldStart: number;
  oldEnd: number;
  added: number;
  removed: number;
  /** Why "Hide uninteresting" hid this hunk, if it did. */
  hiddenReason?: string;
}

/** Per-hunk UI + agent state, keyed by content hash so it survives versions. */
export interface HunkState {
  contentHash: string;
  folded: boolean;
  reviewed: boolean;
  summary?: string;
  note?: string;
}

export type PageKind = "root" | "concept" | "finding" | "opened-expansion";

/** A guide page: root, concept, finding, or opened expansion. */
export interface Page {
  id: string;
  kind: PageKind;
  title: string;
  /**
   * Bookmark state. Absent means "default": concept pages default to saved,
   * PR-specific pages to unsaved (prototype `isSaved`).
   */
  saved?: boolean;
  /** Parent page id for the breadcrumb trail; absent on root. */
  parent?: string;
  /** Finding-only: confidence label shown as "Agent finding · <confidence>". */
  confidence?: string;
  /** Finding-only: one-line summary shown on the finding-ref card. */
  summary?: string;
  cards: Card[];
}

export type DepthLevel = "simple" | "standard" | "deep";

/** One card on a page. IDs stay stable across revisions (PRD §7.2). */
export interface Card {
  id: string;
  pageId: string;
  /** Null for untitled cards (collapsed view shows first line). */
  title: string | null;
  level: DepthLevel;
  read: boolean;
  collapsed: boolean;
  /** Bumped on every accepted rewrite; references always mean latest. */
  revision: number;
  blocks: Block[];
  /** Undo stack of block snapshots (depth/examples/diagram changes). */
  undoStack: CardSnapshot[];
  /** Placeholder ("Go deeper") cards that still need generation. */
  pending?: PendingCard;
}

/** A single undo entry: block list + depth level. No redo (PRD §4.4). */
export interface CardSnapshot {
  blocks: Block[];
  level: DepthLevel;
}

export interface PendingCard {
  label: string;
  why: string;
  /**
   * Mock/seed only: key into the "Go deeper" generated-content table
   * (the prototype's `GEN`), used by mock mode to fill the card.
   * The service resolves generation through jobs instead.
   */
  genKey?: string;
  /** Progress lines shown while the card generates (prototype `status`). */
  statusSteps?: string[];
}

export type BlockType =
  | "paragraph"
  | "list"
  | "table"
  | "code"
  | "diagram"
  | "finding-link"
  | "comment-link"
  | "follow-up"
  | "aside"
  | "html";

/** Text variants per depth level (PRD §4.4). Standard is the stored default. */
export interface DepthText {
  simple?: string;
  standard: string;
  deep?: string;
}

export interface ParagraphBlock {
  type: "paragraph";
  id: string;
  text: DepthText;
  citations: Citation[];
}

export interface ListItem {
  /** HTML/Markdown inline content of the item. */
  html: string;
  /** Per-item citations (prototype renders markers per list item). */
  citations: Citation[];
}

export interface ListBlock {
  type: "list";
  id: string;
  ordered: boolean;
  items: ListItem[];
  /** Block-level citations in addition to per-item ones. */
  citations: Citation[];
}

export interface TableBlock {
  type: "table";
  id: string;
  /** Raw HTML table (prototype renders `<table>` markup). */
  html: string;
  citations: Citation[];
}

export interface CodeBlock {
  type: "code";
  id: string;
  language?: string;
  code: string;
  citations: Citation[];
}

export interface DiagramBlock {
  type: "diagram";
  id: string;
  /** Mermaid source (PRD §13 proposal; prototype used hand-drawn SVG). */
  mermaid: string;
  caption?: string;
  citations: Citation[];
}

/** Orange "Agent finding" reference card inside the guide. */
export interface FindingLinkBlock {
  type: "finding-link";
  id: string;
  pageId: string;
  citations: Citation[];
}

/**
 * Link from a finding page to the agent's suggested comment on a diff line
 * (PRD §4.9). Hover previews the thread, click jumps to it via revealSource.
 */
export interface CommentLinkBlock {
  type: "comment-link";
  id: string;
  /** Diff target, e.g. `diff:conn:82`. */
  diffRef: string;
  /** Thread id in `ReviewSnapshot.annotations` holding the suggested comment. */
  threadId: string;
  citations: Citation[];
}

export interface FollowUpItem {
  label: string;
  /** Pre-baked agent question this follow-up asks. */
  ask?: string;
}

export interface FollowUpBlock {
  type: "follow-up";
  id: string;
  items: FollowUpItem[];
  citations: Citation[];
}

/** Example / Diagram / Underlying-principle insert (prototype `gen-aside`). */
export interface AsideBlock {
  type: "aside";
  id: string;
  kind: "Example" | "Diagram" | "Underlying principle";
  /** Inner blocks rendered inside the aside. */
  inner: Block[];
  citations: Citation[];
}

/**
 * Trusted pre-rendered HTML (code samples, canned agent content).
 * Producers must sanitize agent HTML before storing it here; the web
 * renders it as-is.
 */
export interface HtmlBlock {
  type: "html";
  id: string;
  html: string;
  citations: Citation[];
}

export type Block =
  | ParagraphBlock
  | ListBlock
  | TableBlock
  | CodeBlock
  | DiagramBlock
  | FindingLinkBlock
  | CommentLinkBlock
  | FollowUpBlock
  | AsideBlock
  | HtmlBlock;

export type AnnotationType = "expansion" | "thread" | "link";

export interface ChatMessage {
  who: "you" | "ai";
  /** Plain text (user) or HTML (agent answer with link tokens rendered). */
  text?: string;
  html?: string;
  /** Agent-drafted suggested comment not yet marked for the PR. */
  suggested?: boolean;
}

/** An expansion card, comment thread, or opened-as-page link on an anchor. */
export interface Annotation {
  id: string;
  type: AnnotationType;
  anchor: Anchor;
  /** Open in place vs closed back to its marker/link. */
  open: boolean;
  /** Threads only: messages so far. */
  messages: ChatMessage[];
  /** Threads only: include in the Submit review payload. */
  post: boolean;
  /** Threads only: editable draft of the text to post (For PR view). */
  draft?: string;
  /** Threads only: a Note (no agent reply) vs Ask. */
  note: boolean;
  /** Threads only: unsent reply-box content (survives re-renders). */
  reply?: string;
}

/** Where an annotation is attached (PRD §7.1). */
export type AnchorHost =
  | { kind: "block"; blockId: string }
  | { kind: "description"; paragraphId: string }
  | { kind: "diff-line"; fileKey: string; line: number };

export interface Anchor {
  host: AnchorHost;
  quotedText: string;
  prefix: string;
  suffix: string;
  /** Line/offset position at creation (best effort; rematch by content). */
  position: number;
  /** Version number the anchor was created against. */
  version: number;
}

export type ContributionItemKind = "fact" | "correction" | "open_question" | "reader_note";

export interface ContributionItem {
  kind: ContributionItemKind;
  text: string;
  /** Corrections target `card:<id>#<block>`. */
  target?: string;
  citations: Citation[];
}

export type ContributionStatus = "pending" | "accepted" | "dismissed" | "merged";

/** One automatic agent contribution appended to the shared log (PRD §9.5). */
export interface Contribution {
  id: string;
  sourceSession: string;
  items: ContributionItem[];
  /** ID of an earlier contribution this supersedes. */
  replaces?: string;
  status: ContributionStatus;
}

export type JobKind =
  | "reader"
  | "critic"
  | "hunk-pass"
  | "concept"
  | "explain"
  | "ask"
  | "depth"
  | "examples"
  | "diagram"
  | "go-deeper"
  | "second-opinion"
  | "update-pass"
  | "summarize";

export type JobState = "queued" | "running" | "done" | "error" | "cancelled";

export interface TokenUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

/** A unit of agent work in the priority queue (PRD §12). */
export interface Job {
  id: string;
  kind: JobKind;
  model: string;
  priority: number;
  state: JobState;
  sessionId?: string;
  /** Snapshot of the exact prompt sent (Settings links to it). */
  promptSnapshot?: string;
  usage?: TokenUsage;
  cacheHitRate?: number;
  error?: string;
  /** Card this job works on, when card-scoped (depth/examples/diagram/generate). */
  cardId?: string;
  /** Latest human-readable progress line, shown on the card while running. */
  progress?: string;
}

/** PR description tab content (PRD §4.11). Read-only in M2; editing is M4. */
export interface ReviewDescription {
  /** GitHub login of the PR author. */
  author: string;
  /** True once merged: description is never editable. */
  merged: boolean;
  /** True when the viewer is the PR author (gates the editing seam). */
  isAuthor: boolean;
  /** Author HTML with stable paragraph ids (`desc:` citation targets). */
  html: string;
  /** "Restated →" links: description paragraph → guide block. */
  restated: { paragraphId: string; cardId: string; blockId: string }[];
  /**
   * Branch without a PR: commit messages instead of a description.
   * Present (and `html` empty) when there is no PR.
   */
  commits?: { sha: string; subject: string }[];
}

export type LogScope = { scope: "global" } | { scope: "card"; cardId: string };

/** One append-only log entry feeding the base + change lists (PRD §9.3). */
export interface LogEntry {
  seq: number;
  kind: string;
  payload: unknown;
  scope: LogScope;
}

/** A validated citation from a `[[…]]` token to review content. */
export interface Citation {
  /** Raw token target, e.g. `diff:conn:147-152@abc123`. */
  target: string;
  /** Whether validation failed (shown dimmed as unverified, PRD §4.5). */
  unverified?: boolean;
}

/** Citation display info for hover previews / jump-to-source. */
export interface CitationPreview {
  target: string;
  label: string;
  snippet: string;
}
