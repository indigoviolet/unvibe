/**
 * Opt-in performance traces (issue #356). Pure surface only: this
 * barrel never (even transitively) imports `@opentelemetry/*` — seams
 * import from here in lean builds. The recorder (OTel) loads solely
 * through `loader.ts` dynamic imports.
 */
export type { TraceRecorder } from "./recorder.js";
export {
  NOOP_SPAN,
  setActiveTracer,
  getActiveTracer,
  traceSpan,
  traceparentOf,
} from "./tracing.js";
export type { SpanHandle, SpanParent, BrowserSpanBatch, TraceBackend } from "./tracing.js";
export { tracesDir, spansFile, ensureTracesDir, TRACE_SAFETY_CAP_BYTES } from "./paths.js";
export {
  makeTraceHasher,
  isSafeToken,
  isRoutePattern,
  createExportScrubber,
  scrubExportedSpan,
} from "./scrub.js";
export { traceIngest, traceRefresh, watchOpenToFirstCard, hasGuideCards } from "./milestones.js";
export { traceStatement, parseSqlOperation } from "./sqlite.js";
export { ensureTracingSetup, loadTraceRecorder, attachRouteHook } from "./loader.js";
