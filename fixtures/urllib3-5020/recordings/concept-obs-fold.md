An `obs-fold` is the obsolete HTTP/1.x way to continue a header field value on the next line: a CRLF followed by at least one SP or HTAB inside the value. RFC 9112 tells a recipient to replace each one with SP before it interprets the value. The description states it this way: each "OWS CRLF RWS sequence" becomes a single space. [[desc:d-p1]]

In this change the concept shows up in three places:

- **The pattern.** `_OBSOLETE_FOLD_RE` is `(?:(?<![ \t])[ \t]+)?\r\n[ \t]+`. The optional leading group is the OWS before the CRLF. The required CRLF and trailing whitespace are the RWS that marks a continuation. [[diff:src-urllib3-connection.py:80-82]]
- **The single-value rule.** `_normalize_header_value` returns the value unchanged if it has no `\r\n`. Otherwise it replaces every match with one space. [[diff:src-urllib3-connection.py:85-88]]
- **The message-level rule.** `_normalize_header_values` applies that rule to every `HTTPMessage` item. [[diff:src-urllib3-connection.py:91-110]]

## Why it matters here

Python's `http.client` does not unfold. It keeps the raw CRLF inside the `HTTPMessage` values. Before the change, `getresponse` copied those values straight into `HTTPHeaderDict`. A folded `Set-Cookie` therefore reached consumers with `\r\n` embedded in it. [[desc:d-p1]] [[diff:src-urllib3-connection.py:647-651]]

The `obs-fold` has to be removed from two places. One is `HTTPHeaderDict`. The other is the original `HTTPMessage`, because the description says cookie consumers such as Requests read the message and could re-emit the raw CRLF. [[desc:d-p2]]

The alternative would be to clean only the `HTTPHeaderDict` copy. That would leave the fold in the message, which is the part Requests reads. The change instead writes the cleaned values back into the same `HTTPMessage` object. [[diff:src-urllib3-connection.py:102-108]]

Two details of the unfolding rule are easy to get wrong:

- **Whitespace around the CRLF is absorbed.** `"before \t\r\n\t  after"` becomes `"before after"`, not `"before \t after"`. [[diff:test-test_connection.py:218]]
- **Each fold becomes exactly one space.** `"one\r\n \r\n\tthree"` becomes `"one  three"` with two spaces. The lookbehind stops the second match from absorbing the space the first fold produced. This differs from the description's "adjacent folds collapse to one space". [[diff:test-test_connection.py:220]] [[desc:d-p6]]

A bare `\r\n` that is not followed by SP or HTAB is not an `obs-fold` under this pattern, so it is left alone. The tests never exercise that case. [[diff:src-urllib3-connection.py:82]]

## Example

This is the socket test's folded `Set-Cookie`. The server sends the cookie over two lines:

```
Set-Cookie: ___utmvbtouVBFmB=gZg\r\n
    XbNOjalT: Lte; path=/; Max-Age=900\r\n
```

[[diff:test-with_dummyserver-test_socketlevel.py:101-102]]

| | Value |
|---|---|
| Before (`http.client` message) | `___utmvbtouVBFmB=gZg\r\n    XbNOjalT: Lte; path=/; Max-Age=900` |
| After (`HTTPHeaderDict` and `msg`) | `___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900` |

The CRLF and the four spaces after it are one match, so they become a single space. The test then checks both `r.headers.getlist("set-cookie")` and `_original_response.msg.get_all("set-cookie")` against the unfolded value. [[diff:test-with_dummyserver-test_socketlevel.py:124-146]]

### Follow-ups

- Does an `obs-fold` with only a lone `\n` get unfolded? | ask: If a server ends a folded header line with a bare LF instead of CRLF, what value does `http.client` produce, and does `_normalize_header_value` change it?
- Why does RFC 9112 say to replace an `obs-fold` with SP rather than reject the message? | ask: What does RFC 9112 allow a recipient to do with an `obs-fold`, and why did this change choose replacement with a single space for each fold?
- Is a long run of whitespace around an `obs-fold` handled in linear time? | ask: Walk through how the lookbehind in `_OBSOLETE_FOLD_RE` keeps matching linear for a value with a long whitespace run and one CRLF.

```json
{"title": "obs-fold"}
```