## Answer

The consumer is Requests' cookie handling. This comes from the PR description, and I haven't read Requests' source here. The description says Requests reads `_original_response.msg` directly. It lists "end-to-end Requests cookie extraction and subsequent request serialization" among the checks it ran. [[desc:d-p2]] [[desc:d-p5]]

The fix stops it by making sure the `HTTPMessage` Requests reads no longer holds a fold. `_normalize_header_values` unfolds each value, then deletes and re-adds the headers on that same `HTTPMessage`. `getresponse` builds `HTTPHeaderDict` from the list it returns. [[diff:src-urllib3-connection.py:94-110]] [[diff:src-urllib3-connection.py:650-651]]

## How the CRLF would be re-emitted

I'm reconstructing this from memory of Requests and `http.cookiejar`, and I haven't checked it here.

1. Requests passes the response's original `HTTPMessage` to `http.cookiejar`.
2. The cookie jar reads `get_all("Set-Cookie")` and stores the cookie value as given.
3. On a later request, the jar serializes that stored value into a `Cookie` header.
4. If the value still contained `\r\n`, that header would be written with a raw line break in it.

Before the change, `getresponse` copied `msg.items()` and never touched `msg`. Any cookie value that came from a folded `Set-Cookie` therefore kept its `\r\n` all the way to step 4. [[diff:src-urllib3-connection.py:650-654]]

## Why cleaning only `HTTPHeaderDict` would not stop it

If only `HTTPHeaderDict` were cleaned, `r.headers` would look correct. The `HTTPMessage` that the cookie path reads would still hold the fold.

The write-back in `_normalize_header_values` is the step that reaches the consumer. It runs on the same object, so `_original_response.msg` is clean when Requests reads it. [[diff:src-urllib3-connection.py:102-108]]

This serves the invariant that no copy of the headers a consumer can reach carries a fold. urllib3 can't see which copy a consumer will read, so both must be clean.

## What the tests show

The socket test asserts the same unfolded `set-cookie` list on both copies. It checks `r.headers.getlist("set-cookie")` and `_original_response.msg.get_all("set-cookie")`. [[diff:test-with_dummyserver-test_socketlevel.py:124-127]] [[diff:test-with_dummyserver-test_socketlevel.py:142-145]]

No test runs a real cookie consumer. The assertions check that the data Requests would read is clean. They don't check that Requests actually reads it or stops emitting CRLF. The Requests claim rests on the author's manual run.

Only a `\r\n` fold is covered. A bare-LF fold would pass through untouched, so that path could still reach a cookie jar. That is the bare-LF finding. [[diff:src-urllib3-connection.py:86-88]]

### Follow-ups

- Which Requests code path reads `_original_response.msg`? | ask: Which function in Requests passes `_original_response.msg` to `http.cookiejar`, and where does the cookie value become a `Cookie` header on the next request?
- Does `http.cookiejar` itself reject or keep a cookie value that contains `\r\n`? | ask: If a `Set-Cookie` value contained a raw `\r\n`, would `http.cookiejar` store it, drop it, or alter it before the next request?

```json
{"anchor": {"quote": "they could re-emit raw CRLF on later requests", "hostBlockId": "card:problem"}, "contribute": {"open_questions": ["Does Requests pass _original_response.msg to http.cookiejar's extract_cookies, and does the stored cookie value keep a raw CRLF into the next Cookie header?"]}}
```