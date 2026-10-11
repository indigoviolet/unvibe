# Diagram

Add a diagram to the card below, after the paragraphs it relates to. Never
add one the card already has.

## Card

### The problem [[card:c-problem]]

Legacy servers folded long headers across lines. [[desc:d-intro]] Python kept the raw line break. [[diff:conn:650-651]]


## Level to match

standard

## Rules

<!-- D2 convention source: prompts/includes/d2-convention.md — edit there, copy here. -->

- The diagram is a fenced `d2` block, optionally followed by a `Caption:`
  line: a flowchart for data flow (`direction: right` first line) or
  `shape: sequence_diagram` for interactions. Five to nine nodes; every node
  label short.
- Cite code by putting link: "diff:<fileKey>:<START>-<END>" (ranges from
  your context, no [[ ]], no tooltip:) directly on 2-3 shapes or
  connections, inline in braces, e.g. `a -> b: unfold
  {link: "diff:conn:91-110"}` or `norm: "_normalize_header_values"
  {link: "diff:conn:80-88"}` (a `link:` on its own indented line is
  silently dropped — always attach inline).
- Limits: at most 12 shapes and 16 connections; no icon:, no shape: image,
  no imports, no markdown labels, no layers/scenarios/steps/boards, no
  vars, no classes, no tooltip:.
- After the block, two to four lines of prose walking the reader through
  it, with citations. Do not start that paragraph with `Caption:` — that
  prefix would make it the diagram's caption instead of a walkthrough.
- Match the card's level: name the parts at `simple`, use the code's own
  names at `standard`, show the invariant at `deep`.
- Output the diagram block, the walkthrough, and the trailing JSON block.
