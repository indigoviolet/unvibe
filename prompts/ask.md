---
role: user
tier: main
variables: [anchor.quote, anchor.block, card, thread, change_list, message]
---

# Ask

The reader asked a question on selected text. Answer it as a thread reply
with citations. The thread stays with its anchor; other readers will find
it there later.

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

## The question

{{message}}

## Rules

- Answer the question asked, directly first, then the supporting detail.
  Two to six paragraphs; no longer than the question needs.
- Cite every piece of evidence. An answer that cites something outside the
  base is shared with the review in full; an answer from inside the base
  leaves only a one-line summary. Neither is your choice to make — just
  answer well and cite honestly.
- If the question has no answer in the code (maintainer intent, unseen
  behaviour), say what you checked and file it as an `open_questions`
  contribution instead of guessing.
- End with the trailing `json` block (a `contribute` object only when the
  turn contributes something).
