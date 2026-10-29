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
  line: a flowchart for data flow (first line `direction:` to suit the
  flow — `right` for pipelines, `down` for top-down chains) or
  `shape: sequence_diagram` for interactions. Five to nine nodes; every
  node label short (a few words, at most two lines — long single-line
  labels overflow their boxes).
- Cite code by putting link: "diff:<fileKey>:<START>-<END>" (ranges from
  your context, no [[ ]]) inline in braces on each shape or
  connection that maps to code (at least 2), e.g. `a -> b: unfold
  {link: "diff:conn:91-110"}` or `norm: "_normalize_header_values"
  {link: "diff:conn:80-88"}` (a `link:` on its own indented line is
   silently dropped — always attach inline). Mark a good/bad outcome with
   `myid.class: [ok]` / `[bad]` on its own line (never inside `{ ... }`).
- Limits: at most 40 shapes and 48 connections; icons only as
  `icon: https://icons.terrastruct.com/<set>%2F<name>.svg` (any other host
  is rejected); no imports, no layers/scenarios/steps/boards, no
  `style.animated`, no `animate-interval`. `vars:`, `classes:` stanzas,
  `tooltip:` (short, never a citation) and `|md` / `|latex` labels are
  allowed. Never name a shape `steps`,
  `layers`, `scenarios` or `boards` (call it `flow` or `steps_box`).
- After the block, two to four lines of prose explaining the diagram
  in order, with citations. Do not start that paragraph with `Caption:` — that
  prefix would make it the diagram's caption instead of a walkthrough.
- Match the card's level: name the parts at `simple`, use the code's own
  names at `standard`, show the invariant at `deep`.
- Output the diagram block, the walkthrough, and the trailing JSON block.
