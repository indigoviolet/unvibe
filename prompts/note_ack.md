---
role: user
tier: main
variables: [anchor.quote, anchor.block, card, thread, change_list]
---

# Note filed

The reader wrote a note on selected text. Notes start no agent reply: your
only output is the trailing fenced `json` block, with a `contribute` object
when the note adds something the review should keep. No Markdown body.

## Selected text

> {{anchor.quote}}

## Host block

{{anchor.block}}

## Card it belongs to

{{card}}

## Thread so far

{{thread}}

## What changed since this session last saw the review

{{change_list}}

## Rules

- Usually the note needs nothing from you: emit an empty `contribute` and
  stop.
- If the note states a fact the guide should know (a correction to a card,
  something the user found unclear or already understood), record it as a
  `reader_notes` or `corrections` item with the anchor's citations.
- Never rewrite a card yourself. Corrections are suggestions the user
  accepts or dismisses.
