/**
 * Shared-context surface (PRD §9.3–§9.5).
 *
 * - `hooks.ts` — the `recordInteraction` seam shared with the
 *   interaction-actions agent (`InteractionEvent`, no-op default handler).
 * - `taxonomy.ts` — which events enter the log, with what kind/scope.
 * - `threads.ts` — thread-settle detection + small-model-or-fallback summary.
 * - `contributions.ts` — automatic `contribute` processing (validation,
 *   dedupe, replaces, per-turn limit) + consolidation merge.
 * - `growth.ts` — batch planning for base growth (~2k tokens from settings).
 * - `rebuild.ts` — rebuild planning (version/guide/cache-expiry/thresholds).
 * - `isolation.ts` — small-model and second-opinion leak asserts.
 * - `store.ts` — per-review base observations + conversation cursors.
 * - `service.ts` — the live wiring used by the pipeline and routes.
 */
export {
  recordInteraction,
  setInteractionHandler,
  getInteractionHandler,
  type InteractionEvent,
  type InteractionEventKind,
  type InteractionHandler,
} from "./hooks.js";
export { logEntryForEvent, type TaxonomyResult } from "./taxonomy.js";
export {
  DEFAULT_THREAD_SETTLE_MS,
  fallbackThreadSummary,
  isThreadSettled,
  lastAgentLines,
  lastAgentText,
  summarizeSettledThread,
  toThreadSnapshot,
  type ThreadSnapshot,
} from "./threads.js";
export {
  MAX_CONTRIBUTION_ITEMS,
  applyConsolidation,
  isUsableCitation,
  normalizeContributionText,
  processContribute,
  type ContributeInput,
  type ContributeOutcome,
} from "./contributions.js";
export { forceBatches, planGrowth, renderBatchTurn, type GrowthPlan } from "./growth.js";
export { planRebuild, resolveThresholds, supersededRatio, type RebuildPlanInput } from "./rebuild.js";
export {
  assertNoLeak,
  assertSecondOpinionIsolated,
  assertSmallPromptIsolated,
  buildIsolatedSecondOpinionPrompt,
  type IsolatedSecondOpinionInput,
} from "./isolation.js";
export { SharedContextStore, toStats, type BaseObservation } from "./store.js";
export { SharedContextService, codedError, type SharedContextDeps } from "./service.js";
