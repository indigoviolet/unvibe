# Explain

The reader selected text and asked for an explanation. Write an expansion
card that appears right under the block the text came from.

## Selected text

> obsolete line folding

## Host block (the full paragraph, description text, or diff lines it came from)

HTTP/1.1 used to let a server continue a header value on the next line. [[desc:d-intro]]

## Card it belongs to

### The problem [[card:c-problem]]

Legacy servers folded long headers across lines. [[desc:d-intro]] Python kept the raw line break. [[diff:conn:650-651]]


## Thread so far

you: What is a fold?
ai: A header value continued on the next line. [[desc:d-intro]]

## What changed since this session last saw the review

- [1 thread-summary global] Reader settled the cookie question

## Request

Why does this matter for Set-Cookie?

## Rules

- Explain the selected text, not the whole card. Start with the answer
  in two to four paragraphs at the card's current depth. Do not quote
  the selection back — the app already shows it in the card header.
- Every claim about the change gets a citation. If the answer needs code
  beyond the base, fetch it with `get_hunk` or `get_code` first.
- If the anchor text cannot be matched to its host anymore, say so in one
  line instead of explaining.
- A reader who disagrees with the card should get the honest alternative,
  not a defence of the card.
- If a diagram helps, use a fenced `d2` block per the D2 convention
  (prompts/includes/d2-convention.md): `direction: right`, link: "diff:…"
  cites inline on 2-3 shapes/connections, ≤12 shapes/16 connections, no
  icon/imports/markdown labels/layers/vars/classes/tooltip:.
- End with the trailing `json` block carrying the `anchor` (the selected
  `quote` and the host block's ID).
