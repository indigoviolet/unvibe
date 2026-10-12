/**
 * Context builder surface (PRD §9).
 *
 * Pipeline entry points (a pipeline should call these):
 * - `buildBasePack(snapshot, instructions, opts)` — the base user message
 *   (L1 + L1b + L2), keyed by (version, guide revision, model).
 * - `buildL1Source` / `buildL1bPinned` / `buildL2Guide` /
 *   `buildHunkSummaries` — individual layers and the hunk-summary variable.
 * - `buildL4Conversation(conv)` — the per-turn message forked onto a base.
 * - `appendLogEntry` / `batchLogEntries` / `formatLogBatch` — L3 growth.
 * - `filterChangeList` / `formatChangeList` — a session's next-turn delta.
 * - `decideRebuild(state, thresholds)` — when to build a new base.
 * - `buildSecondOpinionContext(input)` — the isolated second-opinion base.
 * - `renderTemplate` + `loadTemplatesDirSync` — prompt templates (re-export).
 */
export {
  baseKey,
  buildBasePack,
  type BasePack,
  type BasePackOptions,
} from "./base.js";
export {
  buildConceptsSection,
  buildDiffSection,
  buildGuideSection,
  buildHiddenHunksSection,
  buildHunkSummaries,
  buildL1bPinned,
  buildL1Source,
  buildL2Guide,
  buildSourceBlurb,
  formatDiffLine,
  formatFinding,
  formatGuideCard,
  formatHiddenHunk,
  formatHunk,
  formatHunkHeader,
  buildL4Conversation,
  hunkId,
  pinnedId,
  type DiffSectionResult,
  type L1Options,
  type L1Result,
  type L4Conversation,
} from "./layers.js";
export {
  appendLogEntry,
  batchLogEntries,
  CARD_LOCAL_KINDS,
  filterChangeList,
  formatChangeList,
  formatLogBatch,
  formatLogEntry,
  NEVER_LOGGED_KINDS,
  logEntryText,
  payloadText,
  shouldEnterLog,
  stableStringify,
  type ChangeListFilter,
  type LogEntryKind,
} from "./log.js";
export {
  decideRebuild,
  defaultThresholds,
  type BaseRebuildState,
  type RebuildReason,
  type RebuildThresholds,
} from "./rebuild.js";
export {
  buildSecondOpinionContext,
  type CodeExcerpt,
  type SecondOpinionContext,
  type SecondOpinionInput,
} from "./secondOpinion.js";
export {
  charTokenEstimator,
  DEFAULT_INLINE_BUDGET_TOKENS,
  DEFAULT_LOG_BATCH_TOKENS,
  DEFAULT_REBUILD_APPENDED_TOKENS,
  DEFAULT_REBUILD_SUPERSEDED_RATIO,
  type TokenEstimator,
} from "./tokens.js";
export type {
  ConceptIndexEntry,
  ContextDiffLine,
  ContextFile,
  ContextHunk,
  FindingInput,
  GuideCardInput,
  PinnedExcerpt,
  PromptReviewSnapshot,
  SessionCursor,
} from "./types.js";
