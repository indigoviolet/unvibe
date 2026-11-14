---
role: user
tier: main
variables: [card]
---

# Examples

Add example blocks to the card below. Examples go after the paragraphs they
relate to, as "Example" asides — never duplicating an example the card
already has.

## Card

{{card}}

## Rules

- One example per paragraph that needs one; skip paragraphs that are clear
  without. Prefer values from the actual change (real header values, real
  inputs from the tests) over invented ones.
- Each example is a `::: example` container placed immediately after the
  paragraph it relates to, holding a short fenced code block with one or
  two lines of prose saying what it shows. Cite the diff or test lines the
  values come from.
- Match the card's current wording: use the same terms and level of
  detail as the text around the example.
- Output the card's new blocks in order (each `::: example` where it goes),
  then the trailing `json` block.
