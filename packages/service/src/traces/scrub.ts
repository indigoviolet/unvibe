/**
 * Trace scrubber (issue #356). The local recording is RAW — whatever the
 * auto-instrumentations capture (URLs and query strings, headers, fs
 * paths, argv, env) is stored as-is. Scrubbing happens here, in a
 * processor ON EXPORT (`scrubExportedSpan`, applied by
 * `TraceRecorder.exportOtlp`): the exported file carries only numbers,
 * fixed enums/safe tokens, and salted HMAC hashes (one random salt per
 * export, never written anywhere — same rule as the #323 stats exporter).
 * No code, file contents, reviewed-repo paths, home-folder paths,
 * tokens, query strings, headers, argv, env, or prompt text ever reach
 * the export. Absolute wall-clock times stay (they are the waterfall).
 */
import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import type { OtlpAttribute, OtlpSpan } from "@unvibe/shared";
import { JOB_KINDS, JOB_STATES } from "./stats-spans.js";

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** True for values safe to keep verbatim (short safe tokens). */
export function isSafeToken(value: string): boolean {
  return SAFE_TOKEN.test(value);
}

/** Salted hasher factory: one random salt per export, never persisted. */
export function makeTraceHasher(): (kind: string, value: string) => string {
  const salt = randomBytes(32);
  return (kind, value) =>
    createHmac("sha256", salt).update(`${kind}:${value}`).digest("hex").slice(0, 16);
}

/**
 * Route patterns (`/api/reviews/:id`) are code constants, safe to keep
 * readable. Anything with a space, query string, or backslash is not a
 * pattern and stays hashed.
 */
export function isRoutePattern(value: string): boolean {
  return /^\/[A-Za-z0-9._~:/*-]*$/.test(value);
}

/** HTTP methods worth keeping; anything else is dropped, not hashed. */
const KNOWN_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

/** Bare auto-instrumentation names (`GET`) and anything URL-shaped. */
const BARE_METHOD = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/i;
const URLISH = /[/:?#&=]/;

/**
 * Attribute keys dropped outright (never hashed — a hash of a token,
 * query string or header value would still group attacker-chosen
 * values): query strings, headers, user agents, env, argv/args, bodies,
 * and transport noise. Matching is case-insensitive.
 */
const DROP_KEY = /query|header|user.agent|useragent|\benv\b|argv|\bargs\b|arguments|body|cookie|auth|token|flavor|transport|method.original|peer|status.text|scheme/i;

/**
 * URL / host / path carriers: hashed (query stripped first) so endpoint
 * grouping survives without ever keeping a raw URL, path or host.
 */
function isHashUrlKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === "http.url" ||
    k === "http.target" ||
    k === "http.host" ||
    k === "http.path" ||
    k === "url.full" ||
    k === "url.path" ||
    k === "server.address" ||
    k === "net.host.name" ||
    k === "net.host.ip"
  );
}

/**
 * Attribute keys whose values are always hashed, even when they look
 * like innocent safe tokens: review/session/repo ids and any path, file
 * or host reference (#323 hashes every id; a `rv-…` id must never be
 * kept verbatim just because it matches the token grammar).
 */
function isIdLikeKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k === "review" || k === "session" || k === "repo" || k === "host") return true;
  return (
    k === "http.route" ||
    k.endsWith(".review") ||
    k.endsWith(".session") ||
    k.endsWith(".repo") ||
    k.endsWith(".path") ||
    k.endsWith(".file") ||
    k.endsWith(".host") ||
    k === "http.target" ||
    k === "http.url" ||
    k === "url.full" ||
    k === "url.path" ||
    k === "server.address" ||
    k === "net.host.name" ||
    k === "exec.cmd"
  );
}

/** Strip query strings and fragments; never throws. */
function stripQuery(value: string): string {
  const q = value.indexOf("?");
  const h = value.indexOf("#");
  const cut = q < 0 ? h : h < 0 ? q : Math.min(q, h);
  return cut < 0 ? value : value.slice(0, cut);
}

