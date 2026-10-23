# Go deeper

The reader asked to generate one of the review's placeholder cards. Write
its content at standard depth.

## Direction

Data flow: from the socket to HTTPHeaderDict — follows a folded header to both views.

The direction is the title plus the why-line the reader wrote when planning
the review. It tells you what the card must cover and why it matters.

## Glossary

## Glossary

Use these exact terms for the things they name: call each thing by this exact term everywhere, never a synonym, abbreviation or paraphrase.

- `HTTPHeaderDict` — Headers view.


## Rules

- Use the glossary's exact terms for the things they name, never a synonym, abbreviation or paraphrase.
- One card: two to five paragraphs, then a `### Follow-ups` section with
  at most three follow-up suggestions, each following the shared
  follow-up rule in the instructions (deepen understanding or test the
  change, with a pre-baked question; never a restatement). Follow the
  direction; do not write a different card.
- Explain, do not just restate: where the direction touches a decision,
  cover what was chosen, what else was possible, why this one and what
  it costs — naming an alternative only when it is real for this code,
  and saying when a reason is inferred. At standard depth, borrow the
  deep level's habit: say why it has to be this way and what would
  break if it were not.
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
