`http.client` doesn't unfold continuation lines when it parses a response. It stores each header value as the raw text of the field, and for a folded field that text still contains the line break and the indent. For the socket test's `Set-Cookie`, the stored value is `"___utmvbtouVBFmB=gZg\r\n    XbNOjalT: Lte; path=/; Max-Age=900"`. The value is one string, but it spans two lines. [[desc:d-p1]] [[diff:test-with_dummyserver-test_socketlevel.py:101-102]]

**Why this is a problem.** The parser is faithful to the bytes the server sent. But a header value that contains `\r\n` breaks a basic assumption of HTTP/1.x, because `\r\n` is also the delimiter between field lines. Any consumer that writes the value back out can have that `\r\n` read as a real line break. RFC 9112 closes this gap by requiring the recipient to replace each `obs-fold` with a single space before using the value. Nothing in the old path did that. Before the change, `getresponse` copied `httplib_response.msg.items()` straight into `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:647-651]]

**Where the change shows this behavior.**
- `_normalize_header_value` begins with `if "\r\n" not in value: return value`. That fast path only makes sense if parsed values can still contain `\r\n`. [[diff:src-urllib3-connection.py:85-88]]
- The unit test builds an `HTTPMessage` with `"a=1 \r\n two"` as a stored value and expects the cleanup to rewrite it. [[diff:test-test_connection.py:229]]

**What I haven't verified.** This checkout has no stdlib source, and I didn't run the parser. The mechanism (the email parser behind `http.client` joining continuation lines without removing the line ending) comes from my knowledge of the stdlib and from the description. The tests above are consistent with it, but they don't prove it.

The stored `HTTPMessage` is also what `_original_response.msg` exposes, so the raw `\r\n` sits in the object that cookie consumers read, not only in urllib3's copy. That is why the fix rewrites the message and doesn't just clean `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:102-108]]

### Follow-ups
- Does `http.client` keep the line ending when a folded line ends in a bare `\n`? | ask: When `http.client` parses a folded header whose lines end in bare `\n`, does the stored value contain `\n` and would `_normalize_header_value` leave it untouched?
- Where does the stdlib join continuation lines? | ask: Which part of `http.client`'s header parsing joins continuation lines into one value, and why does it keep the line ending?

```json
{"anchor": {"quote": "keeps those raw CRLFs inside the HTTPMessage values", "hostId": "card:problem"}, "contribute": {"open_questions": ["Does http.client's header parser keep the original line ending (CRLF vs bare LF) when joining a continuation line into the stored value?"]}, "degraded": "No stdlib source is available in the checkout and the parser was not run, so how http.client stores folded values rests on the description and the tests, not on the parser's code."}
```