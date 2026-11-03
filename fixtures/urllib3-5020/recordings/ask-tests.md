The unit tests pin five cases: four parametrized single-value cases and one message-level test. They only exercise `\r\n` folds, and several fold shapes have no test.

**What they pin**

`test_normalize_header_value` has four cases. [[diff:test-test_connection.py:214-224]]

- `"ordinary\tvalue"` has no `\r\n`, so the fast path returns it unchanged. [[diff:test-test_connection.py:217]] [[diff:src-urllib3-connection.py:86-87]]
- `"before \t\r\n\t  after"` is one fold with whitespace on both sides, and it becomes `"before after"`. [[diff:test-test_connection.py:218]]
- `"one\r\n two\t\r\n\tthree"` is two folds in one value, and each becomes one space. [[diff:test-test_connection.py:219]]
- `"one\r\n \r\n\tthree"` is adjacent folds, and it becomes `"one  three"` with two spaces. [[diff:test-test_connection.py:220]]

`test_normalize_header_values_preserves_message` covers the whole-message layer. [[diff:test-test_connection.py:226-249]]

- It builds a message with interleaved duplicate `Set-Cookie` entries and one fold.
- It asserts that the returned items and `message.items()` keep their order.
- It asserts that `get_all("Set-Cookie")` returns both cookies.
- It asserts that the payload, `defects` and `policy` keep their identity.

These two tests guard the invariant that no consumer sees a raw CRLF in `HTTPHeaderDict` or the message, and that unfolding doesn't disturb anything else on the message.

**Fold shapes with no unit test**

Some of these are covered at socket level only, and some are covered nowhere.

- **A fold at the start or end of a value.** No case has a leading `\r\n ` or a trailing `\r\n `. The result would be a leading or trailing space, since the regex replaces it with one space. Whether `http.client` ever hands such a value over is not shown.
- **A `\r\n` with no following SP or HTAB.** The regex requires at least one, so it leaves the value alone. [[diff:src-urllib3-connection.py:82]] No test sends it, and `headers_changed` staying false for it is untested.
- **A bare `\n` fold.** The fast path checks only for `"\r\n"`, so a value like `"a=1\n b=2"` is skipped. [[diff:src-urllib3-connection.py:86-87]] This is the bare-LF finding. Neither the unit tests nor the socket test sends one.
- **A long whitespace run.** The `(?<![ \t])` lookbehind exists for this, but every input is short, so removing it would pass. [[diff:src-urllib3-connection.py:80-82]]
- **Message-level edge cases.** There is no test with no folded values, to show the message is left untouched. There is no test with a mixed-case header name, to show the case survives delete and re-add. There is no test with several folded headers in one message.

**What the socket test adds**

The socket test covers all four SP/HTAB pairings around the CRLF, a repeated mixed fold, and ordinary interior whitespace. [[diff:test-with_dummyserver-test_socketlevel.py:104-115]] The unit tests cover only the pairings `" \t"` before and `"\t  "` after in one case, plus the adjacent-fold case. The SP/HTAB matrix therefore depends on the socket test.

### Follow-ups

- Which added unit cases would close the gaps? | ask: Draft the extra parametrized cases for `test_normalize_header_value` that would cover a leading fold, a trailing fold, a `\r\n` with no following whitespace, and a bare `\n` fold, with the expected output for each.
- Would a no-fold message test be useful? | ask: What assertion would show that `_normalize_header_values` leaves a message untouched when no value contains `\r\n`?

```json
{"anchor": {"quote": "The unit tests cover single values, including adjacent folds", "host": "card:buildup#b4"}, "contribute": {"open_questions": ["Does http.client ever hand over a value that begins or ends with an obs-fold, giving a leading or trailing space after normalization?"]}}
```