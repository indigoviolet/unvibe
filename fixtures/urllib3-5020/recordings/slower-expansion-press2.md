Start with one detail at a time. First, what goes wrong without unfolding: an old server sends `Set-Cookie: a=1`, then a line break (CRLF), then a space, then `path=/`. Python's `HTTPMessage` keeps that raw split, urllib3 copies it into the `HTTPHeaderDict`, and a consumer such as Requests can re-emit the raw CRLF on a later request. The change fixes this right after parsing, before anything else reads the headers. Finding each split is the job of `_OBSOLETE_FOLD_RE`: optional whitespace, then the CRLF, then required whitespace. Wherever it matches, `_normalize_header_value` writes a single space. [[diff:src-urllib3-connection.py:80-88]]

Then watch the fix flow through `_normalize_header_values`, which runs the same unfolding over every header on the `HTTPMessage` in arrival order. When a value changes, the old headers come out and the cleaned ones go back in the same order, so the message and the `HTTPHeaderDict` agree. The cleaned headers come back as the result, and `getresponse` builds the `HTTPHeaderDict` from them. [[diff:src-urllib3-connection.py:91-110]] [[diff:src-urllib3-connection.py:647-651]]
```json
{"slower": {}}
```
