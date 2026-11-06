# Performance traces (#356)

Opt-in OpenTelemetry traces for debugging Unvibe itself. Off by default;
nothing is recorded until Settings → Debug → "Record performance traces"
is turned on, and turning it off stops recording.

## What is recorded

Manual OTel spans only (no auto-instrumentation, no profilers):

- `http <METHOD> <route-pattern>` — every request; the name uses the
  Fastify route pattern, never the raw URL (no ids, no `?token=`). The raw
  pathname is stored hashed (`http.path`) for grouping.
- `job <kind>` — every queue attempt (kind, provider, model, attempt,
  review hash, end state); durations come from the span itself.
- `exec <command>` — every child process (`git`, `gh`, agent CLIs, …):
  the command **basename** only, never arguments, env or cwd.
- `sqlite <op>` — every statement execution, by operation name
  (`select`, `insert`, …) plus the schema table; bound values never
  reach a span.
- `ingest`, `refresh`, `open-to-first-card` — the create path, the
  refresh path, and review-open to first guide card (via the review bus).
- `browser document-load|fetch|interaction` — the web SDK beacon; fetch
  spans carry the W3C `traceparent` header so the service HTTP span joins
  the same trace.

## Storage

`<dataDir>/traces/spans.jsonl`: one OTLP/JSON span object per line,
appended synchronously (crash-safe). Kept for as long as recording is
on — **no time window, no rotation**. Debug shows the span count and
byte size, with a Clear button (inline confirm).

Safety cap: **256 MB**. Past it, recording stops itself and Debug shows
a notice (`capped` in `GET /api/traces/status`); older spans are kept,
nothing is deleted. Clear the store, then toggle the switch to record
again.

## Export

Settings → Debug → Export traces, or `GET /api/traces/export`
(`unvibe-traces.json`): everything recorded so far as **OTLP JSON** —
the OTel standard. Jaeger accepts OTLP natively; Perfetto converts it
with `traceconv`. Nothing is uploaded, ever.

## Scrubbing

Same allowlist rule as the #323 stats export (see `docs/stats-export.md`
and `packages/service/src/traces/scrub.ts`): numbers, fixed enums/safe
tokens, and salted HMAC hashes (one random salt per process, never
written anywhere). Review/session/repo ids and any path or file
reference always hash — even when they look like safe tokens. Span times
stay (they are the product). A canary leak test
(`packages/service/test/traces.test.ts`) seeds canaries through every
seam — review ids, commands, paths, models, browser paths — and fails if
any 6+ character substring reaches the export.

## Cost when off

Zero: every seam calls `traceSpan`, which returns a no-op without
touching the SDK when recording is off — no exporter running, no span
storage, no file. The browser SDK is idle until the Debug switch arms it.

## Dependencies (pure JS, no native addons)

Service: `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`,
`@opentelemetry/core` (W3C propagation). Web: `@opentelemetry/api`,
`@opentelemetry/sdk-trace-web`, `@opentelemetry/sdk-trace-base`
(types for the beacon exporter).
