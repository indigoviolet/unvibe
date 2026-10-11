```diagram
{
  "version": 1,
  "kind": "flow",
  "title": "Data flow from socket to headers",
  "direction": "LR",
  "nodes": [
    {"id": "sock", "title": "Server", "sub": "folded header", "col": 0},
    {"id": "client", "title": "http.client", "sub": "parse_headers", "cite": "diff:conn:650-651", "col": 1},
    {"id": "norm", "title": "_normalize_header_values", "sub": "OWS CRLF RWS to SP", "state": "ok", "cite": "diff:conn:85-88", "col": 2},
    {"id": "dict", "title": "HTTPHeaderDict", "sub": "r.headers", "state": "ok", "cite": "diff:conn:650-651", "col": 3},
    {"id": "msg", "title": "HTTPMessage, same object", "sub": "cookie jar", "state": "ok", "cite": "diff:tsock:139-146", "col": 3}
  ],
  "edges": [
    {"from": "sock", "to": "client"},
    {"from": "client", "to": "norm"},
    {"from": "norm", "to": "dict", "label": "new dict"},
    {"from": "norm", "to": "msg", "label": "rebuilt in place"}
  ]
}
```

Caption: Where a response's headers go after parsing, and the one place they are now unfolded.

1. `http.client` parses the response headers into an `HTTPMessage`. A folded value keeps its CRLF and leading whitespace.
2. `getresponse()` passes that message to `_normalize_header_values` instead of reading `.items()` directly. [[diff:conn:650]]
3. Each value goes through `_normalize_header_value`: values without CRLF return at once, folded ones are rewritten with the pattern. [[diff:conn:85-88]]
4. If any value changed, the message is rewritten in place: every header is deleted, then the normalized list is added back in the same order. [[diff:conn:102-108]]
5. `HTTPHeaderDict` is built from the same normalized list, so `r.headers` and `r._original_response.msg` agree. [[diff:conn:651]] [[diff:tsock:139-146]]

### Follow-ups

- What happens to a fold that ends in a bare LF? | ask: bare lf
- Does unfolding change header order? | ask: order

```json
{
  "title": "Data flow: from the socket to HTTPHeaderDict",
  "cardId": "g-flow"
}
```
