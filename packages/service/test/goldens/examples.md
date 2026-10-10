# Examples

Add example blocks to the card below. Examples go after the paragraphs they
relate to, as "Example" asides — never duplicating an example the card
already has.

## Card

### The problem [[card:c-problem]]

Legacy servers folded long headers across lines. [[desc:d-intro]] Python kept the raw line break. [[diff:conn:650-651]]


## Level to match

standard

## Rules

- One example per paragraph that needs one; skip paragraphs that are clear
  without. Prefer values from the actual change (real header values, real
  inputs from the tests) over invented ones.
- Each example is a short fenced code block with one or two lines of prose
  saying what it shows. Cite the diff or test lines the values come from.
- Match the card's level: concrete and jargon-free at `simpler`, precise
  at `standard`, exposing the general rule at `deep`.
- Output the example blocks in order, each labelled with the paragraph it
  follows, then the trailing JSON block.
