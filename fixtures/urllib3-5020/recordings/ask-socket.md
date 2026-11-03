The socket-level test proves that the real `http.client` parser hands `getresponse` folded values, and that the whole path from socket to `r.headers` and `_original_response.msg` ends up clean. The unit tests only prove the two helper functions behave correctly on strings and on a hand-built `HTTPMessage`.

**What only the socket test shows**

- **The parser's output is what the helpers assume.** The unit tests build `"a=1 \r\n two"` by hand. The socket test sends raw bytes, so `http.client` itself produces the value. If the parser stripped or normalized the continuation line, the helpers would never see a fold, and only this test would notice. It sends a four-space continuation line on a `Set-Cookie`. [[diff:test-with_dummyserver-test_socketlevel.py:99-103]]
- **`getresponse` is actually wired to the helper.** The unit tests import `_normalize_header_value` and `_normalize_header_values` directly. Neither calls `getresponse`. If the call at the `HTTPHeaderDict` construction site were removed, every unit test would still pass. The socket test would fail. [[diff:src-urllib3-connection.py:650-651]] [[diff:test-with_dummyserver-test_socketlevel.py:124-134]]
- **`HTTPHeaderDict` and the original message agree.** After a real response, it asserts that `r.headers` has no `\r` or `\n`. It also asserts that `_original_response.headers is _original_response.msg`, and that `msg.get_all("set-cookie")` and `msg["fold-mixed-repeated"]` return unfolded values. That is the "no consumer sees a raw CRLF" invariant, checked on both views. The unit test checks only the message and the returned list. [[diff:test-with_dummyserver-test_socketlevel.py:135-146]]
- **The SP/HTAB matrix.** The four pairings of SP and HTAB around the CRLF, the repeated mixed fold, and an ordinary `one\t two` all go through the real parser. The unit tests cover only some of these shapes. [[diff:test-with_dummyserver-test_socketlevel.py:104-115]] [[diff:test-test_connection.py:214-222]]

**What the unit tests prove that the socket test does not**

- **Adjacent folds.** `"one\r\n \r\n\tthree"` gives `"one  three"`, with two spaces. The socket test has no such case. [[diff:test-test_connection.py:220]]
- **Message preservation.** Duplicate `Set-Cookie` entries interleaved with other headers keep their order, and the payload, `policy` and `defects` keep their identity. The socket test only compares against the cookie order from the same parse. [[diff:test-test_connection.py:226-249]]

**What neither proves**

- Bare-LF folds. [[diff:src-urllib3-connection.py:86-87]]
- Long whitespace runs, which the lookbehind exists for. [[diff:src-urllib3-connection.py:80-82]]
- Mixed-case header names through delete and re-add.
- That Requests really reads the message. That premise rests on the description alone. [[desc:d-p2]]

### Follow-ups

- Would the socket test fail if `getresponse` stopped calling `_normalize_header_values`? | ask: If the `_normalize_header_values` call in `getresponse` were removed, which tests would fail and which would still pass?
- What socket-level case would cover a bare-LF fold? | ask: Draft a socket-level response with a bare-LF fold and say what `http.client` would leave in the `HTTPMessage` value.

```json
{"anchor": {"quote": "A socket-level test covers real folded responses", "hostId": "card:buildup"}, "contribute": {"open_questions": ["Does http.client's parser itself preserve the raw CRLF and continuation whitespace in HTTPMessage values for folded headers, which is the premise the socket test depends on?"]}}
```