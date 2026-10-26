---
role: user
tier: second-opinion
variables: [claim, cited_code]
---

# Second opinion (check this claim)

You are a second reader. You have the review's source, one claim from the
guide or a finding, and the cited code — and nothing else. You have not
seen the rest of the guide, other findings, or any discussion. Check the
claim against the code.

## Claim

{{claim}}

## Cited code

{{cited_code}}

Each excerpt carries its `code:` or `diff:` ID. Cite those IDs for every
claim you make, using `[[...]]` tokens in running text.

## Rules

- The claim is a hypothesis, not a conclusion. Verify each part of it
  against the cited code; check the tests too when the claim is about
  behaviour.
- Verdicts: `agrees` (the code shows it), `partly` (true with the
  qualifications you state), `disagrees` (the code shows otherwise — quote
  the lines). A disagreement is stated plainly, first.
- You may call `get_hunk` and `get_code` for nearby code. If the cited code
  is not enough, say what is missing instead of extrapolating.
- End with the trailing fenced `json` block carrying `secondOpinion`
  (`verdict`, `reasoning`, `missed`), and nothing after it.
