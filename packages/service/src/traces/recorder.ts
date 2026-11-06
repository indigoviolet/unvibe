/**
 * Opt-in performance-trace recorder (issue #356).
 *
 * OpenTelemetry only: spans come from the OTel JS SDK plus
 * auto-instrumentations for HTTP, Fastify, undici (fetch) and `fs`
 * (`registerInstrumentations`), with manual spans only where no
 * instrumentation exists — jobs, SQLite, the ingest/refresh/
 * open-to-first-card milestones, and child processes (no child_process
 * instrumentation exists). Stored spans are RAW: whatever the
 * instrumentations capture (URLs, query strings, headers, args, fs
 * paths, argv, env) is written as-is to `<dataDir>/traces/spans.jsonl`.
 * Scrubbing happens in a processor ON EXPORT (see `scrub.ts`:
 * `scrubExportedSpan`), and the canary leak test runs against the
 * exported file.
 *
 * Off by default. While off a toggle sampler drops every span before
 * recording (no exporter running, no span storage), and manual seams
 * return no-ops without touching the SDK. Storage is kept for as long
 * as recording is on: no time window, no rotation. A 256 MB safety cap
 * stops recording with a visible notice (`capped` in the status) rather
 * than deleting older data.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
// Type-only OTel imports (erased at build — safe in lean installs).
import type { Span } from "@opentelemetry/api";
import type {
  BasicTracerProvider,
  SamplingDecision,
  Sampler,
  SamplingResult,
  ReadableSpan,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/**
 * Lazily `require()`d OTel packages. Static imports would make the
 * service bundle evaluate them at load, crashing lean installs that do
 * not ship them — every value import here happens at first *use*, and
 * any failure propagates to the caller (the loader treats it as
 * "tracing unavailable"). See `loader.ts`.
 */
interface OtelModules {
  api: typeof import("@opentelemetry/api");
  core: typeof import("@opentelemetry/core");
  ctxHooks: typeof import("@opentelemetry/context-async-hooks");
  sdkBase: typeof import("@opentelemetry/sdk-trace-base");
  instr: typeof import("@opentelemetry/instrumentation");
  http: typeof import("@opentelemetry/instrumentation-http");
  fastify: typeof import("@opentelemetry/instrumentation-fastify");
  undici: typeof import("@opentelemetry/instrumentation-undici");
  fsInstr: typeof import("@opentelemetry/instrumentation-fs");
}

let otelModules: OtelModules | null = null;

function otel(): OtelModules {
  if (!otelModules) {
    const requireOtel = createRequire(import.meta.url);
    otelModules = {
      api: requireOtel("@opentelemetry/api"),
      core: requireOtel("@opentelemetry/core"),
      ctxHooks: requireOtel("@opentelemetry/context-async-hooks"),
      sdkBase: requireOtel("@opentelemetry/sdk-trace-base"),
      instr: requireOtel("@opentelemetry/instrumentation"),
      http: requireOtel("@opentelemetry/instrumentation-http"),
      fastify: requireOtel("@opentelemetry/instrumentation-fastify"),
      undici: requireOtel("@opentelemetry/instrumentation-undici"),
      fsInstr: requireOtel("@opentelemetry/instrumentation-fs"),
    };
  }
  return otelModules;
}
import type { FastifyInstance } from "fastify";
import type { SpanKind } from "@opentelemetry/api";
import type { OtlpSpan, TraceExport, TraceStatusResponse } from "@unvibe/shared";
import { ensureTracesDir, spansFile, TRACE_SAFETY_CAP_BYTES } from "./paths.js";
import { isRoutePattern, scrubExportedSpan } from "./scrub.js";
import {
  NOOP_SPAN,
  type BrowserSpanBatch,
  type SpanHandle,
  type SpanParent,
} from "./tracing.js";

/** How often the store size is re-checked while recording (every N spans). */
const SIZE_CHECK_EVERY = 64;

