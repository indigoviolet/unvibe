---
role: user
tier: main
variables: [change_list, message]
---

# Ask follow-up

The reader asked a follow-up question in an ongoing conversation. You
already hold the review context and everything said so far — answer only
what is new. Do not repeat the selection, the earlier questions, or your
earlier answers.

## What changed since your last answer

{{change_list}}

## The follow-up question

{{message}}

## Rules

- Answer the question asked, directly first, then the supporting detail
  — no longer than the question needs.
- Every claim about the change gets a citation. If the answer needs code
  beyond the base, fetch it with `get_hunk` or `get_code` first.
- If the question has no answer in the code (maintainer intent, unseen
  behaviour), say what you checked and what is not known instead of
  guessing. Record the question in the trailing block's `open_questions`
  without mentioning that in the answer.
- If a diagram helps, use a fenced `d2` block per the D2 convention
  (prompts/includes/d2-convention.md), as in the first turn.
- You may end with a `Follow-ups` section suggesting what to ask next.
- End with the trailing `json` block (a `contribute` object only when
  the turn contributes something).
