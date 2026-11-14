The `HTTPMessage` is the object `http.client` builds while parsing the response. `getresponse` only reads from it. It copies `msg.items()` into a new `HTTPHeaderDict`, and nothing in that copy removes or replaces the original. The response is built around the original `http.client` response object (`body=httplib_response`). That is why the same `HTTPMessage` is still reachable afterwards. [[diff:src-urllib3-connection.py:650-654]]

The socket test shows this from the outside. It asserts that `r._original_response` is set. It also asserts that `_original_response.headers is _original_response.msg`, so one `HTTPMessage` sits under both names. [[diff:test-with_dummyserver-test_socketlevel.py:139-141]]

**Why it matters for the fix.** After `getresponse`, the same header data exists in two places: the `HTTPHeaderDict` and the original `HTTPMessage`. The old code copied from the message at one moment and never touched it again. Cleaning only the `HTTPHeaderDict` would leave the folded value in the message. Anyone who reads `_original_response.msg` directly would still get a `\r\n` in `Set-Cookie`. The description says Requests' cookie handling does this, and I haven't checked that against Requests' source. [[desc:d-p2]]

This is why `_normalize_header_values` rewrites the message in place and also returns the cleaned items that `HTTPHeaderDict` is built from. [[diff:src-urllib3-connection.py:102-110]]

### Follow-ups

- Who else can hold a reference to the original `HTTPMessage`? | ask: Besides `_original_response.msg` and `.headers`, which references to the `HTTPMessage` survive after `getresponse`, and would a replacement object miss any of them?

```json
{"anchor": {"quote": "The original HTTPMessage stayed on the response", "hostId": "card:problem"}}
```