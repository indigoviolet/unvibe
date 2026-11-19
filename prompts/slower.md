---
role: user
tier: main
variables: [card, guide, terms]
---

# Help me understand

Rewrite the card below more slowly than its current text, so a reader
who is not understanding it yet can follow. There are no levels: every
press slows the current text down further, relative to what it says now.

## Card (current text)

{{card}}{{terms}}{{guide}}

## Rules

- The reply is the WHOLE new card body: it replaces the card's body
  completely. It may add paragraphs, lists, numbered steps and one
  example, each with its own citations.
- Keep the card's title. Diagrams and follow-up suggestions survive the
  rewrite either way (they are re-attached when the reply drops them),
  so the reply need not repeat them.
- Fill in the steps the current text skips; make smaller leaps between
  sentences so each one follows from the last.
- Define each term where it is first used, in plain words, the first
  time the reader meets it.
- Include one concrete walk-through with real values, in the order
  things happen.
- State the "why" where the text only says "what": where the card
  touches a decision, say why it has to be this way and what would
  break if it were not — naming an alternative only when it is real
  for this code, and saying when a reason is inferred.
- Never get shorter by dropping content. A slower rewrite says more,
  not less.
- Keep every citation on the claim it supports. Never drop a citation
  in a rewrite.
- Output the full rewritten card, then the trailing JSON block with
  `{"slower": {"cardId": "<the card>"}}`.
