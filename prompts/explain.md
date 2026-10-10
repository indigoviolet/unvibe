---
role: user
tier: main
variables: [anchor.quote, anchor.block, card, thread, change_list, message]
---

# Explain

The reader selected text and asked for an explanation. Write an expansion
card that appears right under the block the text came from.

## Selected text

> {{anchor.quote}}

## Host block (the full paragraph, description text, or diff lines it came from)

{{anchor.block}}

## Card it belongs to

{{card}}

## Thread so far

{{thread}}

## What changed since this session last saw the review

{{change_list}}

## Request

{{message}}

## Rules

- Explain the selected text, not the whole card. Quote it back at the top
  of the card, then answer in two to four paragraphs at the card's current
  depth.
- Every claim about the change gets a citation. If the answer needs code
  beyond the base, fetch it with `get_hunk` or `get_code` first.
- If the anchor text cannot be matched to its host anymore, say so in one
  line instead of explaining.
- A reader who disagrees with the card should get the honest alternative,
  not a defence of the card.
