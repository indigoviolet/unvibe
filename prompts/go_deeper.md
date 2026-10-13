---
role: user
tier: main
variables: [direction]
---

# Go deeper

The reader asked to generate one of the review's placeholder cards. Write
its content at standard depth.

## Direction

{{direction}}

The direction is the title plus the why-line the reader wrote when planning
the review. It tells you what the card must cover and why it matters.

## Rules

- One card: two to five paragraphs, then a `### Follow-ups` section with
  at most three follow-up suggestions. Follow the direction; do not write
  a different card.
- Every paragraph that states something about the change carries its
  citations. Fetch what you need with `get_hunk` or `get_code` first.
- If the direction needs a diagram, use a fenced `d2` block per the D2
  convention (prompts/includes/d2-convention.md): short labels (at most
  two lines), `direction:` to suit the flow, link: "diff:…" cites inline
  on each code-mapped shape/connection (at least 2), `myid.class:
  [ok|bad]` on its own line for good/bad states, ≤12 shapes/16
  connections, never name a shape steps/layers/scenarios/boards, no
  icon/imports/markdown labels/layers/vars/`classes:` stanzas/tooltip:.
- End with the trailing JSON block carrying the card's `title`.
- If the direction turns out to need no card (the question answers itself
  in one line), say so in one paragraph instead of padding.
