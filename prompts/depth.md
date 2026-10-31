---
role: user
tier: main
variables: [card, level]
---

# Depth rewrite

Rewrite the card below at the requested level. Move exactly one level from
where it is: `simple` from standard, `standard` from simple or deep,
`deep` from standard.

## Card (all current levels)

{{card}}

## Target level

{{level}}

## Rules

- Rewrite the card's paragraphs in place at the target level. Keep the
  card's structure, title, examples, and diagrams untouched.
- `simple`: shorter sentences, no jargon without an immediate gloss, one
  idea per paragraph, and no assumed domain knowledge.
- `standard`: the default — precise, cites the code, assumes a working
  engineer. Where the card explains a decision, keep what else was
  possible and why this one (saying when a reason is inferred); borrow
  the deep level's habit of saying why it has to be this way and what
  would break if it were not.
- `deep`: first principles — the underlying rule or invariant, why it has
  to be this way, what would break if it were not. At this level you may
  add one `::: principle` block after the paragraphs.
- Keep every citation the original had, on the paragraph it supports. Never
  drop a citation in a rewrite.
- Output the full rewritten card, then the trailing JSON block with
  `{"depth": {"level": "<simple|standard|deep>", "cardId": "<the card>"}}`.
