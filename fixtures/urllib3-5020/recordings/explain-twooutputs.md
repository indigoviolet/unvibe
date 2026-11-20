Because `r.headers` is the `HTTPHeaderDict`, and the `HTTPHeaderDict` is a separate copy of the header data. Cleaning that copy says nothing about the `HTTPMessage` it was copied from.

- **Where `r.headers` comes from.** `getresponse` builds `HTTPHeaderDict(header_items)` and passes it to the response object. [[diff:src-urllib3-connection.py:650-654]] Before the change, the same line copied `httplib_response.msg.items()`. If only that copy were unfolded, `r.headers.getlist("set-cookie")` would return clean values. A test that reads only `r.headers` would pass.
- **Why the original message is untouched.** The response is built with `body=httplib_response`, so the original `HTTPMessage` stays reachable as `_original_response.msg`. [[diff:src-urllib3-connection.py:650-654]] Nothing links the two objects after the copy. A cleaned `HTTPHeaderDict` leaves `msg` holding the raw `\r\n`. The write-back in `_normalize_header_values` is the step that fixes `msg`. [[diff:src-urllib3-connection.py:102-108]]
- **Who sees the difference.** A reader that goes through `_original_response.msg` would still get a `Set-Cookie` with the `obs-fold` CRLF in it. The description says Requests' cookie handling reads the message this way. I couldn't check that against Requests' source, so treat it as the author's claim. [[desc:d-p2]]

The invariant is that no copy a consumer can reach may carry a fold. A fix that looks right through `r.headers` only holds for callers who read that attribute. Which copy a caller reads is outside urllib3's control.

The socket test guards against this partial fix. It asserts the same unfolded `set-cookie` list through `r.headers.getlist(...)` and through `_original_response.msg.get_all(...)`. [[diff:test-with_dummyserver-test_socketlevel.py:124-127]] [[diff:test-with_dummyserver-test_socketlevel.py:142-145]] A one-copy fix would pass the first assertion and fail the second.

### Follow-ups

- Would the unit tests catch a fix that cleaned only `HTTPHeaderDict`? | ask: Which tests fail if `_normalize_header_values` returned cleaned items but skipped the write-back to the message?
- Is there a reason to keep `r.headers` and `_original_response.msg` as two copies? | ask: Could `HTTPHeaderDict` be built as a view over the `HTTPMessage` so the two could never disagree, and what would that cost?

```json
{"anchor": {"quote": "If only HTTPHeaderDict were cleaned, r.headers would look correct", "blockId": "card:g-reach"}}
```