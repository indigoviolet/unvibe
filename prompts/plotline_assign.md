---
role: user
tier: small
variables: [plotlines, hunks]
---

# Plotline assign

The reader named the change's plotlines (named threads of the work) but
did not see every hunk, so some hunks have no plotline yet. Assign each
hunk below to exactly one of the plotlines, by closest fit. You see only
these hunks: do not rename the plotlines or invent new ones.

## Plotlines

{{plotlines}}

## Hunks (hunk ID, file, one-line summary)

{{hunks}}

## Output

Only the trailing fenced `json` block, and nothing after it:

```json
{"assignments": {"h:<fileKey>:<hash>": "<plotline-id>"}}
```

Every hunk ID above appears once, with one of the plotline IDs from the
list. Never invent an ID on either side.