/** Span processor: serialize finished spans to the JSONL store. */
class FileSpanProcessor implements SpanProcessor {
  constructor(private readonly append: (span: ReadableSpan) => void) {}
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    this.append(span);
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

const HEX16 = /^[0-9a-f]{16}$/;
const HEX32 = /^[0-9a-f]{32}$/;

/**
 * Run fn with tracing suppressed (hides our own file IO from the fs
 * instrumentation, which would otherwise recurse until the stack
 * overflows and recording silently stops).
 */
function unsampled<T>(fn: () => T): T {
  const { context } = otel().api;
  const { suppressTracing } = otel().core;
  return context.with(suppressTracing(context.active()), fn);
}

/**
 * One shared SDK per process (production has one recorder; tests swap
 * targets): toggling recording flips the sampler, never the plumbing.
 * Auto-instrumentations register once against the shared provider, so
 * recorder churn in tests cannot double-patch modules.
 */
let sharedProvider: BasicTracerProvider | null = null;
let autoInstrumented = false;
let recordingOn = false;
let activeTarget: TraceRecorder | null = null;
let propagatorInstalled = false;

class ToggleSampler implements Sampler {
  shouldSample(): SamplingResult {
    const { SamplingDecision } = otel().sdkBase;
    return {
      decision: recordingOn ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD,
    };
  }
  toString(): string {
    return "ToggleSampler";
  }
}

/**
 * Build the shared provider and register auto-instrumentations (HTTP,
 * Fastify, undici, fs). Idempotent: one provider and one registration
 * per process, so recorder churn in tests cannot double-patch modules.
 * Called at entry prelude time (see `bootstrap.ts`) so load-time hooks
 * install before the instrumented modules load; also called lazily from
 * `setEnabled` for contexts that never import the prelude (tests).
 */
let contextManagerInstalled = false;

export function ensureTracingSetup(): BasicTracerProvider {
  // Real async context (the API default is a no-op manager, under which
  // `context.with()` cannot propagate — suppression and trace parenting
  // silently stop working). The global *tracer* provider stays untouched.
  if (!contextManagerInstalled) {
    contextManagerInstalled = true;
    const { context } = otel().api;
    const { AsyncLocalStorageContextManager } = otel().ctxHooks;
    context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  }
  return sharedTracerProvider();
}

function sharedTracerProvider(): BasicTracerProvider {
  const { propagation } = otel().api;
  const { W3CTraceContextPropagator } = otel().core;
  const { BasicTracerProvider } = otel().sdkBase;
  const { registerInstrumentations } = otel().instr;
  const { HttpInstrumentation } = otel().http;
  const { FastifyInstrumentation } = otel().fastify;
  const { UndiciInstrumentation } = otel().undici;
  const { FsInstrumentation } = otel().fsInstr;
  if (!sharedProvider) {
    if (!propagatorInstalled) {
      propagatorInstalled = true;
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    }
    sharedProvider = new BasicTracerProvider({
      sampler: new ToggleSampler(),
      spanProcessors: [new FileSpanProcessor((span) => activeTarget?.storeRawSpan(span))],
    });
  }
  if (!autoInstrumented) {
    autoInstrumented = true;
    registerInstrumentations({
      tracerProvider: sharedProvider,
      instrumentations: [
        new HttpInstrumentation(),
        new FastifyInstrumentation(),
        new UndiciInstrumentation(),
        new FsInstrumentation(),
      ],
    });
  }
  return sharedProvider;
}

export class TraceRecorder {
  private spansSinceCheck = 0;
  private spanCount = 0;

  constructor(private readonly dataDir: string) {
    this.spanCount = countStoredSpans(dataDir);
  }

  get enabled(): boolean {
    return recordingOn && activeTarget === this;
  }

  get capped(): boolean {
    try {
      return currentBytes(this.dataDir) >= TRACE_SAFETY_CAP_BYTES;
    } catch {
      return false;
    }
  }

  /** Start recording (Debug switch on). Idempotent. */
  setEnabled(on: boolean): void {
    if (on) {
      ensureTracesDir(this.dataDir);
      // Recount: spans may have landed since construction (e.g. a store
      // restored around the data dir, or the capped test's fixture).
      // Cheap except near the cap, and toggles are explicit user actions.
      this.spanCount = countStoredSpans(this.dataDir);
      this.spansSinceCheck = 0;
      sharedTracerProvider();
      if (currentBytes(this.dataDir) >= TRACE_SAFETY_CAP_BYTES) {
        // Over the cap: stay off with a visible notice (status.capped).
        if (activeTarget === this) {
          activeTarget = null;
          recordingOn = false;
        }
        return;
      }
      this.activate();
    } else {
      this.deactivate();
    }
  }

  /** Become the process-wide recording target (module-global by design). */
  private activate(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the active target IS this recorder
    activeTarget = this;
    recordingOn = true;
  }

  /** Release the process-wide target when it is this recorder. */
  private deactivate(): void {
    if (activeTarget === this) {
      activeTarget = null;
      recordingOn = false;
    }
  }

