# Anonymized usage statistics export (#323)

A debug export of how Unvibe was used, built so the file can be handed
over without handing over the work. It exists to answer questions like
"how often do Ask jobs re-read files outside the diff?" from real usage.

## How to make one

- **Settings → Debug → Export statistics** — downloads `unvibe-stats.json`.
- **`unvibe stats export [--out <file>]`** — writes the file (default
  `./unvibe-stats.json`) and prints where it went.

Explicit only: no upload, no telemetry, no background job, no automatic
run. The export is read-only on the data dir and anonymized by default
with no flags — there is no way to turn anonymization off. Summarize a
file with `mise run stats:summary -- <file>` (reads only that file).

## How anonymization works

- The exporter writes **only** the schema fields below (allowlist).
- Every ID (review, job, session) and every read file path becomes an
  HMAC-SHA256 hash (first 16 hex chars) keyed by a **random salt
  generated per export, kept in memory and never written anywhere**.
  The same file within one export gets the same hash, so re-reading can
  be measured; nothing links across exports or back to a name.
- Times are **relative only**: durations and offsets from the owning
  review's creation, in milliseconds. No absolute timestamp is emitted.
- Errors become a **failure class enum**; the message is never emitted.
- Provider is an enum; model and effort are kept only when they are
  short safe tokens (`[A-Za-z0-9._-]`), else `other`. Tool names follow
  the same rule. Anything unrecognized becomes `other` (fail closed).

## Schema (schemaVersion 2)

Version 2 adds `reviews[].skippedHunkSummaries`, keeps the `persona`
job kind instead of folding it to `other`, and records `reads[].lines`
for `get_code`/`get_hunk` argument shapes (see below).

Top level: `{ schemaVersion, reviews, jobs, totals }`.

### `reviews[]` — one per review

| Field | Type | Meaning |
|---|---|---|
| `id` | hash | Salted hash of the review id |
| `kind` | enum | `change` \| `document` |
| `files` | number | Files in the current diff |
| `hunks` | number | Hunks in the current diff |
| `skippedHunkSummaries` | number | Hunks with no stored summary because the hunk-pass fan-out cap left them out (0 when the review fits the cap; missing summaries there are pending work, not cap skips) |
| `addedLines` / `removedLines` | number | Changed lines in the current diff |
| `guidePages` / `guideCards` | number | Guide size |
| `threads` / `replies` | number | Conversation size |
| `outboxThreads` | number | Threads marked for the Outbox, not yet posted |
| `versions` | number | Fetched versions of the change |
| `jobs` | number | Jobs recorded against this review |

### `jobs[]` — one per agent job

| Field | Type | Meaning |
|---|---|---|
| `id` / `review` / `session` | hash \| null | Salted grouping ids |
| `kind` | enum | Job kind (`reader`, `ask`, `explain` via `ask`, `depth`, `examples`, `diagram`, `persona`, …) or `other`. Conversation turns (Ask/Explain replies, follow-ups, depth, examples, diagram and persona runs) are jobs with the same fields |
| `state` | enum | `queued` \| `running` \| `backing-off` \| `done` \| `error` \| `cancelled` \| `other` |
| `provider` | enum | `claude` \| `codex` \| `pi` \| `other` |
| `model` / `effort` | token | Safe-token id, else `other` (`""` effort = adapter default) |
| `access` | enum \| null | `full` \| `lockdown` when recorded |
| `tokens` | object \| null | `{ input, cachedRead, cachedWrite, output }` |
| `toolCounts` | `[{tool, count}]` | Tool calls by tool type |
| `reads` | `[{file, lines, insideDiff}]` | File reads: salted path hash, lines read when known (else null), diff membership. `get_code` ranges come from its `path` + `startLine`/`endLine` (or `limit`/`count`) arguments; `get_hunk` reads resolve the hunk id to its file + new-side line span via the review snapshot; `Read path:a-b` details keep the token form |
| `turns` / `repairTurns` | number | Agent turns; turns labelled repair |
| `attempts` | number | Queue attempts |
| `failure` | enum \| null | Failure class for failed jobs (never the message) |
| `queuedMs` / `durationMs` / `offsetMs` | number \| null | Queue wait, run duration, offset from review creation |

### `totals`

`{ reviews, jobs, failures, repairs, tokens }` — counts and token sums
over the whole export.

## Deliberately excluded

Free text of any kind (titles, card/thread text, questions, answers,
comments, Outbox drafts, prompts, replies); file paths (even relative);
repo/org names; people's names and logins; PR numbers; branch names;
commit SHAs; absolute timestamps; the install token; environment
values; settings values; raw error messages. Cost is excluded because
no price is recorded locally — token counts are exported instead. The
fork-vs-fresh-session source is excluded because it is not persisted
per job. A leak test seeds canary strings in every such field and fails
if any 6+ character substring reaches the output.
