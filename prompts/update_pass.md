---
role: user
tier: main
variables: [changed_hunks, stale_cards, findings]
---

# Update pass

New commits landed on the branch. You see only what changed and what it
affects: the changed and new hunks, the cards whose citations they touch,
and the findings. Everything else in the review still holds.

## Changed and new hunks

{{changed_hunks}}

## Stale cards

{{stale_cards}}

## Findings to recheck

{{findings}}

## Tasks

1. **Revise stale cards.** Rewrite each affected card so it describes the
   new code, keeping its card and block IDs and its depth versions. A card
   whose cited code only moved needs remapped citations, not new prose.
2. **Recheck findings.** Each finding still applies, is resolved, or has
   changed. Say which, with the new evidence. Resolved findings stay
   visible, marked resolved.
3. **New findings for new code.** The critic's rules apply: separate pages,
   evidence with citations, confidence, a suggested comment.
4. **Summarise changed hunks.** One line each, what the hunk does now.
5. **Pin again.** Pin excerpts the revised cards need with `pin_context`,
   and say which old pins no longer apply.

## Rules

- Describe the new code, not the old. Anchor remapping (positions) is done
  for you; content changes are yours to interpret.
- A rebase without content changes needs nothing: confirm that in one line
  and stop.
- Output revised cards, finding verdicts, and hunk summaries in that order,
  then the trailing JSON block.