  /**
   * Start a manual span (jobs, SQLite, milestones, child processes).
   * Attributes are stored RAW; the export scrubber anonymizes. Returns
   * a no-op when recording is off, without touching the SDK.
   */
  startSpan(
    name: string,
    attrs: Record<string, string | number | boolean> = {},
    parent?: SpanParent,
    kind?: SpanKind,
  ): SpanHandle {
    if (!this.enabled) return NOOP_SPAN;
    const { context, propagation, SpanKind } = otel().api;
    const kindValue = kind ?? SpanKind.INTERNAL;
    const tracer = sharedTracerProvider().getTracer("unvibe", "0.0.15");
    let ctx = context.active();
    if (parent && HEX32.test(parent.traceId) && HEX16.test(parent.spanId)) {
      const extracted = propagation.extract(ctx, { traceparent: `00-${parent.traceId}-${parent.spanId}-01` });
      ctx = extracted ?? ctx;
    }
    const span = tracer.startSpan(name, { kind: kindValue }, ctx);
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    return new LiveSpan(span);
  }

  /**
   * Append one finished span (SDK or browser) to this recorder's store.
   * The write runs unsampled (`suppressTracing`): without it the store's
   * own file IO would be captured by the fs instrumentation and recurse
   * until the stack overflows and recording silently stops.
   */
  storeRawSpan(span: ReadableSpan): void {
    if (!recordingOn || activeTarget !== this) return;
    if (this.spansSinceCheck++ % SIZE_CHECK_EVERY === 0 && this.cappedNow()) {
      activeTarget = null;
      recordingOn = false;
      return;
    }
    try {
      const line = `${JSON.stringify(toOtlp(span))}\n`;
      unsampled(() => {
        fs.appendFileSync(spansFile(this.dataDir), line, "utf8");
      });
      this.spanCount++;
    } catch {
      // A full disk stops recording rather than crashing the service.
      activeTarget = null;
      recordingOn = false;
    }
  }

  /** Size check without feeding the check itself back into the store. */
  private cappedNow(): boolean {
    try {
      return unsampled(() => currentBytes(this.dataDir))
        >= TRACE_SAFETY_CAP_BYTES;
    } catch {
      return false;
    }
  }

  /**
   * Ingest browser spans (POSTed by the web SDK beacon). Entries are
   * validated for shape and stored RAW under the browser's trace ids;
   * the export scrubber anonymizes. Malformed entries are rejected.
   */
  ingestBrowser(batch: BrowserSpanBatch): { accepted: number; rejected: number } {
    if (!this.enabled) return { accepted: 0, rejected: batch.spans?.length ?? 0 };
    let accepted = 0;
    let rejected = 0;
    for (const entry of batch.spans ?? []) {
      const otlp = toBrowserOtlp(entry);
      if (!otlp) {
        rejected++;
        continue;
      }
      try {
        const line = `${JSON.stringify(otlp)}\n`;
        unsampled(() => {
          fs.appendFileSync(spansFile(this.dataDir), line, "utf8");
        });
        this.spanCount++;
        accepted++;
      } catch {
        activeTarget = null;
        recordingOn = false;
        rejected++;
      }
    }
    return { accepted, rejected };
  }

  status(): TraceStatusResponse {
    const enabled = this.enabled;
    return {
      recording: enabled,
      spans: this.spanCount,
      bytes: this.unsampledBytes(),
      capped: !enabled && this.capped,
    };
  }

  /** Store size without capturing the check itself as a span. */
  private unsampledBytes(): number {
    try {
      return unsampled(() => currentBytes(this.dataDir));
    } catch {
      return 0;
    }
  }

  /**
   * Empty the store (Debug → Clear). Keeps recording on when it is on;
   * the cap re-evaluates from the emptied store.
   */
  clear(): void {
    try {
      unsampled(() => {
        fs.rmSync(spansFile(this.dataDir), { force: true });
      });
    } catch {
      // Missing file clears to the same empty state.
    }
    this.spanCount = 0;
    this.spansSinceCheck = 0;
  }

  /**
   * Everything recorded so far, scrubbed for handoff (Jaeger/Perfetto).
   * The local file stays raw; only the export is anonymized.
   */
  exportOtlp(): TraceExport {
    const spans: OtlpSpan[] = [];
    let text = "";
    try {
      text = unsampled(() =>
        fs.readFileSync(spansFile(this.dataDir), "utf8"),
      );
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as OtlpSpan;
          if (typeof parsed.traceId === "string" && typeof parsed.spanId === "string") {
            spans.push(scrubExportedSpan(parsed));
          }
        } catch {
          // A torn last line (crash mid-append) is skipped, not fatal.
        }
      }
    } catch {
      // No store yet: empty export.
    }
    return {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "unvibe" } }] },
          scopeSpans: [{ scope: { name: "unvibe", version: "0.0.15" }, spans }],
        },
      ],
    };
  }
}

