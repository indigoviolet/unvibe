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

- The diagram is a fenced `mermaid` block: a flowchart for data flow or a
  sequence diagram for interactions. Five to nine nodes; every node label
  short.
- Citation tokens are allowed inside node labels, pointing at the code each
  step comes from.
- After the block, two to four lines of prose walking the reader through
  it, with citations. Do not start that paragraph with `Caption:` — that
  prefix would make it the diagram's caption instead of a walkthrough.
- Match the card's level: name the parts at `simple`, use the code's own
  names at `standard`, show the invariant at `deep`.
- Output the diagram block, the walkthrough, and the trailing JSON block.
