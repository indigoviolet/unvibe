## How the tests cover edge cases

The tests cover the whitespace around `obs-fold` fairly thoroughly. They cover header-name cases not at all, and the changelog and description say that is deliberate. [[desc:d-p4]]

**Whitespace combinations.** The socket-level test sends four headers, one for each pairing of trailing whitespace before the CRLF (SP or HTAB) with leading whitespace after it (SP or HTAB). Each must come back as `before after`. [[diff:test-with_dummyserver-test_socketlevel.py:104-111]] A fifth header, `Fold-Mixed-Repeated`, mixes runs of both kinds across two folds and must come back as `one two three`. [[diff:test-with_dummyserver-test_socketlevel.py:112-114]] The `Set-Cookie` fold has four leading spaces on its continuation line, so a run longer than one character is covered too. [[diff:test-with_dummyserver-test_socketlevel.py:101-102]] The test is written at the socket level because it sends raw bytes. This means the real `http.client` parser produces the folded values, rather than the test hand-building an `HTTPMessage`.

**Unit cases for `_normalize_header_value`.** The four parametrized cases pin down what the regex consumes. [[diff:test-test_connection.py:214-224]]
- `ordinary\tvalue` has no CRLF, so it stays unchanged. This exercises the fast path. [[diff:src-urllib3-connection.py:86-87]]
- `before \t\r\n\t  after` shows that whitespace on both sides of the CRLF collapses to a single space.
- `one\r\n two\t\r\n\tthree` is two folds in one value, giving one space each.
- `one\r\n \r\n\tthree` becomes `one  three`, with two spaces. The first fold's trailing whitespace is consumed with its own CRLF, and the second fold starts at the next CRLF. So adjacent folds each produce one space, and nothing merges or disappears. This is the case that tests "one space per fold, not zero".

The socket test also checks that `Ordinary: one\t two` keeps its internal tab and space. That shows the regex only touches whitespace that is attached to a CRLF. [[diff:test-with_dummyserver-test_socketlevel.py:115]] [[diff:test-with_dummyserver-test_socketlevel.py:133]]

**Message-level cases.** `test_normalize_header_values_preserves_message` covers duplicate `Set-Cookie` entries interleaved with other headers. It checks that the returned items and `message.items()` match the expected order, and that the payload, `defects` and `policy` keep their identity. [[diff:test-test_connection.py:226-249]] This guards the delete-and-re-add rewrite. [[diff:src-urllib3-connection.py:102-108]] The socket test also checks `HTTPHeaderDict` and `_original_response.msg` agree. [[diff:test-with_dummyserver-test_socketlevel.py:139-146]]

**What is not covered.**
- Header-name cases: whitespace before the colon, and names with odd characters. This is intentionally out of scope.
- Header names with mixed case through delete and re-add. The unit test uses `Set-Cookie` and `X-First` in their usual casing, so case preservation is not demonstrated.
- A bare `\n` fold, or a fold with no whitespace after the CRLF. The regex needs `\r\n` followed by at least one SP or HTAB, and no test shows other line endings being left alone.
- A very long whitespace run. The `(?<![ \t])` lookbehind exists to avoid quadratic backtracking, but no test would catch a regression to it. [[diff:src-urllib3-connection.py:80-82]]

### Follow-ups
- Does a mixed-case header name survive the delete-and-re-add loop? | ask: In `_normalize_header_values`, does `del message[name]` followed by `message[name] = value` preserve the original header-name case, and is there a test for it?
- Could a timing test cover the quadratic-backtracking case? | ask: How would I write a test that fails if `_OBSOLETE_FOLD_RE` loses its `(?<![ \t])` lookbehind on a long whitespace run?
- What happens to a lone `\r\n` with no following whitespace? | ask: What does `_normalize_header_value` do with a value containing `\r\n` that is not followed by a space or tab?

```json
{"title": "How the tests cover edge cases"}
```