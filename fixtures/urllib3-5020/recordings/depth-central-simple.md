## The central idea

`getresponse` now cleans up the response headers before it builds `HTTPHeaderDict`. It does this with a new helper, `_normalize_header_values`. [[diff:src-urllib3-connection.py:650-651]]

- `_normalize_header_value` fixes one header value. A folded header is one split over two lines, with a line break (`\r\n`) and some spaces or tabs in the middle. The helper replaces each such break and its surrounding spaces with a single space. It uses the `_OBSOLETE_FOLD_RE` pattern to find them. If the value has no `\r\n`, it returns at once and does nothing. [[diff:src-urllib3-connection.py:80-88]]
- `_normalize_header_values` fixes every header in the response. It returns the cleaned list of `(name, value)` pairs. If any value changed, it also deletes all headers from the original `HTTPMessage` and adds the cleaned ones back in the same order. After that, the message and the `HTTPHeaderDict` hold the same values. [[diff:src-urllib3-connection.py:91-110]]

```json
{"depth": {"level": "simple", "cardId": "central"}}
```