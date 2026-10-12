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
- If a diagram helps, use a fenced `d2` block per the D2 convention
  (prompts/includes/d2-convention.md): short labels (at most two lines),
  `direction:` to suit the flow, link: "diff:…" cites inline on each
  code-mapped shape/connection (at least 2), `.class: [ok|bad]` for
  good/bad states, ≤12 shapes/16 connections, no icon/imports/markdown
  labels/layers/vars/`classes:` stanzas/tooltip:.
- End with the trailing `json` block carrying the `anchor` (the selected
  `quote` and the host block's ID).
