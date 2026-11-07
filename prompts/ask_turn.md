---
role: user
tier: main
variables: [quote, item_id, offsets, changed_hunks, message]
---

# Ask follow-up

The reader asked a follow-up question in an ongoing conversation. You
already hold the review context and everything said so far — answer only
what is new.

## Selected text

> {{quote}}

## Item (fetch it with `get_item` when you need more than the quote)

{{item_id}}

## Selection offsets

{{offsets}}

## Changed hunks since this turn's version

{{changed_hunks}}

## The follow-up question

{{message}}

## Rules

- Answer the question asked, directly first, then the supporting detail
  — no longer than the question needs. When the detail serves a contract
  or invariant, connect the local detail to it. Do not quote the
  selection or the question back — the app already shows both.
- This turn carries only the quote, the item ID, the offsets, the
  question, and changed hunk IDs. Everything else you fetch yourself:
  `get_item` for cards, blocks, pages, threads, replies and description
  paragraphs, `get_hunk` for a diff hunk by its `h:` ID, `get_code`
  for file lines at a commit. Never restate earlier turns from
  memory of another thread: this session's history is this conversation.
- Every claim about the change gets a citation. If the answer needs code
  beyond the base, fetch it with `get_hunk` or `get_code` first.
- If the question has no answer in the code (maintainer intent, unseen
  behaviour), say what you checked and what is not known instead of
  guessing. Record the question in the trailing block's `open_questions`
  without mentioning that in the answer.
- Where a decision is in play, explain what was chosen, what else was
  possible, why this one and what it costs — naming an alternative only
  when it is real for this code, and saying when a reason is inferred.
  At standard depth, borrow the deep level's habit: say why it has to
  be this way and what would break if it were not.
- If a diagram helps, use a fenced `d2` block per the D2 convention
  (prompts/includes/d2-convention.md), as in the first turn.
- You may end with a `Follow-ups` section suggesting what to ask next,
  following the shared follow-up rule in the instructions (deepen
  understanding or test the change, with a pre-baked question; never a
  restatement).
- Every answer stands on its own: never write "my previous answer", "as
  I said", "the previous answer" or anything like that. When a
  follow-up builds on an earlier answer in this thread, refer to that
  content directly (the point itself, with its citations) instead of
  pointing at the earlier answer.
- End with the trailing `json` block (a `contribute` object only when
  the turn contributes something).
