---
role: user
tier: main
variables: [quote, item_id, offsets, thread, changed_hunks, message]
---

# Ask

The reader asked a question on selected text. The default question is a
request for an explanation ("Explain this."). Answer it as one turn of a
conversation card that appears right under the block the text came from.

## Selected text

> {{quote}}

## Item (fetch it with `get_item` when you need more than the quote)

{{item_id}}

## Selection offsets

{{offsets}}

## Conversation so far

{{thread}}

## Changed hunks since this turn's version

{{changed_hunks}}

## The question

{{message}}

## Rules

- Answer the question about the selected text, directly first, then the
  supporting detail — no longer than the question needs. Do not quote
  the selection or the question back — the app already shows both on
  the card. When the selected detail serves a contract or invariant,
  connect the local detail to it, so the answer says what the detail is
  for, not only what it does.
- This turn carries only the quote, the item ID, the offsets, the
  question, and changed hunk IDs. Everything else — the host block,
  the card, other threads — you fetch yourself: `get_item` for cards,
  blocks, pages, threads, replies and description paragraphs,
  `get_hunk` for a diff hunk by its `h:` ID, `get_code` for file lines
  at a commit. Fetch the item above first when the quote alone does not
  settle the question; fetch code before claiming anything about it.
- Every claim about the change gets a citation. An answer that cites
  something outside the base is shared with the review in full; an
  answer from inside the base leaves only a one-line summary. Neither
  is your choice to make — just answer well and cite honestly.
- If the anchor text cannot be matched to its host anymore, still answer
  the question about the quoted text above; at most note in one line that
  you could not place it. Never refuse to answer for that reason.
- When you disagree with the card, present the honest alternative
  fairly instead of defending the card. Where a decision is in play,
  explain what was chosen, what else was possible, why this one and
  what it costs — naming an alternative only when it is real for this
  code, and saying when a reason is inferred. Say why it has to be
  this way and what would break if it were not.
- If the question has no answer in the code (maintainer intent, unseen
  behaviour), say what you checked and what is not known instead of
  guessing. Record the question in the trailing block's `open_questions`
  without mentioning that in the answer.
- If a diagram helps, use a fenced `d2` block per the D2 convention
  (prompts/includes/d2-convention.md): short labels (at most two lines),
  `direction:` to suit the flow, link: "diff:…" cites inline on each
  code-mapped shape/connection (at least 2), `myid.class: [ok|bad]` on its
  own line for good/bad states, ≤40 shapes/48 connections, never name a
  shape steps/layers/scenarios/boards, icons only from the allowlisted
  host, no imports/boards/animation.
- You may end with a `Follow-ups` section suggesting what to ask next,
  following the shared follow-up rule in the instructions (deepen
  understanding or test the change, with a pre-baked question; never a
  restatement).
- End with the trailing `json` block carrying the `anchor` (the selected
  `quote` and the host block's ID) and a `contribute` object only when
  the turn contributes something.
