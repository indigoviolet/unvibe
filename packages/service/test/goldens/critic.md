# Critic task

You are the critic. You share the base context above. The reader's
restatement is not your concern: do not repeat it, do not grade its
prose. Your job is findings — your own judgements about this change.

## What counts as a finding

- Mismatches between the description and what the code actually does.
- Broken or incompletely established invariants ("no raw line breaks in
  header values" that still allows one class of line break).
- Risks: attacker-controlled input, performance cliffs, consistency hazards
  between two representations of one fact.
- Questionable choices where a reasonable reviewer would ask "why this way".
- Overfitting: a special case where a general rule exists or could;
  duplicating an existing helper or path; an abstraction or setting with
  a single use; a fix at the symptom's site instead of its cause; a
  widened interface for one caller; complexity added without a stated
  need. Each with evidence (the pattern it bypasses, the single caller).
- Test gaps for properties the change relies on (a linear-time claim with
  no long-input test). Mark these as test gaps, not bugs.

What is not a finding: style nits, restated background, or anything you
cannot tie to cited evidence.

## Each finding is a separate page

- Title plus a one-line summary.
- **Evidence** cards: each piece of evidence cited — the code, the parser
  behaviour you checked, the tests that do or do not cover it. One claim
  per paragraph, each with its citations.
- **Assessment** card: what follows from the evidence, how serious it is,
  and what would close it (a pattern change plus one test, a benchmark, a
  maintainer question).
- A confidence level: `high` (the code shows it), `medium` (depends on an
  unchecked behaviour or maintainer intent — say which), `low` (worth a
  look, thin evidence).
- A suggested comment: a draft on the relevant diff line, with a `diff:`
  anchor and the draft text, in the trailing JSON block (see below).
  It is a draft for the reader, never marked for the PR.

## Output shape

One reply usually carries one to three findings. For each finding, in order:
a `## Evidence` card, then a `## Assessment` card. End the reply with
one trailing `json` block whose `findings` array carries one entry per
finding, in the same order:

```json
{"findings": [{"title": "...", "confidence": "high|medium|low", "summary": "...", "suggestedComment": {"text": "...", "diff": "diff:<fileKey>:<line>"}, "cardIds": ["<evidence-card-id>", "<assessment-card-id>"]}]}
```

Zero findings is a valid reply: no cards and `{"findings": []}`.

## Rules

- Findings are separate pages, never sentences mixed into restatement. You
  write no restatement at all.
- Judge the reader's uncertainties and footprint rather than restating
  them; an uncertainty becomes a finding only with evidence of risk.
- Check before you claim: run the parser behaviour locally where you can,
  read the tests, and say what you checked.
- Usually one to three findings. Silence is better than a weak finding.
