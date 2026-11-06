/**
 * Opt-in performance traces (issue #356): wire types for the Debug-page
 * recording switch, status/size/Clear, and export.
 *
 * Recording is off by default (`Settings.recordTraces`). Spans are kept
 * locally under `<dataDir>/traces/` for as long as recording is on — no
 * rotation, no upload. Export is OTLP JSON (see `TraceExport`): Jaeger
 * reads OTLP natively and Perfetto converts it via `traceconv`, so one
 * format serves both viewers.
 */

/** `GET /api/traces/status`: recording state plus local store size. */
export interface TraceStatusResponse {
  /** True while the Debug switch is on and spans are being recorded. */
  recording: boolean;
  /** Spans stored so far (across the current recording). */
  spans: number;
  /** Store size in bytes (the spans file on disk). */
  bytes: number;
  /**
   * True when recording stopped itself at the safety cap (see
   * `TRACE_SAFETY_CAP_BYTES`): older spans are kept, nothing is deleted,
   * and Debug shows a notice instead of silently resuming.
   */
  capped: boolean;
}

/** One OTLP/JSON span attribute value (`AnyValue` subset we emit). */
export interface OtlpAttributeValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
}

/** One OTLP/JSON span attribute. */
export interface OtlpAttribute {
  key: string;
  value: OtlpAttributeValue;
}

/**
 * One OTLP/JSON span. Times are strings of unix nanoseconds (OTLP/JSON
 * encodes uint64 as strings); ids are lowercase hex (16 chars for span
 * ids, 32 for trace ids).
 */
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtlpAttribute[];
  status?: { code?: number; message?: string };
}

/** `GET /api/traces/export`: everything recorded so far, as OTLP JSON. */
export interface TraceExport {
  resourceSpans: {
    resource?: { attributes?: OtlpAttribute[] };
    scopeSpans: {
      scope: { name: string; version?: string };
      spans: OtlpSpan[];
    }[];
  }[];
}
