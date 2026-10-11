---
role: user
tier: small
variables: [hunk, path]
---

# Hunk pass

Summarise one diff hunk for a code reader, and judge whether it is
interesting. You see only this hunk: do not speculate about the rest of the
change.

## File

{{path}}

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
{"hunk": {"summary": "Adds a fast path that skips values without CRLF.", "hiddenReason": null}}
```

Set `hiddenReason` to a one-line reason only for generated files,
import-only changes, or docs/config churn (e.g. `"import-only change"`);
otherwise null. Never mark uninteresting: a hunk cited by the guide, a
hunk with a one-line functional change, or anything you are unsure about.
When unsure, it is interesting.

Citations: use `[[...]]` tokens only for IDs that appear in the hunk text
above. Never invent one.
