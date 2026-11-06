/**
 * Tracing loader (issue #356, debug flavour): the ONLY module in the
 * always-loaded path that touches the OTel packages, and only through
 * dynamic `import()` in a `try/catch`. In a lean build (no OTel on disk)
 * every function here degrades to a no-op or null — the service boots
 * and runs with tracing unavailable instead of crashing on the missing
 * packages. This module itself imports nothing but the pure seam
 * surface and `fastify` types (erased).
 */
import { createRequire } from "node:module";
import type { FastifyInstance } from "fastify";
import { setActiveTracer, type TraceBackend } from "./tracing.js";
import type { TraceRecorder } from "./recorder.js";

type RecorderModule = typeof import("./recorder.js");

/**
 * Probe for the OTel packages with the runtime resolver *before*
 * touching the recorder module. This matters because bundlers inline
 * the dynamic `import()` below into a single file: the import itself
 * can no longer fail in a lean install, but the *evaluation* of the
 * bundled recorder is side-effect free, so probing first keeps the
 * whole path throw-free. (In unbundled source the import fails
 * directly and this is just a fast path.)
 */
function otelPresent(): boolean {
  // Resolve the entry point, not package.json: several OTel packages
  // restrict subpath exports, so ./package.json does not resolve.
  try {
    createRequire(import.meta.url).resolve("@opentelemetry/api");
    return true;
  } catch {
    return false;
  }
}

/** Dynamic importer, injectable so tests can simulate a lean install. */
export type RecorderImporter = () => Promise<RecorderModule>;

const defaultImporter: RecorderImporter = () => import("./recorder.js");

let cached: RecorderModule | null | undefined;

function isRecorderModule(mod: unknown): mod is RecorderModule {
  if (typeof mod !== "object" || mod === null) return false;
  const m = mod as Record<string, unknown>;
  return (
    typeof m["ensureTracingSetup"] === "function" &&
    typeof m["attachRouteHook"] === "function" &&
    typeof m["TraceRecorder"] === "function"
  );
}

/** Resolve (and cache, for the default importer) the recorder module. */
async function recorderModule(importer: RecorderImporter = defaultImporter): Promise<RecorderModule | null> {
  const useCache = importer === defaultImporter;
  if (useCache && cached !== undefined) return cached;
  // Lean install: OTel is absent, so do not even load the recorder.
  if (useCache && !otelPresent()) {
    cached = null;
    return null;
  }
  let mod: RecorderModule | null = null;
  try {
    const loaded = await importer();
    if (isRecorderModule(loaded)) mod = loaded;
  } catch {
    mod = null;
  }
  if (useCache) cached = mod;
  return mod;
}

/**
 * Install auto-instrumentation hooks + the shared provider + the real
 * async context manager. Returns false in lean builds (nothing
 * installed, nothing to hook). Call before the instrumented modules
 * load (service entry prelude).
 */
export async function ensureTracingSetup(
  importer: RecorderImporter = defaultImporter,
): Promise<boolean> {
  const mod = await recorderModule(importer);
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
export async function loadTraceRecorder(
  dataDir: string,
  importer: RecorderImporter = defaultImporter,
): Promise<TraceRecorder | null> {
  const mod = await recorderModule(importer);
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
 * from `server.ts`.
 */
export async function attachRouteHook(
  app: FastifyInstance,
  getRecorder: () => TraceRecorder | null,
  importer: RecorderImporter = defaultImporter,
): Promise<void> {
  const mod = await recorderModule(importer);
  if (!mod) return;
  try {
    mod.attachRouteHook(app, getRecorder);
  } catch {
    // Tracing never breaks requests.
  }
}
