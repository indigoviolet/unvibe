```d2
direction: right
server: "Server folded header"
client: "http.client parse_headers"
msg: "HTTPMessage value keeps CRLF"
norm: "_normalize_header_values" {link: "diff:conn:91-110"}
dict: "HTTPHeaderDict r.headers" {link: "diff:conn:650-651"}
same: "HTTPMessage same object" {link: "diff:tsock:139-146"}
server -> client -> msg -> norm
norm -> dict: "new dict"
norm -> same: "rebuilt in place"
```

Caption: Where a response's headers go after parsing, and the one place they are now unfolded.

```json
{
  "title": "Header data flow"
}
```
