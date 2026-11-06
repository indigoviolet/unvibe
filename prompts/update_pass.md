---
role: user
tier: main
variables: [changed_hunks, stale_cards, findings, since_context]
---

# Update pass: explain the delta since B, and append

New commits landed on the branch. The baseline B is named in ##
Baseline below — usually the version the reviewer last opened, sometimes
a commit they picked (or already reviewed on GitHub). The head has moved
since. Your job is to **explain what changed between B and the head and
append that explanation** — not to rewrite the guide. No background
work, no extra sessions: one reply, then the trailing JSON block.

{{since_context}}

## Changed and new hunks (B to head)

{{changed_hunks}}

## Stale cards

{{stale_cards}}

## Findings to recheck

{{findings}}

## Tasks

1. **Write the Since-B cards.** One card per thread of the delta: what
   changed and how, **why** (from the commits' messages above), and
   **what feedback caused each change** — the review comment, thread or
   conversation remark it answers, where one exists above. Say what the
   change means for the earlier guide, and cite every claim into the new
   hunks (`[[h:fileKey:hash]]` or `[[diff:…]]`). Each card carries an
   `answers` list with the bracketed ids of the feedback it answers
   (`[{ "kind": "comment", "id": "7" }]`: kind is `comment`, `thread`,
   `conversation` or `commit`; the id is the bracketed comment, thread
   or conversation id, or the full commit sha). Title each card with
   the change alone — never repeat the baseline ("since vN" or
   "since <sha>"): the section header already says it. Keep each card to
   its own thread; don't restate the old guide.
2. **Append addenda, don't rewrite cards.** Where a change affects an
   existing card, write an "Updated since B" addendum for the end of
   that card: dated, explaining what changed relative to what the card
   says, with its own `answers` list in the same shape. Start the body
   with the explanation itself — never with "Updated since …" (the
   dated header above it already says that). Never edit the card's
   text. Rewrite a card's prose only when it is now plainly wrong —
   prefer the addendum.
3. **Recheck findings.** Each finding still applies, is resolved, or has
   changed. Say which, with the new evidence. Resolved findings stay
   visible, marked resolved.
4. **New findings for new code.** The critic's rules apply: separate
   pages, evidence with citations, confidence, a suggested comment.
5. **Summarise changed hunks.** One line each, what the hunk does now.
6. **Place the new hunks.** Say which existing plotline each new hunk
   joins (by content, not position). A genuinely new thread of work
   becomes a new plotline. Name only hunks listed above.
7. **Pin again.** Pin excerpts the new cards need with `pin_context`,
   and say which old pins no longer apply.

## Rules

- A rebase without content changes needs nothing: confirm that in one
  line and stop.
- Anchor remapping (positions) is done for you; content changes are
  yours to interpret.
- Output revised cards, finding verdicts, and hunk summaries in that
  order, then the trailing JSON block.
