It is the same object. `_normalize_header_values` mutates the `HTTPMessage` it was given. It does not build a replacement. `getresponse` passes it `httplib_response.msg`, so the object that gets rewritten is the one `http.client` produced. [[diff:src-urllib3-connection.py:650-651]]

- **No new message is created.** The function calls `del message[name]` and `message[name] = value` on its argument, and it never constructs or returns another `HTTPMessage`. What it returns is only the `(name, value)` list. [[diff:src-urllib3-connection.py:102-110]]
- **Identity is preserved on purpose.** The code comment says the rewrite keeps "its identity and header ordering". [[diff:src-urllib3-connection.py:103-104]]
- **The socket test checks this.** It asserts `_original_response.headers is _original_response.msg`, and then reads the unfolded cookies through `msg`. The first assertion shows these are one object. The second shows that reading through it gives the unfolded values. [[diff:test-with_dummyserver-test_socketlevel.py:141-146]]

"Downstream code already holds" needs a qualification. The rewrite runs inside `getresponse`, before `HTTPResponse` is built, so nothing outside `getresponse` can have a reference to `msg` yet. In practice, consumers get the reference afterwards, through `_original_response`, and by then it is already rewritten. What the identity guarantee covers is any reference taken inside the stdlib or before the call. That includes the `headers is msg` aliasing in the test. [[diff:src-urllib3-connection.py:650-653]]

This serves the invariant that no consumer sees a raw CRLF in either the `HTTPHeaderDict` or the message. A copy would leave the original message folded. Anyone who reads through `_original_response` would then see the raw CRLF, which is what the in-place design is meant to prevent. [[desc:d-p2]]

The cost is that urllib3 mutates an object the standard library owns. The unit test limits the damage by checking that `defects`, `policy` and the payload keep their identity too. [[diff:test-test_connection.py:247-249]]

### Follow-ups

- Can anything hold `msg` before `_normalize_header_values` runs? | ask: Between `http.client` parsing the response and `_normalize_header_values` running in `getresponse`, can any code read `httplib_response.msg` and see the raw CRLF?
- Would a copy break the `headers is msg` assertion? | ask: If `_normalize_header_values` built a new `HTTPMessage` instead of mutating, which assertions in the socket test would fail?

```json
{"anchor": {"quote": "the same message object", "hunk": "h:src-urllib3-connection.py:fa60105d7fcbe8fe"}}
```