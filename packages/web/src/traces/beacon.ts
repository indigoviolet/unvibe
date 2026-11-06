/**
 * Browser performance traces (issue #356, owner decisions 2026-11-06):
 * the OTel web SDK with AUTO-instrumentation for document load, fetch
 * and user interactions. Finished spans are POSTed raw to the local
 * service (`/api/traces/spans`), which scrubs them on export.
 *
 * Everything OTel loads LAZILY inside `setTraceRecording(true)` — plain
 * `zone.js` included — so the normal app never evaluates it. Idle until
 * the Debug switch arms it. In lean builds (`__UNVIBE_TRACES__` false)
 * enabling is a no-op and the Debug section shows the install notice
 * instead. Best-effort throughout: tracing never breaks the app.
 */
declare const __UNVIBE_TRACES__: boolean;

/** False in lean builds (no OTel shipped): the Debug section explains how to get tracing. */
export function isTraceBuild(): boolean {
  try {
    return __UNVIBE_TRACES__ === true;
  } catch {
    return false;
  }
}

import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan, Sampler, SpanExporter } from "@opentelemetry/sdk-trace-base";

export interface BeaconEntry {
  kind: string;
  name?: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startMs?: number;
  durationMs?: number;
  attributes?: Record<string, string | number | boolean>;
}

const FLUSH_AT = 20;
const FLUSH_EVERY_MS = 10_000;

let enabled = false;
let token = "";
let queue: BeaconEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let listenersAttached = false;
let modules: OtelModules | null = null;

interface OtelModules {
  provider: { forceFlush(): Promise<void> };
}

function toMs(hr: [number, number]): number {
  return hr[0] * 1000 + hr[1] / 1_000_000;
}

function attrValue(v: unknown): string | number | boolean | undefined {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(String).join(",");
  return undefined;
}

/** OTel exporter: queue raw spans for the service beacon. */
function makeExporter(): SpanExporter {
  return {
    export(spans: ReadableSpan[], done: (r: { code: number }) => void): void {
      try {
        for (const span of spans) {
          const ctx = span.spanContext();
          const attrs: Record<string, string | number | boolean> = {};
          for (const [k, v] of Object.entries((span.attributes ?? {}) as Attributes)) {
            const flat = attrValue(v);
            if (flat !== undefined) attrs[k] = flat;
          }
          const startMs = Math.round(toMs(span.startTime));
          const endMs = Math.round(toMs(span.endTime));
          if (!Number.isFinite(startMs)) continue;
          const entry: BeaconEntry = {
            kind: "auto",
            name: span.name,
            traceId: ctx.traceId,
            spanId: ctx.spanId,
            startMs,
            durationMs: Math.max(0, endMs - startMs),
            attributes: attrs,
          };
          const parent = span.parentSpanContext?.spanId;
          if (parent && /^[0-9a-f]{16}$/.test(parent) && parent !== "0000000000000000") {
            entry.parentSpanId = parent;
          }
          queue.push(entry);
        }
        if (queue.length >= FLUSH_AT) void flush();
      } catch {
        // Tracing never breaks the app.
      }
      try {
        done({ code: 0 });
      } catch {
        // ignore
      }
    },
    shutdown(): Promise<void> {
      return Promise.resolve();
    },
  };
}

async function flush(): Promise<void> {
  if (queue.length === 0 || token === "") return;
  const batch = queue;
  queue = [];
  try {
    await fetch("/api/traces/spans", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ spans: batch }),
      keepalive: true,
    });
  } catch {
    // A failed beacon drops its batch (recording stays on; the next
    // flush retries with fresh spans, never an unbounded backlog).
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_EVERY_MS);
}

function attachHideListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  const hide = (): void => {
    void flush();
  };
  window.addEventListener("pagehide", hide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hide();
  });
}

async function loadOtel(): Promise<boolean> {
  if (modules) return true;
  try {
    // zone.js first: the ZoneContextManager needs its patches installed.
    await import("zone.js");
    const [{ WebTracerProvider, SimpleSpanProcessor }, { ZoneContextManager }, api, { registerInstrumentations }, { DocumentLoadInstrumentation }, { FetchInstrumentation }, { UserInteractionInstrumentation }] =
      await Promise.all([
        import("@opentelemetry/sdk-trace-web"),
        import("@opentelemetry/context-zone"),
        import("@opentelemetry/api"),
        import("@opentelemetry/instrumentation"),
        import("@opentelemetry/instrumentation-document-load"),
        import("@opentelemetry/instrumentation-fetch"),
        import("@opentelemetry/instrumentation-user-interaction"),
      ]);
    // 2 = RECORD_AND_SAMPLED, 0 = NOT_RECORD (mirrors the service).
    const sampler: Sampler = {
      shouldSample: () => ({ decision: enabled ? 2 : 0 }),
      toString: () => "TraceToggleSampler",
    };
    const provider = new WebTracerProvider({
      sampler,
      spanProcessors: [new SimpleSpanProcessor(makeExporter())],
    });
    const contextManager = new ZoneContextManager();
    provider.register({ contextManager });
    registerInstrumentations({
      tracerProvider: provider,
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation(),
        new UserInteractionInstrumentation(),
      ],
    });
    // Keep the API's bearings for later toggles (types only above).
    void api;
    modules = { provider };
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn browser tracing on or off (the Debug switch). Enabling loads the
 * OTel web SDK + auto-instrumentations on first use; disabling stops
 * recording (the sampler drops everything) and flushes once.
 */
export function setTraceRecording(on: boolean, nextToken?: string): void {
  if (nextToken !== undefined) token = nextToken;
  if (!isTraceBuild()) {
    // Lean build: nothing to load; the Debug section shows the
    // install notice instead of recording.
    enabled = false;
    return;
  }
  if (!on) {
    enabled = false;
    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    void flush();
    return;
  }
  attachHideListeners();
  scheduleFlush();
  void loadOtel().then((ok) => {
    enabled = ok;
    if (!ok && flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  });
}

/** Currently recording (tests + the Debug switch label). */
export function isTraceRecording(): boolean {
  return enabled;
}
