The selected phrase is the output side of the regex. Each fold becomes exactly one space, whatever whitespace surrounded the CRLF. So every `obs-fold` collapses to a single separator, and a separator is always left. [[diff:src-urllib3-connection.py:88]]

The match is the whole `OWS CRLF RWS` run: the optional whitespace before the CRLF, the CRLF, and the required whitespace after it. [[diff:src-urllib3-connection.py:82]] `re.sub(" ", ...)` swaps that entire run for `" "`. In `"before \t\r\n\t  after"`, the trailing space and tab, the CRLF, and the leading tab and two spaces are one match. The result is `"before after"`. [[diff:test-test_connection.py:218]]

Why exactly one space:

- **Not zero.** RFC 9112 asks the receiver to replace each `obs-fold` with spaces. Replacing with nothing would glue words together, for example `gZg` and `XbNOjalT:` in the socket test's cookie. Replacing with one space keeps the two halves separate. [[diff:test-with_dummyserver-test_socketlevel.py:124-127]]
- **Not the original whitespace.** Keeping the original whitespace would keep runs of arbitrary length, and a stray tab would survive too. One space is a canonical form, and it is the same for SP and HTAB combinations. The four-way socket test shows all of them become `before after`. [[diff:test-with_dummyserver-test_socketlevel.py:104-111]]
- **One per fold, not one per run.** Each match is a single fold, so two adjacent folds give two spaces. `"one\r\n \r\n\tthree"` becomes `"one  three"`. [[diff:test-test_connection.py:220]] The description's "one space, not zero" wording for adjacent folds doesn't match this result. The code and test agree with each other, and one of the critic findings covers the mismatch. [[desc:d-p6]]

The replacement touches only whitespace attached to a CRLF. Interior whitespace such as `"one\t two"` is unchanged, and a value with no `\r\n` skips the regex entirely. [[diff:src-urllib3-connection.py:86-88]] [[diff:test-with_dummyserver-test_socketlevel.py:133]]

This detail serves the invariant that no consumer sees a raw CRLF in a header value. The same normalized value is written to both `HTTPHeaderDict` and the original `HTTPMessage`. [[diff:src-urllib3-connection.py:102-110]]

### Follow-ups

- Why does RFC 9112 say a space instead of just removing the fold? | ask: Why does `_OBSOLETE_FOLD_RE` replace each match with one space rather than an empty string, and what would break in the folded `Set-Cookie` case?
- Is `"one  three"` for adjacent folds really correct? | ask: For adjacent folds like `"one\r\n \r\n\tthree"`, is two spaces the right RFC 9112 result, or should they collapse into one?

```json
{"anchor": {"quote": "replaces each OWS CRLF RWS run with one space", "host": "card:central#b2"}}
```