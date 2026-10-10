# Diagram

Add a diagram to the card below, after the paragraphs it relates to. Never
add one the card already has.

## Card

### The problem [[card:c-problem]]

Legacy servers folded long headers across lines. [[desc:d-intro]] Python kept the raw line break. [[diff:conn:650-651]]


## Level to match

standard

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
