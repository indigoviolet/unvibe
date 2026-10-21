---
role: user
tier: main
variables: [card_title, card_kind, card_points, plan_overview, problem_card]
---

# Write one guide card

You are a fork of the reader session that explored this change, settled
its plotlines and wrote the problem card. You hold everything it read.
Write exactly one card now: the one named below. Sibling forks are
writing the other planned cards in parallel from the same plan.

## Your card

- Title (use it exactly, as the `## ` heading): {{card_title}}
- Kind: {{card_kind}}
- Key points your card must cover:
{{card_points}}

## The shared plan (all remaining cards, in guide order)

{{plan_overview}}

Write only your card's share of this plan. Do not repeat the problem
card (below) or another card's points; refer to them by the names the
plan uses, so the guide reads as one piece.

## The problem card (already written; do not repeat it)

{{problem_card}}

## Output shape

Your whole reply is one card: it opens with `## {{card_title}}` and
contains only that card's paragraphs, lists or tables. No greeting, no
notes, no other card, no trailing JSON block except an optional
`contribute` block in the usual shape. Keep it tight — a few short
paragraphs (plus a list or small table where they help), at the length
the same card would have inside a single-turn guide; covering a point
takes a sentence or two, not a section.

Card kinds:

- `central`: what this thread of the change does and how. Name the new
  helpers, the call sites, and the invariant it establishes.
- `buildup`: walk the plotlines in landing order — for each step, what
  it adds and what it makes possible for the next one. With a single
  plotline, say how its pieces build up instead.
- `decisions`: each key choice — what was chosen, what else was
  possible, why this one, and what it costs. Name an alternative only
  when it is real for this code, cited where it can be grounded; when
  the author's reason is not stated, say it is inferred and never invent
  one. Explain; do not judge.

## Rules

- Citations on every paragraph that states something about the change.
  For `diff:` use exactly `diff:<fileKey>:<start>[-<end>]` with the
  `<fileKey>` from the hunk header's `h:` ID and new-side line numbers.
- Use the plan's names for helpers, concepts and plotlines, exactly.
