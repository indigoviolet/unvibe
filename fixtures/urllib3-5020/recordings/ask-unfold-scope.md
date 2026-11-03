The description says only that this PR "intentionally does not address" the whitespace-before-colon and header-name validation scope discussed on #1362. It gives no reason. [[desc:d-p4]] The reasons below are inferred from the code. I also couldn't find the selected sentence in the host block, so I answered from the question.

**Folds change header values. Whitespace before the colon concerns header names.**
- The fold fix works on values that `http.client` has already parsed. `_normalize_header_value` rewrites a value only when it contains `\r\n`, and the regex matches `OWS CRLF RWS` inside that value. [[diff:src-urllib3-connection.py:85-88]] [[diff:src-urllib3-connection.py:80-82]]
- `_normalize_header_values` passes each `name` through untouched. It only swaps in the new value, and it only rewrites the message when a value changed. [[diff:src-urllib3-connection.py:96-100]]
- Whitespace before the colon (`Name : value`) needs a different kind of change. The code would have to decide what to do with a malformed name: reject it, strip it, or drop the header. That is a policy choice about names, and nothing in this diff handles names.

**Why folds could be fixed on their own.**
- Replacing each fold with one space is a deterministic rewrite that RFC 9112 specifies, so there are no open policy questions.
- It also fits the single invariant that no consumer sees a raw CRLF in a value. [[desc:d-p1]]
- Name handling has no such single answer, and it would widen the change beyond the folded `Set-Cookie` case.

**Cost of the split.**
- Names are not validated here, and the changelog and tests make no claim about them. The tests send only well-formed names, so nothing covers `Name : value`. [[diff:test-with_dummyserver-test_socketlevel.py:99-118]]
- A reader should not take "obs-fold handled" to mean "header parsing hardened".

### Follow-ups

- What would `http.client` do with `Name : value` today? | ask: How does `http.client` parse a response header line with whitespace before the colon, and would the name or the value end up with the space?
- Would name handling belong in `_normalize_header_values`? | ask: If name validation were added later, should it live in `_normalize_header_values` or somewhere else in `getresponse`, and why?

```json
{"anchor": {"quote": "The whitespace-before-colon and header-name validation scope is not part of this problem", "host": "card:problem#b3"}, "contribute": {"open_questions": ["How does http.client parse a response header line with whitespace before the colon, and what does that leave in HTTPMessage names or values?"]}}
```