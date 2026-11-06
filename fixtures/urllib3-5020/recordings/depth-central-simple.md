Old servers sometimes split one header value over two lines. This is called an `obs-fold`. The change joins those lines back together right after the response is parsed, before any other code reads the headers. A regex called `_OBSOLETE_FOLD_RE` finds each split: optional spaces or tabs, then a line break (CRLF), then at least one space or tab. The function `_normalize_header_value` swaps each split for a single space. [[diff:src-urllib3-connection.py:80-88]]

The function `_normalize_header_values` does this for every header on Python's own header object, the `HTTPMessage`. If a value changed, it deletes the headers from that object and adds them back in the same order. That way the `HTTPMessage` and urllib3's `HTTPHeaderDict` hold the same clean values. The function returns the cleaned headers, and `getresponse` builds the `HTTPHeaderDict` from them. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:647-651]]

```json
{"depth": {"level": "simple", "cardId": "central"}}
```