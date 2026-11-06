/**
 * Opt-in performance-trace recorder (issue #356).
 *
 * OpenTelemetry only: spans are created through the OTel JS SDK
 * (`BasicTracerProvider` from `@opentelemetry/sdk-trace-base`, ids and
 * W3C trace-context propagation from `@opentelemetry/api`/`core`) and
 * stored as OTLP/JSON span objects, one per line, in
 * `<dataDir>/traces/spans.jsonl`. No profilers, no auto-instrumentation
 * packages: every seam (HTTP, jobs, child processes, SQLite, milestones)
 * records manual spans through this recorder, so attributes are
 * scrub-by-construction (see `scrub.ts`) instead of captured-then-stripped.
 *
 * Off by default. While off there is no exporter running and no span
 * storage — `startSpan` returns a no-op handle without touching the SDK,
 * so the cost is one boolean check. Storage is kept for as long as
 * recording is on: no time window, no rotation. A 256 MB safety cap
 * stops recording with a visible notice (`capped` in the status) rather
 * than deleting older data.
 */
import fs from "node:fs";
import { context, propagation, SpanKind, type Span } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { BasicTracerProvider, type ReadableSpan, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { OtlpSpan, TraceExport, TraceStatusResponse } from "@unvibe/shared";
import { ensureTracesDir, spansFile } from "./paths.js";
import { makeTraceHasher, scrubAttribute } from "./scrub.js";

/** Safety cap: stop recording past this many stored bytes (no deletion). */
export const TRACE_SAFETY_CAP_BYTES = 256 * 1024 * 1024;

/** How often the store size is re-checked while recording (every N spans). */
const SIZE_CHECK_EVERY = 64;

const NOOP_HANDLE: SpanHandle = {
  setAttribute() {},
  rename() {},
  end() {},
};

/** Live span: set scrubbed attributes, then end it. */
export interface SpanHandle {
  setAttribute(key: string, value: string | number | boolean): void;
  /** Replace the span name (must stay scrubbed: operation + safe tokens). */
  rename(name: string): void;
  end(extra?: Record<string, string | number | boolean>): void;
}

/** Parent linkage for a new span (W3C ids, e.g. from the browser). */
export interface SpanParent {
  traceId: string;
  spanId: string;
}

/** Browser batch entry (see the web `traceBeacon`: server scrubs here). */
export interface BrowserSpanBatch {
  spans: {
    /** "document-load" | "fetch" | "interaction" — anything else rejected. */
    kind: string;
    /** Page path or fetch pathname (hashed server-side, never stored). */
    path?: string;
    /** HTTP method for fetch spans (kept only as a safe token). */
    method?: string;
    /** HTTP status for fetch spans. */
    status?: number;
    /** Client-relative start (ms) and duration (ms). */
    startMs: number;
    durationMs: number;
    /** W3C ids from the browser SDK; regenerated when malformed. */
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
  }[];
}

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
 * Module-global recorder (mirrors `telemetry/sentry.ts`'s active
 * reporter): seams deep in the tree (job queue, command runner, SQLite
 * wrapper) record through here without threading a dependency through
 * every constructor. Null in tests and when the app never wired one —
 * every seam treats that as "off".
 */
let active: TraceRecorder | null = null;

export function setActiveRecorder(recorder: TraceRecorder | null): void {
  active = recorder;
}

export function getActiveRecorder(): TraceRecorder | null {
  return active;
}

/**
 * Start a span on the active recorder, or a no-op when recording is
 * off/unwired. Names must already be scrubbed; attributes are scrubbed
 * by the recorder.
 */
export function traceSpan(
  name: string,
  attrs: Record<string, string | number | boolean> = {},
  parent?: SpanParent,
  kind: SpanKind = SpanKind.INTERNAL,
): SpanHandle {
  return active?.startSpan(name, attrs, parent, kind) ?? NOOP_HANDLE;
}

/**
 * Parse an incoming W3C `traceparent` header into a span parent.
 * Malformed values yield undefined (a root span), never a throw.
 */
export function traceparentOf(header: unknown): SpanParent | undefined {
  if (typeof header !== "string") return undefined;
  const parts = header.split("-");
  if (parts.length < 4 || parts[0] !== "00") return undefined;
  const [, traceId, spanId] = parts;
  if (!traceId || !HEX32.test(traceId) || !spanId || !HEX16.test(spanId)) return undefined;
  return { traceId, spanId };
}

let propagatorInstalled = false;

export class TraceRecorder {
  private provider: BasicTracerProvider | null = null;
  private recording = false;
  private hitCap = false;
  private readonly hash = makeTraceHasher();
  private spansSinceCheck = 0;
  private spanCount = 0;

  constructor(private readonly dataDir: string) {
    // One global propagator per process: repeats log a warning.
    if (!propagatorInstalled) {
      propagatorInstalled = true;
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    }
    this.spanCount = countStoredSpans(dataDir);
  }

  get enabled(): boolean {
    return this.recording;
  }

  get capped(): boolean {
    return this.hitCap;
  }

  /** Start recording (Debug switch on). Idempotent. */
  setEnabled(on: boolean): void {
    if (on === this.recording) return;
    if (on) {
      ensureTracesDir(this.dataDir);
      this.provider = new BasicTracerProvider();
      this.provider.addSpanProcessor(new FileSpanProcessor((s) => this.store(s)));
      this.recording = true;
      this.hitCap = currentBytes(this.dataDir) >= TRACE_SAFETY_CAP_BYTES;
      if (this.hitCap) this.recording = false;
    } else {
      this.recording = false;
      const p = this.provider;
      this.provider = null;
      void p?.shutdown().catch(() => {});
    }
  }

  /**
   * Start a span. The name must already be scrubbed (operation + safe
   * tokens only); attributes are scrubbed here. Returns a no-op when
   * recording is off, without touching the SDK.
   */
  startSpan(
    name: string,
    attrs: Record<string, string | number | boolean> = {},
    parent?: SpanParent,
    kind: SpanKind = SpanKind.INTERNAL,
  ): SpanHandle {
    const provider = this.provider;
    if (!this.recording || !provider) return NOOP_HANDLE;
    const tracer = provider.getTracer("unvibe", "0.0.15");
    let ctx = context.active();
    if (parent && HEX32.test(parent.traceId) && HEX16.test(parent.spanId)) {
      const extracted = propagation.extract(ctx, { traceparent: `00-${parent.traceId}-${parent.spanId}-01` });
      ctx = extracted ?? ctx;
    }
    const span = tracer.startSpan(name, { kind }, ctx);
    for (const [k, v] of Object.entries(attrs)) {
      span.setAttribute(k, scrubAttribute(this.hash, k, v));
    }
    return new LiveSpan(this, span);
  }

  /**
   * Store one finished SDK span as an OTLP/JSON line. Stops recording
   * (with `capped`) past the safety cap instead of deleting anything.
   */
  private store(span: ReadableSpan): void {
    if (!this.recording) return;
    if (this.spansSinceCheck++ % SIZE_CHECK_EVERY === 0 && currentBytes(this.dataDir) >= TRACE_SAFETY_CAP_BYTES) {
      this.hitCap = true;
      this.setEnabled(false);
      return;
    }
    const otlp = toOtlp(span);
    try {
      fs.appendFileSync(spansFile(this.dataDir), `${JSON.stringify(otlp)}\n`, "utf8");
      this.spanCount++;
    } catch {
      // A full disk stops recording rather than crashing the service.
      this.hitCap = true;
      this.setEnabled(false);
    }
  }

  /**
   * Ingest browser spans (POSTed by the web SDK beacon). The browser
   * sends timing + opaque path/method under its own W3C ids; the server
   * stores them with scrubbed attributes, keeping the browser's trace
   * ids so one trace links browser and service spans (the service HTTP
   * span joins as a child via the `traceparent` header). The service
   * runs on the same machine as the browser, so client epoch-millis
   * anchor directly. Malformed entries are rejected, never stored.
   */
  ingestBrowser(batch: BrowserSpanBatch): { accepted: number; rejected: number } {
    if (!this.recording) return { accepted: 0, rejected: batch.spans?.length ?? 0 };
    let accepted = 0;
    let rejected = 0;
    for (const entry of batch.spans ?? []) {
      const otlp = scrubBrowserSpan(this.hash, entry);
      if (!otlp) {
        rejected++;
        continue;
      }
      try {
        fs.appendFileSync(spansFile(this.dataDir), `${JSON.stringify(otlp)}\n`, "utf8");
        this.spanCount++;
        accepted++;
      } catch {
        this.hitCap = true;
        this.setEnabled(false);
        rejected++;
      }
    }
    return { accepted, rejected };
  }

  status(): TraceStatusResponse {
    return {
      recording: this.recording,
      spans: this.spanCount,
      bytes: currentBytes(this.dataDir),
      capped: this.hitCap,
    };
  }

  /**
   * Empty the store (Debug → Clear). Keeps recording on when it is on,
   * and lifts the safety cap so toggling the switch records again.
   */
  clear(): void {
    try {
      fs.rmSync(spansFile(this.dataDir), { force: true });
    } catch {
      // Missing file clears to the same empty state.
    }
    this.spanCount = 0;
    this.spansSinceCheck = 0;
    this.hitCap = currentBytes(this.dataDir) >= TRACE_SAFETY_CAP_BYTES;
  }

  /** Everything recorded so far, as OTLP JSON (Jaeger/Perfetto-openable). */
  exportOtlp(): TraceExport {
    const spans: OtlpSpan[] = [];
    try {
      const text = fs.readFileSync(spansFile(this.dataDir), "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as OtlpSpan;
          if (typeof parsed.traceId === "string" && typeof parsed.spanId === "string") spans.push(parsed);
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

class LiveSpan implements SpanHandle {
  constructor(
    private readonly recorder: TraceRecorder,
    private readonly span: Span,
  ) {}
  setAttribute(key: string, value: string | number | boolean): void {
    this.span.setAttribute(key, scrubAttribute(this.recorder["hash"], key, value));
  }
  rename(name: string): void {
    this.span.updateName(name);
  }
  end(extra: Record<string, string | number | boolean> = {}): void {
    for (const [k, v] of Object.entries(extra)) {
      this.span.setAttribute(k, scrubAttribute(this.recorder["hash"], k, v));
    }
    this.span.end();
  }
}

/** HTTP methods worth recording; anything else is dropped, never stored. */
const KNOWN_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

/** Validate + scrub one browser batch entry into a storable OTLP span. */
function scrubBrowserSpan(
  hash: (kind: string, value: string) => string,
  entry: BrowserSpanBatch["spans"][number],
): OtlpSpan | null {
  if (entry.kind !== "document-load" && entry.kind !== "fetch" && entry.kind !== "interaction") return null;
  if (!entry.traceId || !HEX32.test(entry.traceId) || !entry.spanId || !HEX16.test(entry.spanId)) return null;
  if (!Number.isFinite(entry.startMs) || !Number.isFinite(entry.durationMs)) return null;
  if (entry.durationMs < 0 || entry.durationMs > 3_600_000) return null;
  const startNs = Math.round(entry.startMs * 1e6);
  if (!Number.isFinite(startNs) || startNs <= 0) return null;
  const attributes: OtlpSpan["attributes"] = [];
  // Method is an allowlist enum: a safe-token-shaped hostile value must
  // not be stored verbatim (a free-text method is dropped, not hashed —
  // a hash of it would still group attacker-chosen values).
  if (typeof entry.method === "string" && KNOWN_METHODS.has(entry.method.toUpperCase())) {
    attributes.push({ key: "http.method", value: { stringValue: entry.method.toUpperCase() } });
  }
  if (entry.status !== undefined && Number.isFinite(entry.status)) {
    attributes.push({ key: "http.status_code", value: { intValue: String(Math.round(entry.status)) } });
  }
  if (entry.path !== undefined) {
    const hashed = scrubAttribute(hash, "browser.path", entry.path);
    attributes.push({ key: "browser.path", value: { stringValue: String(hashed) } });
  }
  const out: OtlpSpan = {
    traceId: entry.traceId,
    spanId: entry.spanId,
    name: `browser ${entry.kind}`,
    kind: 1,
    startTimeUnixNano: String(startNs),
    endTimeUnixNano: String(startNs + Math.round(entry.durationMs * 1e6)),
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
  const parentId = span.parentSpanId;
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
    for (const line of text.split("\n")) if (line.trim()) n++;
    return n;
  } catch {
    return 0;
  }
}
