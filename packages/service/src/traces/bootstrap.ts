/**
 * Tracing prelude (issue #356). Imported FIRST by the service entry so
 * auto-instrumentation hooks install before the instrumented modules
 * (`fastify`, `fs`, …) load — require-time hooks cannot patch modules
 * that are already in the cache. Spans flow only while recording is on
 * (the toggle sampler starts closed); this import alone records nothing.
 */
import { ensureTracingSetup } from "./recorder.js";

ensureTracingSetup();
