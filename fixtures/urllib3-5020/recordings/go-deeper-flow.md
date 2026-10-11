```d2
direction: right
sock: "Server sends a folded header"
client: "http.client parses into HTTPMessage" {link: "diff:conn:650-651"}
norm: "_normalize_header_values"
dict: "HTTPHeaderDict r.headers"
msg: "HTTPMessage same object" {link: "diff:tsock:139-146"}
sock -> client -> norm
norm -> dict
norm -> msg
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
