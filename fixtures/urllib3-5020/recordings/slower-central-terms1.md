An `obs-fold` is an obsolete folded header line: an old server splits one header value over two lines, continuing it on the next line after a line break (CRLF) plus whitespace. The change unfolds every such fold right after parsing, before anything else reads the headers. Unfolding means joining the split lines back into one value. `_OBSOLETE_FOLD_RE` is the pattern that finds each split, in three steps: first optional spaces or tabs, then the line break itself, then at least one space or tab starting the continuation. `_normalize_header_value` swaps each match it finds for a single space. [[diff:src-urllib3-connection.py:80-88]]

`_normalize_header_values` — the plural version — applies this to every header on Python's own header object, the `HTTPMessage`, in the order the headers arrived. If any value changed, it deletes the headers from that object and adds the cleaned ones back in the same order, so nothing is lost and nothing moves. That way the `HTTPMessage` and urllib3's `HTTPHeaderDict` hold the same clean values instead of disagreeing about what the server sent. The function returns the cleaned headers, and `getresponse` builds the `HTTPHeaderDict` from them, so cookie consumers such as Requests never see the raw split. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:647-651]]

```json
{"slower": {"cardId": "central"}}
```
