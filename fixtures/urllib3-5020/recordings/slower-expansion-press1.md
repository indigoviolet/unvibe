An `obs-fold` is what old servers do when a header value is too long for one line: they put the first half on one line, then a line break (CRLF) plus whitespace, then the rest of the value on the next line. The change joins the halves back together right after parsing, before any other code reads the headers, because every consumer downstream would otherwise see the raw split. The regex `_OBSOLETE_FOLD_RE` finds each split by reading any spaces or tabs first, then the CRLF, then the required whitespace that marks a continuation line. Wherever it matches, `_normalize_header_value` writes a single space, so the two halves become one value. [[diff:src-urllib3-connection.py:80-88]]

`_normalize_header_values` runs this over every header on Python's `HTTPMessage` in arrival order. When unfolding changes a value, it deletes the old headers and adds the cleaned ones back in the same order, so the `HTTPMessage` and urllib3's `HTTPHeaderDict` agree. The cleaned headers come back as the result, and `getresponse` builds the `HTTPHeaderDict` from them. [[diff:src-urllib3-connection.py:91-110]]
```json
{"slower": {}}
```
