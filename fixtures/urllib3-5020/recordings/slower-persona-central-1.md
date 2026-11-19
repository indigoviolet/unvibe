An `obs-fold` is a header value split across two lines: the server sends the first half, then a line break (CRLF) plus whitespace, then the rest of the value on the next line. The change joins the halves back together right after parsing, before any other code reads the headers, because every consumer downstream would otherwise see the raw split. The regex `_OBSOLETE_FOLD_RE` finds each split by reading optional spaces or tabs, then the CRLF, then the required whitespace that marks a continuation. Wherever it matches, `_normalize_header_value` writes a single space, turning the two halves into one value. [[diff:src-urllib3-connection.py:80-88]]

`_normalize_header_values` repeats this for every header on Python's `HTTPMessage`, in arrival order. When unfolding changes a value, it deletes the old headers from the message object and adds the cleaned ones back in the same order, so the `HTTPMessage` and urllib3's `HTTPHeaderDict` agree with each other. The cleaned headers come back as the result, and `getresponse` builds the `HTTPHeaderDict` from them, which is why cookie consumers such as Requests now see one clean value per header. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:647-651]]

```json
{"slower": {"cardId": "central"}}
```
