The phrase describes the three parts of `_OBSOLETE_FOLD_RE`, which is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. They follow RFC 9112's definition of an `obs-fold` (OWS CRLF RWS). [[diff:src-urllib3-connection.py:80-82]]

- **Optional whitespace**: `(?:(?<![ \t])[ \t]+)?` is any run of spaces or tabs before the line break. It is optional because a fold can start right at the CRLF. It is part of the match so that `sub` replaces it too. Otherwise those blanks would stay next to the substituted space.
- **CRLF**: `\r\n` is the literal line break. It is the only mandatory anchor, which is also why `_normalize_header_value` can return early when a value has no `\r\n`. [[diff:src-urllib3-connection.py:85-88]]
- **Required whitespace**: `[ \t]+` is at least one space or tab after the line break. This is what makes it a fold and not a line end. A CRLF followed by anything else does not match and is left alone.

All three parts form one match, and `sub` replaces that whole span with a single space. For `"before \t\r\n\t  after"` the match is `" \t" + "\r\n" + "\t  "`, and the result is `"before after"`. [[diff:test-test_connection.py:218]]

This serves the invariant that, after parsing, a header value is one logical line in the canonical form the RFC defines. A pattern that matched only the CRLF would remove the line break but leave stray blanks around the replacement space.

The lookbehind inside the optional group only limits where that group may start, so matching stays linear on long runs of blanks. It does not change what counts as a fold. [[diff:src-urllib3-connection.py:80-82]]

### Follow-ups

- What happens if the trailing whitespace were optional? | ask: If the trailing `[ \t]+` in `_OBSOLETE_FOLD_RE` became `[ \t]*`, which inputs would change and which current tests would still pass?
- How do two folds in one value get matched? | ask: Walk through `_OBSOLETE_FOLD_RE.sub` on `"one\r\n \r\n\tthree"` and show where each match starts and ends.

```json
{"anchor": {"quote": "matches optional whitespace, then CRLF, then required whitespace", "hostBlock": "card:central"}}
```