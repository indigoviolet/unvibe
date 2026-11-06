/**
 * Tracing loader (issue #356, debug flavour): the ONLY module in the
 * always-loaded path that touches the OTel packages, and only through
 * dynamic `import()` in a `try/catch`. In a lean install (no
 * `@opentelemetry/*` on disk) every function here degrades to a no-op or
 * null, so the service boots and runs with tracing unavailable. This
 * module itself imports nothing but the pure seam surface.
 */
import type { FastifyInstance } from "fastify";
import { setActiveTracer, type TraceBackend } from "./tracing.js";
import type { TraceRecorder } from "./recorder.js";

type RecorderModule = typeof import("./recorder.js");

let cached: RecorderModule | null | undefined;

/** Dynamically import the recorder module; null when OTel is absent. */
async function recorderModule(): Promise<RecorderModule | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await import("./recorder.js");
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Install auto-instrumentation hooks + the shared provider + the real
 * async context manager. Safe to call in a lean build (no-op false).
 * Call before the instrumented modules load (service entry prelude).
 */
export async function ensureTracingSetup(): Promise<boolean> {
  const mod = await recorderModule();
  if (!mod) return false;
  try {
    mod.ensureTracingSetup();
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the process recorder and publish it as the seam backend. Null
 * in a lean build (routes answer 501 "not available in this build").
 */
export async function loadTraceRecorder(dataDir: string): Promise<TraceRecorder | null> {
  const mod = await recorderModule();
  if (!mod) return null;
  try {
    const rec = new mod.TraceRecorder(dataDir);
    setActiveTracer(rec as unknown as TraceBackend);
    return rec;
  } catch {
    return null;
  }
}

/**
 * Stamp the route pattern onto the auto HTTP span (`http.route`; the
 * export scrubber renames from it). No-op without a recorder. Registered
 * from `server.ts`; the hook itself never touches OTel directly.
 */
export async function attachRouteHook(
  app: FastifyInstance,
  getRecorder: () => TraceRecorder | null,
): Promise<void> {
  const mod = await recorderModule();
  if (!mod) return;
  try {
    mod.attachRouteHook(app, getRecorder);
  } catch {
    // Tracing never breaks requests.
  }
}
