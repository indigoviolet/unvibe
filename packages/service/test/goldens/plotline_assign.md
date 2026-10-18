# Plotline assign

The reader named the change's plotlines but did not see every hunk, so
some hunks have no plotline yet. A plotline is a thread of change with
its own purpose — the unit of a separate commit or stacked PR — never a
file type: tests, docs and config belong to the thread they serve.
Assign each hunk below to exactly one of the plotlines, by closest fit
to that purpose. You see only these hunks: do not rename the plotlines
or invent new ones. A hunk that serves no thread (mechanical churn:
formatting, generated files, lock files) goes to no plotline — omit it,
and it reads as "other".

The commit list is evidence for closest fit, not the answer: a hunk
the same commit touched as a plotline's known hunks usually belongs
with them, and a fixup commit's hunks belong to the thread it fixes.
Commit subjects never override a plotline's stated purpose.

## Plotlines

- retry-logic: Retry failed uploads — retries with backoff

## Commits (subject, hunks each touched)

- `aaa1114` Unfold obsolete folded header values — hunks: h:conn:h111, h:conn:h222

## Hunks (hunk ID, file, one-line summary)

- h:conn:h111 src/conn.py: Adds a fast path that skips values without CRLF.

## Output

Only the trailing fenced `json` block, and nothing after it:

```json
{"assignments": {"h:<fileKey>:<hash>": "<plotline-id>"}}
```

Every hunk that serves a thread appears once, with one of the plotline
IDs from the list; hunks that serve no thread are omitted. Never invent
an ID on either side.
