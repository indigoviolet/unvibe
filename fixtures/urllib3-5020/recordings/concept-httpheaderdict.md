## HTTPHeaderDict

`HTTPHeaderDict` is urllib3's mapping for response headers. It is case-insensitive and keeps duplicate fields, so `getlist("set-cookie")` returns each `Set-Cookie` line separately. In this change it is still built in `getresponse`, but from a different source. It used to be built straight from `httplib_response.msg.items()`. It is now built from the list that `_normalize_header_values` returns. [[diff:src-urllib3-connection.py:647-651]] [[desc:d-p2]]

`HTTPHeaderDict` is only one of two views of the headers. The other is the stdlib `HTTPMessage` (`httplib_response.msg`), which the response keeps as `_original_response`. Before the change both views held the raw `\r\n` from any `obs-fold`. [[desc:d-p1]]

### Why it matters here

Fixing `HTTPHeaderDict` alone would be incomplete. The description says cookie consumers such as Requests read the original message, so they could still re-emit the raw CRLF. For that reason `_normalize_header_values` does two jobs. It returns the normalized `(name, value)` items that feed `HTTPHeaderDict`. If any value changed, it also rewrites the `HTTPMessage` in place. This keeps the two views identical. [[diff:src-urllib3-connection.py:91-110]] [[desc:d-p2]]

The alternative was to normalize only `HTTPHeaderDict` and leave the stdlib object untouched. That is smaller and avoids mutating an object urllib3 does not own. It would not help consumers that read through `_original_response`. The cost of the chosen design is that urllib3 now mutates a stdlib object. The author's reasons are taken from the description. I did not check Requests' source. [[diff:src-urllib3-connection.py:102-108]]

Order and duplicates matter for `HTTPHeaderDict` too. The items come from `message.items()` in order. Only changed values are replaced in the list, so the `HTTPHeaderDict` sees the same header order and the same duplicate `Set-Cookie` entries as before, with unfolded values. [[diff:src-urllib3-connection.py:94-100]]

### Example

The socket-level test sends a folded cookie followed by an ordinary one:

```
Set-Cookie: ___utmvbtouVBFmB=gZg\r\n
    XbNOjalT: Lte; path=/; Max-Age=900\r\n
Set-Cookie: ordinary=1; Path=/\r\n
```

`r.headers.getlist("set-cookie")` returns:

- `"___utmvbtouVBFmB=gZg XbNOjalT: Lte; path=/; Max-Age=900"`
- `"ordinary=1; Path=/"`

The test then checks that `r._original_response.msg.get_all("set-cookie")` returns the same two values. The test also asserts that no value in `r.headers.values()` contains `\r` or `\n`. [[diff:test-with_dummyserver-test_socketlevel.py:99-103]] [[diff:test-with_dummyserver-test_socketlevel.py:124-146]]

```d2
direction: right

parsed: "HTTPMessage\n(raw CRLF)"
norm: "_normalize_header_values" {
  link: "diff:src-urllib3-connection.py:91-110"
}
items: "(name, value) items"
hd: "HTTPHeaderDict" {
  link: "diff:src-urllib3-connection.py:650-651"
}
synced: "HTTPMessage\n(synced)"
synced.class: [ok]

parsed -> norm
norm -> items: "returns"
items -> hd: "built from"
norm -> synced: "rewrites in place" {
  link: "diff:src-urllib3-connection.py:102-108"
}
```

Caption: Both views end up with the same unfolded values.

### Follow-ups

- Does `HTTPHeaderDict` get any other normalization? | ask: Does `HTTPHeaderDict` do anything with CRLF in values on its own, or does this change rely entirely on `_normalize_header_values` to remove it?
- Could `HTTPHeaderDict` and the `HTTPMessage` diverge after `getresponse`? | ask: After `getresponse` returns, can the `HTTPHeaderDict` and `_original_response.msg` drift apart, for example if a caller mutates one of them?
- What would a consumer see if only `HTTPHeaderDict` were normalized? | ask: If `_normalize_header_values` returned the items but skipped the in-place rewrite of the `HTTPMessage`, which assertions in the socket-level test would fail?

```json
{"title": "HTTPHeaderDict"}
```