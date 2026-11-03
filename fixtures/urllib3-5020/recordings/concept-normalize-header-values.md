`_normalize_header_values` is the function that unfolds every `obs-fold` in a parsed `HTTPMessage`. It does three things. It returns the `(name, value)` items that `getresponse` hands to `HTTPHeaderDict`. It runs `_normalize_header_value` on each value. If any value changed, it rewrites the original message so the message and the `HTTPHeaderDict` agree. [[diff:src-urllib3-connection.py:91-110]]

The steps are:

1. `message.items()` returns a list copy of the headers. [[diff:src-urllib3-connection.py:94]]
2. Each value goes through `_normalize_header_value`. A changed value replaces its tuple in that list, and `headers_changed` is set. [[diff:src-urllib3-connection.py:96-100]]
3. If anything changed, every header name is deleted from the message. Then all the items are re-added in their original order. [[diff:src-urllib3-connection.py:102-108]]
4. The list is returned. [[diff:src-urllib3-connection.py:110]]

`getresponse` replaced `HTTPHeaderDict(httplib_response.msg.items())` with a call to this function, and builds the `HTTPHeaderDict` from the returned items. [[diff:src-urllib3-connection.py:650-651]]

## Why it matters here

Before the change, the raw `\r\n` sat in both the `HTTPHeaderDict` and the original message. The description says cookie consumers such as Requests read the original message, and could re-emit the CRLF on the next request. So fixing only the `HTTPHeaderDict` would not be enough. The function keeps both views in step. [[desc:d-p2]]

Decision: mutate the stdlib `HTTPMessage` in place. The alternative was to normalize only the `HTTPHeaderDict`. That is smaller and avoids touching an object urllib3 does not own. The stated reason for in-place mutation is the Requests case above. The cost is that urllib3 now rewrites a stdlib object. The message keeps its identity, so existing references see the unfolded values. [[desc:d-p2]]

Decision: delete and re-add all headers, not only the changed ones. `message[name] = value` appends. Rewriting only the changed headers would move them to the end and break the order. Deleting and re-adding everything keeps order and duplicates without using private `HTTPMessage` internals. This reason is inferred. The description does not state it. [[diff:src-urllib3-connection.py:105-108]]

The rewrite runs only when something changed. Ordinary responses are not touched. [[diff:src-urllib3-connection.py:102]]

## Example

The unit test builds a message with interleaved duplicates:

| Step | Headers |
|---|---|
| Before | `X-First: one`, `Set-Cookie: a=1 \r\n two`, `X-Second: three`, `Set-Cookie: b=2` |
| After | `X-First: one`, `Set-Cookie: a=1 two`, `X-Second: three`, `Set-Cookie: b=2` |

The returned items equal `message.items()`. `get_all("Set-Cookie")` returns `["a=1 two", "b=2"]`. The payload, `defects` and `policy` keep their identity. [[diff:test-test_connection.py:226-249]]

```d2
direction: right
parsed: "HTTPMessage\n(raw CRLF)" {
  link: "diff:src-urllib3-connection.py:94-94"
}
fn: "_normalize_header_values" {
  link: "diff:src-urllib3-connection.py:91-110"
}
msg: "Same HTTPMessage\n(unfolded)" {
  link: "diff:src-urllib3-connection.py:102-108"
}
hd: "HTTPHeaderDict" {
  link: "diff:src-urllib3-connection.py:650-651"
}
parsed -> fn
fn -> msg: "delete + re-add"
fn -> hd: "returned items"
msg.class: [ok]
hd.class: [ok]
```

Caption: Both views of the headers end up with the same unfolded values.

Header-name case after delete and re-add is probably preserved, because the names come from `message.items()`. No test shows it.

### Follow-ups

- Does header-name case survive the rewrite? | ask: Does `_normalize_header_values` preserve the exact header-name case when it deletes and re-adds headers on the `HTTPMessage`? Which test would show it?
- Could only the changed headers be rewritten? | ask: Could `_normalize_header_values` rewrite only the headers whose values changed without breaking header order on the `HTTPMessage`?
- What can read the message before it is rewritten? | ask: Can anything read `httplib_response.msg` between parsing and `_normalize_header_values` running, and would it see the raw CRLF?

```json
{"title": "_normalize_header_values"}
```