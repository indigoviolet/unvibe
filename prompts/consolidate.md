---
role: user
tier: small
variables: [contributions]
---

# Consolidate contributions

Merge the accumulated agent contributions into a clean list. You see only
the contributions, not the review: judge duplicates and supersession from
the texts and IDs given.

## Contributions

{{contributions}}

Each item has an ID, a kind (`fact`, `correction`, `open_question`,
`reader_note`), text, citations, and optionally `replaces` (the ID of an
earlier contribution it supersedes) and a `target` (`card:<id>#<block>` for
corrections).

## Rules

- Drop exact duplicates, keeping the earliest ID.
- Resolve `replaces` chains: keep the latest version, drop the superseded
  ones.
- Keep accepted corrections folded in: a correction whose target text
  already says what it asks for is done — drop it.
- Drop facts without citations.
- Keep the survivors in ID order. Do not reword them.

## Output

No Markdown body. Only the trailing fenced `json` block, and nothing after
it:

```json
{"kept": [{"id": "c1", "kind": "fact", "text": "..."}],
 "dropped": [{"id": "c2", "why": "duplicate of c1"}]}
```
