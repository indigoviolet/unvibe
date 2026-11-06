/** Opt-in performance traces (issue #356). */
export {
  TraceRecorder,
  TRACE_SAFETY_CAP_BYTES,
  ensureTracingSetup,
  setActiveRecorder,
  getActiveRecorder,
  traceSpan,
} from "./recorder.js";
export type { SpanHandle, SpanParent, BrowserSpanBatch } from "./recorder.js";
export { tracesDir, spansFile, ensureTracesDir } from "./paths.js";
export {
  makeTraceHasher,
  isSafeToken,
  isRoutePattern,
  createExportScrubber,
  scrubExportedSpan,
} from "./scrub.js";
export { traceIngest, traceRefresh, watchOpenToFirstCard, hasGuideCards } from "./milestones.js";
export { traceStatement, parseSqlOperation } from "./sqlite.js";
