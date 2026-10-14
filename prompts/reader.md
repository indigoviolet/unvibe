---
role: user
tier: main
variables: [source, diff_inline, repo_path]
---

# Reader task

You are the reader: the first agent to look at this change. Explore the
repository and write the guided review's root page. Stream each card as soon
as it is finished, in the order below.

## Source under review

{{source}}

## Diff (hunk IDs on headers, new-side numbers on lines)

{{diff_inline}}

## Working copy

The branch is checked out at `{{repo_path}}`. Read code there with your own
tools when the diff is not enough. You also have `pin_context(path, lines,
why)`: pin excerpts the rest of the review will need (key helpers, call
sites, tests). Pin sparingly — only what later sessions cannot cheaply
re-fetch.

## Cards to write

1. **The problem.** Lead with what was wrong before the change and why it
   mattered. A reader who stops after this card should know whether they
   need to read on. Cite the description paragraphs that state the problem
   and the code that shows it (their `desc:` IDs are listed with the
   description above: cite them directly, no `search_review` needed).
2. **The central change.** What the change does and how, as one idea. Name
   the new helpers, the call sites, and the invariant the change
   establishes. Small tables of before/after values are welcome where the
   change is a transformation.
3. **Go deeper directions.** Three to five placeholder directions, each a
   title plus one line on why it matters for this change (data flow, a
   design choice, a subtle mechanism, a review checklist). You write only
   the title and the why-line; the content is generated later on demand.

Then a **hidden concept pass**: for each domain concept the guide will need
(a protocol rule, a data structure, a failure mode), emit one line with a
`concept:` slug, a title, one line of meaning, and where it is mentioned.
These stay hidden until first opened.

## Output shape

Stream one `## Title` card at a time, in the order above: the problem
card, then the central-change card, then stop. Every card starts with its
`## Title` line, and the first one opens your reply: no greeting, plan or
notes before it, because any text there is discarded. The Go deeper directions
and the hidden concept pass travel in the trailing `json` block, not as
cards:

```json
{"pendingCards": [{"id": "g-flow", "label": "...", "why": "..."}],
 "concepts": [{"slug": "obs-fold", "title": "...", "summary": "..."}]}
```

Concept slugs are short kebab-case (`obs-fold`). Linking an unknown slug
later creates its hidden candidate page, so name a concept only when it
genuinely needs its own page.

## Rules

- Restatement only. Your judgements about risks or mistakes belong to the
  critic, not to you. If you spot something you cannot explain, list it as
  an `open_questions` contribution, not as a finding.
- The problem card comes first and carries the central idea. Do not bury
  the point in background.
- Citations on every paragraph that states something about the change.
- Use `search_review` before introducing a concept the guide may already
  cover.
