/** Opt-in performance traces (issue #356). */
export {
  TraceRecorder,
  TRACE_SAFETY_CAP_BYTES,
  setActiveRecorder,
  getActiveRecorder,
  traceSpan,
  traceparentOf,
} from "./recorder.js";
export type { SpanHandle, SpanParent, BrowserSpanBatch } from "./recorder.js";
export { tracesDir, spansFile, ensureTracesDir } from "./paths.js";
export { makeTraceHasher, scrubAttribute, isSafeToken, isRoutePattern } from "./scrub.js";
export { traceIngest, traceRefresh, watchOpenToFirstCard, hasGuideCards } from "./milestones.js";
export { traceStatement, parseSqlOperation } from "./sqlite.js";
