/**
 * API contract (PRD §14.1). Service and web both import these types;
 * change the contract here first (AGENTS.md).
 *
 * Auth: every HTTP and WS request carries the per-install token as
 * `Authorization: Bearer <token>` or `?token=`. Only `/api/health` is
 * unauthenticated.
 */
import type {
  Annotation,
  Card,
  Contribution,
  ExistingReviewComment,
  HunkState,
  Job,
  LogEntry,
  Page,
  Review,
  ReviewDescription,
  ReviewFile,
  Repo,
  Version,
} from "./entities.js";

/** Health is the only unauthenticated route. */
export interface HealthResponse {
  ok: boolean;
  version: string;
}

// --- repos ---------------------------------------------------------------

export interface ReposResponse {
  repos: Repo[];
}

export interface AddRepoRequest {
  /** Absolute local path of the checkout. */
  path: string;
}

export type ChangesFilter = "authoring" | "review-requested" | "branches" | "recent" | "all";

export interface RepoChange {
  kind: "pr" | "branch" | "review" | "demo";
  title: string;
  prNumber?: number;
  branch?: string;
  author?: string;
  updatedAt?: number;
  /** Set for kind "review": the opened review's id (M1 service addition). */
  reviewId?: string;
  /** Set for kind "review": head moved since the review was fetched. */
  stale?: boolean;
  /** Set for kind "demo": fixture name, e.g. "urllib3-5020" (M3 pipeline). */
  demo?: string;
}

export interface RepoChangesResponse {
  changes: RepoChange[];
}

// --- reviews -------------------------------------------------------------

export interface CreateReviewRequest {
  repoId: string;
  pr?: number;
  branch?: string;
  /**
   * M3 demo mode: when true (or a fixture name), ingest the bundled
   * `fixtures/urllib3-5020/` diff + description instead of git/gh, and run
   * the same pipeline code path against the replay recordings. `repoId`
   * may be `"demo"`; the demo repo is synthetic and needs no checkout.
   */
  demo?: boolean | string;
}

export interface ReviewSnapshot {
  review: Review;
  version: Version;
  files: ReviewFile[];
  /** PR description / commit messages; absent only on pre-M1 snapshots. */
  description?: ReviewDescription;
  pages: Page[];
  annotations: Annotation[];
  hunkStates: HunkState[];
  jobs: Job[];
  contributions: Contribution[];
  logTail: LogEntry[];
  /** Monotonic revision of this snapshot; WS patches carry baseRev/headRev. */
  rev: number;
  /**
   * M3 pipeline (PRD §16): per-review token totals + cache-hit rate.
   * Updated by the pipeline after every job; absent on pre-M3 snapshots.
   */
  usageTotals?: ReviewUsageTotals;
  /**
   * M3 pipeline (PRD §11): which stages have completed. Absent on pre-M3
   * snapshots (treated as all pending). Used by resume-after-restart.
   */
  pipeline?: {
    stages: Record<PipelineStage, "pending" | "running" | "done" | "error">;
    /** Last error per stage (when state is "error"). */
    errors?: Partial<Record<PipelineStage, string>>;
  };
  /**
   * M5 (PRD §8): review-level staleness for the "New commits · Update"
   * banner. Present once a refresh has created version n+1; cleared by a
   * successful update pass. Absent on fresh reviews.
   */
  versionStatus?: import("./versions.js").VersionStatus;
  /**
   * M5: reader-pinned excerpts stored in the snapshot so refresh can remap
   * them by content (`needsRepining` when not found again).
   */
  pinnedCode?: import("./versions.js").PinnedCode[];
  /**
   * M6: read-only cache of existing PR comments
   * (`gh api …/pulls/{n}/comments`). Populated on demand by
   * `GET /api/reviews/:id/pr-comments`; absent until first fetch.
   */
  existingComments?: ExistingReviewComment[];
}

