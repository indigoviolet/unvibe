Seven fold shapes have no test. The gap that matters most is the bare-LF fold, because it is the only one that could show the fix leaves the original bug open.

**What is tested.** `test_normalize_header_value` covers a value with no CRLF, mixed SP/HTAB around one fold, two folds with text between them, and two adjacent folds [[diff:test-test_connection.py:217-220]]. The socket test adds all four SP/HTAB pairings and a mixed repeated fold. It also covers a `Set-Cookie` whose continuation starts with spaces and has no whitespace before the CRLF [[diff:test-with_dummyserver-test_socketlevel.py:101-117]].

**Fold shapes with no test**

- **A CRLF with no whitespace after it** (`"a\r\nb"`). It passes the `"\r\n" not in value` check and then must fail the pattern [[diff:src-urllib3-connection.py:86-88]]. Loosening the trailing `[ \t]+` to `[ \t]*` would merge two lines into one value, and every current assertion would still pass.
- **A bare-LF fold** (`"\n "`). Both the early return and `_OBSOLETE_FOLD_RE` require `\r\n`, so such a value would pass through untouched [[diff:src-urllib3-connection.py:80-82]]. A lone `\r` is untested in the same way. Whether `http.client` can hand over such a value is unverified.
- **A fold at the start or end of a value** (`"\r\n x"`, `"a\r\n "`). Every case has text on both sides of the fold. The regex would give `" x"` and `"a "`, with a stray edge space. I don't know whether `http.client` strips values first.
- **A long run of blanks.** Every case uses runs of a few characters, so removing the lookbehind would fail nothing [[diff:src-urllib3-connection.py:80-82]].
- **Adjacent folds over the socket.** The `"one  three"` case exists only at unit level, and the socket's mixed case has text between its folds [[diff:test-with_dummyserver-test_socketlevel.py:112-114]].
- **Duplicate names that differ only in case.** `del message[name]` is case-insensitive, and whether the replay restores each casing is untested [[diff:src-urllib3-connection.py:105-108]].
- **A message with no folds at all.** Every message-level test takes the rewrite path, so nothing observes the `headers_changed` guard [[diff:src-urllib3-connection.py:102]].

**Which gap matters most.** The invariant is that no copy a consumer can reach carries a raw line break. The bare-LF fold is the only gap where the answer could show that invariant failing. If `http.client` keeps `\n ` in a stored value, a raw `\n` still reaches `Set-Cookie`, which is the symptom this PR targets. The changelog and description only promise removal of CRLF, so this is a gap in scope and not a contradiction.

I haven't run the parser, so I can't say whether it is real. The `a\r\nb` refusal case is the best gap to close first. It needs no stdlib knowledge, takes one unit test line, and guards against silent header merging. That rewrite policy would also be the cost of widening the pattern to fix the bare-LF case.

### Follow-ups

- Does `http.client` keep a leading or trailing fold's whitespace in a stored value? | ask: When a header line is `X:` followed by a continuation line, or a value ends with a folded blank line, what string does `http.client` store, and what does `_normalize_header_value` return for it?
- What cases would pin the refusal side? | ask: Which extra parametrized cases for `test_normalize_header_value` would fail if the trailing `[ \t]+` became `[ \t]*` or if `\n` alone started matching?

```json
{
  "anchor": {"quote": "Nothing asserts that _normalize_header_values leaves the message alone", "hostBlock": "card:g-tests"},
  "contribute": {
    "open_questions": [
      "Does http.client strip or keep whitespace when a header value begins or ends with a fold, so that _normalize_header_value would leave a stray leading or trailing space?"
    ]
  }
}
```