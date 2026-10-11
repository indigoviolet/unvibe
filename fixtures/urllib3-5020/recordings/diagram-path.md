```diagram
{
  "version": 1,
  "kind": "flow",
  "title": "Header data flow",
  "direction": "LR",
  "nodes": [
    {"id": "srv", "title": "Server", "sub": "folded header", "col": 0},
    {"id": "cli", "title": "http.client", "sub": "parse_headers", "col": 1},
    {"id": "msg", "title": "HTTPMessage", "sub": "value keeps CRLF", "state": "bad", "cite": "diff:conn:650-651", "col": 2},
    {"id": "norm", "title": "_normalize_header_values", "sub": "OWS CRLF RWS to SP", "state": "ok", "cite": "diff:conn:91-110", "col": 3},
    {"id": "dict", "title": "HTTPHeaderDict", "sub": "r.headers", "state": "ok", "cite": "diff:conn:650-651", "col": 4},
    {"id": "same", "title": "HTTPMessage, same object", "sub": "cookie jar", "state": "ok", "cite": "diff:tsock:139-146", "col": 4}
  ],
  "edges": [
    {"from": "srv", "to": "cli"},
    {"from": "cli", "to": "msg"},
    {"from": "msg", "to": "norm"},
    {"from": "norm", "to": "dict", "label": "new dict"},
    {"from": "norm", "to": "same", "label": "rebuilt in place"}
  ]
}
```

Caption: Where a response's headers go after parsing, and the one place they are now unfolded.

```json
{
  "title": "Header data flow"
}
```
