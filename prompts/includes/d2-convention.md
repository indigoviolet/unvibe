<!-- D2 diagram convention — SINGLE SOURCE OF TRUTH.
  Templates (diagram.md, instructions.md reply-format section, go_deeper.md,
  ask.md, concept_page.md) copy this text. To apply the reliability verdict, edit HERE
  and copy the block into each template, then refresh goldens
  (UPDATE_GOLDENS=1) and read the diff.
  Basis: docs/d2-diagrams.md; one-line cite instruction (16/16 after ≤1 repair). -->

Diagrams are fenced `d2` blocks, optionally followed by a `Caption:` line.
Cite code by putting link: "diff:<fileKey>:<START>-<END>" (ranges from your
context, no [[ ]], no tooltip:) inline in braces on each shape or
connection that maps to code (at least 2), e.g. `a -> b: unfold
{link: "diff:conn:91-110"}` or `norm: "_normalize_header_values"
{link: "diff:conn:80-88"}` (a `link:` on its own indented line is
silently dropped — always attach inline).
D2 rules: first line `direction:` to suit the flow (`right` for
left-to-right pipelines, `down` for top-down chains); `shape:
sequence_diagram` for sequences with participants; shapes as `id: "Short
label"` with every label short (a few words, at most two lines — long
single-line labels overflow their boxes); edges as `a -> b: label`; mark
a good/bad outcome with `myid.class: [ok]` / `[bad]` on its own line
(never inside `{ ... }`).
Never name a shape `steps`, `layers`, `scenarios` or `boards` (those words
switch on multi-board diagrams): call the box `flow` or `steps_box`.
Limits: at most 12 shapes and 16 connections; no icon:, no shape: image, no
imports, no markdown labels, no layers/scenarios/steps/boards, no vars, no
`classes:` stanzas, no tooltip:. Example:

```d2
direction: right
client -> norm: parse {link: "diff:conn:650-651"}
norm: "_normalize_header_values" {link: "diff:conn:80-88"}
```
