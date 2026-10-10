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
  kind: "pr" | "branch" | "review";
  title: string;
  prNumber?: number;
  branch?: string;
  author?: string;
  updatedAt?: number;
  /** Set for kind "review": the opened review's id (M1 service addition). */
  reviewId?: string;
  /** Set for kind "review": head moved since the review was fetched. */
  stale?: boolean;
}

export interface RepoChangesResponse {
  changes: RepoChange[];
}

// --- reviews -------------------------------------------------------------

export interface CreateReviewRequest {
  repoId: string;
  pr?: number;
  branch?: string;
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

// --- comments ------------------------------------------------------------

export interface UpdateCommentRequest {
  post?: boolean;
  draft?: string;
}

export interface ThreadMessage {
  who: "you" | "ai";
  text?: string;
  html?: string;
}

// --- description ---------------------------------------------------------

export interface UpdateDescriptionRequest {
  /** Edited HTML with paragraph ids preserved (PRD §4.11). */
  html: string;
}

export interface SubmitReviewRequest {
  /** Optional client-side confirmation of what will be posted. */
  expectedCount?: number;
}

export interface SubmitReviewResponse {
  posted: boolean;
  commentCount: number;
  descriptionUpdated: boolean;
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