export type ReviewResponse = ReviewSnapshot;

export interface RefreshResponse {
  review: Review;
  /**
   * True when a new version was created by the fetch.
   * M1: true when the head SHA moved (version creation + mapping is M5;
   * see the `M5 seam` marker in the service refresh route).
   */
  newVersion: boolean;
  /**
   * M5: hunk-level summary of what the fetch found (present when
   * `newVersion` is true). `versionStatus` on the snapshot carries the
   * same counts for the banner; `rangeDiff` is display-only.
   */
  comparison?: import("./versions.js").VersionComparisonSummary;
  /** M5: new version number (equals `review.currentVersion` when created). */
  version?: import("./entities.js").Version;
}

/**
 * M5: `POST /api/reviews/:id/update` response — the enqueued update-pass
 * job. The pass runs only when the user clicks Update; it sees only the
 * changed and new hunks (PRD §8).
 */
export interface UpdateReviewResponse {
  jobId: string;
  /** New version the pass updates to (current version at enqueue time). */
  toVersion: number;
}

// --- actions -------------------------------------------------------------
/**
 * POST /api/reviews/:id/actions. One discriminated union so the service can
 * route by `kind` and later agents can add variants without new endpoints.
 */
export type ReviewAction =
  | { kind: "explain"; quote: string; anchor: ActionAnchor }
  | { kind: "ask"; quote: string; anchor: ActionAnchor; message: string }
  | { kind: "note"; quote: string; anchor: ActionAnchor; text?: string }
  | { kind: "depth"; cardId: string; direction: "simpler" | "deeper" }
  | { kind: "examples"; cardId: string }
  | { kind: "diagram"; cardId: string }
  | { kind: "undo"; cardId: string }
  | { kind: "read"; cardId: string; read: boolean }
  | { kind: "collapse"; cardId: string; collapsed: boolean }
  | { kind: "generate"; cardId: string }
  | { kind: "second_opinion"; cardId: string; mode: "blind" | "check" }
  | { kind: "promote"; annotationId: string }
  | { kind: "close"; annotationId: string }
  | { kind: "delete"; targetId: string };

export type ActionAnchor =
  | { where: "block"; blockId: string }
  | { where: "description"; paragraphId: string }
  | { where: "diff-line"; fileKey: string; line: number };

export interface ActionResponse {
  accepted: boolean;
  /** Job started for the action, when async. */
  jobId?: string;
}

// --- hunks ---------------------------------------------------------------

export interface UpdateHunkRequest {
  folded?: boolean;
  reviewed?: boolean;
  /** Set to change the note; explicit null clears it (M1 addition). */
  note?: string | null;
  /**
   * Set/replace the agent summary, or delete it with `null`.
   * Added for M1-web (hunk cards carry Delete for the summary).
   */
  summary?: string | null;
}

export interface SummarizeHunkResponse {
  jobId: string;
}

/**
 * M3 pipeline (PRD §11, §16): resume an interrupted pipeline.
 * `POST /api/reviews/:id/resume` re-enqueues every pipeline stage that has
 * not completed yet (idempotent; already-done stages are skipped).
 */
export interface ResumeReviewResponse {
  resumed: boolean;
  /** Job ids enqueued by this resume call (empty when nothing was missing). */
  jobIds: string[];
  /** Pipeline stages still incomplete after the resume. */
  pendingStages: PipelineStage[];
}

/** Pipeline stages (PRD §11): reader → base → critic/concepts → hunk pass. */
export type PipelineStage = "reader" | "base" | "critic" | "concepts" | "hunk-pass" | "go-deeper";

/**
 * M3 pipeline (PRD §16): per-review token totals + cache-hit rate.
 * Computed from the review's jobs; served via `GET /api/reviews/:id` as
 * `usageTotals` and via `GET /api/jobs?review=:id` per job.
 */
