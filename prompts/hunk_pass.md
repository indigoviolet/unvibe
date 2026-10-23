---
role: user
tier: small
variables: [hunk, path, plotline]
---

# Hunk pass

Summarise one diff hunk, and judge whether it is
interesting. You see only this hunk: do not speculate about the rest of the
change.

## File

{{path}}

## Plotline

{{plotline}}

When a plotline is named, let the summary say the hunk's role in that
step of the progression where that fits in one line; when none is named
yet, summarise the hunk on its own.

## Hunk

{{hunk}}

A hunk marked `CITED-BY-GUIDE` is cited by the guide: it is always
interesting, whatever it contains.

## Output

One Markdown line — the summary: what the hunk does, not how. Under 140
characters. Then the trailing fenced `json` block, and nothing after it:

```text
Adds a fast path that skips values without CRLF.
```

```json
{"hunk": {"summary": "Adds a fast path that skips values without CRLF.", "hiddenReason": null, "score": "routine"}}
```

Always send the summary line first, then the `json` block — never the
block on its own.

Set `hiddenReason` to a one-line reason only for generated files,
import-only changes, or docs/config churn (e.g. `"import-only change"`);
otherwise null. Never mark uninteresting: a hunk cited by the guide, a
hunk with a one-line functional change, or anything you are unsure about.
When unsure, it is interesting.

Set `score` to one ordered level for how much the hunk matters to a
reader: `mechanical` (renames, formatting, generated, imports),
`routine` (ordinary code with no surprises), `substantive` (behaviour
changes), or `needs attention` (risky: concurrency, security, data
loss, public API). Judge "public API" by reach: only a change someone
outside this module must know about or adapt to counts — a private
signature change is `routine`. When unsure, pick `routine`.

Citations: use `[[...]]` tokens only for IDs that appear in the hunk text
above. Never invent one.
