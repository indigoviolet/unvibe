A folded `Set-Cookie` is a single `Set-Cookie` header that the server wrote across two or more lines. The continuation line starts with a space or tab, so the receiver reads it as part of the previous header and not as a new one. This is the `obs-fold` case. The socket test sends one:

```
Set-Cookie: ___utmvbtouVBFmB=gZg\r\n
    XbNOjalT: Lte; path=/; Max-Age=900\r\n
```

[[diff:test-with_dummyserver-test_socketlevel.py:101-102]]

`http.client` parses this as one cookie and leaves the `\r\n` and the four spaces inside the value. The value urllib3 receives is `___utmvbtouVBFmB=gZg\r\n    XbNOjalT: Lte; path=/; Max-Age=900`. The continuation text `XbNOjalT: Lte` looks like a header of its own, but it is only the second half of the cookie value. After the fix, the test expects `___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900`. [[diff:test-with_dummyserver-test_socketlevel.py:124-127]]

This case matters because cookies are one of the places where a raw line break in a value does harm. A cookie jar reads the `Set-Cookie` value from the original `HTTPMessage`. If it keeps the `\r\n` and writes it into the next request, it produces a malformed header line. That is why `_normalize_header_values` rewrites the `HTTPMessage` as well as building `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:102-108]] [[desc:d-p2]]

The test sends this folded cookie next to an ordinary `Set-Cookie: ordinary=1; Path=/`. It checks that `getlist("set-cookie")` returns both, in order. So unfolding one cookie must not merge it with, or reorder, the cookies around it. [[diff:test-with_dummyserver-test_socketlevel.py:103]] [[diff:test-with_dummyserver-test_socketlevel.py:124-127]]

### Follow-ups

- Does a folded `Set-Cookie` still parse as one cookie after unfolding? | ask: After `_normalize_header_value` unfolds the `Set-Cookie` in the socket test, is the cookie value `___utmvbtouVBFmB=gZg XbNOjalT: Lte` still a single cookie, and what does a cookie jar do with the space in it?
- Why does the cookie case need the `HTTPMessage` rewritten too? | ask: Which consumer reads `Set-Cookie` from `_original_response.msg` rather than `HTTPHeaderDict`, and what would it do with the raw CRLF?

```json
{"anchor": {"quote": "a folded `Set-Cookie`", "block": "card:problem"}}
```