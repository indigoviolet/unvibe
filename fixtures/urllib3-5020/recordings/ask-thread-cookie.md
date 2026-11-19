The description names Requests' cookie handling as the consumer. It says the synchronization prevents "cookie consumers such as Requests from re-emitting raw CRLF". It also lists "end-to-end Requests cookie extraction and subsequent request serialization" among the checks the author ran. [[desc:d-p2]] [[desc:d-p5]]

That claim comes from the description only. This checkout has no Requests source and no urllib3 code that reads `_original_response`, and I did not run anything. Treat it as the author's claim, not something I verified.

The mechanism, reconstructed from memory of Requests and `http.cookiejar` and unchecked here, has four steps:

1. Requests hands the response's original `HTTPMessage` to `http.cookiejar` for cookie extraction.
2. The jar reads `Set-Cookie` values from that message and stores them.
3. On a later request, the jar writes the stored value into a `Cookie` header.
4. If the stored value still held `\r\n`, that header would be written with a raw line break in it.

Before the change, `getresponse` copied `httplib_response.msg.items()` into `HTTPHeaderDict` and never touched the message. A folded `Set-Cookie` therefore reached that consumer with its `obs-fold` CRLF intact. [[diff:src-urllib3-connection.py:647-651]]

This is the contract the fix serves: no copy of the headers a consumer can reach may carry a fold. urllib3 cannot see which copy a consumer reads, so cleaning `HTTPHeaderDict` alone would not reach this one. `_normalize_header_values` therefore rewrites the same `HTTPMessage` in place, and `getresponse` builds `HTTPHeaderDict` from the list it returns. [[diff:src-urllib3-connection.py:102-110]] [[diff:src-urllib3-connection.py:650-651]]

No test runs a real cookie consumer. The socket test only shows that the data such a consumer would read is clean. It asserts the same unfolded `set-cookie` list through `r.headers.getlist(...)` and through `_original_response.msg.get_all(...)`. [[diff:test-with_dummyserver-test_socketlevel.py:124-127]] [[diff:test-with_dummyserver-test_socketlevel.py:142-145]]

Other consumers of `_original_response.msg` or `.headers` are not named anywhere in the base. I only know of this one from the description.

### Follow-ups

- Which Requests code path reads the message? | ask: Which function in Requests passes `_original_response.msg` to `http.cookiejar`, and where does the stored cookie value become a `Cookie` header on the next request?
- Would `http.cookiejar` already refuse a cookie value that contains CRLF? | ask: If a `Set-Cookie` value contained a raw `\r\n`, would `http.cookiejar` store it, drop it, or alter it before the next request?

```json
{
  "anchor": {"quote": "they could re-emit raw CRLF on later requests", "hostBlock": "card:problem"},
  "contribute": {
    "open_questions": ["Which exact Requests/http.cookiejar code path reads _original_response.msg and writes a stored Set-Cookie value into a later Cookie header, and does it reject CRLF anywhere along the way?"]
  },
  "degraded": "No Requests or urllib3 consumer source is in this checkout, so the Requests claim rests on the PR description and unverified recall of Requests and http.cookiejar."
}
```