/**
 * Fixed-shape stats keys (issue #366). Anything `job.*` / `review*`
 * outside this set is forged (browser beacon) and drops — including
 * numeric values, which otherwise bypass value scrubbing.
 */
const STATS_KEYS = new Set([
  "job.id", "job.kind", "job.state", "job.provider", "job.model", "job.effort",
  "job.access", "job.session", "job.turns", "job.repairs", "job.attempts", "job.attempt",
  "job.failure", "job.queued_ms", "job.duration_ms",
  "job.tokens.input", "job.tokens.cached_read", "job.tokens.cached_write", "job.tokens.output",
  "review", "review.kind", "review.files", "review.hunks", "review.skipped", "review.added",
  "review.removed", "review.pages", "review.cards", "review.threads", "review.replies",
  "review.outbox", "review.versions",
]);

export function isStatsKey(key: string): boolean {
  if (STATS_KEYS.has(key)) return true;
  if (key.startsWith("job.tool.")) {
    const suffix = key.slice("job.tool.".length);
    return suffix === "other" || isSafeToken(suffix);
  }
  return /^job\.read\.\d+\.(file|lines|inside)$/.test(key);
}

/** API SpanKind (0..4) → OTLP spec kind (1..5); unknown → UNSPECIFIED. */
function toOtlpKind(kind: number | undefined): number {
  return kind === 0 ? 1 : kind === 1 ? 2 : kind === 2 ? 3 : kind === 3 ? 4 : kind === 4 ? 5 : 0;
}

export interface ExportScrubber {
  scrubSpan(span: OtlpSpan): OtlpSpan;
}

