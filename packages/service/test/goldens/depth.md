# Depth rewrite

Rewrite the card below at the requested level. Move exactly one level from
where it is: `simpler` from standard, `standard` from simpler or deep,
`deep` from standard.

## Card (all current levels)

### The problem [[card:c-problem]]

Legacy servers folded long headers across lines. [[desc:d-intro]] Python kept the raw line break. [[diff:conn:650-651]]


## Target level

deep

## Rules

- Rewrite the card's paragraphs in place at the target level. Keep the
  card's structure, title, examples, and diagrams untouched.
- `simpler`: shorter sentences, no jargon without an immediate gloss, one
  idea per paragraph. The reader is new to the domain.
- `standard`: the default — precise, cites the code, assumes a working
  engineer.
- `deep`: first principles — the underlying rule or invariant, why it has
  to be this way, what would break if it were not. At this level you may
  add one "Underlying principle" block after the paragraphs.
- Keep every citation the original had, on the paragraph it supports. Never
  drop a citation in a rewrite.
- Output the full rewritten card, then the trailing JSON block with the
  `depth` field set to the level you wrote.
