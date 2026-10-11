---
role: user
tier: main
variables: [card, level]
---

# Diagram

Add a diagram to the card below, after the paragraphs it relates to. Never
add one the card already has.

## Card

{{card}}

## Level to match

{{level}}

## Rules

- The diagram is a fenced `diagram` block holding JSON (kind `flow` for
  data flow, `panels` for a before/after, `sequence` for interactions).
  Five to nine nodes; every title short (≤48 chars), `sub`/labels ≤80.
  Caps: ≤12 nodes, ≤16 edges, ≤6 actors, ≤16 messages.
- Citations go in `cite` fields (bare payloads like `diff:conn:91-110`,
  never `[[…]]`): every node, edge, panel or message may carry one,
  pointing at the code each step comes from. Titles, subs, labels and
  lines are plain text (no tokens).
- Use `col` (0–5) to order left-to-right flow, `row` for vertical order;
  `state` is `ok`, `bad` or `neutral`. Example:

  ```diagram
  {
    "version": 1, "kind": "flow", "title": "Header data flow",
    "nodes": [
      {"id": "srv", "title": "Server", "sub": "folded header", "col": 0},
      {"id": "norm", "title": "normalize", "cite": "diff:conn:91-110", "col": 1, "state": "ok"}
    ],
    "edges": [{"from": "srv", "to": "norm", "label": "parse"}]
  }
  ```

- After the block, two to four lines of prose walking the reader through
  it, with citations. Do not start that paragraph with `Caption:` — that
  prefix would make it the diagram's caption instead of a walkthrough.
- Match the card's level: name the parts at `simple`, use the code's own
  names at `standard`, show the invariant at `deep`.
- Output the diagram block, the walkthrough, and the trailing JSON block.
