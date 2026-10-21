---
role: user
tier: small
variables: [plotlines, hunks, commits]
---

# Plotline assign

The reader named the change's plotlines but did not see every hunk, so
some hunks have no plotline yet. A plotline's job is pedagogic: the
plotlines split the change into a logical progression that shows how
the feature is built up, step by step, so each unit can be understood
on its own. A plotline is a thread of change with its own purpose —
the unit of a separate commit or stacked PR — never a file type:
tests, docs and config belong to the thread they serve.
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

{{plotlines}}

## Commits (subject, hunks each touched)

{{commits}}

## Hunks (hunk ID, file, one-line summary)

{{hunks}}

## Output

Only the trailing fenced `json` block, and nothing after it:

```json
{"assignments": {"h:<fileKey>:<hash>": "<plotline-id>"}}
```

Every hunk that serves a thread appears once, with one of the plotline
IDs from the list; hunks that serve no thread are omitted. Never invent
an ID on either side.
