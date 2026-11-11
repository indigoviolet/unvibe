## HTTPHeaderDict

`HTTPHeaderDict` is urllib3's response header mapping. It is a case-insensitive mapping that can hold several values for one name, such as two `Set-Cookie` fields. `getresponse` builds it from the header items of the `http.client` response message. The PR does not change the class. It changes what goes into it. [[diff:src-urllib3-connection.py:647-651]]

The mapping is one of two copies of the headers on a response. The other is the original `http.client.HTTPMessage`, which stays on the response as `_original_response.msg`. Before this change, `getresponse` copied `httplib_response.msg.items()` into `HTTPHeaderDict` unchanged. A value with an `obs-fold` therefore kept its raw `\r\n` in both copies. [[diff:src-urllib3-connection.py:647-651]] [[desc:d-p1]]

### Why it matters here

The fix has to leave the two copies in agreement. The description says that keeping `HTTPHeaderDict` and the original `HTTPMessage` synchronized is what stops cookie consumers such as Requests from re-emitting raw CRLF. [[desc:d-p2]]

The change achieves this by making `_normalize_header_values` the single source for both copies. It unfolds each value, writes the changed values back into the message, and returns the cleaned items. `getresponse` then builds `HTTPHeaderDict` from those returned items rather than reading `msg` a second time. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:650-651]]

One alternative was to clean only the `HTTPHeaderDict` copy. That would make `r.headers` look correct while `_original_response.msg` kept the CRLF, so the bug would remain for consumers that read the message. The description gives this as the reason for syncing both. [[desc:d-p2]]

Another alternative was to unfold inside `HTTPHeaderDict` itself. That would put `http.client`-specific cleanup into a general container. I infer this was not chosen, because the PR does not touch the class and keeps the helpers private to `connection.py`. The author does not state the reason.

The class also keeps duplicates. The returned items are a list of `(name, value)` pairs, so two `Set-Cookie` entries stay two entries and keep their order. [[diff:test-test_connection.py:238-246]]

### Example

The socket test sends a folded `Set-Cookie` and checks both copies:

- Wire: `Set-Cookie: ___utmvbtouVBFmB=gZg\r\n    XbNOjalT: Lte; path=/; Max-Age=900`, then `Set-Cookie: ordinary=1; Path=/`.
- `HTTPHeaderDict`: `r.headers.getlist("set-cookie")` gives `["___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900", "ordinary=1; Path=/"]`.
- Message: `r._original_response.msg.get_all("set-cookie")` gives the same list.
- Every value in `r.headers` is free of `\r` and `\n`.

[[diff:test-with_dummyserver-test_socketlevel.py:99-103]] [[diff:test-with_dummyserver-test_socketlevel.py:124-137]] [[diff:test-with_dummyserver-test_socketlevel.py:142-145]]

```d2
direction: right

msg: "HTTPMessage\n(folded values)"
norm: "_normalize_header_values" {
  link: "diff:src-urllib3-connection.py:91-110"
}
back: "msg rewritten\nin place" {
  link: "diff:src-urllib3-connection.py:102-108"
}
items: "cleaned items" {
  link: "diff:src-urllib3-connection.py:110"
}
hd: "HTTPHeaderDict" {
  link: "diff:src-urllib3-connection.py:650-651"
}
msg -> norm
norm -> back
norm -> items
items -> hd
```

Caption: Both the message and `HTTPHeaderDict` are fed from one pass over the values.

### Follow-ups

- Does `HTTPHeaderDict` merge duplicate `Set-Cookie` fields, and does that change what the tests see? | ask: How does HTTPHeaderDict store duplicate Set-Cookie entries built from the list of tuples that _normalize_header_values returns, and why does getlist still give two items?
- Could the returned items and `msg` ever disagree? | ask: Can the items returned by _normalize_header_values differ from the rewritten HTTPMessage, for example when two headers differ only in name casing?
- Why build `HTTPHeaderDict` from the return value rather than from `msg`? | ask: What would change if getresponse built HTTPHeaderDict from httplib_response.msg.items() after _normalize_header_values ran?

```json
{"title": "HTTPHeaderDict"}
```