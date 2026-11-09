/**
 * Trace seam API (issue #356): the OTel-free surface every seam imports.
 *
 * This module has NO `@opentelemetry/*` imports so the lean install
 * (without tracing dependencies) loads it fine: `traceSpan` returns a
 * no-op until a real backend is installed by `loader.ts` (which is the
 * only place that ever touches the OTel packages).
 */
/** Live span: set attributes, then end it. Values are stored RAW. */
export interface SpanHandle {
  setAttribute(key: string, value: string | number | boolean): void;
  rename(name: string): void;
  end(extra?: Record<string, string | number | boolean>): void;
}

/** Parent linkage for a new span (W3C ids, e.g. from the browser). */
export interface SpanParent {
  traceId: string;
  spanId: string;
}

/** Raw browser batch entry (validated, stored as-is; scrubbed on export). */
export interface BrowserSpanBatch {
  spans: {
    kind: string;
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name?: string;
    startMs?: number;
    durationMs?: number;
    attributes?: Record<string, string | number | boolean>;
  }[];
}

export const NOOP_SPAN: SpanHandle = {
  setAttribute() {},
  rename() {},
  end() {},
};

/** The recording backend (implemented by `TraceRecorder`). */
export interface TraceBackend {
  startSpan(
    name: string,
    attrs?: Record<string, string | number | boolean>,
    parent?: SpanParent,
    kind?: number,
  ): SpanHandle;
}

/**
 * Module-global backend (mirrors `telemetry/sentry.ts`'s active
 * reporter): seams deep in the tree record through here without threading
 * a dependency through every constructor. Null in tests, in lean builds,
 * and when the app never wired one — every seam treats that as "off".
 */
let active: TraceBackend | null = null;

export function setActiveTracer(backend: TraceBackend | null): void {
  active = backend;
}

export function getActiveTracer(): TraceBackend | null {
  return active;
}

/**
 * Start a manual span on the active backend (RAW; scrubbed on export),
 * or a no-op when recording is off/unwired. Names should already be
 * operation-shaped; attributes may be raw.
 */
export function traceSpan(
  name: string,
  attrs: Record<string, string | number | boolean> = {},
  parent?: SpanParent,
  kind?: number,
): SpanHandle {
  return active?.startSpan(name, attrs, parent, kind) ?? NOOP_SPAN;
}

/**
 * Parse an incoming W3C `traceparent` header into a span parent.
 * Malformed values yield undefined (a root span), never a throw.
 */
const HEX16 = /^[0-9a-f]{16}$/;
const HEX32 = /^[0-9a-f]{32}$/;

export function traceparentOf(header: unknown): SpanParent | undefined {
  if (typeof header !== "string") return undefined;
  const parts = header.split("-");
  if (parts.length < 4 || parts[0] !== "00") return undefined;
  const [, traceId, spanId] = parts;
  if (!traceId || !HEX32.test(traceId) || !spanId || !HEX16.test(spanId)) return undefined;
  return { traceId, spanId };
}