---
role: user
tier: main
variables: [concept, mentions]
---

# Concept stub

Write the first version of a concept page. Stubs are generated in one batch
for every hidden candidate the reader named, so keep each stub tight: a
title, one or two paragraphs at standard depth, and the key links. Full
pages are written later, on demand.

## Concept

{{concept}}

## Where it is mentioned

{{mentions}}

## Rules

- Explain the concept as this change uses it, not in general. One idea per
  paragraph; cite the diff or description lines that show it.
- Link related concepts with `[[concept:...]]` tokens where they genuinely
  connect. Do not force links.
- End with at most three follow-up questions a reader of this change would
  ask next, as a plain list.
