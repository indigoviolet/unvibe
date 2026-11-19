The description says adjacent folds collapse to one space, while the unit test expects two — and "adjacent folds" means two folds with nothing but whitespace between them. The regex is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`, and the lookbehind — the `(?<![ \t])` guard — only lets the optional leading whitespace match at the start of a whitespace run. [[diff:src-urllib3-connection.py:80-82]]

For `"one\r\n \r\n\tthree"`, the first match is `\r\n ` and becomes one space: the CRLF plus the single space after it. The second fold then starts right after that match, where the preceding character is the space the first match just consumed. Because of the lookbehind, the second match cannot absorb that space — a match may only start its optional group after a non-space. It matches only `\r\n\t` and becomes a second space.

The test pins the result as `"one  three"`, with two spaces — one per fold. [[diff:test-test_connection.py:220]]

The description and the guide state a different behavior, "adjacent folds collapse to one space, not zero". That is not what the code does, and the mismatch is the finding. [[desc:d-p6]] [[desc:d-p3]]

The socket test has no adjacent-fold case. Its mixed case, `one \t\r\n\t  two\t \r\n \tthree`, has non-whitespace between the folds, so it never exercises two folds back to back. [[diff:test-with_dummyserver-test_socketlevel.py:112-114]]

```json
{"slower": {"cardId": "evidence-adjacent-folds"}}
```
