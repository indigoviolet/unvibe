/**
 * Browser performance traces (issue #356): the OTel web SDK
 * (`BasicTracerProvider` from `@opentelemetry/sdk-trace-web`) with manual
 * instrumentation for document load, same-origin fetches and clicks.
 * Finished spans are POSTed to the local service (`/api/traces/spans`),
 * which scrubs and stores them alongside the server spans under the
 * browser's W3C trace ids. Manual instrumentation (instead of the
 * auto-instrumentation packages) keeps the footprint small and the
 * attributes scrub-by-construction: paths are hashed server-side, and
 * query, headers and bodies never leave the browser.
 *
 * Idle unless `setTraceRecording(true, token)` runs (the Debug switch).
 * Everything here is best-effort: tracing never breaks the app.
 */
import { context, trace } from "@opentelemetry/api";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-web";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

export interface BeaconEntry {
  kind: string;
  path?: string;
  method?: string;
  status?: number;
  startMs: number;
  durationMs: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

const FLUSH_AT = 20;
const FLUSH_EVERY_MS = 10_000;

let provider: BasicTracerProvider | null = null;
let pageTraceId = "";
let pageSpanId = "";
let enabled = false;
let token = "";
let queue: BeaconEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let fetchWrapped = false;
let listenersAttached = false;

function hrToMs(hr: [number, number]): number {
  return hr[0] * 1000 + hr[1] / 1_000_000;
}

/** OTel exporter: queue scrub-ready entries for the service beacon. */
const beaconExporter: SpanExporter = {
  export(spans: ReadableSpan[], resultCallback: (result: { code: number }) => void): void {
    try {
      for (const span of spans) {
        const ctx = span.spanContext();
        const attrs = span.attributes as Record<string, string | number | undefined>;
        const kind = span.name;
        if (kind !== "document-load" && kind !== "fetch" && kind !== "interaction") continue;
        const startMs = hrToMs(span.startTime);
        if (!Number.isFinite(startMs)) continue;
        const entry: BeaconEntry = {
          kind,
          startMs: Math.round(startMs),
          durationMs: Math.max(0, Math.round(hrToMs(span.endTime) - startMs)),
          traceId: ctx.traceId,
          spanId: ctx.spanId,
        };
        if (typeof attrs["page.path"] === "string") entry.path = attrs["page.path"];
        if (typeof attrs["http.method"] === "string") entry.method = attrs["http.method"];
        if (typeof attrs["http.status_code"] === "number") entry.status = attrs["http.status_code"];
        const parentSpanId = span.parentSpanId;
        if (
          typeof parentSpanId === "string" &&
          /^[0-9a-f]{16}$/.test(parentSpanId) &&
          parentSpanId !== "0000000000000000"
        ) {
          entry.parentSpanId = parentSpanId;
        }
        queue.push(entry);
      }
      if (queue.length >= FLUSH_AT) void flush();
    } catch {
      // Tracing never breaks the app.
    }
    try {
      resultCallback({ code: 0 });
    } catch {
      // ignore
    }
  },
  shutdown(): Promise<void> {
    return Promise.resolve();
  },
};

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
  if (typeof flushTimer === "object" && "unref" in flushTimer) {
    (flushTimer as unknown as { unref(): void }).unref();
  }
}

function pageParent(): ReturnType<typeof context.active> {
  if (pageTraceId !== "" && pageSpanId !== "") {
    return trace.setSpanContext(context.active(), {
      traceId: pageTraceId,
      spanId: pageSpanId,
      traceFlags: 1,
    });
  }
  return context.active();
}

function wrapFetch(): void {
  if (fetchWrapped) return;
  fetchWrapped = true;
  const original = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!enabled || !provider) return original(input, init);
    let url: URL | null = null;
    try {
      url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, window.location.href);
    } catch {
      return original(input, init);
    }
    // Same-origin service calls only: no third-party timing or URLs.
    if (url.origin !== window.location.origin) return original(input, init);
    const tracer = provider.getTracer("unvibe-web", "0.0.15");
    const method = (init?.method ?? "GET").toUpperCase();
    const span = tracer.startSpan("fetch", { attributes: { "http.method": method, "page.path": url.pathname } }, pageParent());
    const headers = new Headers(init?.headers);
    const sc = span.spanContext();
    headers.set("traceparent", `00-${sc.traceId}-${sc.spanId}-01`);
    try {
      const res = await original(input, { ...init, headers });
      span.setAttribute("http.status_code", res.status);
      span.end();
      return res;
    } catch (err) {
      span.end();
      throw err;
    }
  }) as typeof window.fetch;
}

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener("click", () => {
    if (!enabled || !provider) return;
    try {
      const tracer = provider.getTracer("unvibe-web", "0.0.15");
      const span = tracer.startSpan(
        "interaction",
        { attributes: { "page.path": window.location.pathname }, startTime: Date.now() },
        pageParent(),
      );
      span.end(Date.now());
    } catch {
      // ignore
    }
  });
  const flushOnHide = (): void => {
    void flush();
  };
  window.addEventListener("pagehide", flushOnHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnHide();
  });
}

/**
 * Turn browser tracing on or off (the Debug switch). On enable, starts
 * the SDK once and opens the page's document-load span; on disable,
 * flushes once and stops recording (the fetch wrapper stays installed
 * but idle).
 */
export function setTraceRecording(on: boolean, nextToken?: string): void {
  if (nextToken !== undefined) token = nextToken;
  if (on && !provider) {
    try {
      const next = new BasicTracerProvider();
      next.addSpanProcessor(new SimpleSpanProcessor(beaconExporter));
      next.register();
      provider = next;
    } catch {
      provider = null;
    }
  }
  enabled = on && provider !== null;
  if (!enabled) {
    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    void flush();
    return;
  }
  scheduleFlush();
  wrapFetch();
  attachListeners();
  try {
    const tracer = provider!.getTracer("unvibe-web", "0.0.15");
    let startMs = Date.now();
    try {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav && nav.startTime >= 0) startMs = Math.round(performance.timeOrigin + nav.startTime);
    } catch {
      // fall back to now
    }
    const span = tracer.startSpan("document-load", {
      attributes: { "page.path": window.location.pathname },
      startTime: startMs,
    });
    const sc = span.spanContext();
    pageTraceId = sc.traceId;
    pageSpanId = sc.spanId;
    const endMs = Date.now();
    if (document.readyState === "complete") span.end(endMs);
    else window.addEventListener("load", () => span.end(Date.now()), { once: true });
  } catch {
    // ignore
  }
}

/** Currently recording (tests + the Debug switch label). */
export function isTraceRecording(): boolean {
  return enabled;
}