export interface ReviewUsageTotals {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** cachedTokens / inputTokens (undefined when no input yet). */
  cacheHitRate?: number;
  /** Epoch ms of the first card streamed (time-to-first-card, PRD §16). */
  firstCardAt?: number;
  /** Epoch ms the review was created (for time-to-first-card deltas). */
  createdAt: number;
}

// --- comments ------------------------------------------------------------

/** PATCH /api/reviews/:id/comments/:commentId (M6 extends M3 contract). */
export interface UpdateCommentRequest {
  post?: boolean;
  /** Editable draft of the text to post; explicit null clears it. */
  draft?: string | null;
  /** M6: open/closed in place. */
  open?: boolean;
  /** M6: unsent reply-box content (survives re-renders); null clears it. */
  reply?: string | null;
}

/** POST /api/reviews/:id/comments — create a thread (M6). */
export interface CreateCommentRequest {
  anchor: ActionAnchor;
  /** Quoted anchor text (highlighted in the UI). */
  quote: string;
  /** A few lines before the quote (anchor matching, PRD §8). */
  prefix?: string;
  /** A few lines after the quote. */
  suffix?: string;
  /** Best-effort position at creation (line/offset). */
  position?: number;
  /** True = Note (no agent reply); false = user's first Ask message. */
  note?: boolean;
  /** Initial user text (first message when present). */
  text?: string;
  /**
   * Create an agent-suggested comment: first message is the agent's
   * suggestion (`suggested: true`), never marked for the PR initially.
   * Only valid on diff-line anchors.
   */
  suggested?: boolean;
  /** Agent suggestion text (required when `suggested` is true). */
  suggestionText?: string;
}

export interface CreateCommentResponse {
  id: string;
}

/** POST /api/reviews/:id/comments/:commentId/replies — user reply (M6). */
export interface ReplyCommentRequest {
  text: string;
}

export interface ThreadMessage {
  who: "you" | "ai";
  text?: string;
  html?: string;
  /** M6: agent-drafted suggested comment (first message, not for PR). */
  suggested?: boolean;
}

/** GET /api/reviews/:id/pr-comments — read-only existing PR comments (M6). */
export interface ExistingCommentsResponse {
  comments: ExistingReviewComment[];
}

// --- description ---------------------------------------------------------

export interface UpdateDescriptionRequest {
  /** Edited HTML with paragraph ids preserved (PRD §4.11). */
  html: string;
}

export interface SubmitReviewRequest {
  /** Optional client-side confirmation of what will be posted. */
  expectedCount?: number;
  /** M6: return the preview without posting (Submit panel). */
  dryRun?: boolean;
}

/** M6: where one For-PR thread lands on GitHub (PRD §4.8, §4.12). */
export type SubmitCommentLocation =
  | {
      kind: "inline";
      path: string;
      line: number;
      side: "LEFT" | "RIGHT";
      startLine?: number;
      startSide?: "LEFT" | "RIGHT";
      /** Set when the anchor line wasn't commentable and we fell back. */
      fallbackNote?: string;
    }
  | { kind: "general"; reason?: string };

/** M6: one comment as it will be posted. */
export interface SubmitPreviewComment {
  threadId: string;
  location: SubmitCommentLocation;
  /** Exact text that will be posted (draft + fallback note). */
  text: string;
}

/** M6: exactly what Submit will post (preview + dryRun response). */
export interface SubmitPreview {
  /** Threads marked For PR that are not yet posted. */
  comments: SubmitPreviewComment[];
  /** Threads already posted (skipped on retry). */
  alreadyPosted: string[];
  /** Review body (general comments joined), "" when none. */
  reviewBody: string;
  /** Pinned head SHA the review will carry as `commit_id`. */
  commitId: string;
  /** Description update, when a pending edit exists. */
  description?: { fromRev: string; markdown: string; html: string };
  disabledReason?: string;
}

