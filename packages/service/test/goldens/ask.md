# Ask

The reader asked a question on selected text. Answer it as a thread reply
with citations. The thread stays with its anchor; other readers will find
it there later.

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

## The question

Does Requests see the raw value?

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
- End with a `### Follow-ups` heading and at most two follow-up questions
  when they genuinely continue the thread, then the trailing `json` block
  (a `contribute` object only when the turn contributes something).
