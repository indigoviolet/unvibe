# Performance traces (#356, owner decisions 2026-11-06)

Opt-in OpenTelemetry traces for debugging Unvibe itself, on the latest
OTel line. Off by default; nothing is recorded until Settings → Debug →
"Record performance traces" is turned on, and turning it off stops
recording.

## What is recorded

Auto-instrumentation where it exists, manual spans where it does not:

- **HTTP** (`instrumentation-http`): every request, server and client.
- **Fastify** (`instrumentation-fastify`): route handlers + middleware
  (operation names; the `http.route` pattern rides along).
- **undici** (`instrumentation-undici`): outgoing `fetch`.
- **fs** (`instrumentation-fs`): file operations (names only, no paths).
- Manual spans only for the rest: **jobs** (kind, provider, model,
  attempt, review), **SQLite** (operation + table), **child processes**
  (`exec`, basename + argv), and the **ingest / refresh /
  open-to-first-card** milestones.
- **Browser**: the OTel web SDK with auto-instrumentation for
  document load, fetch and user interactions, POSTed to the local
  service and stored with the server spans (trace context propagates
  via `traceparent`).

A route-pattern hook stamps `http.route` onto the auto HTTP server span
(the pattern comes from our own route table, never the raw URL).

## Raw recording, scrubbed export

The local store is RAW: `<dataDir>/traces/spans.jsonl`, one OTLP/JSON
span object per line — whatever the instrumentations capture (URLs and
query strings, headers, fs paths, argv, env). No rotation; kept for as
long as recording is on.

Scrubbing happens in a processor ON EXPORT (`scrubExportedSpan`,
fresh salt per export, never persisted):

- names: `http METHOD route|other` (server), `fetch METHOD` (client),
  `fs <op>`, fastify operation prefixes (`request handler`, `middleware`
  — the `-> plugin` suffix is cut), manual names kept when strict;
- dropped outright: query strings, headers, user agents, env, argv,
  cookies/tokens, transport noise, `status.message` (may carry paths);
- hashed (query stripped first): URLs, paths, hosts, review/session
  ids — every id-like key, even when it looks like a safe token;
- kept: methods (allowlist), status codes (numbers), route patterns
  (validated), enums, safe tokens, schema table names;
- API span kinds mapped to OTLP spec kinds; ids and times stay
  (structural).

A canary leak test (`packages/service/test/traces.test.ts`) seeds
canaries through every seam — review ids, commands + argv, a SQL
comment and bound value, real HTTP query strings, browser paths — and
asserts the raw file DID capture them and the EXPORTED file contains
none (no 6+ character substring anywhere).

## Storage, cap, export

The store lives in `<dataDir>-traces` — a sibling of the data dir,
not inside it. `unvibe reset-data` and the reset notice move only the
data dir aside, so traces survive resets (and version switches, which
keep the data dir) until the user presses Clear. One store per data
dir: parallel services, worktrees and test runs never share a file
or a size cap.

Debug shows the span count and byte size, with a Clear button (inline
confirm). Safety cap: **256 MB** — past it, recording stops with a
visible notice (`capped` in `GET /api/traces/status`); older spans are
kept, nothing is deleted. Clear, then toggle the switch to record
again.

Export: Settings → Debug → Export traces, or `GET /api/traces/export`
(`unvibe-traces.json`): everything recorded so far as **OTLP JSON** —
the OTel standard. Jaeger accepts OTLP natively; Perfetto converts it
with `traceconv`. Nothing is uploaded, ever.

## Cost when off

A toggle sampler drops every span before recording (no exporter
running, no span storage), and manual seams return no-ops without
touching the SDK. Auto-instrumentation patches stay installed but cost
one sampler check per operation. The browser SDK (including zone.js)
loads only when the Debug switch arms it.

## Self-tracing

The store's own file IO runs unsampled (`suppressTracing`): without
it, each append would be captured by the fs instrumentation and
recurse until the stack overflows and recording silently stops. The
service entry loads the instrumentation prelude first and `fastify`
lazily through a real CJS require — hoisted ESM imports and ESM dynamic
imports both miss require-in-the-middle hooks.

## Dependencies (pure JS, no native addons)

Service: `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`,
`@opentelemetry/core` (+ `context-async-hooks`),
`@opentelemetry/instrumentation` + `http`, `fastify`, `undici`, `fs`.
Web: `@opentelemetry/api`, `@opentelemetry/sdk-trace-web`,
`@opentelemetry/sdk-trace-base` (types), `@opentelemetry/context-zone`,
`zone.js`, `instrumentation-document-load/fetch/user-interaction`,
`@opentelemetry/instrumentation`.