export interface SubmitReviewResponse {
  posted: boolean;
  commentCount: number;
  descriptionUpdated: boolean;
  /** M6: present on dryRun (preview without posting). */
  preview?: SubmitPreview;
  /** M6: GitHub review URL after a successful post. */
  reviewUrl?: string;
  /** M6: true when the review posted but the description update failed. */
  partial?: boolean;
  /** M6: why submit is disabled / refused (branch without PR, head moved…). */
  reason?: string;
}

// --- settings ------------------------------------------------------------

export interface ModelPick {
  provider: string;
  model: string;
}

export interface Settings {
  main: ModelPick;
  small: ModelPick;
  secondOpinion: ModelPick;
  /** Max concurrent sessions per provider (default 4, PRD §12). */
  sessionsPerProvider: number;
  /** Inline size budget in tokens (L1 budget guess ~40k, PRD §9.1). */
  inlineBudgetTokens: number;
  /** Base-rebuild thresholds (PRD §9.4). */
  rebuildSupersededRatio: number;
  rebuildAppendedTokens: number;
  /** Provider cache lifetime in ms: idle sessions close after this (PRD §12). */
  cacheLifetimeMs: number;
  /** Service exits after this many idle minutes (PRD §14; 0 = never). */
  idleExitMinutes: number;
}

/** PUT /api/settings accepts a partial update; GET returns full Settings. */
export type UpdateSettingsRequest = Partial<Settings>;

/** GET /api/models?provider=:id — models an ACP adapter offers (PRD §4.14). */
export interface ModelsResponse {
  provider: string;
  models: string[];
}

// --- prompts -------------------------------------------------------------

export interface PromptTemplate {
  name: string;
  role: string;
  tier: string;
  variables: string[];
  template: string;
}

export interface PromptExpanded {
  name: string;
  expanded: string;
  /** Token counts per layer for the expanded text. */
  layers: { layer: string; tokens: number }[];
  cachedTokens: number;
}

export interface PromptsResponse {
  templates: PromptTemplate[];
  /** Present when ?review= is given: per-review expansion. */
  expanded?: PromptExpanded[];
}

// --- jobs ----------------------------------------------------------------

export interface JobsResponse {
  jobs: Job[];
}

/** GET /api/jobs/:id — one job. */
export interface JobResponse {
  job: Job;
}

/** GET /api/jobs/:id/prompt — the exact prompt the job sent. */
export interface JobPromptResponse {
  jobId: string;
  promptSnapshot: string;
}

// --- WebSocket events ----------------------------------------------------
/**
 * WS `/api/events?review=:id` event union: job progress, streamed text,
 * and state patches.
 *
 * ### State-patch shape (contract decision)
 *
 * Patches are RFC 6902-style JSON Patch ops scoped to the review snapshot:
 *
 * ```ts
 * { type: "patch", baseRev: 41, headRev: 42,
 *   ops: [{ op: "replace", path: "/cards/c-central/blocks", value: [...] }] }
 * ```
 *
 * - `path` is a JSON Pointer (RFC 6901) relative to the snapshot root
 *   (`/pages`, `/annotations`, `/hunkStates`, …).
 * - `op` is one of `add` | `remove` | `replace`.
 * - `baseRev` is the snapshot revision the ops apply to; clients that have
 *   drifted re-fetch the snapshot instead of applying.
 * - Full-snapshot resync is `{ type: "snapshot", snapshot }`.
 *
 * The web store applies ops in order and bumps its local `rev` to `headRev`.
 */
export type StatePatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown };

export type ReviewEvent =
  | { type: "job"; job: Job }
  | { type: "text"; jobId: string; cardId?: string; delta: string }
  | { type: "patch"; baseRev: number; headRev: number; ops: StatePatchOp[] }
  | { type: "snapshot"; snapshot: ReviewSnapshot }
  | { type: "error"; message: string; jobId?: string };

/** Re-exported entity slices used by route stubs. */
export type { Annotation, Card, Page };