/** Fresh scrubber per export (fresh salt). */
export function createExportScrubber(): ExportScrubber {
  const hash = makeTraceHasher();

  const hashed = (key: string, value: string): string => hash(key, value);

  /**
   * Stats-shaped span keys (`job.*`, `review`, `review.*`, issue #366):
   * every id and path hashes, known enums stay verbatim, unknown enums
   * become `other` (the old exporter's fail-closed rule), and anything
   * off-shape drops. Null when the key is not stats-shaped (generic
   * handling applies).
   */
  function scrubStatsValue(key: string, value: string): { drop: boolean; kept?: string } | null {
    if (!(key === "review" || key.startsWith("job.") || key.startsWith("review."))) return null;
    // Identity + paths hash (the old exporter salted these per export).
    if (
      key === "review" || key === "job.id" || key === "job.review" || key === "job.session" ||
      key.endsWith(".file")
    ) {
      return { drop: false, kept: hashed(key, value) };
    }
    // Tool counts: the suffix is sanitized at record time; a forged
    // suffix (browser beacon) drops rather than leaking into a key.
    if (key.startsWith("job.tool.")) {
      const suffix = key.slice("job.tool.".length);
      if (suffix !== "other" && !isSafeToken(suffix)) return { drop: true };
      return isSafeToken(value) ? { drop: false, kept: value } : { drop: false, kept: hashed(key, value) };
    }
    // Read slots: fixed shape, anything else drops.
    if (key.startsWith("job.read.")) {
      if (!/^job\.read\.\d+\.(file|lines|inside)$/.test(key)) return { drop: true };
      if (key.endsWith(".inside")) {
        return value === "true" || value === "false" ? { drop: false, kept: value } : { drop: true };
      }
      return isSafeToken(value) ? { drop: false, kept: value } : { drop: false, kept: hashed(key, value) };
    }
    // Enums: known values verbatim, everything else `other`. Effort
    // keeps `""` (the adapter default, as the old exporter did).
    if (key in STATS_ENUMS) {
      if (key === "job.effort" && value === "") return { drop: false, kept: "" };
      if (!isSafeToken(value)) return { drop: false, kept: "other" };
      const allowed = STATS_ENUMS[key];
      if (allowed && !allowed.has(value)) return { drop: false, kept: "other" };
      return { drop: false, kept: value };
    }
    // Other stats counters (`job.turns`, `job.queued_ms`, `review.files`,
    // …): numbers never reach here; safe strings stay, rest hashes.
    if (
      key === "job.turns" || key === "job.repairs" || key === "job.attempts" || key === "job.attempt" ||
      key.endsWith("_ms") || key.startsWith("job.tokens.") || key.startsWith("review.")
    ) {
      return isSafeToken(value) ? { drop: false, kept: value } : { drop: false, kept: hashed(key, value) };
    }
    return { drop: true };
  }

  function scrubValue(key: string, value: string): { drop: boolean; kept?: string } {
    const stats = scrubStatsValue(key, value);
    if (stats) return stats;
    if (isHashUrlKey(key)) return { drop: false, kept: hashed(key, stripQuery(value)) };
    if (DROP_KEY.test(key)) return { drop: true };
    if (key === "http.route") {
      return isRoutePattern(value) ? { drop: false, kept: value } : { drop: false, kept: hashed(key, value) };
    }
    if (key === "http.method" || key === "http.request.method") {
      const upper = value.toUpperCase();
      return KNOWN_METHODS.has(upper) ? { drop: false, kept: upper } : { drop: true };
    }
    if (key === "exec.cmd") {
      const base = path.basename(value);
      return { drop: false, kept: isSafeToken(base) ? base : hashed(key, base) };
    }
    if (isIdLikeKey(key)) {
      return { drop: false, kept: hashed(key, stripQuery(value)) };
    }
    if (isSafeToken(value)) return { drop: false, kept: value };
    // Fail closed: unknown free text hashes (grouping survives).
    return { drop: false, kept: hashed(key, value) };
  }

  function scrubAttributes(attrs: OtlpAttribute[] | undefined): OtlpAttribute[] {
    const out: OtlpAttribute[] = [];
    for (const attr of attrs ?? []) {
      const v = attr.value;
      if (typeof v.intValue === "string" && /^-?\d+$/.test(v.intValue)) {
        // Numeric stats keys are fixed-shape; a forged numeric key
        // (browser beacon) drops instead of reaching the export.
        if (!isStatsKey(attr.key) && (attr.key === "review" || attr.key.startsWith("job.") || attr.key.startsWith("review."))) continue;
        out.push({ key: attr.key, value: { intValue: v.intValue } });
        continue;
      }
      if (typeof v.doubleValue === "number" && Number.isFinite(v.doubleValue)) {
        if (!isStatsKey(attr.key) && (attr.key === "review" || attr.key.startsWith("job.") || attr.key.startsWith("review."))) continue;
        out.push({ key: attr.key, value: { doubleValue: v.doubleValue } });
        continue;
      }
      if (typeof v.stringValue !== "string") continue;
      const r = scrubValue(attr.key, v.stringValue);
      if (!r.drop && r.kept !== undefined) out.push({ key: attr.key, value: { stringValue: r.kept } });
    }
    return out;
  }

  const JOB_PROVIDERS = new Set(["claude", "codex", "pi", "other"]);
const JOB_ACCESSES = new Set(["full", "lockdown"]);
const JOB_FAILURES = new Set([
  "timeout", "rate-limit", "auth", "no-agent", "not-found", "head-moved", "network", "cancelled", "interrupted", "other",
]);
const REVIEW_KINDS = new Set(["change", "document"]);

/** Allowlisted values per stats enum key; null keeps any safe token. */
const STATS_ENUMS: Record<string, Set<string> | null> = {
  "job.kind": JOB_KINDS,
  "job.state": JOB_STATES,
  "job.provider": JOB_PROVIDERS,
  "job.access": JOB_ACCESSES,
  "job.failure": JOB_FAILURES,
  "review.kind": REVIEW_KINDS,
  "job.model": null,
  "job.effort": null,
};

/** Method from the usual method attributes (uppercased, allowlisted). */
  function spanMethod(attrs: OtlpAttribute[] | undefined): string | null {
    for (const attr of attrs ?? []) {
      if ((attr.key === "http.method" || attr.key === "http.request.method") && typeof attr.value.stringValue === "string") {
        const upper = attr.value.stringValue.toUpperCase();
        if (KNOWN_METHODS.has(upper)) return upper;
      }
    }
    return null;
  }

  function scrubSpan(span: OtlpSpan): OtlpSpan {
    const attrs = scrubAttributes(span.attributes);
    const byKey = new Map(attrs.map((a) => [a.key, a.value]));
    const strOf = (v: unknown): string | null =>
      typeof v === "object" && v !== null && typeof (v as { stringValue?: unknown }).stringValue === "string"
        ? ((v as { stringValue: string }).stringValue as string)
        : null;
    const method = spanMethod(span.attributes);
    const route = strOf(byKey.get("http.route"));
    let name = span.name;
    // Raw API kinds: 1 = server, 2 = client (mapped to spec kinds below).
    const serverLike = span.kind === 1 || hasServerAttr(span);
    const fastifyOp = /^(middleware|request handler) - ([A-Za-z0-9 _.-]+?)( -> .*)?$/.exec(name);
    // Fastify operation spans keep their operation prefix; the `-> plugin`
    // suffix (arbitrary plugin names) is cut. They carry `http.route`.
    const fastifyName = fastifyOp ? `${fastifyOp[1]} - ${fastifyOp[2]}` : null;
    if (fastifyName && /^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,80}$/.test(fastifyName)) {
      name = fastifyName;
    } else if (hasHttpMarker(span) && (BARE_METHOD.test(name) || URLISH.test(name))) {
      // Bare `GET` or `GET /path?query` auto names become
      // `http METHOD route|other` server-side, `fetch METHOD` client-side.
      // Operation-shaped names (`request handler - fastify`) are kept.
      name = method ? (serverLike ? `http ${method} ${route ?? "other"}` : `fetch ${method}`) : "http other";
    } else if (name.startsWith("exec ")) {
      // Record-time names are already `exec <safe-basename|other>`; keep
      // them when strict, collapse anything else (attrs keep grouping).
      if (!/^exec [A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) name = "exec other";
    } else if (!/^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,80}$/.test(name)) {
      // Anything else URL-shaped (browser spans with paths, hostile
      // manual names) collapses to a fixed operation label.
      name = "span";
    }
    const out: OtlpSpan = {
      traceId: span.traceId,
      spanId: span.spanId,
      name,
      kind: toOtlpKind(span.kind),
      startTimeUnixNano: span.startTimeUnixNano,
      endTimeUnixNano: span.endTimeUnixNano,
      attributes: attrs,
    };
    if (span.parentSpanId) out.parentSpanId = span.parentSpanId;
    if (span.status && span.status.code !== 0 && span.status.code !== undefined) {
      // Keep the code; the message may carry raw error text (paths).
      out.status = { code: span.status.code };
    }
    return out;
  }

  return { scrubSpan };
}

/** True for spans carrying auto-HTTP markers (server or client). */
function hasHttpMarker(span: OtlpSpan): boolean {
  for (const attr of span.attributes ?? []) {
    const k = attr.key;
    if (
      k === "http.url" || k === "http.target" || k === "url.full" ||
      k === "http.route" || k === "http.request.method" || k === "http.method"
    ) {
      return true;
    }
  }
  return false;
}

/** True for server-side HTTP spans (raw API kind 1, or server markers). */
function hasServerAttr(span: OtlpSpan): boolean {
  if (span.kind === 1) return true;
  if (span.kind === 2) return false;
  for (const attr of span.attributes ?? []) {
    if (attr.key === "http.target" || attr.key === "http.url" || attr.key === "http.route") return true;
  }
  return false;
}

/** Scrub one recorded span for export (fresh salt per call — prefer `createExportScrubber` per file). */
export function scrubExportedSpan(span: OtlpSpan): OtlpSpan {
  return createExportScrubber().scrubSpan(span);
}
