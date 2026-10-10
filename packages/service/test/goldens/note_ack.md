# Note filed

The reader wrote a note on selected text. Notes start no agent reply: your
only output is the trailing fenced `json` block, with a `contribute` object
when the note adds something the review should keep. No Markdown body.

## Selected text

> obsolete line folding

## Host block

HTTP/1.1 used to let a server continue a header value on the next line. [[desc:d-intro]]

## Card it belongs to

### The problem [[card:c-problem]]

Legacy servers folded long headers across lines. [[desc:d-intro]] Python kept the raw line break. [[diff:conn:650-651]]


## Thread so far

you: What is a fold?
ai: A header value continued on the next line. [[desc:d-intro]]

## What changed since this session last saw the review

- [1 thread-summary global] Reader settled the cookie question

## Rules

- Usually the note needs nothing from you: emit an empty `contribute` and
  stop.
- If the note states a fact the guide should know (a correction to a card,
  something the user found unclear or already understood), record it as a
  `reader_notes` or `corrections` item with the anchor's citations.
- Never rewrite a card yourself. Corrections are suggestions the user
  accepts or dismisses.
