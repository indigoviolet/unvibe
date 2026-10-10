/**
 * Pipeline public types (M3): the reusable seam the next agents build on.
 *
 * `runInFork` handles base lookup/rebuild, fork-or-fallback, L4 rendering,
 * job bookkeeping, streaming, validation + repair, and returns parsed
 * content + trailing JSON. `runSmall` is the small-model equivalent (no
 * fork, no base). See `docs/pipeline.md` for the worked example.
 */
import type { Job, JobKind, ParsedCard, ReplyData, TokenUsage } from "@unvibe/shared";
import type { ValidationReport } from "../validate/index.js";

export interface RunInForkOptions {
  reviewId: string;
  /** Job kind for bookkeeping (e.g. "go-deeper", "explain"). */
  kind: JobKind;
  /** Prompt template name (e.g. "go_deeper", "critic"). */
  template: string;
  /** Template variables (rendered deterministically; may nest for `{{a.b}}`). */
  variables: Record<string, unknown>;
  priority: number;
  dedupeKey?: { anchor: string; requestKind: string; depth?: string; baseVersion: string };
  cardId?: string;
  /** M4: annotation the streamed text belongs to (ask replies, expansions). */
  threadId?: string;
  /** Called with newly finished cards as they stream in. */
  onPartial?: (cards: ParsedCard[]) => void | Promise<void>;
  signal?: AbortSignal;
  /** Extra replay marker for the ReplayAgentRunner (demo/tests). */
  replay?: { kind: string; key?: string };
  /**
   * M4: called with the enqueued job once it exists (after the base
   * lookup). Lets action handlers return the `jobId` without awaiting
   * the agent result.
   */
  onJob?: (job: Job) => void;
}

export interface RunInForkResult {
  job: Job;
  /** Full reply text (Markdown + trailing JSON). */
  text: string;
  /** Parsed cards (finished). */
  cards: ParsedCard[];
  /** Trailing JSON (null when missing). */
  data: ReplyData | null;
  /** Citation validation report for the final reply. */
  validation: ValidationReport;
  usage: TokenUsage;
  /** True when the fork path was used (false = fresh-session fallback). */
  viaFork: boolean;
  /** True when a repair turn was sent (needsRepairTurn fired). */
  repaired: boolean;
}

export interface RunSmallOptions {
  reviewId: string;
  kind: JobKind;
  template: string;
  variables: Record<string, unknown>;
  priority: number;
  dedupeKey?: { anchor: string; requestKind: string; depth?: string; baseVersion: string };
  cardId?: string;
  /** M4: annotation the streamed text belongs to (ask replies, expansions). */
  threadId?: string;
  signal?: AbortSignal;
  replay?: { kind: string; key?: string };
  /** M4: called with the enqueued job once it exists (see above). */
  onJob?: (job: Job) => void;
}

export type RunSmallResult = RunInForkResult;
