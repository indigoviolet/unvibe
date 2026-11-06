/**
 * Anonymized usage statistics export (issue #323).
 *
 * Debug only, explicit only: produced solely by `GET /api/stats/export`
 * (Settings → Debug → Export) or `unvibe stats export`. The exporter is
 * allowlist-by-construction: it writes only the fields below — numbers,
 * fixed enums and salted hashes. IDs and file paths are HMAC hashes under
 * a random per-export salt that is never written anywhere, so hashes
 * cannot be linked across exports or reversed. No free text, no paths,
 * no names, no absolute timestamps: times are durations/offsets in ms.
 * See `docs/stats-export.md` for the field-by-field schema.
 */
import type { JobKind, JobState } from "./entities.js";

export type StatsProvider = "claude" | "codex" | "pi" | "other";

export type StatsFailureClass =
  | "timeout"
  | "rate-limit"
  | "auth"
  | "no-agent"
  | "not-found"
  | "head-moved"
  | "network"
  | "cancelled"
  | "interrupted"
  | "other";

export interface StatsTokens {
  input: number;
  cachedRead: number;
  cachedWrite: number;
  output: number;
}

export interface StatsToolCount {
  /** Adapter tool name, kept only when it is a short safe token. */
  tool: string;
  count: number;
}

export interface StatsRead {
  /** Salted hash of the read file's path (same file ⇒ same hash in one export). */
  file: string;
  /** Lines read when the tool detail named a range, else null. */
  lines: number | null;
  /** True when the file is part of the review's diff. */
  insideDiff: boolean;
}

export interface StatsReview {
  /** Salted hash of the review id. */
  id: string;
  kind: "change" | "document";
  files: number;
  hunks: number;
  /**
   * Issue #356: hunks with no stored summary because the hunk-pass
   * fan-out cap left them out (0 when the review fits the cap).
   */
  skippedHunkSummaries: number;
  addedLines: number;
  removedLines: number;
  guidePages: number;
  guideCards: number;
  threads: number;
  replies: number;
  /** Threads marked for the Outbox and not yet posted. */
  outboxThreads: number;
  versions: number;
  /** Jobs recorded against this review. */
  jobs: number;
}

export interface StatsJob {
  /** Salted hash of the job id. */
  id: string;
  /** Salted hash of the owning review, null for review-less jobs. */
  review: string | null;
  /** Salted hash of the agent session, null when none was recorded. */
  session: string | null;
  kind: JobKind | "other";
  state: JobState | "other";
  provider: StatsProvider;
  /** Model id kept only as a short safe token, else "other". */
  model: string;
  /** Effort token ("" = adapter default), else "other". */
  effort: string;
  access: "full" | "lockdown" | null;
  tokens: StatsTokens | null;
  toolCounts: StatsToolCount[];
  reads: StatsRead[];
  /** Agent turns recorded for the job. */
  turns: number;
  /** Turns labelled as repairs. */
  repairTurns: number;
  attempts: number;
  /** Error class for failed jobs; never the error message. */
  failure: StatsFailureClass | null;
  /** ms from queued to first start; null when not recorded. */
  queuedMs: number | null;
  /** ms from first start to finish; null while unfinished/unrecorded. */
  durationMs: number | null;
  /** ms from the review's creation to this job's first start. */
  offsetMs: number | null;
}

export interface StatsExport {
  schemaVersion: 2;
  reviews: StatsReview[];
  jobs: StatsJob[];
  totals: {
    reviews: number;
    jobs: number;
    failures: number;
    repairs: number;
    tokens: StatsTokens;
  };
}
