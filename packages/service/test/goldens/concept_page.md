# Concept page

Write the full concept page the reader opens from a concept link.
Standard depth first: the page gains simple and deep versions later, one
level at a time.

## Concept

obs-fold — Obsolete line folding: a header value continued on the next line.

## Where it is mentioned

- problem card [[card:c-problem]]
- diff [[diff:conn:650-651]]

## Glossary

## Glossary

Use these exact terms for the things they name: call each thing by this exact term everywhere, never a synonym, abbreviation or paraphrase.

- `HTTPHeaderDict` — Headers view.


## Structure

1. What the concept is, as this change uses it — with the citations that
   show it in the code or description.
2. Why it matters here: the decision, risk, or mechanism it explains.
   Where the concept embodies a decision, say what else was possible
   and why this one — naming an alternative only when it is real for
   this code, and saying when a reason is inferred.
3. A concrete example: before/after values, a short trace, or a minimal
   snippet from the change. Prefer values from the actual code.
4. A `### Follow-ups` section with at most three follow-up questions
   on this change, each following the shared follow-up rule in the
   instructions (deepen understanding or test the change, with a
   pre-baked question; never a restatement).

Keep it to what this review needs. Use the glossary's exact terms for the things they name, never a synonym, abbreviation or paraphrase. If a diagram helps, use a fenced `d2`
block per the D2 convention (prompts/includes/d2-convention.md):
short labels (at most two lines), `direction:` to suit the flow,
link: "diff:…" cites inline on each code-mapped shape/connection (at
least 2), `myid.class: [ok|bad]` on its own line for good/bad states,
≤40 shapes/48 connections, never name a shape
steps/layers/scenarios/boards, icons only from the allowlisted host, no
imports/boards/animation. Never write that a diagram could be added or ask the
reader to request one. End with the trailing `json` block carrying the
page `title`.
