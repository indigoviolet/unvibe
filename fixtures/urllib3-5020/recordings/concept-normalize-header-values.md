`_normalize_header_values` is the message-level helper in `connection.py`. It takes the `http.client.HTTPMessage` from a response and unfolds every `obs-fold` in its values. If any value changed, it rewrites the same message object. It returns the list of `(name, value)` items, which `getresponse` uses to build `HTTPHeaderDict`. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:650-651]]

It works in three steps:

1. It reads `message.items()` and runs each value through `_normalize_header_value`. That function skips values with no `\r\n` and otherwise replaces each `obs-fold` with one space. [[diff:src-urllib3-connection.py:94-100]] [[diff:src-urllib3-connection.py:85-88]]
2. If at least one value changed (`headers_changed`), it deletes every name from the message and re-adds the names in `header_items` order. [[diff:src-urllib3-connection.py:102-108]]
3. It returns `header_items` whether or not anything changed. [[diff:src-urllib3-connection.py:110]]

## Why it matters here

The problem has two copies of the headers. Before the change, `getresponse` built `HTTPHeaderDict` straight from `httplib_response.msg.items()`. The original `HTTPMessage` stayed on the response, and the description says cookie consumers such as Requests read it. Cleaning only `HTTPHeaderDict` would leave raw CRLF in the message. [[diff:src-urllib3-connection.py:647-651]] [[desc:d-p2]]

This helper is where both copies are made to agree. The code comment says it keeps the message in sync "while preserving its identity and header ordering". [[diff:src-urllib3-connection.py:103-104]]

Other designs were possible:

- **Clean only the `HTTPHeaderDict` copy.** This is the smaller change, but it does not fix what Requests reads (the description's stated reason).
- **Build a new `HTTPMessage` and swap it in.** This would change object identity. The socket test asserts `_original_response.headers is _original_response.msg`, and the unit test asserts `defects` and `policy` are the same objects. [[diff:test-with_dummyserver-test_socketlevel.py:141]] [[diff:test-test_connection.py:248-249]]

Why the author chose delete-and-re-add over a swap is my inference. The tests are consistent with that reason, but the description doesn't state it.

The costs are that urllib3 now rewrites an object it does not own, and it relies on `HTTPMessage` semantics. `del message[name]` removes every occurrence of a name, and `message[name] = value` appends. That works because the loop first removes all names and then re-adds them in the original sequence, so duplicates keep their order. The `headers_changed` guard means responses without folds never touch the message.

## Example

This is the unit test for the helper. The message holds `X-First`, a folded `Set-Cookie`, `X-Second`, and a second `Set-Cookie`. [[diff:test-test_connection.py:226-249]]

| Step | State |
|---|---|
| Before | `Set-Cookie: "a=1 \r\n two"`, followed later by `Set-Cookie: "b=2"` |
| Return value | `[("X-First","one"), ("Set-Cookie","a=1 two"), ("X-Second","three"), ("Set-Cookie","b=2")]` |
| Message after | `message.items()` equals the same list, and `get_all("Set-Cookie") == ["a=1 two", "b=2"]` |
| Unchanged | payload, `defects` identity and `policy` identity |

Only the first `Set-Cookie` is folded, but the rewrite removes and re-adds all four headers. The order stays the same because the re-add follows `header_items`.

```d2
direction: right

msg: "HTTPMessage\n(folded values)" {
  link: "diff:src-urllib3-connection.py:94-94"
}
norm: "_normalize_header_value\nper value" {
  link: "diff:src-urllib3-connection.py:97-97"
}
rewrite: "delete and re-add\nsame message" {
  link: "diff:src-urllib3-connection.py:105-108"
}
items: "returned items" {
  link: "diff:src-urllib3-connection.py:110-110"
}
hd: "HTTPHeaderDict" {
  link: "diff:src-urllib3-connection.py:650-651"
}

msg -> norm
norm -> rewrite: "if changed"
norm -> items
items -> hd
```

Caption: Values are unfolded once. The same result updates the message and feeds `HTTPHeaderDict`.

### Follow-ups

- Does the rewrite keep each header's original name casing? | ask: When `_normalize_header_values` deletes and re-adds names from `message.items()`, can a differently-cased duplicate name be lost or merged?
- Can a consumer see a half-rewritten message? | ask: Between the delete loop and the re-add loop in `_normalize_header_values`, can any other code observe the `HTTPMessage` with headers missing?
- Why return the items instead of reading `msg` again? | ask: What would differ if `getresponse` built `HTTPHeaderDict` from `httplib_response.msg.items()` after calling `_normalize_header_values`?

```json
{"title": "_normalize_header_values"}
```