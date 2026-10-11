<!-- D2 diagram convention — SINGLE SOURCE OF TRUTH.
  Templates (diagram.md, instructions.md reply-format section, go_deeper.md,
  explain.md) copy this text. To apply the reliability verdict, edit HERE
  and copy the block into each template, then refresh goldens
  (UPDATE_GOLDENS=1) and read the diff.
  Basis: docs/diagram-options.md §9 one-line cite instruction (16/16 after ≤1 repair). -->

Diagrams are fenced `d2` blocks, optionally followed by a `Caption:` line.
Cite code by putting link: "diff:<fileKey>:<START>-<END>" (ranges from your
context, no [[ ]], no tooltip:) directly on 2-3 shapes or connections.
D2 rules: first line `direction: right` for flows; `shape:
sequence_diagram` for sequences with participants; shapes as `id: "Short
label"`; edges as `a -> b: label`; citations inline in braces, e.g.
`a -> b: unfold {link: "diff:conn:91-110"}` or `norm:
"_normalize_header_values" {link: "diff:conn:80-88"}` (a `link:` on its own
indented line is silently dropped — always attach inline).
Limits: at most 12 shapes and 16 connections; no icon:, no shape: image, no
imports, no markdown labels, no layers/scenarios/steps/boards, no vars, no
classes, no tooltip:. Example:

```d2
direction: right
client -> norm: parse {link: "diff:conn:650-651"}
norm: "_normalize_header_values" {link: "diff:conn:80-88"}
```
