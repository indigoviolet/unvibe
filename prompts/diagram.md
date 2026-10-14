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

<!-- D2 convention source: prompts/includes/d2-convention.md — edit there, copy here. -->

- The diagram is a fenced `d2` block, optionally followed by a `Caption:`
  line: a flowchart for data flow (first line `direction:` to suit the
  flow — `right` for pipelines, `down` for top-down chains) or
  `shape: sequence_diagram` for interactions. Five to nine nodes; every
  node label short (a few words, at most two lines — long single-line
  labels overflow their boxes).
- Cite code by putting link: "diff:<fileKey>:<START>-<END>" (ranges from
  your context, no [[ ]], no tooltip:) inline in braces on each shape or
  connection that maps to code (at least 2), e.g. `a -> b: unfold
  {link: "diff:conn:91-110"}` or `norm: "_normalize_header_values"
  {link: "diff:conn:80-88"}` (a `link:` on its own indented line is
   silently dropped — always attach inline). Mark a good/bad outcome with
   `myid.class: [ok]` / `[bad]` on its own line (never inside `{ ... }`).
- Limits: at most 12 shapes and 16 connections; no icon:, no shape: image,
  no imports, no markdown labels, no layers/scenarios/steps/boards, no
  vars, no `classes:` stanzas, no tooltip:. Never name a shape `steps`,
  `layers`, `scenarios` or `boards` (call it `flow` or `steps_box`).
- After the block, two to four lines of prose walking the reader through
  it, with citations. Do not start that paragraph with `Caption:` — that
  prefix would make it the diagram's caption instead of a walkthrough.
- Match the card's level: name the parts at `simple`, use the code's own
  names at `standard`, show the invariant at `deep`.
- Output the diagram block, the walkthrough, and the trailing JSON block.