/**
 * Stamp the route pattern onto the auto HTTP span (the export scrubber
 * renames from it; the raw URL/query stay hashed). No-op while
 * recording is off. Registered from `server.ts` via the loader.
 */
export function attachRouteHook(
  app: FastifyInstance,
  getRecorder: () => TraceRecorder | null,
): void {
  app.addHook("preHandler", async (req) => {
    try {
      if (!getRecorder()?.enabled) return;
      const pattern = req.routeOptions?.url;
      if (typeof pattern === "string" && isRoutePattern(pattern)) {
        const { context, trace } = otel().api;
        trace.getSpan(context.active())?.setAttribute("http.route", pattern);
      }
    } catch {
      // Tracing never breaks requests.
    }
  });
}

class LiveSpan implements SpanHandle {
  constructor(private readonly span: Span) {}
  setAttribute(key: string, value: string | number | boolean): void {
    this.span.setAttribute(key, value);
  }
  rename(name: string): void {
    this.span.updateName(name);
  }
  end(extra: Record<string, string | number | boolean> = {}): void {
    for (const [k, v] of Object.entries(extra)) this.span.setAttribute(k, v);
    this.span.end();
  }
}

/** Validate one browser batch entry into a storable RAW OTLP span. */
function toBrowserOtlp(entry: BrowserSpanBatch["spans"][number]): OtlpSpan | null {
  if (typeof entry.kind !== "string" || entry.kind === "") return null;
  if (!entry.traceId || !HEX32.test(entry.traceId) || !entry.spanId || !HEX16.test(entry.spanId)) return null;
  const startMs = entry.startMs ?? Date.now();
  const durationMs = entry.durationMs ?? 0;
  if (!Number.isFinite(startMs) || !Number.isFinite(durationMs)) return null;
  if (durationMs < 0 || durationMs > 3_600_000) return null;
  const startNs = Math.round(startMs * 1e6);
  if (!Number.isFinite(startNs) || startNs <= 0) return null;
  const attributes = Object.entries(entry.attributes ?? {}).map(([key, value]) => ({
    key,
    value:
      typeof value === "number" && Number.isFinite(value)
        ? Number.isInteger(value)
          ? { intValue: String(value) }
          : { doubleValue: value }
        : { stringValue: String(value) },
  }));
  const out: OtlpSpan = {
    traceId: entry.traceId,
    spanId: entry.spanId,
    name: entry.name ?? `browser ${entry.kind}`,
    kind: 0,
    startTimeUnixNano: String(startNs),
    endTimeUnixNano: String(startNs + Math.round(durationMs * 1e6)),
    attributes,
  };
  if (entry.parentSpanId && HEX16.test(entry.parentSpanId)) out.parentSpanId = entry.parentSpanId;
  return out;
}

function toOtlp(span: ReadableSpan): OtlpSpan {
  const ctx = span.spanContext();
  const attributes = Object.entries(span.attributes ?? {}).map(([key, value]) => ({
    key,
    value:
      typeof value === "number" && Number.isFinite(value)
        ? Number.isInteger(value)
          ? { intValue: String(value) }
          : { doubleValue: value }
        : Array.isArray(value)
          ? { stringValue: value.map(String).join(",") }
          : { stringValue: String(value) },
  }));
  const out: OtlpSpan = {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    name: span.name,
    kind: span.kind ?? 1,
    startTimeUnixNano: String(Math.round(span.startTime[0] * 1e9 + span.startTime[1] / 1e6)),
    endTimeUnixNano: String(Math.round(span.endTime[0] * 1e9 + span.endTime[1] / 1e6)),
    attributes,
  };
  const parentId = span.parentSpanContext?.spanId;
  if (typeof parentId === "string" && HEX16.test(parentId) && parentId !== "0000000000000000") {
    out.parentSpanId = parentId;
  }
  if (span.status.code !== 0) {
    out.status = { code: span.status.code, ...(span.status.message ? { message: span.status.message } : {}) };
  }
  return out;
}

function currentBytes(dataDir: string): number {
  try {
    return fs.statSync(spansFile(dataDir)).size;
  } catch {
    return 0;
  }
}

function countStoredSpans(dataDir: string): number {
  try {
    const text = fs.readFileSync(spansFile(dataDir), "utf8");
    let n = 0;
    // NUL bytes only occur in sparse padding past a torn tail (real
    // span lines never contain a raw NUL: JSON escapes it).
    for (const line of text.split("\n")) if (line.trim() && !line.includes("\0")) n++;
    return n;
  } catch {
    return 0;
  }
}


