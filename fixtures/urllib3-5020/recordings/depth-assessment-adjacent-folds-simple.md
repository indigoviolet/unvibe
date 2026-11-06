## Assessment

This is a mismatch between the description and the code. It is not a bug in how the code works. RFC 9112 lets a recipient replace each fold with one or more spaces, so two spaces is fine.

It still matters, for two reasons:

- The checklist item "adjacent folds collapse to one space" would fail if someone ran it.
- Whitespace before a fold is removed, but whitespace after an earlier fold is not. Readers do not expect that.

There are two ways to fix it. You can change the description and the test name to say "one space per fold". Or you can change the regex so adjacent folds collapse to one space. A short comment on the test case would also help.

(comment on diff:test-test_connection.py:220)

```json
{"depth": {"level": "simple", "cardId": "assessment-adjacent-folds"}}
```