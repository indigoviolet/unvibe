Leaving it alone is correct. A bare LF that isn't followed by a space or tab isn't an `obs-fold`, and the code can't treat it as one without inventing a rule RFC 9112 doesn't give.

- **What the code does.** `_normalize_header_value` returns early unless `"\r\n"` is in the value. `_OBSOLETE_FOLD_RE` also requires `\r\n[ \t]+`. A lone `\n` therefore goes untouched either way. [[diff:src-urllib3-connection.py:86-88]] [[diff:src-urllib3-connection.py:80-82]]
- **Why that is right for this case.** An `obs-fold` is `OWS CRLF RWS`, and the required whitespace after the line break is what makes it a continuation. Without it, the line break is a line terminator, not a fold. Replacing it with a space would change what the header means.
- **Probably unreachable.** From memory, I haven't run it. `http.client` reads header lines with `readline`, which splits at `\n`. A bare LF with no whitespace after it should therefore start a new header line, or a malformed one, and not stay inside a value. If so, no value reaches `_normalize_header_value` with such an LF in it.
- **The case that does matter.** It is a bare LF followed by whitespace, such as `Set-Cookie: a=1\n b=2`. As I recall, `http.client`'s parser keeps the continuation line's own ending, so `\n b=2` would stay in the value. The fast path would skip it, because it checks only for `\r\n`. That is the bare-LF finding. If you widen anything, widen the pattern to `\r?\n[ \t]+` and the fast-path check to match. Don't add a rule for an LF with no whitespace after it.

The invariant "no raw line break in a header value" is enforced only for CRLF folds. No test sends a bare LF in either form. [[diff:test-test_connection.py:214-222]]

### Follow-ups

- Does `http.client` keep a bare `\n` continuation inside the value? | ask: For a response header folded with a bare `\n` followed by a space, what does `http.client` leave in the `HTTPMessage` value, and would `_normalize_header_value` change it?
- What would a minimal fix and test look like? | ask: What change to `_OBSOLETE_FOLD_RE` and the fast-path check would handle bare-LF folds, and which test cases should be added to `test_normalize_header_value`?

```json
{"anchor": {"quote": "A value with a bare", "hostId": "card:decisions"}, "contribute": {"open_questions": ["Does http.client's header reader ever leave a bare LF (with or without following whitespace) inside an HTTPMessage value, or does readline always split it into a new line?"]}}
```