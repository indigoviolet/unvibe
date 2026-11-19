## The problem

The change reworks the two demo functions in `src-app.py`: `alpha` now returns 11 instead of 1, and `beta` now returns 22 instead of 2. Each function sits in its own hunk, separated by a run of divider comments, so the diff reads as two independent one-line edits with the module constants untouched. [[diff:src-app.py:1-5]] [[diff:src-app.py:11-17]]

## The central idea

Both edits keep the functions' shape and only change the returned constant: `alpha` returns 11 where it returned 1, and `beta` returns 22 where it returned 2. The divider comments between the hunks and the `CONST_A` / `CONST_B` assignments are unchanged. [[diff:src-app.py:1-5]] [[diff:src-app.py:11-17]]

## Decisions and questions

**Decisions**
- **One line per function.** Each hunk changes a single return value and nothing else, so either edit could land on its own. [[diff:src-app.py:1-5]] [[diff:src-app.py:11-17]]

**Questions**
- What asks for 11 and 22 — is there a downstream expectation behind the new values?

```json
{"pendingCards":[{"id":"g-alpha","label":"Why 11 for alpha","why":"Lets you judge what the new alpha value is for."},{"id":"g-beta","label":"Why 22 for beta","why":"Lets you judge what the new beta value is for."}],"plotlines":[{"id":"rework-returns","name":"Rework the demo return values","description":"Changes the two demo functions to return their new constants, one hunk each.","hunks":["h:src-app.py:025c48900cb5b0e9","h:src-app.py:d05efa00b6269df8"]}],"glossary":[{"name":"alpha","definition":"The first demo function, returning its constant from the opening hunk.","citation":"diff:src-app.py:2"},{"name":"beta","definition":"The second demo function, returning its constant from the later hunk.","citation":"diff:src-app.py:14"}],"contribute":{"facts":[{"text":"alpha now returns 11 instead of 1.","citations":["diff:src-app.py:1-5"]},{"text":"beta now returns 22 instead of 2.","citations":["diff:src-app.py:11-17"]}],"open_questions":["What asks for the 11 and 22 values?"]}}
```
