# Go deeper

The reader asked to generate one of the review's placeholder cards. Write
its content at standard depth.

## Direction

Data flow: from the socket to HTTPHeaderDict — follows a folded header to both views.

The direction is the title plus the why-line the reader wrote when planning
the review. It tells you what the card must cover and why it matters.

## Rules

- One card: two to five paragraphs, then at most three follow-up
  suggestions as a plain list. Follow the direction; do not write a
  different card.
- Every paragraph that states something about the change carries its
  citations. Fetch what you need with `get_hunk` or `get_code` first.
- End with the trailing JSON block carrying the card's `title`.
- If the direction turns out to need no card (the question answers itself
  in one line), say so in one paragraph instead of padding.
