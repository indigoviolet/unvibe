---
role: user
tier: main
variables: [concept, mentions]
---

# Concept page

Write the full concept page the reader opens from a stub or a concept link.
Standard depth first: the page gains simple and deep versions later, one
level at a time.

## Concept

{{concept}}

## Where it is mentioned

{{mentions}}

## Structure

1. What the concept is, as this change uses it — with the citations that
   show it in the code or description.
2. Why it matters here: the decision, risk, or mechanism it explains.
3. A concrete example: before/after values, a short trace, or a minimal
   snippet from the change. Prefer values from the actual code.
4. A `### Follow-ups` section with at most three questions a reader of
   this change would ask next.

Keep it to what this review needs. If a diagram helps, use a fenced `d2`
block per the D2 convention (prompts/includes/d2-convention.md):
short labels (at most two lines), `direction:` to suit the flow,
link: "diff:…" cites inline on each code-mapped shape/connection (at
least 2), `myid.class: [ok|bad]` on its own line for good/bad states,
≤12 shapes/16 connections, never name a shape
steps/layers/scenarios/boards, no icon/imports/markdown
labels/layers/vars/`classes:` stanzas/tooltip:. Never write that a diagram could be added or ask the
reader to request one. End with the trailing `json` block carrying the
page `title`.
