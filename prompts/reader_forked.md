---
role: user
tier: main
variables: [source, diff_inline, repo_path]
---

# Reader task (forked spike, #208): read, plan, write the problem card only

You are the reader: the first agent to look at this change. Explore the
repository, settle the plotlines, plan the rest of the guide, and write
only the first card. Parallel forks of this session will write the
remaining cards from your plan, so the plan carries the shared names,
terms and decisions that keep the cards coherent.

## Source under review

{{source}}

## Diff (hunk IDs on headers, new-side numbers on lines)

{{diff_inline}}

## Working copy

The branch is checked out at `{{repo_path}}`. Read code there with your own
tools when the diff is not enough. You also have `pin_context(path, lines,
why)`: pin excerpts the rest of the review will need. Pin sparingly.

## Decide the plotlines first

Settle the change's **plotlines** as in the normal reader task: a thread
of change with its own purpose (the unit of a separate commit or stacked
PR), never a file type; tests and docs belong to the thread they serve.
List them in landing order, each with a one-line description of what that
step adds to the progression, `"buildsOn"` when it depends on an earlier
one, and the `h:` hunk IDs that belong to it (each hunk in exactly one
plotline; mechanical churn goes to no plotline).

## Write only the problem card

Write one card, first in your reply (no greeting, plan or notes before
it, because any text there is discarded):

**The problem.** Lead with what was wrong before the change and why it
mattered, in the first sentence. The first paragraph alone states the
problem and the central idea. Include how the system worked before. Cite
the description paragraphs that state the problem (their `desc:` IDs are
listed with the description above) and the code that shows it. When the
description is thin, reconstruct the problem from the commits and the
code, and say where a reason is inferred rather than stated.

## Plan the remaining cards in the trailing JSON

Do not write the remaining cards. Plan them, in guide order:

1. one central-idea card per plotline (a single one, "The central
   change", when there is one plotline);
2. "How it's built up" — the plotlines in landing order, what each step
   adds and makes possible;
3. "Decisions and alternatives" — each key choice, the real alternatives,
   why this one, what it costs; inferred reasons marked as inferred.

Each plan entry gives the exact card title the fork must use, its kind
(`central`, `buildup` or `decisions`), and 3–6 key points: the facts the
card must state, the names and terms it must use (so every card names
things the same way), and the citations it should make. The forks hold
everything you read, but not your intentions — a point you leave out of
the plan will not be written the way you meant it.

Then the usual trailing JSON, with `cardPlan` added:

```json
{"pendingCards": [{"id": "g-flow", "label": "...", "why": "..."}],
 "concepts": [{"slug": "obs-fold", "title": "...", "summary": "..."}],
 "plotlines": [{"id": "retry-logic", "name": "...", "description": "...", "buildsOn": "<earlier-plotline-id, only when it depends on one>", "hunks": ["h:<fileKey>:<hash>"]}],
 "cardPlan": [{"kind": "central", "title": "...", "points": ["...", "..."]}]}
```

`pendingCards` are the 3–5 go-deeper directions (at least one on a key
decision and its alternatives, at least one on how to check the change).
`concepts` is the hidden concept pass (slug, title, one line of meaning).

## Rules

- Explanation, not verdicts. Judgements belong to the critic. If you spot
  something you cannot explain, record it as an `open_questions`
  contribution, silently.
- Citations on every paragraph that states something about the change.
  For `diff:` use exactly `diff:<fileKey>:<start>[-<end>]` with the
  `<fileKey>` from the hunk header's `h:` ID and new-side line numbers.
- Use `search_review` before introducing a concept the guide may already
  cover.
