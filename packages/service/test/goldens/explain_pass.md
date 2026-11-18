# Explain pass: what changed since X, and why

New commits landed on the branch, or the reviewer picked an X to hear
about. The baseline X is named in ## Baseline below — an earlier
version, a commit they picked, or the commit of their own last GitHub
review. The end is always the current head. Your job is to **explain
what changed between X and the head and why** — one reply, then the
trailing JSON block. No background work, no extra sessions. You change
nothing else: the old guide stays exactly as it is.

## Baseline

B is v1 · aaa1111 · 3 Nov; head is v2 · bbb2222 · 4 Nov. Explain only the 1 changed + 0 new hunks since X.

## Changed and new hunks (X to head)

### [[h:conn:h111]] reflowed: +1 −1

## Tasks

1. **Write the Changes-since-X cards.** Group the delta into threads
   of work — group by change, not by commit: one card may cover several
   commits, and one commit may split across cards. Each card says what
   changed and how, **why** (from the commits' messages above), and
   **what feedback caused each change** — the review comment, thread or
   conversation it answers, where one exists above. Say what the change
   means for the earlier guide, and cite every claim into the new hunks
   (`[[h:fileKey:hash]]` or `[[diff:…]]`). Each card carries an
   `answers` list with the bracketed ids of the feedback it answers
   (`[{ "kind": "comment", "id": "7" }]`: kind is `comment`, `thread`
   or `conversation`; the id is the bracketed comment, thread or
   conversation id). List a commit in `answers` only when no comment,
   thread or conversation applies — Answers is for feedback, and the UI
   hides commit-only Answers lines. Title each card with the change
   alone — never repeat the baseline ("since vN" or "since <sha>"): the
   section header already says it. Keep each card to its own thread;
   don't restate the old guide. Return the cards only in the trailing
   JSON block's `sinceSection.cards` — each with its `id`, `title`,
   `blocks` and `answers`. `blocks` is the card body as a Markdown
   string with `[[…]]` citations, e.g.
   `"blocks": "Alpha now returns 111. [[h:conn:abc123]]"`
   (an array of block objects works too). Every card needs a real
   body: cards without `blocks`, or whose body parses to nothing, are
   dropped. The prose above carries no cards: prose `##`
   cards are discarded, leaving a title with no body.
2. **Confirm the range.** A rebase without content changes needs
   nothing: confirm that in one line and stop.

## Rules

- Output the explanation in prose first, then the trailing JSON block.
  The cards travel only in that block (`sinceSection.cards` entries
  carry `blocks`) — never as `##` prose cards.
