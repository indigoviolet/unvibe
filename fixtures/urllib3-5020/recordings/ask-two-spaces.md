Yes, the double space is intended. The unit test pins it, and the code produces it by design. It is also where the description's wording is wrong.

In `"one\r\n \r\n\tthree"` there are two folds, and each one is replaced by one space. `_OBSOLETE_FOLD_RE` matches `OWS CRLF RWS` as a single run. The first match is `\r\n ` and it becomes a space. The second match is `\r\n\t` and it becomes another space. Nothing between the folds is left to merge them, so the result is `"one  three"`. [[diff:src-urllib3-connection.py:80-82]] [[diff:src-urllib3-connection.py:88]] [[diff:test-test_connection.py:220]]

This is the rule "replace each `obs-fold` with a space". It is applied per fold, not per whitespace run. The case exists to guard against two other results:

- Zero spaces, if the second fold's whitespace were swallowed by the first match. That would glue `one` and `three` together.
- One space, if the whole region were treated as one run of whitespace. That would be a different reading of the RFC, where the region is a single fold.

The description disagrees with this. It says adjacent folds "collapse to one space, not zero". The code and the test agree with each other and produce two spaces, so the description is the part that is wrong. One of the critic findings covers this mismatch. [[desc:d-p6]]

If you would prefer one space, the regex would need to absorb repeated `CRLF RWS` groups, for example `(?:\r\n[ \t]+)+`. That would be a deliberate design change, and the test expectation would change with it.

### Follow-ups

- Would collapsing adjacent folds into one space be a valid reading of RFC 9112? | ask: Would changing `_OBSOLETE_FOLD_RE` to absorb repeated `CRLF RWS` groups into one space still be RFC 9112 compliant, and what would the pattern look like?
- Does a double space matter to cookie consumers? | ask: Does a double space inside a `Set-Cookie` value change how a cookie jar parses it?

```json
{"anchor": {"quote": "one  three", "hunk": "h:test-test_connection.py:b33779988cee5f8a"}}
```