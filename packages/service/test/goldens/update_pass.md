# Update pass: explain the delta since B, and append

New commits landed on the branch. The reviewer last opened baseline B;
the head has moved since. Your job is to **explain what changed between
B and the head and append that explanation** — not to rewrite the guide.
No background work, no extra sessions: one reply, then the trailing
JSON block.

## Baseline

B is v1 · aaa1111 · 3 Nov; head is v2 · bbb2222 · 4 Nov. Explain only the 1 changed + 0 new hunks since B.

## Changed and new hunks (B to head)

### [[h:conn:h111]] reflowed: +1 −1

## Stale cards

### The central change [[card:c-central]] (2 cited hunks changed)

## Findings to recheck

### Folds that end in a bare LF are not unfolded (medium) [[page:f-lf]] — still applies

## Tasks

1. **Write the Since-B cards.** One card per thread of the delta: what
   changed and how, **why** (from the commits' messages above), and
   **what feedback caused each change** — the review comment, thread or
   conversation remark it answers, where one exists above. Say what the
   change means for the earlier guide, and cite every claim into the new
   hunks (`[[h:fileKey:hash]]` or `[[diff:…]]`). Keep each card to its
   own thread; don't restate the old guide.
2. **Append addenda, don't rewrite cards.** Where a change affects an
   existing card, write an "Updated since B" addendum for the end of
   that card: dated, explaining what changed relative to what the card
   says. Never edit the card's text. Rewrite a card's prose only when it
   is now plainly wrong — prefer the addendum.
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
